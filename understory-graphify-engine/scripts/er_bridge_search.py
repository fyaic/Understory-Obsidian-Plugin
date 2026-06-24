"""Bridge ER entities into document relation discovery."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    from .er_models import get_er_connection, get_er_db_path, init_er_database
    from .ner_simple import extract_entity_mentions
except ImportError:
    from er_models import get_er_connection, get_er_db_path, init_er_database
    from ner_simple import extract_entity_mentions


def _doc_rel_path(doc_path: str | Path, vault: str | Path) -> str:
    vault_path = Path(vault).expanduser().resolve()
    path = Path(doc_path).expanduser()
    if not path.is_absolute():
        return str(path).replace("\\", "/")
    try:
        return path.resolve().relative_to(vault_path).as_posix()
    except ValueError:
        return str(path).replace("\\", "/")


def write_doc_entities(
    doc_path: str | Path,
    mentions: list[dict[str, Any]],
    vault: str | Path,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Replace the doc->entity mention rows for one document."""
    vault_path = Path(vault).expanduser().resolve()
    db = Path(db_path) if db_path is not None else get_er_db_path(vault_path)
    if not db.exists():
        return {"status": "skipped", "reason": "er_db_missing", "written": 0}

    init_er_database(db)
    rel_path = _doc_rel_path(doc_path, vault_path)
    entity_ids = [int(item["entity_id"]) for item in mentions]

    with get_er_connection(db) as conn:
        if entity_ids:
            placeholders = ",".join("?" for _ in entity_ids)
            conn.execute(
                f"DELETE FROM doc_entities WHERE doc_path = ? AND entity_id NOT IN ({placeholders})",
                (rel_path, *entity_ids),
            )
        else:
            conn.execute("DELETE FROM doc_entities WHERE doc_path = ?", (rel_path,))

        for item in mentions:
            count = int(item.get("mention_count") or 1)
            confidence = min(0.95, 0.55 + min(count, 4) * 0.1)
            contexts = {
                "matched_terms": item.get("matched_terms") or [],
                "snippets": item.get("contexts") or [],
            }
            conn.execute(
                """
                INSERT INTO doc_entities
                    (doc_path, entity_id, mention_count, contexts, confidence, extracted_by)
                VALUES (?, ?, ?, ?, ?, 'rule')
                ON CONFLICT(doc_path, entity_id) DO UPDATE SET
                    mention_count = excluded.mention_count,
                    contexts = excluded.contexts,
                    confidence = excluded.confidence,
                    extracted_by = excluded.extracted_by,
                    last_seen_at = datetime('now')
                """,
                (
                    rel_path,
                    int(item["entity_id"]),
                    count,
                    json.dumps(contexts, ensure_ascii=False),
                    confidence,
                ),
            )

    return {"status": "ok", "doc_path": rel_path, "written": len(mentions)}


def refresh_doc_entities_for_content(
    doc_path: str | Path,
    content: str,
    vault: str | Path,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Extract mentions for one document and persist doc_entities."""
    vault_path = Path(vault).expanduser().resolve()
    db = Path(db_path) if db_path is not None else get_er_db_path(vault_path)
    if not db.exists():
        return {"status": "skipped", "reason": "er_db_missing", "written": 0}
    mentions = extract_entity_mentions(content, db_path=db)
    return write_doc_entities(doc_path, mentions, vault_path, db_path=db)


def er_extend_relations(
    doc_path: str | Path,
    vault: str | Path,
    top_k: int = 10,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Find related documents through one-hop authoritative ER relations."""
    vault_path = Path(vault).expanduser().resolve()
    db = Path(db_path) if db_path is not None else get_er_db_path(vault_path)
    if not db.exists():
        return []
    init_er_database(db)
    rel_path = _doc_rel_path(doc_path, vault_path)

    with get_er_connection(db) as conn:
        source_rows = conn.execute(
            """
            SELECT de.entity_id, de.mention_count, e.name, e.type
            FROM doc_entities de
            JOIN entities e ON e.id = de.entity_id
            WHERE de.doc_path = ?
            """,
            (rel_path,),
        ).fetchall()
        if not source_rows:
            return []

        source_ids = [int(row["entity_id"]) for row in source_rows]
        source_mentions = {int(row["entity_id"]): int(row["mention_count"] or 1) for row in source_rows}
        placeholders = ",".join("?" for _ in source_ids)
        relation_rows = conn.execute(
            f"""
            SELECT
                r.id, r.from_entity_id, r.to_entity_id, r.relation_type, r.confidence,
                fe.name AS from_name, te.name AS to_name
            FROM relations r
            JOIN entities fe ON fe.id = r.from_entity_id
            JOIN entities te ON te.id = r.to_entity_id
            WHERE r.from_entity_id IN ({placeholders}) OR r.to_entity_id IN ({placeholders})
            """,
            (*source_ids, *source_ids),
        ).fetchall()
        if not relation_rows:
            return []

        neighbor_meta: dict[int, dict[str, Any]] = {}
        for row in relation_rows:
            from_id = int(row["from_entity_id"])
            to_id = int(row["to_entity_id"])
            source_id = from_id if from_id in source_ids else to_id
            neighbor_id = to_id if source_id == from_id else from_id
            meta = neighbor_meta.setdefault(
                neighbor_id,
                {
                    "score": 0.0,
                    "relations": set(),
                    "source_entities": set(),
                },
            )
            meta["score"] += 0.62 + float(row["confidence"] or 1.0) * 0.18
            meta["score"] += min(source_mentions.get(source_id, 1), 3) * 0.03
            meta["relations"].add(str(row["relation_type"]))
            source_name = row["from_name"] if source_id == from_id else row["to_name"]
            meta["source_entities"].add(str(source_name))

        neighbor_ids = sorted(neighbor_meta)
        neighbor_placeholders = ",".join("?" for _ in neighbor_ids)
        doc_rows = conn.execute(
            f"""
            SELECT
                de.doc_path,
                de.entity_id,
                de.mention_count,
                e.name AS entity_name,
                e.source_doc AS entity_source_doc
            FROM doc_entities de
            JOIN entities e ON e.id = de.entity_id
            WHERE de.entity_id IN ({neighbor_placeholders})
            """,
            tuple(neighbor_ids),
        ).fetchall()

        source_doc_rows = conn.execute(
            f"SELECT id, name, source_doc FROM entities WHERE id IN ({neighbor_placeholders})",
            tuple(neighbor_ids),
        ).fetchall()

    by_doc: dict[str, dict[str, Any]] = {}

    def add_doc(path_value: str | None, neighbor_id: int, mention_count: int, entity_name: str) -> None:
        if not path_value:
            return
        path = str(path_value).replace("\\", "/")
        if path == rel_path or not (vault_path / path).exists():
            return
        meta = neighbor_meta[neighbor_id]
        item = by_doc.setdefault(
            path,
            {
                "path": path,
                "title": Path(path).stem,
                "similarity": 0.0,
                "channel": "er",
                "er_relation_types": set(),
                "er_entities": set(),
                "er_source_entities": set(),
                "reason": "ER 权威关系一跳扩展",
            },
        )
        item["similarity"] = max(
            float(item["similarity"]),
            min(0.99, float(meta["score"]) + min(int(mention_count or 1), 3) * 0.03),
        )
        item["er_relation_types"].update(meta["relations"])
        item["er_source_entities"].update(meta["source_entities"])
        item["er_entities"].add(entity_name)

    for row in doc_rows:
        add_doc(row["doc_path"], int(row["entity_id"]), int(row["mention_count"] or 1), str(row["entity_name"]))

    for row in source_doc_rows:
        add_doc(row["source_doc"], int(row["id"]), 1, str(row["name"]))

    results = []
    for item in by_doc.values():
        item["er_relation_types"] = sorted(item["er_relation_types"])
        item["er_entities"] = sorted(item["er_entities"])
        item["er_source_entities"] = sorted(item["er_source_entities"])
        results.append(item)
    results.sort(key=lambda value: (-float(value["similarity"]), value["path"]))
    return results[:top_k]
