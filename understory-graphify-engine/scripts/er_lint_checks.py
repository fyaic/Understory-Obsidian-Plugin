"""ER-specific lint checks for entity pages and relation schema constraints."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

try:
    from .er_models import EntityDAO, get_er_connection, get_er_db_path
    from .er_schema import load_schema, load_schema_from_db, validate_entity, validate_relation
    from .er_vault_ops import parse_entity_page, scan_entity_pages
except ImportError:
    from er_models import EntityDAO, get_er_connection, get_er_db_path
    from er_schema import load_schema, load_schema_from_db, validate_entity, validate_relation
    from er_vault_ops import parse_entity_page, scan_entity_pages


ER_ISSUE_TYPES = {
    "er_entity_missing_in_db",
    "er_entity_out_of_sync",
    "er_entity_schema_violation",
    "er_relation_schema_violation",
}


def _sig(*parts: Any) -> str:
    return hashlib.sha256("||".join(str(part) for part in parts).encode("utf-8")).hexdigest()[:12]


def _issue(issue_type: str, severity: str, doc: str | None, description: str, suggestion: str, **extra) -> dict:
    return {
        "id": "C-" + _sig(issue_type, doc or "", description),
        "type": issue_type,
        "severity": severity,
        "doc": doc,
        "description": description,
        "suggestion": suggestion,
        **extra,
    }


def _repo_schema_path() -> Path:
    return Path(__file__).resolve().parent.parent / "er_schema.yaml"


def _load_active_schema(vault: Path, db_path: Path) -> dict[str, Any] | None:
    vault_schema = vault / "er_schema.yaml"
    if vault_schema.exists():
        return load_schema(vault_schema)
    repo_schema = _repo_schema_path()
    if repo_schema.exists():
        return load_schema(repo_schema)
    return load_schema_from_db(db_path)


def _stable_json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def _stable_list(value: Any) -> str:
    return json.dumps(sorted(value or []), ensure_ascii=False)


def _entity_pages(vault: Path, doc_path: str | None) -> list[dict[str, Any]]:
    if doc_path:
        path = vault / doc_path.replace("/", "\\")
        parsed = parse_entity_page(path, vault)
        return [parsed] if parsed else []
    return scan_entity_pages(vault)


def _check_entity_page_sync(vault: Path, db_path: Path, schema: dict[str, Any], doc_path: str | None) -> list[dict]:
    dao = EntityDAO(db_path)
    issues = []
    for data in _entity_pages(vault, doc_path):
        valid, errors = validate_entity(data, schema)
        if not valid:
            issues.append(
                _issue(
                    "er_entity_schema_violation",
                    "high",
                    data.get("source_doc"),
                    f"实体页「{data.get('name')}」不符合 ER schema：{'; '.join(errors)}",
                    "修正实体页 frontmatter，或更新 er_schema.yaml 后重新同步。",
                    entity_name=data.get("name"),
                    entity_type=data.get("type"),
                    errors=errors,
                )
            )
            continue

        entity = dao.get_by_er_id(data["er_id"]) if data.get("er_id") else None
        if entity is None:
            entity = dao.get_by_name_and_type(data["name"], data["type"])
        if entity is None:
            issues.append(
                _issue(
                    "er_entity_missing_in_db",
                    "medium",
                    data.get("source_doc"),
                    f"实体页「{data.get('name')}」存在，但 er.sqlite 中没有对应实体。",
                    "运行 ER 同步，或检查 er_id/name/type 是否写错。",
                    entity_name=data.get("name"),
                    entity_type=data.get("type"),
                    er_id=data.get("er_id"),
                )
            )
            continue

        mismatches = []
        if entity.er_id != data.get("er_id"):
            mismatches.append("er_id")
        if entity.name != data.get("name"):
            mismatches.append("name")
        if entity.type != data.get("type"):
            mismatches.append("type")
        if _stable_json(entity.attributes) != _stable_json(data.get("attributes")):
            mismatches.append("attributes")
        if _stable_list(entity.aliases) != _stable_list(data.get("aliases")):
            mismatches.append("aliases")
        if (entity.description or "") != (data.get("description") or ""):
            mismatches.append("description")
        if (entity.source_doc or "") != (data.get("source_doc") or ""):
            mismatches.append("source_doc")

        if mismatches:
            issues.append(
                _issue(
                    "er_entity_out_of_sync",
                    "medium",
                    data.get("source_doc"),
                    f"实体页「{data.get('name')}」与 er.sqlite 不一致：{', '.join(mismatches)}。",
                    "保存实体页触发同步，或运行 ER 同步命令修复数据库快照。",
                    entity_name=data.get("name"),
                    entity_type=data.get("type"),
                    er_id=data.get("er_id"),
                    fields=mismatches,
                )
            )
    return issues


def _check_relation_schema(vault: Path, db_path: Path, schema: dict[str, Any], doc_path: str | None) -> list[dict]:
    issues = []
    where = ""
    params: tuple[Any, ...] = ()
    if doc_path:
        where = "WHERE fe.source_doc = ? OR te.source_doc = ?"
        params = (doc_path.replace("\\", "/"), doc_path.replace("\\", "/"))

    with get_er_connection(db_path) as conn:
        rows = conn.execute(
            f"""
            SELECT
                r.id, r.relation_type,
                fe.name AS from_name, fe.type AS from_type, fe.source_doc AS from_doc,
                te.name AS to_name, te.type AS to_type, te.source_doc AS to_doc
            FROM relations r
            JOIN entities fe ON fe.id = r.from_entity_id
            JOIN entities te ON te.id = r.to_entity_id
            {where}
            ORDER BY r.id
            """,
            params,
        ).fetchall()

    for row in rows:
        valid, errors = validate_relation(
            {
                "relation_type": row["relation_type"],
                "from_type": row["from_type"],
                "to_type": row["to_type"],
            },
            schema,
        )
        if valid:
            continue
        doc = row["from_doc"] or row["to_doc"]
        issues.append(
            _issue(
                "er_relation_schema_violation",
                "high",
                doc,
                (
                    f"ER 关系「{row['from_name']} --{row['relation_type']}--> {row['to_name']}」"
                    f"不符合 schema：{'; '.join(errors)}"
                ),
                "修正关系方向/类型，或更新 er_schema.yaml 中的关系定义。",
                relation_id=row["id"],
                relation_type=row["relation_type"],
                errors=errors,
            )
        )
    return issues


def check_er_conflicts(vault_path: str | Path, doc_path: str | None = None) -> list[dict]:
    """Return ER lint issues. No-op when the vault has no ER database yet."""
    vault = Path(vault_path).expanduser().resolve()
    db_path = get_er_db_path(vault)
    if not db_path.exists():
        return []
    schema = _load_active_schema(vault, db_path)
    if not schema:
        return []
    rel_doc = doc_path.replace("\\", "/") if doc_path else None
    return (
        _check_entity_page_sync(vault, db_path, schema, rel_doc)
        + _check_relation_schema(vault, db_path, schema, rel_doc)
    )
