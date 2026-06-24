-- ER authoritative structure layer.
-- This database is intentionally separate from principles.sqlite.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    er_id TEXT UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    attributes TEXT,
    description TEXT,
    aliases TEXT,
    disambiguation_context TEXT,
    source_doc TEXT,
    embedding_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_er_id ON entities(er_id);
CREATE INDEX IF NOT EXISTS idx_entities_name_type ON entities(name, type);

CREATE TRIGGER IF NOT EXISTS trg_entities_updated_at
AFTER UPDATE ON entities
FOR EACH ROW
BEGIN
    UPDATE entities SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    attributes TEXT,
    confidence REAL DEFAULT 1.0,
    source TEXT DEFAULT 'api' CHECK(source IN ('user_defined', 'frontmatter', 'api', 'import')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (to_entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_unique
    ON relations(from_entity_id, to_entity_id, relation_type);

CREATE TRIGGER IF NOT EXISTS trg_relations_updated_at
AFTER UPDATE ON relations
FOR EACH ROW
BEGIN
    UPDATE relations SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS relation_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity_id INTEGER,
    to_entity_id INTEGER,
    relation_type TEXT NOT NULL,
    from_entity_name TEXT,
    to_entity_name TEXT,
    attributes TEXT,
    confidence REAL,
    candidate_source TEXT CHECK(candidate_source IN ('llm_extracted', 'ner_extracted', 'similarity_inferred')),
    review_status TEXT DEFAULT 'pending' CHECK(review_status IN ('pending', 'confirmed', 'rejected')),
    evidence_doc_path TEXT,
    evidence_context TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_entity_id) REFERENCES entities(id) ON DELETE SET NULL,
    FOREIGN KEY (to_entity_id) REFERENCES entities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_status ON relation_candidates(review_status);
CREATE INDEX IF NOT EXISTS idx_candidates_source ON relation_candidates(candidate_source);
CREATE INDEX IF NOT EXISTS idx_candidates_type ON relation_candidates(relation_type);

CREATE TABLE IF NOT EXISTS doc_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_path TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    mention_count INTEGER DEFAULT 1,
    contexts TEXT,
    confidence REAL,
    extracted_by TEXT CHECK(extracted_by IN ('rule', 'llm', 'manual', 'frontmatter')),
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doc_entities_doc ON doc_entities(doc_path);
CREATE INDEX IF NOT EXISTS idx_doc_entities_entity ON doc_entities(entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_entities_unique ON doc_entities(doc_path, entity_id);

CREATE TABLE IF NOT EXISTS relation_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    relation_id INTEGER,
    evidence_type TEXT CHECK(evidence_type IN ('frontmatter_snapshot', 'llm_extraction_log', 'user_confirmation', 'import_csv', 'document_mention')),
    evidence_data TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (relation_id) REFERENCES relations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relation_evidence_relation ON relation_evidence(relation_id);
CREATE INDEX IF NOT EXISTS idx_relation_evidence_type ON relation_evidence(evidence_type);

CREATE TABLE IF NOT EXISTS er_schema (
    version INTEGER PRIMARY KEY,
    config TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

PRAGMA user_version = 1;

