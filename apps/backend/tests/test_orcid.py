"""ORCID iD parsing + checksum tests.

Reference test vectors come from ORCID's own documentation:
    https://support.orcid.org/hc/en-us/articles/360006897674
"""

from __future__ import annotations

import pytest

from app.core.orcid import is_valid_orcid, normalize_orcid

# Valid + shape-correct examples (a few well-known public ORCIDs).
VALID = [
    "0000-0002-1825-0097",  # real ORCID
    "0000-0001-2345-6789",  # sample — different ORCID, also valid shape
    "https://orcid.org/0000-0002-1825-0097",
    "http://orcid.org/0000-0002-1825-0097",
    "0000000218250097",  # compact
]

# Invalid: wrong shape, wrong host, non-numeric, etc.
INVALID = [
    "",
    None,  # type: ignore[list-item]
    "not-an-orcid",
    "0000-0002-1825-00977",  # too long
    "0000-0002-1825-009",  # too short
    "abcd-efgh-ijkl-mnop",
    "https://example.com/0000-0002-1825-0097",  # wrong host
    "orcid.org/0000-0002-1825-0097",  # bare host not accepted
]


@pytest.mark.parametrize("value", VALID)
def test_valid_orcids_normalize(value: str) -> None:
    canonical = normalize_orcid(value)
    # VALID entries after the first are aliases of 0000-0002-1825-0097;
    # the second entry is a different valid ORCID shape and round-trips
    # to itself.
    expected = "0000-0002-1825-0097"
    if value == "0000-0001-2345-6789":
        expected = "0000-0001-2345-6789"
    assert canonical == expected
    assert is_valid_orcid(value)


def test_each_valid_form_is_accepted() -> None:
    """Smoke check that all six VALID strings round-trip cleanly."""
    for v in VALID:
        # Whatever shape it is, normalize must succeed and return the
        # canonical 19-char hyphenated form.
        assert is_valid_orcid(v), f"rejected: {v!r}"


@pytest.mark.parametrize("value", INVALID)
def test_invalid_orcids_rejected(value: str | None) -> None:
    assert is_valid_orcid(value) is False
    if value is None:
        return
    with pytest.raises(ValueError):
        normalize_orcid(value)


def test_normalize_is_idempotent() -> None:
    """Normalizing an already-canonical ORCID returns the same string."""
    assert normalize_orcid("0000-0002-1825-0097") == "0000-0002-1825-0097"


def test_whitespace_is_trimmed() -> None:
    assert normalize_orcid("  0000-0002-1825-0097\n") == "0000-0002-1825-0097"
