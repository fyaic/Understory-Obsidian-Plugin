"""Schema loading and validation helpers for Understory ER."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml


_SCHEMA_CACHE: Optional[Dict[str, Any]] = None
_SCHEMA_PATH: Optional[str] = None


def load_schema(yaml_path: str | Path) -> Dict[str, Any]:
    """Load er_schema.yaml with a simple path-based cache."""
    global _SCHEMA_CACHE, _SCHEMA_PATH
    path = str(Path(yaml_path).expanduser().resolve())
    if _SCHEMA_CACHE is not None and _SCHEMA_PATH == path:
        return _SCHEMA_CACHE
    with open(path, "r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError("ER schema must be a YAML mapping")
    _SCHEMA_CACHE = data
    _SCHEMA_PATH = path
    return data


def invalidate_cache() -> None:
    """Clear the in-process schema cache."""
    global _SCHEMA_CACHE, _SCHEMA_PATH
    _SCHEMA_CACHE = None
    _SCHEMA_PATH = None


def get_entity_types(schema: Dict[str, Any]) -> Dict[str, Any]:
    return schema.get("entity_types", {}) or {}


def get_relation_types(schema: Dict[str, Any]) -> Dict[str, Any]:
    return schema.get("relation_types", {}) or {}


def _attribute_map(type_def: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {item.get("name"): item for item in type_def.get("attributes", []) if item.get("name")}


def validate_entity(entity_dict: Dict[str, Any], schema: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Validate entity type and required attributes against er_schema.yaml."""
    errors: List[str] = []
    entity_type = entity_dict.get("type") or entity_dict.get("er_type")
    types = get_entity_types(schema)
    if entity_type not in types:
        errors.append(f"Unknown entity type: {entity_type}")
        return False, errors

    attrs = entity_dict.get("attributes") or {}
    if not isinstance(attrs, dict):
        errors.append("attributes must be a mapping")
        return False, errors

    type_def = types[entity_type]
    for attr in type_def.get("attributes", []):
        name = attr.get("name")
        if attr.get("required") and name not in attrs:
            errors.append(f"Missing required attribute: {name}")
        if name in attrs and attr.get("type") == "enum":
            allowed = attr.get("values") or []
            if allowed and attrs[name] not in allowed:
                errors.append(f"Invalid enum value for {name}: {attrs[name]}")
    return len(errors) == 0, errors


def validate_relation(relation_dict: Dict[str, Any], schema: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Validate relation type and optional from/to entity types."""
    errors: List[str] = []
    rel_type = relation_dict.get("relation_type")
    rel_types = get_relation_types(schema)
    if rel_type not in rel_types:
        errors.append(f"Unknown relation type: {rel_type}")
        return False, errors

    type_def = rel_types[rel_type]
    from_type = relation_dict.get("from_type")
    to_type = relation_dict.get("to_type")
    expected_from = type_def.get("from")
    expected_to = type_def.get("to")
    if from_type and expected_from != "*" and from_type != expected_from:
        errors.append(f"Relation {rel_type} expects from={expected_from}, got {from_type}")
    if to_type and expected_to != "*" and to_type != expected_to:
        errors.append(f"Relation {rel_type} expects to={expected_to}, got {to_type}")
    return len(errors) == 0, errors


def save_schema_to_db(schema: Dict[str, Any], db_path: str | Path) -> int:
    """Persist schema into the er_schema cache table."""
    try:
        from .er_models import SchemaDAO
    except ImportError:
        from er_models import SchemaDAO

    return SchemaDAO(db_path).save_schema(schema)


def load_schema_from_db(db_path: str | Path) -> Optional[Dict[str, Any]]:
    """Load the latest persisted schema snapshot from er.sqlite."""
    try:
        from .er_models import SchemaDAO
    except ImportError:
        from er_models import SchemaDAO

    return SchemaDAO(db_path).load_schema()

