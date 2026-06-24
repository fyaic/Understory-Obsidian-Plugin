"""Rule-based entity mention extraction for the ER bridge layer."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

try:
    from .er_models import EntityDAO, get_er_db_path
except ImportError:
    from er_models import EntityDAO, get_er_db_path


def _entity_terms(entity) -> list[str]:
    terms = [entity.name]
    terms.extend(entity.aliases or [])
    seen = set()
    out = []
    for term in terms:
        value = str(term).strip()
        if len(value) < 2:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def build_entity_mention_index(db_path: str | Path) -> list[dict[str, Any]]:
    """Load entities into a compact mention index."""
    db = Path(db_path)
    if not db.exists():
        return []
    entities = EntityDAO(db).list_all()
    index = []
    for entity in entities:
        terms = _entity_terms(entity)
        if not terms or entity.id is None:
            continue
        index.append(
            {
                "entity_id": int(entity.id),
                "entity_name": entity.name,
                "entity_type": entity.type,
                "terms": terms,
            }
        )
    return index


def _is_ascii_wordish(term: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.-]*", term))


def _iter_matches(text: str, term: str):
    flags = re.IGNORECASE if _is_ascii_wordish(term) else 0
    if _is_ascii_wordish(term):
        pattern = rf"(?<![A-Za-z0-9_]){re.escape(term)}(?![A-Za-z0-9_])"
    else:
        pattern = re.escape(term)
    return re.finditer(pattern, text, flags)


def _context(text: str, start: int, end: int, radius: int = 48) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return re.sub(r"\s+", " ", text[left:right]).strip()


def extract_entity_mentions(
    content: str,
    db_path: str | Path | None = None,
    vault: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Extract entity mentions by exact name/alias matching."""
    if db_path is None:
        if vault is None:
            raise ValueError("Either db_path or vault is required")
        db_path = get_er_db_path(vault)

    mentions = []
    for entry in build_entity_mention_index(db_path):
        spans = set()
        matched_terms = set()
        contexts: list[str] = []
        for term in entry["terms"]:
            for match in _iter_matches(content, term):
                span = (match.start(), match.end())
                if span in spans:
                    continue
                spans.add(span)
                matched_terms.add(term)
                if len(contexts) < 3:
                    contexts.append(_context(content, match.start(), match.end()))
        if not spans:
            continue
        mentions.append(
            {
                "entity_id": entry["entity_id"],
                "entity_name": entry["entity_name"],
                "entity_type": entry["entity_type"],
                "mention_count": len(spans),
                "matched_terms": sorted(matched_terms),
                "contexts": contexts,
            }
        )
    mentions.sort(key=lambda item: (-item["mention_count"], item["entity_name"]))
    return mentions
