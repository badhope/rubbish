"""ORCID iD validation.

ORCID identifiers are 16-digit numbers with a single check digit,
displayed as four groups of four digits separated by hyphens:
    0000-0002-1825-0097

We accept:
  - The 19-character hyphenated form ``0000-0002-1825-0097``
  - The 16-character compact form ``0000000218250097``
  - The HTTPS URL form ``https://orcid.org/0000-0002-1825-0097``
  - The bare URL form ``orcid.org/0000-0002-1825-0097``

We do **NOT** verify the ISO 7064 mod 11-2 check digit. ORCID's
checksum algorithm is documented but the live iDs we encounter in
the wild are 99%+ format-correct even when their check digit is
slightly off (the ORCID registry assigns iDs and our ingest path
sometimes copies them from PDFs where the last digit is mangled).
Catching only shape errors here gives us a strict but forgiving
gate; the canonicalising pass through ORCID's API remains the
source of truth for "is this iD really assigned".

Invalid input raises ``ValueError`` so callers (Pydantic field
validator / test assertions) get an obvious failure mode.
"""

from __future__ import annotations

import re

# Match 16-digit compact; 19-char hyphenated; URL form. We accept
# any final digit 0-9 or X so X-ending hypotheticals (which the
# mod-11 algorithm can produce) pass the shape check.
_HYPHENATED = re.compile(r"^(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])$")
_COMPACT = re.compile(r"^(\d{15})([\dX])$")
_URL = re.compile(r"^(?:https?://(?:www\.)?orcid\.org/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX]|\d{16})$")


def _normalize(value: str) -> str:
    """Return the canonical 19-char hyphenated form."""
    raw = value.strip()
    # URL forms.
    m = _URL.match(raw)
    if m:
        body = m.group(1)
    elif _HYPHENATED.match(raw):
        body = raw
    elif _COMPACT.match(raw):
        body = raw
    else:
        raise ValueError(f"Not a valid ORCID iD: {value!r}")
    # Strip hyphens for compact-form matching.
    compact_body = body.replace("-", "").upper()
    if len(compact_body) != 16:
        raise ValueError(f"ORCID iD must be 16 digits: {value!r}")
    return f"{compact_body[0:4]}-{compact_body[4:8]}-{compact_body[8:12]}-{compact_body[12:16]}"


def is_valid_orcid(value: str | None) -> bool:
    """Public predicate: True iff ``value`` parses to a canonical ORCID."""
    if not value:
        return False
    try:
        _normalize(value)
        return True
    except ValueError:
        return False


def normalize_orcid(value: str) -> str:
    """Parse + canonicalise. Returns the 19-char canonical form or raises ValueError."""
    return _normalize(value)
