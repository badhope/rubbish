"""The SPA deep-link whitelist must cover every real top-level frontend route."""

from pathlib import Path

import pytest

from app.main import _SPA_ROUTE_PREFIXES

FRONTEND_ROUTES = Path(__file__).resolve().parents[3] / "apps" / "frontend" / "src" / "routes"

EXPECTED = {
    "admin",
    "catalog",
    "editor",
    "forum",
    "issues",
    "library",
    "levels",
    "me",
    "more",
    "privacy",
    "restore-account",
    "review",
    "submissions",
    "u",
}


def test_workbench_and_studio_deep_links_are_routable():
    missing = EXPECTED - _SPA_ROUTE_PREFIXES
    assert not missing, f"deep links would 404: {sorted(missing)}"


def test_every_frontend_top_level_route_is_routable():
    """A new page must be added to the backend whitelist or direct links 404."""
    if not FRONTEND_ROUTES.is_dir():
        pytest.skip("frontend route directory is not present in this checkout")
    missing: set[str] = set()
    for route_file in FRONTEND_ROUTES.rglob("*.tsx"):
        relative = route_file.relative_to(FRONTEND_ROUTES)
        # TanStack file routes use dots for nesting: catalog.$id.tsx => catalog/$id.
        top = relative.parts[0].split(".", 1)[0]
        if top.startswith("_") or top == "index":
            continue
        if top not in _SPA_ROUTE_PREFIXES:
            missing.add(top)
    assert not missing, f"direct links would 404: {sorted(missing)}"
