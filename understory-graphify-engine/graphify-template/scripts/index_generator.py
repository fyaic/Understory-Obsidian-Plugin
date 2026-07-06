#!/usr/bin/env python3
"""
index_generator —— L5 知识索引生成。

综合 principles.sqlite + community_clusters.json + conflicts.json + vault 文件列表，
生成 .understory/index.md（AI 易读的知识地图，含 [[wikilink]]）。

用法：
    python index_generator.py --vault "<VAULT_ROOT>"
"""
import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import graphify_common as gc

SCOPE_LABEL = {"global": "🌍 全局原则", "project": "📁 项目级原则",
               "personal": "👤 个人原则", "local": "📌 局部原则"}
SEV_ICON = {"high": "🔴 high", "medium": "🟡 medium", "low": "🟢 low"}


def _wikilink(rel_path: str) -> str:
    return f"[[{Path(rel_path).stem}]]"


def _load_json(path: Path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _load_knowledge_graph(vault_path: Path) -> tuple[list[dict], dict]:
    """读取 .understory/knowledge_graph.json"""
    gdir = gc.get_graphify_dir(vault_path)
    path = gdir / "knowledge_graph.json"
    if not path.exists():
        return [], {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("edges", []), data.get("stats", {})
    except (json.JSONDecodeError, OSError):
        return [], {}


def _load_edge_stats(vault_path: Path) -> dict:
    """读取 .understory/edge_stats.json"""
    gdir = gc.get_graphify_dir(vault_path)
    path = gdir / "edge_stats.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _load_supersede_gaps(vault_path: Path) -> list[dict]:
    """读取 .understory/supersede_gaps.json"""
    gdir = gc.get_graphify_dir(vault_path)
    path = gdir / "supersede_gaps.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("gaps", [])
    except (json.JSONDecodeError, OSError):
        return []


def generate_index(vault_path: Path) -> dict:
    vault_path = Path(vault_path)
    logger = gc.setup_logger("index", vault_path)
    gdir = gc.get_graphify_dir(vault_path)
    db_path = gc.get_principles_db(vault_path)

    # ── 数据源 ──
    principles = []
    doc_count = 0
    if db_path.exists():
        conn = sqlite3.connect(str(db_path))
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT id, doc_path, type, content, confidence, scope, updated_at "
                "FROM principles WHERE deleted_at IS NULL ORDER BY confidence DESC"
            )
            for r in cur.fetchall():
                principles.append({"id": r[0], "doc_path": r[1], "type": r[2],
                                   "content": r[3], "confidence": r[4] or 0,
                                   "scope": r[5] or "local", "updated_at": r[6]})
            cur.execute("SELECT COUNT(*) FROM doc_meta")
            doc_count = cur.fetchone()[0]
        finally:
            conn.close()

    clusters = _load_json(gdir / "community_clusters.json") or {}
    communities = clusters.get("communities", [])
    god = _load_json(gdir / "god_nodes.json") or {}
    god_nodes = god.get("god_nodes", [])
    surprising = god.get("surprising_connections", [])
    conflicts = _load_json(gdir / "conflicts.json") or {}
    issues = [i for i in conflicts.get("issues", []) if i.get("status", "open") == "open"]

    vault_total = len(gc.list_vault_markdown(vault_path))
    lines = []
    lines.append("# Understory 知识索引（AI 用）\n")
    lines.append(f"> 自动生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"> 已提取原则的文档：{doc_count} / 全库 {vault_total} 篇 | 原则总数：{len(principles)} | "
                 f"社区数：{len(communities)} | 活跃冲突：{len(issues)}\n")
    lines.append("---\n")

    # ── 一、核心原则（按 scope 分组） ──
    lines.append("## 一、核心原则（按 scope 分组）\n")
    by_scope = {"global": [], "project": [], "personal": [], "local": []}
    for p in principles:
        if p["type"] in ("principle", "decision"):
            by_scope.get(p["scope"], by_scope["local"]).append(p)
    for scope in ("global", "project", "personal"):
        items = by_scope[scope][:15]
        if not items:
            continue
        lines.append(f"### {SCOPE_LABEL[scope]}\n")
        for p in items:
            lines.append(f"- [P-{p['id']:03d}] {p['content']} → {_wikilink(p['doc_path'])}"
                         f"（confidence: {p['confidence']:.2f}）")
        lines.append("")
    # 待确认（低 confidence principle）
    low_conf = [p for p in principles if p["type"] == "principle" and p["confidence"] < 0.7][:10]
    if low_conf:
        lines.append("### ⚠️ 待确认原则\n")
        for p in low_conf:
            lines.append(f"- [P-{p['id']:03d}] {p['content']} → {_wikilink(p['doc_path'])}"
                         f"（confidence: {p['confidence']:.2f}）")
        lines.append("")
    lines.append("---\n")

    # ── 二、最近决策（按时间倒序） ──
    lines.append("## 二、最近决策（按时间倒序）\n")
    decisions = sorted([p for p in principles if p["type"] == "decision"],
                       key=lambda x: x["updated_at"] or "", reverse=True)[:15]
    if decisions:
        lines.append("| 时间 | 决策 | 来源 | scope |")
        lines.append("|------|------|------|-------|")
        for p in decisions:
            t = (p["updated_at"] or "")[:10]
            lines.append(f"| {t} | {p['content'][:50]} | {_wikilink(p['doc_path'])} | {p['scope']} |")
    else:
        lines.append("*（暂无决策记录）*")
    lines.append("\n---\n")

    # ── 三、知识社区 ──
    lines.append("## 三、知识社区（按社区分组）\n")
    # 预计算知识图数据（用于社区增强）
    kg_edges, _ = _load_knowledge_graph(vault_path)
    mentions_in = defaultdict(list)
    mentions_out = defaultdict(list)
    superseded_by = {}
    contra_pairs = set()
    for e in kg_edges:
        if e["type"] == "mentions":
            mentions_in[e["to"]].append(e["from"])
            mentions_out[e["from"]].append(e["to"])
        elif e["type"] == "supersedes":
            superseded_by[e["to"]] = e["from"]
        elif e["type"] == "contradicts":
            contra_pairs.add(tuple(sorted([e["from"], e["to"]])))

    if communities:
        for c in communities[:20]:
            links = " | ".join(_wikilink(d) for d in c["docs"][:12])
            more = f" …(共 {c['size']} 篇)" if c['size'] > 12 else ""
            lines.append(f"### 社区-{c['id']}：{c['name']}（{c['size']} 篇，凝聚度 {c['coherence']}）")
            lines.append(f"{links}{more}")

            # 引用信息
            comm_docs = set(c["docs"])
            incoming_mentions = []
            seen_mentions = set()
            for doc in c["docs"]:
                for from_doc in mentions_in.get(doc, []):
                    if from_doc not in comm_docs and from_doc not in seen_mentions:
                        seen_mentions.add(from_doc)
                        incoming_mentions.append(from_doc)
            if incoming_mentions:
                mention_links = " | ".join(_wikilink(d) for d in incoming_mentions[:5])
                lines.append(f"> 🔗 被引用：{mention_links}" + ("…" if len(incoming_mentions) > 5 else ""))

            # 冲突信息
            outgoing_contra = []
            for doc in c["docs"]:
                for pair in contra_pairs:
                    if doc in pair:
                        other = pair[0] if pair[1] == doc else pair[1]
                        if other not in comm_docs:
                            outgoing_contra.append(other)
            if outgoing_contra:
                contra_links = " | ".join(_wikilink(d) for d in outgoing_contra[:3])
                lines.append(f"> ⚔️ 与外部冲突：{contra_links}" + ("…" if len(outgoing_contra) > 3 else ""))

            # 版本演进
            evolved = []
            for doc in c["docs"]:
                if doc in superseded_by:
                    evolved.append((doc, superseded_by[doc]))
            if evolved:
                lines.append(f"> 🔄 版本演进：")
                for old_doc, new_doc in evolved[:3]:
                    if old_doc == new_doc:
                        lines.append(f">   [[{Path(old_doc).stem}]]（内部原则已迭代）")
                    else:
                        lines.append(f">   [[{Path(old_doc).stem}]] → [[{Path(new_doc).stem}]]")

            # 拆分原因
            if c.get("split_reason"):
                lines.append(f"> 📌 {c['split_reason']}")

            lines.append("")
    else:
        lines.append("*（图分析尚未运行）*\n")
    lines.append("---\n")
    # ── 四、God Node ──
    lines.append("## 四、God Node（跨界知识枢纽）\n")
    if god_nodes:
        lines.append("| 文档 | 连接社区 | 中心性 | 被引用 | 综合评分 |")
        lines.append("|------|---------|--------|--------|---------|")
        for n in god_nodes[:15]:
            comms = ", ".join(f"社区-{c}" for c in n["connects_communities"])
            centrality = n.get('centrality', n.get('score', '-'))
            lines.append(f"| {_wikilink(n['path'])} | {comms} | {centrality} | {n.get('mentions_in', 0)} | {n.get('score', '-')} |")
    else:
        lines.append("*（暂无跨界枢纽）*")
    lines.append("\n---\n")

    # ── 五、意外关联 ──
    lines.append("## 五、意外关联（跨社区发现）\n")
    if surprising:
        for s in surprising[:15]:
            lines.append(f"- {_wikilink(s['doc_a'])} ↔ {_wikilink(s['doc_b'])}"
                         f"（相似度 {s['similarity']}，社区-{s['community_a']} × 社区-{s['community_b']}）")
    else:
        lines.append("*（暂无意外关联）*")
    lines.append("\n---\n")

    # ── 六、活跃冲突（按类型聚合 + 子类型分布）──
    lines.append("## 六、活跃冲突（需关注）\n")
    if issues:
        from collections import Counter
        type_label = {
            "principle_contradiction": "原则矛盾", "expired_claim": "过期计划/断言",
            "orphan_page": "孤儿页", "dead_link": "死链",
            "duplicate_principle": "重复原则", "inconsistent_term": "术语不一致",
        }
        n_high = sum(1 for i in issues if i.get("severity") == "high")
        n_med = sum(1 for i in issues if i.get("severity") == "medium")
        n_low = sum(1 for i in issues if i.get("severity") == "low")
        lines.append(f"> 🔴 {n_high} · 🟡 {n_med} · 🟢 {n_low} ｜ 完整看板见 `.understory/conflicts.md`\n")
        by_type = Counter(i["type"] for i in issues)
        sub_by_type: dict = {}
        for i in issues:
            sub_by_type.setdefault(i["type"], Counter())[i.get("subtype", "-")] += 1
        lines.append("| 类型 | 当前 | 子类型分布 |")
        lines.append("|------|------|-----------|")
        for t, cnt in by_type.most_common():
            subs = "、".join(f"{k}: {v}" for k, v in sub_by_type[t].items())
            lines.append(f"| {type_label.get(t, t)} | {cnt} | {subs} |")
        # high/medium 明细（low 不展开，避免噪音）
        focus = [i for i in issues if i.get("severity") in ("high", "medium")]
        if focus:
            lines.append("\n### 需优先处理（high + medium）\n")
            for it in sorted(focus, key=lambda x: 0 if x.get("severity") == "high" else 1)[:15]:
                docs = it.get("doc_a") or it.get("doc")
                docs_l = _wikilink(docs) if docs else (f"术语「{it.get('term', '')}」" if it.get("term") else "-")
                if it.get("doc_b"):
                    docs_l += f" ↔ {_wikilink(it['doc_b'])}"
                sev = SEV_ICON.get(it.get("severity"), it.get("severity", ""))
                lines.append(f"- {sev} {type_label.get(it.get('type'), it.get('type'))}：{docs_l} — {it.get('description', '')[:50]}")
    else:
        lines.append("*（当前无活跃冲突）*")
    lines.append("\n---\n")

    # ── 七、知识网络统计 ──
    edge_stats = _load_edge_stats(vault_path)
    if edge_stats:
        lines.append("## 七、知识网络统计\n")
        stats = edge_stats.get("stats", {})
        lines.append(f"> 节点：{edge_stats.get('total_nodes', 0)} | 边：{edge_stats.get('total_edges', 0)}\n")
        lines.append("| 边类型 | 数量 | 占比 |")
        lines.append("|--------|------|------|")
        total = edge_stats.get("total_edges", 1)
        for etype, count in stats.items():
            pct = count / total * 100
            icon = {"similar": "🔗", "mentions": "📎", "supersedes": "🔄", "contradicts": "⚔️"}.get(etype, "•")
            lines.append(f"| {icon} {etype} | {count} | {pct:.1f}% |")
        lines.append("")
    lines.append("---\n")

    # ── 八、知识漂移（需同步更新）──
    gaps = _load_supersede_gaps(vault_path)
    lines.append("## 八、知识漂移（需同步更新）\n")
    if gaps:
        lines.append(f"> 检测到 {len(gaps)} 处知识漂移\n")
        for g in gaps:
            lines.append(f"> 🔗 **[[{Path(g['superseded_doc']).stem}]]** 的原则已被更新")
            lines.append(f">   但 **[[{Path(g['stale_doc']).stem}]]** 仍引用旧版本")
            if g.get("old_content"):
                lines.append(f">   旧：`{g['old_content'][:50]}`")
            if g.get("new_content"):
                lines.append(f">   新：`{g['new_content'][:50]}`")
            lines.append("")
    else:
        lines.append("*（暂无知识漂移）*\n")
    lines.append("---\n")

    # ── 九、最近变更 ──
    lines.append("## 九、最近变更\n")
    recent = _recent_changed_docs(vault_path, limit=10)
    if recent:
        for rel, mtime, kind in recent:
            lines.append(f"- {mtime}: {kind} {_wikilink(rel)}")
    else:
        lines.append("*（无）*")
    lines.append("\n---\n")
    lines.append("*本文件由 index_generator.py 自动生成，不要手动修改。*")

    content = "\n".join(lines) + "\n"
    gc.atomic_write_text(gdir / "index.md", content)
    gc.rotate_logs(vault_path)
    logger.info(f"index.md generated: principles={len(principles)} communities={len(communities)} "
                f"god={len(god_nodes)} conflicts={len(issues)} gaps={len(gaps)}")
    return {"status": "ok", "principles": len(principles), "communities": len(communities),
            "god_nodes": len(god_nodes), "conflicts": len(issues), "gaps": len(gaps),
            "path": str(gdir / "index.md")}


def _recent_changed_docs(vault_path: Path, limit: int = 10):
    """返回最近修改的文档 (rel, date, kind)。kind 区分「新增」/「更新」。"""
    files = gc.list_vault_markdown(vault_path)
    dated = []
    for f in files:
        try:
            st = f.stat()
            # 创建后基本未再编辑（mtime≈ctime）视为新增，否则更新
            kind = "新增" if abs(st.st_mtime - st.st_ctime) < 60 else "更新"
            dated.append((str(f.relative_to(vault_path)).replace("\\", "/"), st.st_mtime, kind))
        except OSError:
            continue
    dated.sort(key=lambda x: x[1], reverse=True)
    return [(rel, datetime.fromtimestamp(mt).strftime("%Y-%m-%d"), kind)
            for rel, mt, kind in dated[:limit]]


def main():
    parser = argparse.ArgumentParser(description="Generate AI knowledge index")
    parser.add_argument("--vault", help="Vault 根路径")
    args = parser.parse_args()
    vault = gc.get_vault_path(args.vault)
    print(json.dumps(generate_index(vault), ensure_ascii=False))


if __name__ == "__main__":
    main()
