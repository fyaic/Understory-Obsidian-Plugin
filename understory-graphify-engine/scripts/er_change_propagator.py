"""Find documents affected by ER entity changes."""
from __future__ import annotations

from pathlib import Path

try:
    from .er_models import get_er_connection, get_er_db_path, init_er_database
except ImportError:
    from er_models import get_er_connection, get_er_db_path, init_er_database


def get_docs_affected_by_entity_change(
    entity_id: int,
    vault: str | Path,
    db_path: str | Path | None = None,
    limit: int = 100,
) -> list[str]:
    """Return vault-relative docs whose ER-derived relation suggestions may change."""
    vault_path = Path(vault).expanduser().resolve()
    db = Path(db_path) if db_path is not None else get_er_db_path(vault_path)
    if not db.exists():
        return []
    init_er_database(db)
    with get_er_connection(db) as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT doc_path FROM doc_entities WHERE entity_id = ?
            UNION
            SELECT DISTINCT de.doc_path
            FROM relations r
            JOIN doc_entities de
              ON de.entity_id = CASE
                    WHEN r.from_entity_id = ? THEN r.to_entity_id
                    WHEN r.to_entity_id = ? THEN r.from_entity_id
                 END
            WHERE r.from_entity_id = ? OR r.to_entity_id = ?
            UNION
            SELECT DISTINCT source_doc FROM entities WHERE id = ?
            UNION
            SELECT DISTINCT e.source_doc
            FROM relations r
            JOIN entities e
              ON e.id = CASE
                    WHEN r.from_entity_id = ? THEN r.to_entity_id
                    WHEN r.to_entity_id = ? THEN r.from_entity_id
                 END
            WHERE r.from_entity_id = ? OR r.to_entity_id = ?
            """,
            (
                entity_id,
                entity_id,
                entity_id,
                entity_id,
                entity_id,
                entity_id,
                entity_id,
                entity_id,
                entity_id,
                entity_id,
            ),
        ).fetchall()

    docs = []
    seen = set()
    for row in rows:
        path = row[0]
        if not path:
            continue
        rel = str(path).replace("\\", "/")
        if rel in seen or not (vault_path / rel).exists():
            continue
        seen.add(rel)
        docs.append(rel)
    docs.sort()
    return docs[:limit]
