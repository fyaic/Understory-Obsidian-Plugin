#!/usr/bin/env python3
"""
基于 Embedding 向量相似度的关联发现策略。
直接复用 obsidian_qa 的 SQLite 缓存，避免重复建索引。
"""
import json
import math
import os
import sqlite3
import sys
from pathlib import Path

# 尝试加载自身的 .env
_self_root = Path(__file__).resolve().parent.parent
_env_file = _self_root / ".env"
if _env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_file, override=False)
    except Exception:
        pass


def _get_env():
    return {
        "api_key": os.environ.get("ZHIPU_API_KEY", "").strip(),
        "base_url": os.environ.get("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/").strip(),
        "model": os.environ.get("ZHIPU_EMBEDDING_MODEL", "embedding-3").strip(),
        "dimensions": int(os.environ.get("ZHIPU_EMBEDDING_DIMENSIONS", "1024").strip() or "1024"),
    }


def _call_embedding_api(texts: list[str]) -> list[list[float]]:
    import requests
    env = _get_env()
    if not env["api_key"]:
        raise RuntimeError("ZHIPU_API_KEY 未配置")
    url = env["base_url"].rstrip("/") + "/embeddings"
    headers = {
        "Authorization": f"Bearer {env['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "input": texts,
        "model": env["model"],
        "dimensions": env["dimensions"],
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return [item["embedding"] for item in data["data"]]


def _cosine_similarity(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    return dot / (norm_a * norm_b + 1e-10)


def discover_by_embedding(new_doc_path: Path, vault_path: Path, top_k: int = 10):
    """
    发现新文档与已有文档的语义关联。
    返回: list[{"path": str, "title": str, "similarity": float}]
    """
    cache_db = _self_root / ".cache" / "embedding_index.sqlite"
    if not cache_db.exists():
        raise FileNotFoundError(
            f"未找到 Embedding 缓存: {cache_db}\n"
            f"请先运行: python {_self_root / 'scripts' / 'vault_ops.py'} init"
        )

    # 1. 读取新文档并获取 embedding
    content = new_doc_path.read_text(encoding="utf-8")
    text = (new_doc_path.stem + "\n" + content[:800]).strip()
    if len(text) < 10:
        return []

    new_emb = _call_embedding_api([text])[0]

    # 2. 读取缓存中所有已有文档的 embedding（排除自身）
    rel_path_self = str(new_doc_path.relative_to(vault_path)).replace("\\", "/")
    conn = sqlite3.connect(str(cache_db))
    cur = conn.cursor()
    cur.execute("SELECT path, embedding FROM embeddings")

    results = []
    for row in cur.fetchall():
        cached_path = row[0]
        if cached_path == rel_path_self or cached_path.replace("/", "\\") == rel_path_self:
            continue
        cached_emb = json.loads(row[1])
        sim = _cosine_similarity(new_emb, cached_emb)
        results.append({
            "path": cached_path,
            "title": Path(cached_path).stem,
            "similarity": sim,
        })

    conn.close()
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:top_k]
