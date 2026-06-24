DROP TRIGGER IF EXISTS principles_ai;
DROP TRIGGER IF EXISTS principles_ad;
DROP TRIGGER IF EXISTS principles_au;
DROP TABLE IF EXISTS principles_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS principles_fts USING fts5(
    content, doc_path, content=principles, content_rowid=id, tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS principles_ai AFTER INSERT ON principles BEGIN
    INSERT INTO principles_fts(rowid, content, doc_path) VALUES (new.id, new.content, new.doc_path);
END;
CREATE TRIGGER IF NOT EXISTS principles_ad AFTER DELETE ON principles BEGIN
    INSERT INTO principles_fts(principles_fts, rowid, content, doc_path) VALUES ('delete', old.id, old.content, old.doc_path);
END;
CREATE TRIGGER IF NOT EXISTS principles_au AFTER UPDATE ON principles BEGIN
    INSERT INTO principles_fts(principles_fts, rowid, content, doc_path) VALUES ('delete', old.id, old.content, old.doc_path);
    INSERT INTO principles_fts(rowid, content, doc_path) VALUES (new.id, new.content, new.doc_path);
END;

INSERT INTO principles_fts(rowid, content, doc_path)
SELECT id, content, doc_path FROM principles;
