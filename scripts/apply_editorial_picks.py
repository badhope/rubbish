"""Apply editor-curated picks to the catalog DB.

The source of truth is ``content/editorial/picks.json``. Keeping the
seed outside a migration makes it possible to change the homepage pool
without a schema release; the script is idempotent and only updates the
rows named in the JSON.

Usage (from repo root, with the backend virtualenv available)::

    PYTHONPATH=apps/backend apps/backend/.venv/bin/python \
        scripts/apply_editorial_picks.py

On the production host, point ``--env-file`` at the deployment ``.env``
or export the same variables before running.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PICKS = ROOT / "content" / "editorial" / "picks.json"


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("RUBBISH_DATABASE_URL")
    if url:
        return url.replace("postgresql+asyncpg://", "postgresql://", 1)
    # Import lazily so the script can be inspected without the app env.
    sys.path.insert(0, str(ROOT / "apps" / "backend"))
    from app.core.config import settings  # type: ignore[import-not-found]

    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _tenant_slug() -> str:
    if os.environ.get("RUBBISH_BOOTSTRAP_TENANT_SLUG"):
        return os.environ["RUBBISH_BOOTSTRAP_TENANT_SLUG"]
    sys.path.insert(0, str(ROOT / "apps" / "backend"))
    from app.core.config import settings  # type: ignore[import-not-found]

    return settings.bootstrap_tenant_slug


async def apply(picks_path: Path) -> None:
    payload = json.loads(picks_path.read_text(encoding="utf-8"))
    picks = payload.get("picks") or []
    if not picks:
        raise SystemExit("no picks in JSON")

    conn = await asyncpg.connect(_database_url())
    try:
        tenant_id = await conn.fetchval(
            "SELECT id FROM tenants WHERE slug = $1", _tenant_slug()
        )
        if tenant_id is None:
            raise SystemExit(f"tenant not found: {_tenant_slug()}")
        await conn.execute(
            "SELECT set_config('app.current_tenant_id', $1, false)", str(tenant_id)
        )

        for pick in picks:
            await conn.execute(
                """
                UPDATE resources
                   SET short_title = $2,
                       editor_note = $3,
                       discussion_prompt = $4,
                       featured_rank = $5,
                       reading_path = $6,
                       abstract = $7,
                       preview = left($7, 500),
                       updated_at = now()
                 WHERE id = $1
                   AND tenant_id = $8
                """,
                int(pick["id"]),
                pick["short_title"],
                pick["editor_note"],
                pick["discussion_prompt"],
                int(pick["featured_rank"]),
                pick["reading_path"],
                pick["abstract"],
                tenant_id,
            )
        print(f"applied {len(picks)} editorial picks")
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--picks", type=Path, default=DEFAULT_PICKS)
    args = parser.parse_args()
    asyncio.run(apply(args.picks))


if __name__ == "__main__":
    main()
