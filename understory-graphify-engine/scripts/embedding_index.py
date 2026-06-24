#!/usr/bin/env python3
"""
Embedding 语义索引模块。
负责：本地缓存管理、增量更新、智谱 Embedding API 调用、余弦相似度检索。
缺失可选依赖或 API 配置时，自动抛出可识别的异常供上层降级处理。
"""
import json
import os
import sqlite3
import sys
import hashlib
from pathlib import Path

# 依赖检测
try:
    import requests
except Exception:
    requests = None

_skill_root = Path(__file__).resolve().parent.parent
_graphify_scripts = _skill_root / "graphify-template" / "scripts"
graphify_scripts_path = str(_graphify_scripts)
if graphify_scripts_path not in sys.path:
    sys.path.insert(0, graphify_scripts_path)

from graphify_common import clean_markdown as _clean_markdown, cosine_similarity as _cosine_similarity
from providers import get_embedding_provider
from config import config
from network_policy import current_network_mode, embedding_allowed


def _embedding_provider_name() -> str:
    return (
        os.environ.get("UNDERSTORY_EMBEDDING_PROVIDER")
        or os.environ.get("EMBEDDING_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or config.get("provider.embedding", "zhipu")
    ).strip().lower()


def _llm_provider_name() -> str:
    return (
        os.environ.get("UNDERSTORY_LLM_PROVIDER")
        or os.environ.get("LLM_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or config.get("provider.llm", "zhipu")
    ).strip().lower()

def _get_env():
    provider_name = _embedding_provider_name()
    if provider_name == "openai":
        default_base_url = os.environ.get("OPENAI_BASE_URL", str(config.get("openai.base_url", "https://api.openai.com/v1/")))
        default_model = os.environ.get("OPENAI_EMBEDDING_MODEL", str(config.get("openai.embedding_model", "text-embedding-3-small")))
    elif provider_name in {"custom", "custom-openai", "custom_openai", "openai-compatible", "openai_compatible"}:
        default_base_url = (
            os.environ.get("CUSTOM_OPENAI_BASE_URL")
            or os.environ.get("UNDERSTORY_CUSTOM_BASE_URL")
            or str(config.get("custom.base_url", ""))
        )
        default_model = (
            os.environ.get("CUSTOM_OPENAI_EMBEDDING_MODEL")
            or os.environ.get("UNDERSTORY_CUSTOM_EMBEDDING_MODEL")
            or str(config.get("custom.embedding_model", ""))
        )
    else:
        default_base_url = os.environ.get("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/")
        default_model = os.environ.get("ZHIPU_EMBEDDING_MODEL", "embedding-3")
    llm_provider_name = _llm_provider_name()
    if llm_provider_name == "openai":
        default_llm_base_url = os.environ.get("OPENAI_BASE_URL", str(config.get("openai.base_url", "https://api.openai.com/v1/")))
        default_llm_model = os.environ.get("OPENAI_LLM_MODEL", str(config.get("openai.llm_model", "gpt-4o-mini")))
    elif llm_provider_name in {"custom", "custom-openai", "custom_openai", "openai-compatible", "openai_compatible"}:
        default_llm_base_url = (
            os.environ.get("CUSTOM_OPENAI_BASE_URL")
            or os.environ.get("UNDERSTORY_CUSTOM_BASE_URL")
            or str(config.get("custom.base_url", ""))
        )
        default_llm_model = (
            os.environ.get("CUSTOM_OPENAI_LLM_MODEL")
            or os.environ.get("UNDERSTORY_CUSTOM_LLM_MODEL")
            or str(config.get("custom.llm_model", ""))
        )
    else:
        default_llm_base_url = os.environ.get("ZHIPU_BASE_URL", "https://open.bigmodel.cn/api/paas/v4/")
        default_llm_model = os.environ.get("ZHIPU_LLM_MODEL", "glm-4-flash")
    return {
        "api_key": os.environ.get("ZHIPU_API_KEY", "").strip(),
        "embedding_api_key": (
            os.environ.get("UNDERSTORY_EMBEDDING_API_KEY")
            or os.environ.get("ZHIPU_API_KEY", "")
            or os.environ.get("OPENAI_API_KEY", "")
            or os.environ.get("CUSTOM_OPENAI_API_KEY", "")
        ).strip(),
        "llm_api_key": (
            os.environ.get("UNDERSTORY_LLM_API_KEY")
            or os.environ.get("ZHIPU_API_KEY", "")
            or os.environ.get("OPENAI_API_KEY", "")
            or os.environ.get("CUSTOM_OPENAI_API_KEY", "")
        ).strip(),
        "base_url": (
            os.environ.get("UNDERSTORY_EMBEDDING_BASE_URL")
            or default_base_url
        ).strip(),
        "embedding_base_url": (
            os.environ.get("UNDERSTORY_EMBEDDING_BASE_URL")
            or default_base_url
        ).strip(),
        "llm_base_url": (
            os.environ.get("UNDERSTORY_LLM_BASE_URL")
            or default_llm_base_url
        ).strip(),
        "model": (
            os.environ.get("UNDERSTORY_EMBEDDING_MODEL")
            or default_model
        ).strip(),
        "embedding_model": (
            os.environ.get("UNDERSTORY_EMBEDDING_MODEL")
            or default_model
        ).strip(),
        "llm_model": (
            os.environ.get("UNDERSTORY_LLM_MODEL")
            or default_llm_model
        ).strip(),
        "dimensions": int((
            os.environ.get("UNDERSTORY_EMBEDDING_DIMENSIONS")
            or os.environ.get("ZHIPU_EMBEDDING_DIMENSIONS", "1024")
        ).strip() or "1024"),
    }


def _file_hash(path: Path) -> str:
    """基于文件大小+修改时间的轻量 hash。"""
    if not path.exists():
        return ""
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class EmbeddingIndex:
    """
    轻量 Embedding 索引，使用 SQLite 做本地缓存。
    首次使用会自动建表；每次 ensure_index 只处理新增/变更的文档。
    """

    def __init__(self, cache_path: Path = None):
        self.env = _get_env()
        if cache_path is None:
            cache_dir = _skill_root / ".cache"
            cache_dir.mkdir(exist_ok=True)
            cache_path = cache_dir / "embedding_index.sqlite"
        self.db_path = cache_path
        self._conn = sqlite3.connect(str(self.db_path))
        self._configure_connection()
        self._ensure_table()

    def _configure_connection(self):
        cur = self._conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    def _ensure_table(self):
        cur = self._conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS embeddings (
                path TEXT PRIMARY KEY,
                mtime REAL,
                hash TEXT,
                embedding TEXT
            )
            """
        )
        self._conn.commit()

    def _fetch_cached(self, path: str):
        cur = self._conn.cursor()
        cur.execute("SELECT mtime, hash, embedding FROM embeddings WHERE path = ?", (path,))
        row = cur.fetchone()
        if not row:
            return None
        return {"mtime": row[0], "hash": row[1], "embedding": json.loads(row[2])}

    def fetch_all_mtimes(self) -> dict[str, float]:
        """
        AIC-2190: 批量获取所有缓存条目的 mtime，用于预筛选变更文件。
        返回: {path: mtime, ...}
        """
        cur = self._conn.cursor()
        cur.execute("SELECT path, mtime FROM embeddings")
        return {row[0]: row[1] for row in cur.fetchall()}

    def _save_cached(self, path: str, mtime: float, hash_val: str, embedding):
        cur = self._conn.cursor()
        cur.execute(
            "INSERT OR REPLACE INTO embeddings (path, mtime, hash, embedding) VALUES (?, ?, ?, ?)",
            (path, mtime, hash_val, json.dumps(embedding)),
        )
        self._conn.commit()

    def _call_api(self, texts):
        try:
            return get_embedding_provider(env=self.env).embed(texts)
        except RuntimeError:
            raise
        except Exception as exc:
            if requests:
                if isinstance(exc, requests.exceptions.Timeout):
                    raise RuntimeError("Embedding API 请求超时，请检查网络连接。")
                if isinstance(exc, requests.exceptions.ConnectionError):
                    raise RuntimeError("无法连接到 Embedding API，请检查网络或 Base URL 配置。")
                if isinstance(exc, requests.exceptions.HTTPError):
                    detail = ""
                    status_code = "unknown"
                    response = getattr(exc, "response", None)
                    if response is not None:
                        status_code = getattr(response, "status_code", "unknown")
                        detail = getattr(response, "text", "")[:200]
                    raise RuntimeError(f"Embedding API 返回错误 ({status_code}): {detail}")
            raise RuntimeError(f"Embedding API 调用失败: {exc}")

    def ensure_index(self, docs, progress_callback=None, base_path: Path = None):
        """
        对文档列表做增量索引。
        docs: [{"path": str, "title": str, "text": str}, ...]
        progress_callback: callable(current, total, msg)
        base_path: 解析 docs 中相对路径的根目录
        返回: (成功数, 失败数)
        """
        to_update = []
        for doc in docs:
            rel = doc["path"]
            cache_key = Path(rel).as_posix()
            p = (base_path / rel) if base_path else Path(rel)
            cached = self._fetch_cached(cache_key)
            hash_val = _file_hash(p)
            if not hash_val:
                continue
            mtime = p.stat().st_mtime
            if cached is None or cached["hash"] != hash_val:
                to_update.append({"cache_key": cache_key, "mtime": mtime, "hash": hash_val, "text": doc["text"]})

        total = len(to_update)
        if total == 0:
            if progress_callback:
                progress_callback(0, 0, "所有文档缓存已是最新，无需更新。")
            return 0, 0

        success = 0
        fail = 0
        batch_size = int(config.get("embedding.batch_size", 64))
        for i in range(0, total, batch_size):
            batch = to_update[i : i + batch_size]
            texts = [b["text"] for b in batch]
            try:
                embs = self._call_api(texts)
            except Exception as exc:
                if progress_callback:
                    progress_callback(i, total, f"API 调用失败: {exc}")
                fail += len(batch)
                continue

            for b, emb in zip(batch, embs):
                self._save_cached(b["cache_key"], b["mtime"], b["hash"], emb)
                success += 1

            if progress_callback:
                progress_callback(min(i + batch_size, total), total, f"已索引 {min(i + batch_size, total)} / {total}")

        return success, fail

    def search(self, query: str, docs, top_k: int = 20):
        """
        对 query 做向量化，并与缓存中的文档向量计算相似度，返回 Top-K。
        docs: 与 ensure_index 格式相同，用于过滤只在这些文档中检索。
        返回: [{"path": str, "title": str, "similarity": float}, ...]
        """
        query_emb = self._call_api([query])[0]

        results = []
        for doc in docs:
            cache_key = Path(doc["path"]).as_posix()
            cached = self._fetch_cached(cache_key)
            if cached is None:
                continue
            sim = _cosine_similarity(query_emb, cached["embedding"])
            results.append({
                "path": doc["path"],
                "title": doc["title"],
                "similarity": sim,
            })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]

    def prune_missing(self, base_path: Path) -> int:
        """
        清理索引中 base_path 下已不存在的文件条目（僵尸条目）。
        返回被删除的记录数。
        """
        cur = self._conn.cursor()
        cur.execute("SELECT path FROM embeddings")
        to_delete = []
        for (rel_path,) in cur.fetchall():
            p = base_path / rel_path.replace("/", os.sep)
            if not p.exists():
                to_delete.append((rel_path,))
        if to_delete:
            cur.executemany("DELETE FROM embeddings WHERE path = ?", to_delete)
            self._conn.commit()
        return len(to_delete)

    def close(self):
        self._conn.close()


def check_embedding_ready() -> tuple[bool, str]:
    """
    快速检查当前环境是否具备 Embedding 能力。
    返回: (是否就绪, 提示信息)
    """
    env = _get_env()
    if not embedding_allowed():
        return False, f"当前网络模式为 {current_network_mode()}，不会请求云端向量模型，将使用本地/关键词能力。"
    try:
        provider = get_embedding_provider(env=env)
    except Exception as exc:
        return False, f"Embedding provider 配置无效：{exc}"
    provider_name = _embedding_provider_name()
    if provider_name in {"none", "off", "disabled"}:
        return False, "未启用向量模型，将使用纯关键词检索。"
    if provider_name != "mock" and not getattr(provider, "api_key", ""):
        return False, "未配置 Embedding API Key，将使用纯关键词检索。"
    if provider_name != "mock" and not requests:
        return False, "缺少可选依赖 'requests'，将使用纯关键词检索。如需语义检索请执行: pip install requests"
    return True, "Embedding 语义检索已就绪。"
