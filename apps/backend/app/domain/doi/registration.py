"""DataCite REST API adapter for DOI minting.

Design (mirrors ``app/core/search.py``'s Meilisearch integration):

- ``settings.datacite_api_url`` empty → everything is a no-op.
- API key missing / server down → log a warning and return a failure
  result. DOI registration failures NEVER block the write path.
- Supports both DOI minting (new DOI) and DOI updating (metadata sync).

DataCite MDS (Metadata Service) docs:
https://support.datacite.org/docs/api-mds
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

DATACITE_API_URL = "https://api.datacite.org"
HTTP_TIMEOUT = 15.0


def datacite_enabled() -> bool:
    """True when the DataCite base URL, prefix and credential are present."""
    return bool(
        settings.datacite_api_url and settings.datacite_prefix and settings.datacite_api_key
    )


def _api_base() -> str:
    """Resolve the configured API base instead of silently using api.datacite.org."""
    return (settings.datacite_api_url or DATACITE_API_URL).rstrip("/")


def _auth_headers() -> dict[str, str]:
    # ``RUBBISH_DATACITE_API_KEY`` is documented as a base64-encoded
    # "username:password" pair. Do not double-encode it here; operators who
    # paste the raw pair should use the documented generation command.
    return {
        "Content-Type": "application/vnd.api+json",
        "Authorization": f"Basic {settings.datacite_api_key.strip()}",
    }


def _landing_url(resource: Any, doi: str) -> str:
    """Public landing page for the DOI.

    DataCite metadata must point at the article, not back at ``doi.org``:
    a self-referential URL sends readers into a redirect loop.
    """
    base = (settings.public_base_url or settings.frontend_base_url or "").strip().rstrip("/")
    if base:
        return f"{base}/catalog/{getattr(resource, 'id', '')}"
    return f"https://doi.org/{doi}"


def _build_doi(suffix: str) -> str:
    """Build a full DOI from the configured prefix and the given suffix."""
    return f"{settings.datacite_prefix}/{suffix}"


def _build_datacite_metadata(resource: Any, doi: str) -> dict[str, Any]:
    """Build a DataCite 4.x JSON metadata payload from a Resource model."""
    from app.core.time import utcnow

    authors_list = []
    for author in resource.authors or []:
        if isinstance(author, dict):
            name = str(author.get("name") or "").strip()
            if not name:
                continue
            creator = {
                "name": name,
                "nameType": "Personal",
                "givenName": author.get("given_name", ""),
                "familyName": author.get("family_name", ""),
            }
            orcid = str(author.get("orcid") or "").strip()
            if orcid:
                creator["nameIdentifiers"] = [
                    {
                        "nameIdentifier": orcid,
                        "nameIdentifierScheme": "ORCID",
                        "schemeUri": "https://orcid.org",
                    }
                ]
            authors_list.append(creator)
        elif str(author).strip():
            authors_list.append({"name": str(author).strip(), "nameType": "Personal"})

    return {
        "data": {
            "type": "dois",
            "attributes": {
                "doi": doi,
                "creators": authors_list,
                "titles": [{"title": resource.title}],
                "publisher": resource.publisher or "Rubbish",
                "publicationYear": str(resource.year or utcnow().year),
                "types": {
                    "resourceTypeGeneral": "Text",
                    "resourceType": resource.type or "JournalArticle",
                },
                "descriptions": (
                    [{"description": resource.abstract[:5000], "descriptionType": "Abstract"}]
                    if resource.abstract
                    else []
                ),
                "url": _landing_url(resource, doi),
                "subjects": ([{"subject": tag} for tag in (resource.tags or [])[:10]]),
            },
        }
    }


def _default_suffix(resource: Any) -> str:
    """默认 DOI 后缀：必须带租户维度。

    ``resources.id`` 是**全局自增**，多租户部署下租户 A 的 #7 与租户 B 的 #7
    会铸出同一个 DOI。DOI 是学术永久标识，撞号不可撤销，会直接污染引用与
    DataCite 账目，所以默认后缀必须含租户标识。

    ``tenant_id`` 缺失时（单测用的替身对象）退回纯 id，保证可测性。
    """
    tenant_id = getattr(resource, "tenant_id", None)
    if tenant_id is None:
        return str(resource.id)
    return f"{resource.id}-{str(tenant_id)[:8]}"


async def mint_doi(
    resource: Any,
    suffix: str | None = None,
) -> tuple[str, str]:
    """Mint a new DOI for the given resource.

    Returns (doi, state) where state is "completed" or "failed".

    Steps:
    1. Look up the DOI (retry-safe) and create/update metadata.
    2. Publish (make findable) via DataCite REST.
    """
    if not datacite_enabled():
        return "", "failed"

    # 默认后缀必须带租户维度：resources.id 是**全局自增**，多租户部署下
    # 租户 A 的 #7 和租户 B 的 #7 会铸出同一个 DOI。DOI 是学术永久标识，
    # 撞号不可撤销，会直接污染引用与 DataCite 账目。
    doi_suffix = suffix or _default_suffix(resource)
    doi = _build_doi(doi_suffix)

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            base = _api_base()
            headers = _auth_headers()
            metadata = _build_datacite_metadata(resource, doi)
            landing_url = _landing_url(resource, doi)

            # Retry-safe: a previous attempt may have created the DOI and
            # failed on the publish step. GET first so a retry does not
            # attempt to create the same DOI twice.
            existing = await client.get(f"{base}/dois/{doi}", headers=headers)
            if existing.status_code >= 400 and existing.status_code != 404:
                logger.warning(
                    "DataCite DOI lookup failed: %s %s",
                    existing.status_code,
                    existing.text[:500],
                )
                return doi, "failed"

            if existing.status_code == 404:
                meta_resp = await client.post(
                    f"{base}/dois",
                    headers=headers,
                    json=metadata,
                )
                if meta_resp.status_code >= 400:
                    logger.warning(
                        "DataCite metadata POST failed: %s %s",
                        meta_resp.status_code,
                        meta_resp.text[:500],
                    )
                    return doi, "failed"
            else:
                # Metadata may have changed since the draft was created.
                update_resp = await client.put(
                    f"{base}/dois/{doi}",
                    headers=headers,
                    json=metadata,
                )
                if update_resp.status_code >= 400:
                    logger.warning(
                        "DataCite metadata update failed: %s %s",
                        update_resp.status_code,
                        update_resp.text[:500],
                    )
                    return doi, "failed"

            # DataCite REST uses an ``event`` attribute to transition a
            # draft DOI to findable.
            register_payload = {
                "data": {
                    "type": "dois",
                    "attributes": {
                        "doi": doi,
                        "url": landing_url,
                        "event": "publish",
                    },
                }
            }
            reg_resp = await client.put(
                f"{base}/dois/{doi}",
                headers=headers,
                json=register_payload,
            )
            if reg_resp.status_code >= 400:
                logger.warning(
                    "DataCite DOI register failed: %s %s",
                    reg_resp.status_code,
                    reg_resp.text[:500],
                )
                return doi, "failed"

    except httpx.TimeoutException:
        logger.warning("DataCite API timeout")
        return doi, "failed"
    except httpx.RequestError as exc:
        logger.warning("DataCite request failed: %s", exc)
        return doi, "failed"

    return doi, "completed"


__all__ = [
    "datacite_enabled",
    "mint_doi",
]
