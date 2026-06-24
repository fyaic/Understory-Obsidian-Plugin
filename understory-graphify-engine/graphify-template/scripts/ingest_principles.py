#!/usr/bin/env python3
"""
ingest_principles —— L2 原则提取模块。

从单篇文档提取"原则/断言/决策/待解决问题"存入 principles.sqlite，不生成新 markdown。
LLM 可用时走智谱 glm-4-flash，缺 Key 时降级到规则式启发抽取（pipeline 不中断）。
再次 ingest 同一文档时，基于相似度智能合并新旧原则（更新/取代/新增/软删），保留历史版本。

用法：
    python ingest_principles.py "业务文档/产品战略.md" --vault "C:/Users/ryshi/Documents/AIC-000"
    python ingest_principles.py --all --vault "C:/..." [--force] [--limit N]
"""
import argparse
import difflib
import json
import re
import sqlite3
import sys
from pathlib import Path

import graphify_common as gc

# ───────────────────────────────────────────
# Prompt（预授权，不可修改）
# ───────────────────────────────────────────

PRINCIPLE_EXTRACTION_PROMPT = """你是一个严谨的企业知识提取助手。请阅读下面的文档，提取其中的"原则、断言、决策、待解决问题"。

文档标题：{title}
文档内容：
{content}

提取规则：
1. principle（原则）：文档中明确的指导思想、方法论、价值观
2. claim（断言）：文档中陈述的事实、观点、假设
3. decision（决策）：文档中明确的决定、方案、计划
4. question（待解决问题）：文档中提出但未解决的问题

输出要求：
- 只输出合法 JSON 数组，不要 markdown 代码块
- 每条内容不超过 100 字
- confidence 基于文档中证据的充分程度（0.0-1.0）
- scope 判断：适用整个组织→"global"；特定项目→"project"；个人→"personal"；不确定→"local"
- 记录性内容（会议纪要、日报）只提取关键 decision 和 question
- 知识性内容（技术方案、产品文档）提取 principle、claim、decision
- 不要提取通用废话（如"我们要努力工作"）

输出格式：
[
  {{"type": "principle", "content": "...", "confidence": 0.95, "scope": "global"}},
  {{"type": "claim", "content": "...", "confidence": 0.8, "scope": "project"}}
]
"""

# 黑名单：这些路径不做原则提取（记录性/剪藏/聊天流水，不含可提炼原则）
INGEST_BLACKLIST = (
    "daily", "日报", "晨会", "untitled", "linear issues/",
    "templates/", "模板/", ".trash/", "剪藏", "clippings", "clipping",
    # 聊天/会话流水：内容是对话碎片，不应提取为断言
    "聊天记录", "微信群", "群聊", "chat记录", "chatlog", "聊天",
    # 录音转写/会议逐字稿
    "录音", "逐字稿", "transcript", "会议记录",
)

MIN_CONTENT_CHARS = 100  # 短于此长度的文档跳过

VALID_TYPES = {"principle", "claim", "decision", "question"}
VALID_SCOPES = {"global", "local", "project", "personal"}


# ───────────────────────────────────────────
# 数据库
# ───────────────────────────────────────────

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
LATEST_SCHEMA_VERSION = 3


def get_schema_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def _set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(f"PRAGMA user_version = {int(version)}")


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def _migration_files() -> list[tuple[int, Path]]:
    files = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        prefix = path.name.split("_", 1)[0]
        if prefix.isdigit():
            files.append((int(prefix), path))
    return files


def _run_pending_migrations(conn: sqlite3.Connection) -> None:
    version = get_schema_version(conn)
    for migration_version, path in _migration_files():
        if migration_version <= version:
            continue
        conn.executescript(path.read_text(encoding="utf-8"))
        _set_schema_version(conn, migration_version)
        conn.commit()


def _ensure_doc_meta_columns(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(doc_meta)")}
    if "content_date" not in cols:
        conn.execute("ALTER TABLE doc_meta ADD COLUMN content_date TEXT")
    if "content_date_source" not in cols:
        conn.execute("ALTER TABLE doc_meta ADD COLUMN content_date_source TEXT")


def _ensure_trigram_fts(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='principles_fts'"
    ).fetchone()
    if row and row[0] and "trigram" in row[0]:
        return
    migration = MIGRATIONS_DIR / "003_fts_trigram.sql"
    conn.executescript(migration.read_text(encoding="utf-8"))


def _upgrade_unversioned_schema(conn: sqlite3.Connection) -> None:
    """Upgrade pre-versioned databases that were created before PRAGMA user_version."""
    init_sql = MIGRATIONS_DIR / "001_init.sql"
    conn.executescript(init_sql.read_text(encoding="utf-8"))
    _ensure_doc_meta_columns(conn)
    _ensure_trigram_fts(conn)
    _set_schema_version(conn, LATEST_SCHEMA_VERSION)
    conn.commit()


def init_database(db_path: Path) -> None:
    """初始化数据库（幂等）。新库按 migrations 运行；旧库做一次兼容升级。"""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        version = get_schema_version(conn)
        if version == 0 and _table_exists(conn, "principles"):
            _upgrade_unversioned_schema(conn)
        else:
            _run_pending_migrations(conn)
    finally:
        conn.close()


# ───────────────────────────────────────────
# 原则抽取：LLM + 规则式降级
# ───────────────────────────────────────────

def _call_llm_extract_principles(title: str, content: str) -> list[dict] | None:
    """LLM 提取原则；缺 Key/失败时返回 None（上层降级）。"""
    prompt = PRINCIPLE_EXTRACTION_PROMPT.format(title=title, content=content[:4000])
    raw = gc.call_llm(prompt)
    data = gc.parse_json_from_llm(raw)
    if not isinstance(data, list):
        return None
    return data


# 记录性内容模式（含日期但非承诺，不应被提取为 claim）
SKIP_PATTERNS = [
    re.compile(r"(文档|报告|数据)?(生成|创建|更新|导出|采集)时间[：:]\s*\d{4}"),
    re.compile(r"\[\[\d{4}-\d{2}-\d{2}.*?\]\]"),       # wikilink 日期
    re.compile(r"(工作)?(周报|日报|汇报|晨会).*?\d{4}"),
    re.compile(r"数据(覆盖|范围|周期).*?\d{4}"),
    re.compile(r"^\s*\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]?\s*\d{0,2}\s*日?\s*$"),  # 纯日期行
]


def _is_record_content(sentence: str) -> bool:
    """记录性内容（生成时间/周报标题/纯日期/数据范围）→ 不提取为 claim。"""
    return any(p.search(sentence) for p in SKIP_PATTERNS)


def _rule_based_extract(title: str, content: str) -> list[dict]:
    """
    规则式启发抽取（无 LLM 时使用）。
    从小标题、含决策动词/问题标记的句子中抽取，给保守 confidence。
    """
    clean = gc.clean_markdown(content)
    # 按中英文标点切句
    sentences = []
    for raw in re.split(r"[。；！\n]|(?<=[.;!])\s", content):
        s = gc.clean_markdown(raw).strip()
        if 6 <= len(s) <= 120:
            sentences.append(s)

    results = []
    seen = set()
    for s in sentences:
        key = s[:40]
        if key in seen:
            continue
        ptype = None
        conf = 0.5
        if any(q in s for q in gc.QUESTION_MARKERS):
            ptype, conf = "question", 0.55
        elif any(v in s for v in gc.DECISION_VERBS):
            # 决策动词出现 → decision 或 principle
            if any(k in s for k in ("原则", "规范", "必须", "禁止", "应该", "优先")):
                ptype, conf = "principle", 0.6
            else:
                ptype, conf = "decision", 0.55
        elif gc.extract_time_markers(s):
            if _is_record_content(s):
                continue  # 记录性日期内容（生成时间/周报/纯日期）不提取为 claim
            ptype, conf = "claim", 0.5
        if ptype:
            seen.add(key)
            results.append({
                "type": ptype,
                "content": s[:100],
                "confidence": conf,
                "scope": "local",
            })
        if len(results) >= 12:
            break
    return results


def extract_principles(title: str, content: str) -> tuple[list[dict], str]:
    """
    返回 (principles, method)。method ∈ {"llm", "rule"}。
    """
    if gc.llm_available():
        llm = _call_llm_extract_principles(title, content)
        if llm is not None:
            return _normalize(llm), "llm"
    return _rule_based_extract(title, content), "rule"


def _normalize(items: list) -> list[dict]:
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        t = str(it.get("type", "")).strip().lower()
        if t not in VALID_TYPES:
            t = "claim"
        c = str(it.get("content", "")).strip()
        if not c:
            continue
        try:
            conf = float(it.get("confidence", 0.5))
        except (TypeError, ValueError):
            conf = 0.5
        conf = max(0.0, min(1.0, conf))
        sc = str(it.get("scope", "local")).strip().lower()
        if sc not in VALID_SCOPES:
            sc = "local"
        out.append({"type": t, "content": c[:200], "confidence": conf, "scope": sc})
    return out


# ───────────────────────────────────────────
# 智能合并（embedding 相似度，缺 Key 时降级到文本相似度）
# ───────────────────────────────────────────

def _text_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def _build_similarity_fn(new_contents: list[str], old_contents: list[str]):
    """
    构造原则相似度函数。优先 embedding 语义相似度（08 文档设计），
    缺 Key / 失败 / 无旧原则时降级到文本编辑距离。
    返回 (sim_fn, method)。仅在存在旧原则时才发起 embedding（控成本）。
    """
    if old_contents and gc.llm_available():
        uniq = list(dict.fromkeys(new_contents + old_contents))
        vecs = gc.call_embedding(uniq)
        if vecs and len(vecs) == len(uniq):
            emap = {t: v for t, v in zip(uniq, vecs)}

            def _emb_sim(a: str, b: str) -> float:
                if a in emap and b in emap:
                    return gc.cosine_similarity(emap[a], emap[b])
                return _text_similarity(a, b)
            return _emb_sim, "embedding"
    return _text_similarity, "text"


def _record_history(conn, pid: int, version: int, content: str, change_type: str):
    conn.execute(
        "INSERT INTO principle_history(principle_id, version, content, change_type) VALUES (?,?,?,?)",
        (pid, version, content, change_type),
    )


def prune_history(conn, retention_days: int = 90) -> int:
    """清理超过保留期的 principle_history delete 记录。返回删除行数。"""
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM principle_history WHERE change_type='delete' AND changed_at < datetime('now', ?)",
        (f"-{retention_days} days",)
    )
    return cur.rowcount


def prune_deleted_principles(conn, retention_days: int = 90) -> int:
    """物理删除软删除超过保留期的原则。连带触发 FTS 索引自动清理。返回删除行数。"""
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM principles WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)",
        (f"-{retention_days} days",)
    )
    return cur.rowcount


def merge_doc_principles(conn, doc_path: str, doc_title: str, new_principles: list[dict]):
    """
    智能合并某文档的新旧原则。返回统计 dict。
      similarity > 0.92  → 更新内容（version 不变，记 update 历史）
      0.80~0.92          → 旧原则 superseded，新原则 version+1
      < 0.80             → 全新原则
      旧原则无匹配        → 软删除（deleted_at）
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT id, content, version FROM principles WHERE doc_path=? AND deleted_at IS NULL",
        (doc_path,),
    )
    old = [{"id": r[0], "content": r[1], "version": r[2]} for r in cur.fetchall()]
    matched_old_ids = set()
    stats = {"updated": 0, "superseded": 0, "inserted": 0, "deleted": 0}
    now = gc.now_iso()

    sim_fn, sim_method = _build_similarity_fn(
        [p["content"] for p in new_principles], [o["content"] for o in old])
    stats["sim_method"] = sim_method

    for np_ in new_principles:
        best_id, best_ver, best_sim = None, 1, 0.0
        for o in old:
            if o["id"] in matched_old_ids:
                continue
            sim = sim_fn(np_["content"], o["content"])
            if sim > best_sim:
                best_id, best_ver, best_sim = o["id"], o["version"], sim

        if best_sim > 0.92 and best_id is not None:
            cur.execute(
                "UPDATE principles SET content=?, confidence=?, scope=?, type=?, updated_at=? WHERE id=?",
                (np_["content"], np_["confidence"], np_["scope"], np_["type"], now, best_id),
            )
            _record_history(conn, best_id, best_ver, np_["content"], "update")
            matched_old_ids.add(best_id)
            stats["updated"] += 1
        elif best_sim >= 0.80 and best_id is not None:
            cur.execute(
                "INSERT INTO principles(doc_path, doc_title, type, content, confidence, scope, version) "
                "VALUES (?,?,?,?,?,?,?)",
                (doc_path, doc_title, np_["type"], np_["content"], np_["confidence"],
                 np_["scope"], best_ver + 1),
            )
            new_id = cur.lastrowid
            cur.execute("UPDATE principles SET superseded_by=?, deleted_at=? WHERE id=?",
                        (new_id, now, best_id))
            _record_history(conn, best_id, best_ver, "", "supersede")
            _record_history(conn, new_id, best_ver + 1, np_["content"], "create")
            matched_old_ids.add(best_id)
            stats["superseded"] += 1
        else:
            cur.execute(
                "INSERT INTO principles(doc_path, doc_title, type, content, confidence, scope, version) "
                "VALUES (?,?,?,?,?,?,1)",
                (doc_path, doc_title, np_["type"], np_["content"], np_["confidence"], np_["scope"]),
            )
            new_id = cur.lastrowid
            _record_history(conn, new_id, 1, np_["content"], "create")
            stats["inserted"] += 1

    # 未匹配的旧原则 → 软删除
    for o in old:
        if o["id"] not in matched_old_ids:
            cur.execute("UPDATE principles SET deleted_at=? WHERE id=?", (now, o["id"]))
            _record_history(conn, o["id"], o["version"], "", "delete")
            stats["deleted"] += 1

    return stats


# ───────────────────────────────────────────
# ingest 主流程
# ───────────────────────────────────────────

def _is_blacklisted(rel_path: str) -> bool:
    low = rel_path.lower().replace("\\", "/")
    return any(k in low for k in INGEST_BLACKLIST)


def _cleanup_blacklisted_doc(db_path: Path, rel: str) -> int:
    """软删除某（现已黑名单）文档的残留原则，返回清理数量。"""
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, version FROM principles WHERE doc_path=? AND deleted_at IS NULL", (rel,))
        rows = cur.fetchall()
        if not rows:
            return 0
        now = gc.now_iso()
        for pid, ver in rows:
            cur.execute("UPDATE principles SET deleted_at=? WHERE id=?", (now, pid))
            _record_history(conn, pid, ver, "", "delete")
        cur.execute("UPDATE doc_meta SET ingest_status='skipped', principle_count=0 WHERE doc_path=?", (rel,))
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def ingest_single(doc_path, vault_path: Path, force: bool = False, logger=None) -> dict:
    vault_path = Path(vault_path)
    db_path = gc.get_principles_db(vault_path)
    init_database(db_path)

    p = Path(doc_path)
    if not p.is_absolute():
        p = vault_path / doc_path
    if not p.exists():
        return {"status": "error", "doc_path": str(doc_path), "message": "file not found"}

    rel = str(p.relative_to(vault_path)).replace("\\", "/")
    if _is_blacklisted(rel):
        # 若该文档此前被提取过（黑名单是后加的），清理其残留原则
        cleaned = _cleanup_blacklisted_doc(db_path, rel)
        return {"status": "skipped", "doc_path": rel, "message": "blacklisted",
                "cleaned": cleaned, "principles_count": 0}

    try:
        content = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            content = p.read_text(encoding="gbk")
        except Exception as e:
            return {"status": "error", "doc_path": rel, "message": f"read failed: {e}"}

    clean = gc.clean_markdown(content)
    if len(clean) < MIN_CONTENT_CHARS:
        _update_doc_meta(db_path, rel, p.stem, gc.content_hash(content), len(clean), 0, "skipped")
        return {"status": "skipped", "doc_path": rel, "message": "content too short", "principles_count": 0}

    chash = gc.content_hash(content)
    # hash 检查
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute("SELECT content_hash FROM doc_meta WHERE doc_path=?", (rel,))
        row = cur.fetchone()
        if row and row[0] == chash and not force:
            return {"status": "skipped", "doc_path": rel, "message": "unchanged (hash match)",
                    "principles_count": 0}

        principles, method = extract_principles(p.stem, content)
        stats = merge_doc_principles(conn, rel, p.stem, principles)

        # 若发生 supersede，触发链断裂检测（零 LLM，失败不影响主流程）
        if stats.get("superseded", 0) > 0:
            try:
                from supersede_gap_detector import detect_supersede_gaps
                gap_result = detect_supersede_gaps(vault_path, conn=conn)
                if logger:
                    logger.info(f"supersede gap detection: {gap_result.get('count', 0)} gaps found")
                stats["gap_count"] = gap_result.get("count", 0)
            except Exception as e:
                if logger:
                    logger.warning(f"supersede gap detection failed: {e}")
                stats["gap_error"] = str(e)

        cur.execute("SELECT COUNT(*) FROM principles WHERE doc_path=? AND deleted_at IS NULL", (rel,))
        active_count = cur.fetchone()[0]

        # 时序记忆：计算内容时间（判断文档新旧）
        cdate, csrc = gc.get_content_date(p)
        cdate_s = cdate.isoformat() if cdate else None

        cur.execute(
            "INSERT INTO doc_meta(doc_path, doc_title, content_hash, word_count, principle_count, "
            "last_ingested_at, ingest_status, content_date, content_date_source) VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(doc_path) DO UPDATE SET content_hash=excluded.content_hash, "
            "word_count=excluded.word_count, principle_count=excluded.principle_count, "
            "last_ingested_at=excluded.last_ingested_at, ingest_status=excluded.ingest_status, "
            "content_date=excluded.content_date, content_date_source=excluded.content_date_source",
            (rel, p.stem, chash, len(clean), active_count, gc.now_iso(), "success", cdate_s, csrc),
        )
        conn.commit()
    finally:
        conn.close()

    if logger:
        logger.info(f"ingest {rel}: method={method} extracted={len(principles)} "
                    f"merge={stats} active={active_count}")
    return {
        "status": "ok", "doc_path": rel, "method": method,
        "principles_count": active_count, "extracted": len(principles), "merge": stats,
    }


def _update_doc_meta(db_path, rel, title, chash, wc, pc, status):
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "INSERT INTO doc_meta(doc_path, doc_title, content_hash, word_count, principle_count, "
            "last_ingested_at, ingest_status) VALUES (?,?,?,?,?,?,?) "
            "ON CONFLICT(doc_path) DO UPDATE SET content_hash=excluded.content_hash, "
            "word_count=excluded.word_count, principle_count=excluded.principle_count, "
            "last_ingested_at=excluded.last_ingested_at, ingest_status=excluded.ingest_status",
            (rel, title, chash, wc, pc, gc.now_iso(), status),
        )
        conn.commit()
    finally:
        conn.close()


def ingest_all(vault_path: Path, force: bool = False, limit: int | None = None) -> dict:
    vault_path = Path(vault_path)
    logger = gc.setup_logger("ingest", vault_path)
    files = gc.list_vault_markdown(vault_path)
    files = [f for f in files if not _is_blacklisted(str(f.relative_to(vault_path)))]
    if limit:
        files = files[:limit]

    total = len(files)
    processed = skipped = errors = 0
    logger.info(f"ingest_all start: {total} candidate docs (force={force})")
    for i, f in enumerate(files, 1):
        res = ingest_single(f, vault_path, force=force, logger=logger)
        st = res.get("status")
        if st == "ok":
            processed += 1
        elif st == "skipped":
            skipped += 1
        else:
            errors += 1
        if i % 50 == 0:
            logger.info(f"progress {i}/{total} processed={processed} skipped={skipped} errors={errors}")
    gc.rotate_logs(vault_path)
    # 清理无限增长：软删原则物理删除 + history 过期清理
    try:
        db_path = gc.get_principles_db(vault_path)
        conn = sqlite3.connect(str(db_path))
        try:
            h = prune_history(conn)
            d = prune_deleted_principles(conn)
            conn.commit()
            logger.info(f"pruned history={h} deleted_principles={d}")
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"prune failed: {e}")
    summary = {"status": "ok", "total": total, "processed": processed,
               "skipped": skipped, "errors": errors}
    logger.info(f"ingest_all done: {summary}")
    return summary


def main():
    parser = argparse.ArgumentParser(description="Extract principles from Obsidian notes")
    parser.add_argument("doc", nargs="?", help="文档相对/绝对路径（不填配合 --all）")
    parser.add_argument("--vault", help="Vault 根路径")
    parser.add_argument("--all", action="store_true", help="全库处理")
    parser.add_argument("--force", action="store_true", help="忽略 hash，强制重新处理")
    parser.add_argument("--limit", type=int, help="限制处理文档数（调试用）")
    args = parser.parse_args()

    vault = gc.get_vault_path(args.vault)

    if args.all:
        print(json.dumps(ingest_all(vault, force=args.force, limit=args.limit), ensure_ascii=False))
    elif args.doc:
        logger = gc.setup_logger("ingest", vault)
        print(json.dumps(ingest_single(args.doc, vault, force=args.force, logger=logger),
                         ensure_ascii=False))
    else:
        print(json.dumps({"status": "error", "message": "需要指定文档路径或 --all"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
