#!/usr/bin/env python3
"""
supersede_gap_detector —— 检测 supersede 链断裂。

职责：
  1. 读取 principle_history 找出所有 supersede 事件
  2. 对每个 supersede 事件，找出引用旧文档的其他文档
  3. 检查引用文档是否在 supersede 后更新过
  4. 输出 .understory/supersede_gaps.json

约束：
  - 零 LLM 调用（纯 SQLite + Python 文本操作）
  - 向后兼容（只读现有表，不依赖新增字段）
  - 失败不影响主流程
"""
import argparse
import json
import sqlite3
from pathlib import Path

import graphify_common as gc

# ───────────────────────────────────────────
# 核心查询
# ───────────────────────────────────────────


def _get_supersede_events(conn) -> list[dict]:
    """从 principle_history 获取所有 supersede 事件。"""
    cur = conn.execute(
        """
        SELECT
            h.principle_id AS old_id,
            h.version AS old_version,
            h.changed_at AS supersede_time,
            p.doc_path AS old_doc,
            p.content AS old_content,
            p.superseded_by AS new_id
        FROM principle_history h
        JOIN principles p ON h.principle_id = p.id
        WHERE h.change_type = 'supersede'
        ORDER BY h.changed_at DESC
        """
    )
    events = []
    for row in cur.fetchall():
        events.append({
            "old_id": row[0],
            "old_version": row[1],
            "supersede_time": row[2],
            "old_doc": row[3],
            "old_content": row[4] or "",
            "new_id": row[5],
        })
    return events


def _get_new_principle_content(conn, new_id: int) -> str:
    """获取取代旧原则的新原则内容。"""
    if not new_id:
        return ""
    row = conn.execute("SELECT content FROM principles WHERE id=?", (new_id,)).fetchone()
    return row[0] if row else ""


# ───────────────────────────────────────────
# Mentions 搜索（三级降级策略）
# ───────────────────────────────────────────


def _find_mentioning_docs(conn, vault_path: Path, target_doc: str) -> list[tuple[str, str]]:
    """
    找出所有文档中包含指向 target_doc 的 wikilink。

    策略（按优先级）：
      1. principles_fts MATCH（最快）
      2. 若失败/无结果，principles LIKE 搜索
      3. 若仍无结果，文件系统正则搜索（保底）

    Returns:
        [(mentioning_doc_path, reason), ...]
    """
    target_stem = Path(target_doc).stem
    results = []

    # 策略 1：FTS MATCH
    try:
        cur = conn.execute(
            "SELECT DISTINCT doc_path FROM principles_fts WHERE principles_fts MATCH ?",
            (f'[[{target_stem}]]',)
        )
        for row in cur.fetchall():
            if row[0] != target_doc:
                results.append((row[0], f"fts: [[{target_stem}]]"))
    except Exception:
        pass  # 失败则降级

    # 策略 2：LIKE 搜索（若 FTS 无结果）
    if not results:
        try:
            cur = conn.execute(
                "SELECT DISTINCT doc_path FROM principles WHERE content LIKE ?",
                (f'%[[{target_stem}]]%',)
            )
            for row in cur.fetchall():
                if row[0] != target_doc:
                    results.append((row[0], f"like: [[{target_stem}]]"))
        except Exception:
            pass

    # 策略 3：文件系统正则（保底）
    if not results:
        for md_file in vault_path.rglob("*.md"):
            rel = str(md_file.relative_to(vault_path)).replace("\\", "/")
            if rel == target_doc:
                continue
            if gc.is_noisy_path(rel):
                continue
            try:
                content = md_file.read_text(encoding="utf-8")
                if f'[[{target_stem}]]' in content or f'[[{target_stem}|' in content:
                    results.append((rel, f"file: [[{target_stem}]]"))
            except Exception:
                continue

    return results


# ───────────────────────────────────────────
# Stale 检测
# ───────────────────────────────────────────


def _is_doc_stale(conn, doc_path: str, supersede_time: str) -> bool:
    """
    检查引用文档是否在 supersede 后更新过。

    - last_ingested_at < supersede_time → 未更新（stale）→ 返回 True
    - last_ingested_at >= supersede_time → 已更新 → 返回 False
    - doc_path 不在 doc_meta 中 → 未知 → 返回 True（保守标记）
    """
    row = conn.execute(
        "SELECT last_ingested_at FROM doc_meta WHERE doc_path=?",
        (doc_path,)
    ).fetchone()

    if not row or not row[0]:
        return True  # 未知 → 保守标记

    # ISO 格式字符串可直接比较
    return row[0] < supersede_time


# ───────────────────────────────────────────
# Gap 记录构建
# ───────────────────────────────────────────


def _build_gap_record(event: dict, stale_doc: str, reason: str) -> dict:
    """构建单个 gap 记录。"""
    return {
        "type": "supersede_chain_break",
        "old_principle_id": event["old_id"],
        "new_principle_id": event["new_id"],
        "superseded_doc": event["old_doc"],
        "stale_doc": stale_doc,
        "old_content": event["old_content"][:100] if event["old_content"] else "",
        "new_content": event.get("new_content", "")[:100],
        "supersede_time": event["supersede_time"],
        "reason": reason,
        "severity": "medium",
    }


# ───────────────────────────────────────────
# 主检测流程
# ───────────────────────────────────────────

MAX_EVENTS = 100
MAX_MENTIONS_PER_EVENT = 50


def detect_supersede_gaps(vault_path: Path, conn=None) -> dict:
    """
    检测所有 supersede 链断裂。

    Args:
        vault_path: Vault 根路径
        conn: 可选的数据库连接（外部传入时复用）

    Returns:
        {"status": "ok", "gaps": [...], "count": N}
    """
    vault_path = Path(vault_path)
    gdir = gc.get_graphify_dir(vault_path)
    db_path = gc.get_principles_db(vault_path)

    should_close = False
    if conn is None:
        conn = sqlite3.connect(str(db_path))
        should_close = True

    try:
        events = _get_supersede_events(conn)
        if not events:
            output = {
                "status": "ok",
                "generated_at": gc.now_iso(),
                "gaps": [],
                "count": 0,
                "message": "无 supersede 事件",
            }
            gc.atomic_write_text(
                gdir / "supersede_gaps.json",
                json.dumps(output, ensure_ascii=False, indent=2)
            )
            return output

        # 性能护栏：截断过多事件
        events = events[:MAX_EVENTS]

        gaps = []
        for event in events:
            # 获取新原则内容
            event["new_content"] = _get_new_principle_content(conn, event["new_id"])

            # 搜索引用文档
            mentions = _find_mentioning_docs(conn, vault_path, event["old_doc"])

            # 性能护栏：截断过多 mentions
            mentions = mentions[:MAX_MENTIONS_PER_EVENT]

            for mention_doc, reason in mentions:
                if _is_doc_stale(conn, mention_doc, event["supersede_time"]):
                    gaps.append(_build_gap_record(event, mention_doc, reason))

        # 去重（同一 old_doc + stale_doc 组合只保留最新 supersede_time）
        seen = {}
        for g in gaps:
            key = (g["old_principle_id"], g["stale_doc"])
            if key not in seen or g["supersede_time"] > seen[key]["supersede_time"]:
                seen[key] = g
        gaps = list(seen.values())

        # 写入 JSON
        output = {
            "status": "ok",
            "generated_at": gc.now_iso(),
            "gaps": gaps,
            "count": len(gaps),
        }
        gc.atomic_write_text(
            gdir / "supersede_gaps.json",
            json.dumps(output, ensure_ascii=False, indent=2)
        )

        return output

    finally:
        if should_close:
            conn.close()


# ───────────────────────────────────────────
# CLI 入口
# ───────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Detect supersede chain breaks")
    parser.add_argument("--vault", help="Vault 根路径")
    args = parser.parse_args()
    vault = gc.get_vault_path(args.vault)
    result = detect_supersede_gaps(vault)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
