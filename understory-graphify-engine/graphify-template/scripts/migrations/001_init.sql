CREATE TABLE IF NOT EXISTS principles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_path TEXT NOT NULL,
    doc_title TEXT,
    type TEXT NOT NULL CHECK(type IN ('principle','claim','decision','question')),
    content TEXT NOT NULL,
    confidence REAL CHECK(confidence >= 0 AND confidence <= 1),
    scope TEXT CHECK(scope IN ('global','local','project','personal')),
    version INTEGER DEFAULT 1,
    superseded_by INTEGER,
    deleted_at TIMESTAMP,
    extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (superseded_by) REFERENCES principles(id)
);

CREATE TABLE IF NOT EXISTS principle_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    principle_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    change_type TEXT CHECK(change_type IN ('create','update','supersede','delete')),
    FOREIGN KEY (principle_id) REFERENCES principles(id)
);

CREATE TABLE IF NOT EXISTS doc_meta (
    doc_path TEXT PRIMARY KEY,
    doc_title TEXT,
    content_hash TEXT,
    word_count INTEGER,
    principle_count INTEGER DEFAULT 0,
    last_ingested_at TIMESTAMP,
    ingest_status TEXT CHECK(ingest_status IN ('pending','success','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS idx_principles_doc ON principles(doc_path);
CREATE INDEX IF NOT EXISTS idx_principles_type ON principles(type);
CREATE INDEX IF NOT EXISTS idx_principles_scope ON principles(scope);
CREATE INDEX IF NOT EXISTS idx_principles_confidence ON principles(confidence);
CREATE INDEX IF NOT EXISTS idx_doc_meta_hash ON doc_meta(content_hash);
