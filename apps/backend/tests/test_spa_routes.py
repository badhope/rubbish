"""The SPA deep-link whitelist must cover every real top-level frontend route."""

from app.main import _SPA_ROUTE_PREFIXES

EXPECTED = {
    "admin",
    "catalog",
    "editor",
    "forum",
    "ingest",
    "issues",
    "library",
    "levels",
    "me",
    "review",
    "studio",
    "submissions",
    "u",
}


def test_workbench_and_studio_deep_links_are_routable():
    missing = EXPECTED - _SPA_ROUTE_PREFIXES
    assert not missing, f"deep links would 404: {sorted(missing)}"
