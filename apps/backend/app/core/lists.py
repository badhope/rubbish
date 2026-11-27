"""Shared list-field hygiene for author-entered keywords, tags and affiliations.

Authors paste keyword lines from manuscripts. Those lines routinely use
Chinese punctuation (``，``), semicolons (``；``) or the enumeration comma
(``、``), while older clients only split on ASCII commas.  The result was a
single 60-character "keyword" that no search facet could ever match, and a
tag shelf that quietly lost every term.

Normalising on the schema boundary keeps HTTP, batch import and worker paths
consistent; materialisation repeats it as a last line of defence because old
submissions were stored before this rule existed.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_LIST_SEPARATOR = re.compile(r"[,，;；、]+")
_EDGE_PUNCTUATION = " \t\r\n　"


def normalize_string_list(
    values: Iterable[object] | object | None,
    *,
    max_items: int | None = None,
    max_length: int = 120,
) -> list[str] | None:
    """Split, trim, de-duplicate and cap a list of free-text values.

    ``None`` is preserved so PATCH bodies can distinguish "not supplied" from
    "clear the field".  A bare string is accepted because batch imports and
    older clients sometimes send ``"a；b"`` where the schema expects a list.
    """
    if values is None:
        return None
    if isinstance(values, str):
        raw_values: list[object] = [values]
    elif isinstance(values, Iterable):
        raw_values = list(values)
    else:
        raw_values = [values]

    out: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        text = str(raw or "").strip(_EDGE_PUNCTUATION)
        if not text:
            continue
        for part in _LIST_SEPARATOR.split(text):
            item = part.strip(_EDGE_PUNCTUATION)
            if not item:
                continue
            key = item.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(item[:max_length])
            if max_items is not None and len(out) >= max_items:
                return out
    return out
