#!/usr/bin/env python3
"""
Hybrid 混合检索模块：RRF 融合关键词检索与 Embedding 语义检索。
"""
from pathlib import Path

from embedding_index import EmbeddingIndex, check_embedding_ready

# 从 vault_ops 复用的函数会在 build_hybrid_search_results 中通过参数传入，
# 避免循环导入。

DEFAULT_RRF_K = 40


def _compute_rrf(rank_keyword=None, rank_embedding=None, k=DEFAULT_RRF_K):
    score = 0.0
    if rank_keyword is not None:
        score += 1.0 / (k + rank_keyword)
    if rank_embedding is not None:
        score += 1.0 / (k + rank_embedding)
    return score


def build_hybrid_search_results(
    vault: Path,
    query: str,
    limit: int,
    keyword_results: list,
    embedding_results: list,
    snippet_fn,
    source_type_fn=None,
):
    """
    对 keyword_results 和 embedding_results 做 RRF 融合，返回统一格式的结果列表。

    keyword_results: 原有 build_search_results_with_retry 的输出
    embedding_results: embedding_index.search 的输出
    snippet_fn: callable(content, query) -> list of snippets
    source_type_fn: callable(path) -> "vault" | "repo"，默认全部 "vault"
    """
    if source_type_fn is None:
        source_type_fn = lambda p: "vault"

    # path -> {rank_keyword, rank_embedding, title, score_origin}
    merged = {}

    for rank, item in enumerate(keyword_results, start=1):
        path = item["path"]
        merged[path] = {
            "path": path,
            "title": item["title"],
            "rank_keyword": rank,
            "score_keyword": item.get("score", 0),
            "penalty": item.get("penalty", 0),
            "source_type": item.get("source_type", "vault"),
            "channel": item.get("channel"),
        }

    for rank, item in enumerate(embedding_results, start=1):
        path = item["path"]
        if path in merged:
            merged[path]["rank_embedding"] = rank
            merged[path]["similarity"] = item["similarity"]
        else:
            merged[path] = {
                "path": path,
                "title": item["title"],
                "rank_embedding": rank,
                "similarity": item["similarity"],
                "penalty": 0,
                "source_type": source_type_fn(path),
            }

    # 计算 RRF 分数并读取 snippets
    final = []
    for path, info in merged.items():
        rrf_score = _compute_rrf(
            rank_keyword=info.get("rank_keyword"),
            rank_embedding=info.get("rank_embedding"),
        )

        # 确定召回通道标签
        has_kw = "rank_keyword" in info
        has_emb = "rank_embedding" in info
        explicit_channel = info.get("channel")
        if explicit_channel == "er":
            channel = "er"
        elif has_kw and has_emb:
            channel = "hybrid"
        elif has_emb:
            channel = "embedding"
        else:
            channel = "keyword"

        # 读取内容提取 snippets（对 embedding 召回的文档可能需要）
        note_path = vault / path
        snippets = []
        try:
            if note_path.exists():
                content = note_path.read_text(encoding="utf-8")
                snippets = snippet_fn(content, query)
        except Exception:
            pass

        final.append({
            "path": path,
            "title": info["title"],
            "score": round(rrf_score * 1000, 2),  # 放大便于排序和展示
            "rrf_score": round(rrf_score, 6),
            "penalty": info.get("penalty", 0),
            "snippets": snippets,
            "source_type": info["source_type"],
            "channel": channel,
            "keyword_score": info.get("score_keyword"),
            "embedding_similarity": info.get("similarity"),
        })

    final.sort(key=lambda x: (-x["score"], x["path"]))
    return final[:limit]


def hybrid_search(
    vault: Path,
    query: str,
    limit: int,
    keyword_builder_fn,
    docs_for_embedding,
    snippet_fn,
    top_k_embedding: int = 20,
    index: EmbeddingIndex = None,
):
    """
    完整 Hybrid 搜索入口。

    keyword_builder_fn: callable(vault, query, limit) -> list of keyword results
    docs_for_embedding: list of {"path": str, "title": str, "text": str}
    snippet_fn: callable(content, query) -> list
    index: 可选传入已初始化的 EmbeddingIndex，避免重复创建连接
    """
    # 1. 关键词检索
    keyword_results = keyword_builder_fn(vault, query, limit)

    # 2. 检查 Embedding 是否可用
    ready, msg = check_embedding_ready()
    if not ready:
        # 降级：直接返回关键词结果，但补一个统一字段
        for item in keyword_results:
            item["channel"] = "keyword"
            if "score" in item and isinstance(item["score"], int):
                item["score"] = float(item["score"])
        return keyword_results, {"embedding_ready": False, "message": msg}

    # 3. 确保索引是最新的（增量更新）
    if index is None:
        index = EmbeddingIndex()
    try:
        index.ensure_index(docs_for_embedding, base_path=vault)
    except Exception as exc:
        # 索引异常时降级到关键词
        for item in keyword_results:
            item["channel"] = "keyword"
            if "score" in item and isinstance(item["score"], int):
                item["score"] = float(item["score"])
        return keyword_results, {"embedding_ready": True, "error": str(exc), "message": f"语义检索索引异常，已降级到关键词模式。原因: {exc}"}

    # 4. Embedding 语义检索
    try:
        embedding_results = index.search(query, docs_for_embedding, top_k=top_k_embedding)
    except Exception as exc:
        # API 异常时降级到关键词
        for item in keyword_results:
            item["channel"] = "keyword"
            if "score" in item and isinstance(item["score"], int):
                item["score"] = float(item["score"])
        return keyword_results, {"embedding_ready": True, "error": str(exc), "message": f"语义检索异常，已降级到关键词模式。原因: {exc}"}

    # 4. RRF 融合
    final = build_hybrid_search_results(
        vault=vault,
        query=query,
        limit=limit,
        keyword_results=keyword_results,
        embedding_results=embedding_results,
        snippet_fn=snippet_fn,
    )
    return final, {"embedding_ready": True, "message": "Hybrid 检索正常"}
