#!/usr/bin/env python3
"""
graph_analyzer —— L4 图分析模块（完全离线）。

基于 kg 的 embedding_index.sqlite 缓存向量构建相似度图，做：
  - 社区聚类（networkx greedy_modularity → 纯 Python 连通分量 保底）
  - god node（跨社区高中心性枢纽）
  - 意外关联（跨社区高相似度文档对）
不重算 embedding、不调用 LLM，成本为 0。

输出：
  .understory/community_clusters.json
  .understory/god_nodes.json

用法：
    python graph_analyzer.py --vault "<VAULT_ROOT>"
"""
import argparse
import json
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict, deque
from pathlib import Path

import graphify_common as gc

try:
    scripts_dir = gc.get_kg_skill_path() / "scripts"
    scripts_path = str(scripts_dir)
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from config import config  # type: ignore
except Exception:
    config = None

# 依赖检测（预授权降级链）
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False

def _cfg(key: str, default):
    if config is None:
        return default
    return config.get(key, default)


def _sim_threshold() -> float:
    return float(_cfg("graph.sim_threshold", 0.5))


def _top_k_neighbors() -> int:
    return int(_cfg("graph.top_k_neighbors", 15))


def _min_community_size() -> int:
    return int(_cfg("graph.min_community_size", 3))


def _surprise_threshold() -> float:
    return float(_cfg("graph.surprise_threshold", 0.6))


def _god_node_min_communities() -> int:
    return int(_cfg("graph.god_node_min_communities", 3))


def _mention_scan_time() -> int:
    return int(_cfg("graph.mention_scan_time", 20))


def _max_edges_per_type() -> int:
    return int(_cfg("graph.max_edges_per_type", 5000))


def _graph_params() -> dict:
    return {
        "sim_threshold": _sim_threshold(),
        "top_k": _top_k_neighbors(),
        "min_community_size": _min_community_size(),
    }


# ───────────────────────────────────────────
# 相似度图构建
# ───────────────────────────────────────────

def build_similarity_graph(emb_map: dict, threshold: float | None = None,
                           top_k: int | None = None):
    """
    返回 (paths, edges)。
      paths: [rel_path, ...] 节点顺序
      edges: [(i, j, weight), ...] i<j，已稀疏化（每节点 top_k 近邻 ∩ threshold）
    用 numpy 批量算余弦；无 numpy 时退化为纯 Python（慢，仅小库）。
    """
    paths = list(emb_map.keys())
    n = len(paths)
    edges = []
    if threshold is None:
        threshold = _sim_threshold()
    if top_k is None:
        top_k = _top_k_neighbors()
    if n < 2:
        return paths, edges

    if HAS_NUMPY:
        X = np.array([emb_map[p]["embedding"] for p in paths], dtype=np.float32)
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        norms[norms == 0] = 1e-10
        Xn = X / norms
        edge_set = {}
        # 分块算相似度矩阵，避免一次性 n×n 占用过大
        block = 512
        for start in range(0, n, block):
            end = min(start + block, n)
            sims = Xn[start:end] @ Xn.T  # (b, n)
            for local_i in range(end - start):
                i = start + local_i
                row = sims[local_i]
                row[i] = -1.0  # 排除自身
                # top_k 近邻
                if n - 1 > top_k:
                    idx = np.argpartition(row, -top_k)[-top_k:]
                else:
                    idx = np.arange(n)
                for j in idx:
                    j = int(j)
                    if j == i:
                        continue
                    w = float(row[j])
                    if w < threshold:
                        continue
                    a, b = (i, j) if i < j else (j, i)
                    # 保留较大权重（无向）
                    if edge_set.get((a, b), -1) < w:
                        edge_set[(a, b)] = w
        edges = [(a, b, w) for (a, b), w in edge_set.items()]
    else:
        # 纯 Python 保底
        vecs = [emb_map[p]["embedding"] for p in paths]
        for i in range(n):
            sims = []
            for j in range(n):
                if i == j:
                    continue
                w = gc.cosine_similarity(vecs[i], vecs[j])
                if w >= threshold:
                    sims.append((w, j))
            sims.sort(reverse=True)
            for w, j in sims[:top_k]:
                a, b = (i, j) if i < j else (j, i)
                edges.append((a, b, w))
        # 去重
        ded = {}
        for a, b, w in edges:
            if ded.get((a, b), -1) < w:
                ded[(a, b)] = w
        edges = [(a, b, w) for (a, b), w in ded.items()]
    return paths, edges


# ───────────────────────────────────────────
# 社区检测
# ───────────────────────────────────────────

def _connected_components(n: int, edges) -> list[set]:
    """纯 Python 连通分量（保底）。"""
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, _ in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups = defaultdict(set)
    for i in range(n):
        groups[find(i)].add(i)
    return list(groups.values())


def detect_communities(paths, edges, emb_map):
    """
    返回 (communities, node2comm)。
      communities: [{"id","name","docs","size","coherence"}]
      node2comm: {node_idx: comm_id}（仅有效社区；未归入者不在内）
    """
    n = len(paths)
    raw_groups = []
    algo = "none"
    if HAS_NETWORKX and edges:
        G = nx.Graph()
        G.add_nodes_from(range(n))
        for a, b, w in edges:
            G.add_edge(a, b, weight=w)
        try:
            from networkx.algorithms.community import greedy_modularity_communities
            comms = greedy_modularity_communities(G, weight="weight")
            raw_groups = [set(c) for c in comms]
            algo = "greedy_modularity"
        except Exception:
            raw_groups = _connected_components(n, edges)
            algo = "connected_components"
    else:
        raw_groups = _connected_components(n, edges)
        algo = "connected_components"

    # 过滤小社区
    communities = []
    node2comm = {}
    cid = 0
    unclustered = []
    min_size = _min_community_size()
    for g in sorted(raw_groups, key=len, reverse=True):
        if len(g) < min_size:
            unclustered.extend(g)
            continue
        docs = [paths[i] for i in g]
        communities.append({
            "id": cid,
            "name": name_community(docs),
            "docs": docs,
            "size": len(docs),
            "coherence": round(_coherence(list(g), emb_map, paths), 4),
        })
        for i in g:
            node2comm[i] = cid
        cid += 1
    return communities, node2comm, unclustered, algo


def _coherence(indices, emb_map, paths) -> float:
    """社区内平均相似度（抽样估计，控性能）。"""
    if len(indices) < 2:
        return 0.0
    vecs = [emb_map[paths[i]]["embedding"] for i in indices[:30]]
    total, cnt = 0.0, 0
    for a in range(len(vecs)):
        for b in range(a + 1, len(vecs)):
            total += gc.cosine_similarity(vecs[a], vecs[b])
            cnt += 1
    return total / cnt if cnt else 0.0


# 社区命名停用词
_NAME_STOP = set("的了和与及并方案问题怎么如何什么一个记录笔记报告总结介绍分析".split()
                 ) | {"report", "note", "md", "draft", "final", "untitled"}


def name_community(docs: list[str]) -> str:
    """社区命名：优先共同文件夹，否则取标题高频词，再否则编号。"""
    # 1. 共同文件夹
    folders = [Path(d).parent.name for d in docs if Path(d).parent.name]
    if folders:
        fc = Counter(folders).most_common(1)[0]
        if fc[1] >= max(2, len(docs) * 0.5):
            return fc[0]
    # 2. 标题高频词（2-4 字中文词组 / 英文词）
    words = []
    for d in docs:
        stem = Path(d).stem
        words += re.findall(r"[一-鿿]{2,4}", stem)
        words += [w.lower() for w in re.findall(r"[A-Za-z]{3,}", stem)]
    words = [w for w in words if w not in _NAME_STOP and not w.isdigit()]
    if words:
        common = [w for w, c in Counter(words).most_common(3) if c >= 2]
        if common:
            return "·".join(common[:2])
    # 3. 兜底
    if folders:
        return Counter(folders).most_common(1)[0][0]
    return f"社区-{len(docs)}篇"


# ───────────────────────────────────────────
# god node + 意外关联
# ───────────────────────────────────────────

def find_god_nodes(paths, edges, emb_map, node2comm):
    """跨社区高中心性枢纽 + 意外关联。"""
    n = len(paths)
    adj = defaultdict(list)
    for a, b, w in edges:
        adj[a].append((b, w))
        adj[b].append((a, w))

    god_nodes = []
    # 中心性：networkx 近似 betweenness（k 采样）；否则用 degree
    centrality = {}
    if HAS_NETWORKX and edges:
        G = nx.Graph()
        G.add_nodes_from(range(n))
        for a, b, w in edges:
            G.add_edge(a, b, weight=w)
        try:
            k = min(200, n) if n > 0 else None
            centrality = nx.betweenness_centrality(G, k=k, weight="weight", seed=42)
        except Exception:
            centrality = {i: len(adj[i]) / max(1, n) for i in range(n)}
    else:
        centrality = {i: len(adj[i]) / max(1, n) for i in range(n)}

    # 候选：中心性 top 10%
    ranked = sorted(centrality.items(), key=lambda x: x[1], reverse=True)
    top_cut = max(1, int(len(ranked) * 0.1))
    for i, cval in ranked[:top_cut]:
        neigh_comms = set()
        for j, _ in adj[i]:
            if j in node2comm:
                neigh_comms.add(node2comm[j])
        if len(neigh_comms) >= _god_node_min_communities():
            god_nodes.append({
                "path": paths[i],
                "title": Path(paths[i]).stem,
                "centrality": round(float(cval), 4),
                "connects_communities": sorted(neigh_comms),
                "community": node2comm.get(i),
            })
    god_nodes.sort(key=lambda x: x["centrality"], reverse=True)

    # 意外关联：跨社区且相似度超过配置阈值
    surprising = []
    seen = set()
    surprise_threshold = _surprise_threshold()
    for a, b, w in edges:
        ca, cb = node2comm.get(a), node2comm.get(b)
        if ca is None or cb is None or ca == cb:
            continue
        if w < surprise_threshold:
            continue
        key = (min(a, b), max(a, b))
        if key in seen:
            continue
        seen.add(key)
        surprising.append({
            "doc_a": paths[a], "doc_b": paths[b],
            "similarity": round(float(w), 4),
            "community_a": ca, "community_b": cb,
        })
    surprising.sort(key=lambda x: x["similarity"], reverse=True)
    return god_nodes[:30], surprising[:50]


# ───────────────────────────────────────────
# 主入口
# ───────────────────────────────────────────

# ───────────────────────────────────────────
# 【新增】多类型边提取
# ───────────────────────────────────────────

WIKILINK_RE = re.compile(r'\[\[([^\]|\n]+)(?:\|[^\]|\n]+)?\]\]')


def _resolve_wikilink(vault_path: Path, target_raw: str) -> str | None:
    """解析 wikilink 目标文档路径。"""
    target_raw = target_raw.strip()
    if "/" in target_raw or "\\" in target_raw:
        candidate = vault_path / target_raw
        if candidate.suffix != ".md":
            candidate = candidate.with_suffix(".md")
        if candidate.exists():
            return str(candidate.relative_to(vault_path)).replace("\\", "/")
        return None

    target_stem = target_raw
    matches = []
    for md_file in vault_path.rglob("*.md"):
        if md_file.stem == target_stem:
            rel = str(md_file.relative_to(vault_path)).replace("\\", "/")
            matches.append(rel)
    if matches:
        return min(matches, key=len)
    return None


def extract_mention_edges(vault_path: Path) -> list[dict]:
    """提取 wikilink mentions 边。"""
    edges = []
    seen = set()
    start_time = time.time()
    files = gc.list_vault_markdown(vault_path)

    for md_file in files:
        if time.time() - start_time > _mention_scan_time():
            break
        rel_from = str(md_file.relative_to(vault_path)).replace("\\", "/")
        try:
            content = md_file.read_text(encoding="utf-8")
        except Exception:
            continue
        for match in WIKILINK_RE.finditer(content):
            target_raw = match.group(1).strip()
            target_doc = _resolve_wikilink(vault_path, target_raw)
            if not target_doc or target_doc == rel_from:
                continue
            key = (rel_from, target_doc)
            if key in seen:
                continue
            seen.add(key)
            edges.append({"from": rel_from, "to": target_doc, "type": "mentions", "weight": 1.0})
    return edges


def extract_supersede_edges(conn) -> list[dict]:
    """从 principles 表提取 supersedes 边。"""
    cur = conn.execute("""
        SELECT old.doc_path, new.doc_path
        FROM principles old
        JOIN principles new ON old.superseded_by = new.id
        WHERE old.deleted_at IS NOT NULL
    """)
    edges = []
    seen = set()
    for old_doc, new_doc in cur.fetchall():
        key = (new_doc, old_doc)
        if key in seen:
            continue
        seen.add(key)
        edges.append({"from": new_doc, "to": old_doc, "type": "supersedes", "weight": 1.0})
    return edges


def extract_contradiction_edges(vault_path: Path) -> list[dict]:
    """从 conflicts.json 提取 contradicts 边。"""
    gdir = gc.get_graphify_dir(vault_path)
    path = gdir / "conflicts.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    edges = []
    seen = set()
    for issue in data.get("issues", []):
        if issue.get("type") != "principle_contradiction" or issue.get("status") == "resolved":
            continue
        doc_a, doc_b = issue.get("doc_a"), issue.get("doc_b")
        if not doc_a or not doc_b or doc_a == doc_b:
            continue
        key = tuple(sorted([doc_a, doc_b]))
        if key in seen:
            continue
        seen.add(key)
        edges.append({"from": doc_a, "to": doc_b, "type": "contradicts", "weight": 1.0})
    return edges


# ───────────────────────────────────────────
# 【新增】边合并与增强分析
# ───────────────────────────────────────────

def build_multi_type_edges(vault_path: Path, paths, sim_edges, conn=None) -> tuple[list[dict], dict]:
    """构建多类型边图。"""
    all_edges = []
    stats = {}

    # 1. similar 边
    sim_converted = [{"from": paths[i], "to": paths[j], "type": "similar", "weight": w}
                     for i, j, w in sim_edges]
    max_edges = _max_edges_per_type()
    if len(sim_converted) > max_edges:
        sim_converted.sort(key=lambda x: x["weight"], reverse=True)
        sim_converted = sim_converted[:max_edges]
    all_edges.extend(sim_converted)
    stats["similar"] = len(sim_converted)

    # 2. mentions 边
    mention_edges = extract_mention_edges(vault_path)
    all_edges.extend(mention_edges)
    stats["mentions"] = len(mention_edges)

    # 3. supersedes 边
    should_close = False
    if conn is None:
        db_path = gc.get_principles_db(vault_path)
        if db_path.exists():
            conn = sqlite3.connect(str(db_path))
            should_close = True
    if conn:
        try:
            supersede_edges = extract_supersede_edges(conn)
            all_edges.extend(supersede_edges)
            stats["supersedes"] = len(supersede_edges)
        finally:
            if should_close:
                conn.close()
    else:
        stats["supersedes"] = 0

    # 4. contradicts 边
    contra_edges = extract_contradiction_edges(vault_path)
    all_edges.extend(contra_edges)
    stats["contradicts"] = len(contra_edges)

    return all_edges, stats


def _split_by_contradictions(docs: list[str], contra_edges: list[dict]) -> tuple[list[str], list[str]]:
    """BFS 二染色拆分冲突社区。"""
    adj = defaultdict(list)
    for e in contra_edges:
        adj[e["from"]].append(e["to"])
        adj[e["to"]].append(e["from"])

    color = {}
    for start in docs:
        if start in color:
            continue
        queue = deque([start])
        color[start] = 0
        while queue:
            node = queue.popleft()
            for neighbor in adj.get(node, []):
                if neighbor not in color:
                    color[neighbor] = 1 - color[node]
                    queue.append(neighbor)

    group_a = [d for d in docs if color.get(d, 0) == 0]
    group_b = [d for d in docs if color.get(d, 0) == 1]

    if not group_a and docs:
        group_a = [docs[0]]
        group_b = [d for d in docs if d != docs[0]]
    if not group_b and docs:
        group_b = [docs[-1]]
        group_a = [d for d in docs if d != docs[-1]]
    return group_a, group_b


def _coherence_for_docs(docs: list[str], emb_map: dict, path2idx: dict) -> float:
    """社区内平均相似度（抽样估计）。"""
    indices = [path2idx[d] for d in docs if d in path2idx]
    if len(indices) < 2:
        return 0.0
    vecs = [emb_map[paths[i]]["embedding"] for i in indices[:30]]
    total, cnt = 0.0, 0
    for a in range(len(vecs)):
        for b in range(a + 1, len(vecs)):
            total += gc.cosine_similarity(vecs[a], vecs[b])
            cnt += 1
    return total / cnt if cnt else 0.0


def detect_communities_enhanced(paths, sim_edges, contra_edges, emb_map):
    """增强社区检测：similar 基础聚类 + contradicts 分离。"""
    base_communities, node2comm, unclustered, algo = detect_communities(paths, sim_edges, emb_map)

    if not contra_edges:
        return base_communities, node2comm, unclustered, algo

    path2idx = {p: i for i, p in enumerate(paths)}
    final_communities = []
    final_node2comm = {}
    cid = 0

    for comm in base_communities:
        comm_docs = set(comm["docs"])
        internal_contra = [e for e in contra_edges
                          if e["from"] in comm_docs and e["to"] in comm_docs]
        if not internal_contra:
            comm["id"] = cid
            final_communities.append(comm)
            for d in comm["docs"]:
                final_node2comm[d] = cid
            cid += 1
            continue

        group_a, group_b = _split_by_contradictions(comm["docs"], internal_contra)
        for group, suffix in [(group_a, "-a"), (group_b, "-b")]:
            if len(group) < _min_community_size():
                unclustered.extend(group)
                continue
            sub_comm = {
                "id": cid,
                "name": f"{comm['name']}{suffix}",
                "docs": group,
                "size": len(group),
                "coherence": round(_coherence_for_docs(group, emb_map, path2idx), 4),
                "split_from": comm["id"],
                "split_reason": f"内部冲突: {len(internal_contra)} 处",
            }
            final_communities.append(sub_comm)
            for d in group:
                final_node2comm[d] = cid
            cid += 1

    return final_communities, final_node2comm, unclustered, f"{algo}+contra_split"


def find_god_nodes_enhanced(paths, sim_edges, mention_edges, contra_edges, node2comm):
    """增强 God Node：0.4×similar + 0.4×mentions + 0.2×cross_community。"""
    n = len(paths)
    path2idx = {p: i for i, p in enumerate(paths)}

    # 1. similar 中心性
    sim_centrality = {}
    if HAS_NETWORKX and sim_edges:
        G = nx.Graph()
        G.add_nodes_from(range(n))
        for a, b, w in sim_edges:
            G.add_edge(a, b, weight=w)
        try:
            k = min(200, n) if n > 0 else None
            sim_centrality = nx.betweenness_centrality(G, k=k, weight="weight", seed=42)
        except Exception:
            sim_centrality = {i: 0.0 for i in range(n)}
    else:
        sim_centrality = {i: 0.0 for i in range(n)}

    # 2. mentions 入度（归一化）
    mentions_indegree = defaultdict(int)
    for e in mention_edges:
        if e["to"] in path2idx:
            mentions_indegree[path2idx[e["to"]]] += 1
    max_mentions = max(mentions_indegree.values()) if mentions_indegree else 1

    # 3. 邻接表（similar + contradicts）
    adj = defaultdict(list)
    for a, b, w in sim_edges:
        adj[a].append((b, w))
        adj[b].append((a, w))
    for e in contra_edges:
        if e["from"] in path2idx and e["to"] in path2idx:
            adj[path2idx[e["from"]]].append((path2idx[e["to"]], 1.0))
            adj[path2idx[e["to"]]].append((path2idx[e["from"]], 1.0))

    # 综合评分
    scores = {}
    for i in range(n):
        sim_score = sim_centrality.get(i, 0.0)
        mention_score = mentions_indegree.get(i, 0) / max_mentions

        neigh_comms = set()
        for j, _ in adj.get(i, []):
            if j in node2comm:
                neigh_comms.add(node2comm[j])
        cross_score = len(neigh_comms) / max(1, len(set(node2comm.values())))

        scores[i] = 0.4 * sim_score + 0.4 * min(mention_score, 1.0) + 0.2 * cross_score

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    top_cut = max(1, int(len(ranked) * 0.1))

    god_nodes = []
    for i, score in ranked[:top_cut]:
        neigh_comms = set()
        for j, _ in adj.get(i, []):
            if j in node2comm:
                neigh_comms.add(node2comm[j])
        if len(neigh_comms) >= _god_node_min_communities():
            sim_score = sim_centrality.get(i, 0.0)
            god_nodes.append({
                "path": paths[i],
                "title": Path(paths[i]).stem,
                "score": round(float(score), 4),
                "centrality": round(float(sim_score), 4),
                "mentions_in": mentions_indegree.get(i, 0),
                "connects_communities": sorted(neigh_comms),
                "community": node2comm.get(i),
            })

    god_nodes.sort(key=lambda x: x["score"], reverse=True)
    return god_nodes[:30]


def analyze_enhanced(vault_path: Path, emb_map, paths, sim_edges, communities, node2comm):
    """增强分析主入口。构建多类型边图，输出 knowledge_graph.json 等。"""
    vault_path = Path(vault_path)
    logger = gc.setup_logger("graph_enhanced", vault_path)
    gdir = gc.get_graphify_dir(vault_path)
    db_path = gc.get_principles_db(vault_path)

    conn = sqlite3.connect(str(db_path)) if db_path.exists() else None
    try:
        all_edges, stats = build_multi_type_edges(vault_path, paths, sim_edges, conn)
    finally:
        if conn:
            conn.close()

    mention_edges = [e for e in all_edges if e["type"] == "mentions"]
    contra_edges = [e for e in all_edges if e["type"] == "contradicts"]

    # 增强社区
    enhanced_communities, enhanced_node2comm, unclustered, algo = \
        detect_communities_enhanced(paths, sim_edges, contra_edges, emb_map)

    # 增强 God Node
    god_nodes = find_god_nodes_enhanced(paths, sim_edges, mention_edges, contra_edges, enhanced_node2comm)

    # knowledge_graph.json
    kg_out = {
        "status": "ok",
        "generated_at": gc.now_iso(),
        "nodes": list(set(e["from"] for e in all_edges) | set(e["to"] for e in all_edges)),
        "edges": all_edges,
        "stats": stats,
    }
    gc.atomic_write_text(gdir / "knowledge_graph.json",
                         json.dumps(kg_out, ensure_ascii=False, indent=2))

    # edge_stats.json
    edge_stats = {
        "status": "ok",
        "generated_at": gc.now_iso(),
        "stats": stats,
        "total_edges": len(all_edges),
        "total_nodes": len(kg_out["nodes"]),
    }
    gc.atomic_write_text(gdir / "edge_stats.json",
                         json.dumps(edge_stats, ensure_ascii=False, indent=2))

    # 增强 community_clusters.json
    clusters_out = {
        "status": "ok",
        "generated_at": gc.now_iso(),
        "algorithm": algo,
        "params": _graph_params(),
        "node_count": len(paths),
        "edge_count": len(all_edges),
        "community_count": len(enhanced_communities),
        "communities": enhanced_communities,
        "unclustered": unclustered,
        "edge_stats": stats,
    }
    gc.atomic_write_text(gdir / "community_clusters.json",
                         json.dumps(clusters_out, ensure_ascii=False, indent=2))

    # 增强 god_nodes.json
    god_out = {
        "status": "ok",
        "generated_at": gc.now_iso(),
        "god_nodes": god_nodes,
    }
    gc.atomic_write_text(gdir / "god_nodes.json",
                         json.dumps(god_out, ensure_ascii=False, indent=2))

    logger.info(f"enhanced analysis: nodes={len(kg_out['nodes'])}, edges={len(all_edges)}, "
                f"communities={len(enhanced_communities)}, god_nodes={len(god_nodes)}")
    return {
        "status": "ok",
        "nodes": len(kg_out["nodes"]),
        "edges": len(all_edges),
        "communities": len(enhanced_communities),
        "god_nodes": len(god_nodes),
        "edge_stats": stats,
        "enhanced_communities": enhanced_communities,
        "enhanced_node2comm": enhanced_node2comm,
        "unclustered": unclustered,
        "algo": algo,
        "god_nodes_data": god_nodes,
    }


def analyze(vault_path: Path) -> dict:
    vault_path = Path(vault_path)
    logger = gc.setup_logger("graph", vault_path)
    gdir = gc.get_graphify_dir(vault_path)

    emb_map = gc.load_cached_embeddings(vault_path)
    logger.info(f"loaded {len(emb_map)} cached embeddings (numpy={HAS_NUMPY}, networkx={HAS_NETWORKX})")
    if len(emb_map) < 2:
        out = {"status": "error", "message": "缓存向量不足（<2），无法图分析"}
        logger.error(out["message"])
        return out

    paths, edges = build_similarity_graph(emb_map)
    logger.info(f"graph built: {len(paths)} nodes, {len(edges)} edges")

    communities, node2comm, unclustered, algo = detect_communities(paths, edges, emb_map)
    logger.info(f"communities: {len(communities)} (algo={algo}), unclustered={len(unclustered)}")

    god_nodes, surprising = find_god_nodes(paths, edges, emb_map, node2comm)
    logger.info(f"god_nodes={len(god_nodes)}, surprising_connections={len(surprising)}")

    # 【新增】增强分析（失败不影响主流程）
    enhanced = None
    try:
        enhanced = analyze_enhanced(vault_path, emb_map, paths, edges, communities, node2comm)
        logger.info(f"enhanced analysis: {enhanced.get('edges', 0)} edges, "
                    f"{enhanced.get('communities', 0)} communities")
    except Exception as e:
        logger.warning(f"enhanced analysis failed: {e}")

    # 使用增强数据（如果可用），否则回退到基础数据
    if enhanced:
        out_communities = enhanced["enhanced_communities"]
        out_unclustered = enhanced["unclustered"]
        out_algo = enhanced["algo"]
        out_god_nodes = enhanced["god_nodes_data"]
        out_edge_count = enhanced["edges"]
    else:
        out_communities = communities
        out_unclustered = [paths[i] for i in unclustered]
        out_algo = algo
        out_god_nodes = god_nodes
        out_edge_count = len(edges)

    clusters_out = {
        "status": "ok",
        "generated_at": gc.now_iso(),
        "algorithm": out_algo,
        "params": _graph_params(),
        "node_count": len(paths),
        "edge_count": out_edge_count,
        "community_count": len(out_communities),
        "communities": out_communities,
        "unclustered": out_unclustered,
    }
    if enhanced:
        clusters_out["edge_stats"] = enhanced["edge_stats"]

    god_out = {
        "status": "ok",
        "generated_at": gc.now_iso(),
        "god_nodes": out_god_nodes,
        "surprising_connections": surprising,
    }

    gc.atomic_write_text(gdir / "community_clusters.json",
                         json.dumps(clusters_out, ensure_ascii=False, indent=2))
    gc.atomic_write_text(gdir / "god_nodes.json",
                         json.dumps(god_out, ensure_ascii=False, indent=2))
    gc.rotate_logs(vault_path)
    logger.info("graph analysis written")
    return {"status": "ok", "communities": len(out_communities),
            "god_nodes": len(out_god_nodes), "surprising": len(surprising), "algorithm": out_algo}


def main():
    parser = argparse.ArgumentParser(description="Graph analysis on cached embeddings")
    parser.add_argument("--vault", help="Vault 根路径")
    args = parser.parse_args()
    vault = gc.get_vault_path(args.vault)
    print(json.dumps(analyze(vault), ensure_ascii=False))


if __name__ == "__main__":
    main()
