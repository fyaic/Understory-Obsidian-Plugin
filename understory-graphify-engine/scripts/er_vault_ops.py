"""Obsidian entity-page scanning and ER database sync."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

try:
    from .er_models import Entity, EntityDAO, get_er_db_path
    from .er_schema import load_schema, validate_entity
except ImportError:
    from er_models import Entity, EntityDAO, get_er_db_path
    from er_schema import load_schema, validate_entity


DEFAULT_ENTITY_PATHS = [
    "Entities/**/*.md",
    "entities/**/*.md",
    "People/**/*.md",
    "people/**/*.md",
    "Projects/**/*.md",
    "projects/**/*.md",
    "Concepts/**/*.md",
    "concepts/**/*.md",
]

IGNORED_DIR_NAMES = {".git", ".obsidian", ".understory", ".cache", ".trash", "node_modules", "__pycache__"}
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*(?:\n|$)", re.DOTALL)


def _repo_schema_path() -> Path:
    return Path(__file__).resolve().parent.parent / "er_schema.yaml"


def _resolve_schema_path(vault_path: Path, schema_path: Optional[str | Path] = None) -> Path:
    if schema_path is not None:
        return Path(schema_path)
    vault_schema = vault_path / "er_schema.yaml"
    if vault_schema.exists():
        return vault_schema
    return _repo_schema_path()


def _relative_source_doc(file_path: Path, vault_path: Optional[Path]) -> str:
    if vault_path is None:
        return str(file_path)
    try:
        return file_path.resolve().relative_to(vault_path.resolve()).as_posix()
    except ValueError:
        return str(file_path)


def _normalize_aliases(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return [str(value).strip()] if str(value).strip() else []


def _generate_er_id(entity_type: str, name: str) -> str:
    slug = "-".join(name.strip().split())
    return f"{entity_type.lower()}-{slug}"


def parse_entity_page(file_path: str | Path, vault_path: Optional[str | Path] = None) -> Optional[Dict[str, Any]]:
    """Parse an Obsidian markdown entity page with er_type frontmatter."""
    path = Path(file_path)
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = FRONTMATTER_RE.match(content)
    if not match:
        return None
    try:
        frontmatter = yaml.safe_load(match.group(1).strip()) or {}
    except yaml.YAMLError:
        return None
    if not isinstance(frontmatter, dict) or not frontmatter.get("er_type"):
        return None

    entity_type = str(frontmatter["er_type"]).strip()
    name = str(frontmatter.get("name") or path.stem).strip()
    er_id = frontmatter.get("er_id")
    er_id = str(er_id).strip() if er_id else _generate_er_id(entity_type, name)
    vault = Path(vault_path) if vault_path is not None else None
    return {
        "er_id": er_id,
        "name": name,
        "type": entity_type,
        "attributes": frontmatter.get("attributes") or {},
        "description": str(frontmatter.get("description") or ""),
        "aliases": _normalize_aliases(frontmatter.get("aliases")),
        "disambiguation_context": frontmatter.get("disambiguation") or {},
        "source_doc": _relative_source_doc(path, vault),
    }


def _is_ignored(path: Path) -> bool:
    return any(part in IGNORED_DIR_NAMES for part in path.parts)


def scan_entity_pages(
    vault_path: str | Path,
    path_patterns: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Scan configured entity-page paths, with a whole-vault fallback."""
    vault = Path(vault_path).expanduser().resolve()
    patterns = path_patterns or DEFAULT_ENTITY_PATHS
    seen = set()
    entities: List[Dict[str, Any]] = []

    for pattern in patterns:
        for file_path in vault.glob(pattern):
            if not file_path.is_file() or file_path.suffix.lower() != ".md":
                continue
            resolved = file_path.resolve()
            if resolved in seen or _is_ignored(resolved):
                continue
            seen.add(resolved)
            data = parse_entity_page(resolved, vault)
            if data:
                entities.append(data)

    if entities:
        return entities

    for file_path in vault.rglob("*.md"):
        resolved = file_path.resolve()
        if resolved in seen or _is_ignored(resolved):
            continue
        data = parse_entity_page(resolved, vault)
        if data:
            entities.append(data)
    return entities


def _entity_from_data(data: Dict[str, Any], existing: Optional[Entity] = None) -> Entity:
    return Entity(
        id=existing.id if existing else None,
        er_id=data.get("er_id"),
        name=data["name"],
        type=data["type"],
        attributes=data.get("attributes") or {},
        description=data.get("description") or "",
        aliases=data.get("aliases") or [],
        disambiguation_context=data.get("disambiguation_context") or {},
        source_doc=data.get("source_doc"),
    )


def _upsert_entity_data(dao: EntityDAO, data: Dict[str, Any]) -> tuple[str, int]:
    existing = dao.get_by_er_id(data["er_id"]) if data.get("er_id") else None
    if existing is None:
        existing = dao.get_by_name_and_type(data["name"], data["type"])

    entity = _entity_from_data(data, existing)
    if existing:
        dao.update(entity)
        return "updated", int(existing.id)
    return "created", dao.create(entity)


def sync_entities_from_vault(
    vault_path: str | Path,
    db_path: Optional[str | Path] = None,
    schema_path: Optional[str | Path] = None,
    path_patterns: Optional[List[str]] = None,
) -> Dict[str, int]:
    """Sync entity pages from Obsidian markdown into er.sqlite."""
    vault = Path(vault_path).expanduser().resolve()
    db = Path(db_path) if db_path is not None else get_er_db_path(vault)
    schema_file = _resolve_schema_path(vault, schema_path)
    schema = load_schema(schema_file)
    dao = EntityDAO(db)

    stats = {"created": 0, "updated": 0, "skipped": 0}
    for data in scan_entity_pages(vault, path_patterns):
        valid, errors = validate_entity(data, schema)
        if not valid:
            stats["skipped"] += 1
            continue
        status, _entity_id = _upsert_entity_data(dao, data)
        stats[status] += 1
    return stats


def sync_single_entity_page(
    file_path: str | Path,
    vault_path: str | Path,
    db_path: Optional[str | Path] = None,
    schema_path: Optional[str | Path] = None,
) -> Dict[str, Any]:
    """Sync one entity page when Obsidian saves a markdown file."""
    vault = Path(vault_path).expanduser().resolve()
    path = Path(file_path).expanduser()
    if not path.is_absolute():
        path = vault / path
    data = parse_entity_page(path, vault)
    if not data:
        return {
            "status": "skipped",
            "reason": "not_entity_page",
            "path": _relative_source_doc(path, vault),
        }

    db = Path(db_path) if db_path is not None else get_er_db_path(vault)
    schema = load_schema(_resolve_schema_path(vault, schema_path))
    valid, errors = validate_entity(data, schema)
    if not valid:
        return {
            "status": "error",
            "reason": "schema_validation_failed",
            "path": data.get("source_doc"),
            "errors": errors,
        }

    status, entity_id = _upsert_entity_data(EntityDAO(db), data)
    return {
        "status": status,
        "entity_id": entity_id,
        "er_id": data.get("er_id"),
        "name": data.get("name"),
        "type": data.get("type"),
        "path": data.get("source_doc"),
    }
