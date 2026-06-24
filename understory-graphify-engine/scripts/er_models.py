"""
Data models and SQLite DAOs for Understory's ER layer.

The ER database is stored separately at .understory/er.sqlite so authoritative
entity/relation structure does not mix with principles, conflicts, or vectors.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


ER_MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations" / "er"

AUTHORITATIVE_RELATION_SOURCES = {"user_defined", "frontmatter", "api", "import"}
CANDIDATE_RELATION_SOURCES = {"llm_extracted", "ner_extracted", "similarity_inferred"}


def get_er_db_path(vault_root: str | Path) -> Path:
    """Return the ER SQLite path for a vault root."""
    return Path(vault_root).expanduser().resolve() / ".understory" / "er.sqlite"


def get_er_connection(db_path: str | Path) -> sqlite3.Connection:
    """Open an ER database connection with row mapping and FK checks enabled."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migration_version(path: Path) -> int:
    try:
        return int(path.stem.split("_", 1)[0])
    except (IndexError, ValueError) as exc:
        raise ValueError(f"Invalid ER migration filename: {path.name}") from exc


def init_er_database(db_path: str | Path) -> Path:
    """Create or migrate .understory/er.sqlite and return its path."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with get_er_connection(path) as conn:
        current_version = conn.execute("PRAGMA user_version").fetchone()[0]
        migrations = sorted(ER_MIGRATIONS_DIR.glob("*.sql"), key=_migration_version)
        for migration in migrations:
            version = _migration_version(migration)
            if version <= current_version:
                continue
            conn.executescript(migration.read_text(encoding="utf-8"))
            conn.execute(f"PRAGMA user_version = {version}")
            current_version = version
    return path


def _to_json(value: Any, default: Any) -> str:
    if value is None:
        value = default
    return json.dumps(value, ensure_ascii=False)


def _from_json(value: Optional[str], default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


@dataclass
class Entity:
    name: str
    type: str
    id: Optional[int] = None
    er_id: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    description: str = ""
    aliases: List[str] = field(default_factory=list)
    disambiguation_context: Dict[str, Any] = field(default_factory=dict)
    source_doc: Optional[str] = None
    embedding_id: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class Relation:
    from_entity_id: int
    to_entity_id: int
    relation_type: str
    id: Optional[int] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    source: str = "api"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class RelationCandidate:
    relation_type: str
    id: Optional[int] = None
    from_entity_id: Optional[int] = None
    to_entity_id: Optional[int] = None
    from_entity_name: Optional[str] = None
    to_entity_name: Optional[str] = None
    attributes: Dict[str, Any] = field(default_factory=dict)
    confidence: Optional[float] = None
    candidate_source: str = "llm_extracted"
    review_status: str = "pending"
    evidence_doc_path: Optional[str] = None
    evidence_context: Optional[str] = None
    created_at: Optional[str] = None


def _row_to_entity(row: sqlite3.Row | None) -> Optional[Entity]:
    if row is None:
        return None
    return Entity(
        id=row["id"],
        er_id=row["er_id"],
        name=row["name"],
        type=row["type"],
        attributes=_from_json(row["attributes"], {}),
        description=row["description"] or "",
        aliases=_from_json(row["aliases"], []),
        disambiguation_context=_from_json(row["disambiguation_context"], {}),
        source_doc=row["source_doc"],
        embedding_id=row["embedding_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_relation(row: sqlite3.Row | None) -> Optional[Relation]:
    if row is None:
        return None
    return Relation(
        id=row["id"],
        from_entity_id=row["from_entity_id"],
        to_entity_id=row["to_entity_id"],
        relation_type=row["relation_type"],
        attributes=_from_json(row["attributes"], {}),
        confidence=row["confidence"],
        source=row["source"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class ERDatabase:
    """Connection and migration helper for the ER database."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)

    def initialize(self) -> Path:
        return init_er_database(self.db_path)

    def connect(self) -> sqlite3.Connection:
        init_er_database(self.db_path)
        return get_er_connection(self.db_path)

    def user_version(self) -> int:
        with self.connect() as conn:
            return conn.execute("PRAGMA user_version").fetchone()[0]


class EntityDAO:
    """CRUD and search operations for authoritative entities."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        init_er_database(self.db_path)

    def _connect(self) -> sqlite3.Connection:
        return get_er_connection(self.db_path)

    def create(self, entity: Entity) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO entities
                    (er_id, name, type, attributes, description, aliases,
                     disambiguation_context, source_doc, embedding_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entity.er_id,
                    entity.name,
                    entity.type,
                    _to_json(entity.attributes, {}),
                    entity.description,
                    _to_json(entity.aliases, []),
                    _to_json(entity.disambiguation_context, {}),
                    entity.source_doc,
                    entity.embedding_id,
                ),
            )
            return int(cur.lastrowid)

    def get_by_id(self, entity_id: int) -> Optional[Entity]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
        return _row_to_entity(row)

    def get_by_er_id(self, er_id: str) -> Optional[Entity]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM entities WHERE er_id = ?", (er_id,)).fetchone()
        return _row_to_entity(row)

    def get_by_name(self, name: str, entity_type: Optional[str] = None) -> List[Entity]:
        if entity_type:
            query = "SELECT * FROM entities WHERE name = ? AND type = ? ORDER BY id"
            params = (name, entity_type)
        else:
            query = "SELECT * FROM entities WHERE name = ? ORDER BY type, id"
            params = (name,)
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [entity for entity in (_row_to_entity(row) for row in rows) if entity is not None]

    def get_by_name_and_type(self, name: str, entity_type: str) -> Optional[Entity]:
        matches = self.get_by_name(name, entity_type)
        return matches[0] if matches else None

    def list_all(self, entity_type: Optional[str] = None) -> List[Entity]:
        if entity_type:
            query = "SELECT * FROM entities WHERE type = ? ORDER BY name, id"
            params = (entity_type,)
        else:
            query = "SELECT * FROM entities ORDER BY type, name, id"
            params = ()
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [entity for entity in (_row_to_entity(row) for row in rows) if entity is not None]

    def list_by_type(self, entity_type: str) -> List[Entity]:
        return self.list_all(entity_type)

    def update(self, entity: Entity) -> bool:
        if entity.id is None:
            raise ValueError("Entity.id is required for update")
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE entities
                SET er_id = ?, name = ?, type = ?, attributes = ?, description = ?,
                    aliases = ?, disambiguation_context = ?, source_doc = ?,
                    embedding_id = ?
                WHERE id = ?
                """,
                (
                    entity.er_id,
                    entity.name,
                    entity.type,
                    _to_json(entity.attributes, {}),
                    entity.description,
                    _to_json(entity.aliases, []),
                    _to_json(entity.disambiguation_context, {}),
                    entity.source_doc,
                    entity.embedding_id,
                    entity.id,
                ),
            )
            return cur.rowcount > 0

    def delete(self, entity_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM entities WHERE id = ?", (entity_id,))
            return cur.rowcount > 0

    def search(self, keyword: str) -> List[Entity]:
        pattern = f"%{keyword}%"
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM entities
                WHERE name LIKE ? OR er_id LIKE ? OR aliases LIKE ?
                ORDER BY type, name, id
                """,
                (pattern, pattern, pattern),
            ).fetchall()
        return [entity for entity in (_row_to_entity(row) for row in rows) if entity is not None]


class RelationDAO:
    """CRUD and path operations for authoritative relations."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        init_er_database(self.db_path)

    def _connect(self) -> sqlite3.Connection:
        return get_er_connection(self.db_path)

    def create(self, relation: Relation) -> int:
        if relation.source not in AUTHORITATIVE_RELATION_SOURCES:
            raise ValueError(f"Invalid authoritative relation source: {relation.source}")
        with self._connect() as conn:
            try:
                cur = conn.execute(
                    """
                    INSERT INTO relations
                        (from_entity_id, to_entity_id, relation_type, attributes,
                         confidence, source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        relation.from_entity_id,
                        relation.to_entity_id,
                        relation.relation_type,
                        _to_json(relation.attributes, {}),
                        relation.confidence,
                        relation.source,
                    ),
                )
                return int(cur.lastrowid)
            except sqlite3.IntegrityError:
                row = conn.execute(
                    """
                    SELECT id FROM relations
                    WHERE from_entity_id = ? AND to_entity_id = ? AND relation_type = ?
                    """,
                    (relation.from_entity_id, relation.to_entity_id, relation.relation_type),
                ).fetchone()
                if row:
                    return int(row["id"])
                raise

    def get_by_id(self, relation_id: int) -> Optional[Relation]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM relations WHERE id = ?", (relation_id,)).fetchone()
        return _row_to_relation(row)

    def list_by_entity(self, entity_id: int) -> List[Relation]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM relations
                WHERE from_entity_id = ? OR to_entity_id = ?
                ORDER BY relation_type, id
                """,
                (entity_id, entity_id),
            ).fetchall()
        return [rel for rel in (_row_to_relation(row) for row in rows) if rel is not None]

    def list_by_type(self, relation_type: str) -> List[Relation]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM relations WHERE relation_type = ? ORDER BY id",
                (relation_type,),
            ).fetchall()
        return [rel for rel in (_row_to_relation(row) for row in rows) if rel is not None]

    def get_neighbors(
        self,
        entity_id: int,
        relation_type: Optional[str] = None,
        direction: str = "both",
    ) -> List[Dict[str, Any]]:
        if direction not in {"outgoing", "incoming", "both"}:
            raise ValueError("direction must be outgoing, incoming, or both")
        clauses = []
        params: List[Any] = []
        if direction in {"outgoing", "both"}:
            clauses.append("r.from_entity_id = ?")
            params.append(entity_id)
        if direction in {"incoming", "both"}:
            clauses.append("r.to_entity_id = ?")
            params.append(entity_id)
        rel_filter = ""
        if relation_type:
            rel_filter = " AND r.relation_type = ?"
            params.append(relation_type)
        query = f"""
            SELECT
                r.*,
                fe.id AS from_id, fe.er_id AS from_er_id, fe.name AS from_name,
                fe.type AS from_type, fe.attributes AS from_attributes,
                fe.description AS from_description, fe.aliases AS from_aliases,
                fe.disambiguation_context AS from_disambiguation_context,
                fe.source_doc AS from_source_doc, fe.embedding_id AS from_embedding_id,
                fe.created_at AS from_created_at, fe.updated_at AS from_updated_at,
                te.id AS to_id, te.er_id AS to_er_id, te.name AS to_name,
                te.type AS to_type, te.attributes AS to_attributes,
                te.description AS to_description, te.aliases AS to_aliases,
                te.disambiguation_context AS to_disambiguation_context,
                te.source_doc AS to_source_doc, te.embedding_id AS to_embedding_id,
                te.created_at AS to_created_at, te.updated_at AS to_updated_at
            FROM relations r
            JOIN entities fe ON fe.id = r.from_entity_id
            JOIN entities te ON te.id = r.to_entity_id
            WHERE ({' OR '.join(clauses)}){rel_filter}
            ORDER BY r.relation_type, r.id
        """
        with self._connect() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()

        neighbors = []
        for row in rows:
            relation = _row_to_relation(row)
            if relation is None:
                continue
            is_out = row["from_entity_id"] == entity_id
            prefix = "to" if is_out else "from"
            entity = Entity(
                id=row[f"{prefix}_id"],
                er_id=row[f"{prefix}_er_id"],
                name=row[f"{prefix}_name"],
                type=row[f"{prefix}_type"],
                attributes=_from_json(row[f"{prefix}_attributes"], {}),
                description=row[f"{prefix}_description"] or "",
                aliases=_from_json(row[f"{prefix}_aliases"], []),
                disambiguation_context=_from_json(row[f"{prefix}_disambiguation_context"], {}),
                source_doc=row[f"{prefix}_source_doc"],
                embedding_id=row[f"{prefix}_embedding_id"],
                created_at=row[f"{prefix}_created_at"],
                updated_at=row[f"{prefix}_updated_at"],
            )
            neighbors.append({
                "relation": relation,
                "entity": entity,
                "direction": "out" if is_out else "in",
            })
        return neighbors

    def path_query(
        self,
        start_entity_id: int,
        depth: int = 1,
        relation_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if depth < 1:
            return []
        results: List[Dict[str, Any]] = []
        frontier = [(start_entity_id, 0)]
        seen_edges = set()
        seen_nodes = {start_entity_id}
        while frontier:
            current_id, current_depth = frontier.pop(0)
            if current_depth >= depth:
                continue
            for item in self.get_neighbors(current_id, relation_type=relation_type, direction="both"):
                relation = item["relation"]
                neighbor = item["entity"]
                if relation.id in seen_edges:
                    continue
                seen_edges.add(relation.id)
                step_depth = current_depth + 1
                results.append({
                    "depth": step_depth,
                    "from_entity_id": relation.from_entity_id,
                    "to_entity_id": relation.to_entity_id,
                    "relation": relation,
                    "entity": neighbor,
                    "direction": item["direction"],
                })
                if neighbor.id is not None and neighbor.id not in seen_nodes:
                    seen_nodes.add(neighbor.id)
                    frontier.append((neighbor.id, step_depth))
        return results

    def update(self, relation: Relation) -> bool:
        if relation.id is None:
            raise ValueError("Relation.id is required for update")
        if relation.source not in AUTHORITATIVE_RELATION_SOURCES:
            raise ValueError(f"Invalid authoritative relation source: {relation.source}")
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE relations
                SET from_entity_id = ?, to_entity_id = ?, relation_type = ?,
                    attributes = ?, confidence = ?, source = ?
                WHERE id = ?
                """,
                (
                    relation.from_entity_id,
                    relation.to_entity_id,
                    relation.relation_type,
                    _to_json(relation.attributes, {}),
                    relation.confidence,
                    relation.source,
                    relation.id,
                ),
            )
            return cur.rowcount > 0

    def delete(self, relation_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM relations WHERE id = ?", (relation_id,))
            return cur.rowcount > 0


class SchemaDAO:
    """Persist er_schema.yaml snapshots in er.sqlite."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        init_er_database(self.db_path)

    def save_schema(self, schema: Dict[str, Any], version: Optional[int] = None) -> int:
        version = int(version or schema.get("version") or 1)
        with get_er_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO er_schema (version, config, updated_at)
                VALUES (?, ?, datetime('now'))
                """,
                (version, json.dumps(schema, ensure_ascii=False)),
            )
        return version

    def load_schema(self, version: Optional[int] = None) -> Optional[Dict[str, Any]]:
        if version is None:
            query = "SELECT config FROM er_schema ORDER BY version DESC LIMIT 1"
            params = ()
        else:
            query = "SELECT config FROM er_schema WHERE version = ?"
            params = (version,)
        with get_er_connection(self.db_path) as conn:
            row = conn.execute(query, params).fetchone()
        if not row:
            return None
        return _from_json(row["config"], {})

    def get_version(self) -> Optional[int]:
        with get_er_connection(self.db_path) as conn:
            row = conn.execute("SELECT MAX(version) AS version FROM er_schema").fetchone()
        if not row or row["version"] is None:
            return None
        return int(row["version"])

