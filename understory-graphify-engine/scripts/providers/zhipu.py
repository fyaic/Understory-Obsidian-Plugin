import json
import os
import re
from typing import Optional

from config import config
from network_policy import ensure_embedding_allowed, llm_allowed
from .base import EmbeddingProvider, LLMProvider


def _default_base_url() -> str:
    return str(config.get("zhipu.base_url", "https://open.bigmodel.cn/api/paas/v4/"))


def _default_embedding_model() -> str:
    return str(config.get("zhipu.embedding_model", "embedding-3"))


def _default_embedding_dimensions() -> int:
    return int(config.get("embedding.dimensions", 1024))


def _default_llm_model() -> str:
    return str(config.get("zhipu.llm_model", "glm-4-flash"))


def _env_value(env: dict | None, *keys: str, default=None):
    env = env or {}
    for key in keys:
        value = env.get(key)
        if value not in (None, ""):
            return value
    return default


def _load_default_env() -> dict:
    return {
        "api_key": os.environ.get("ZHIPU_API_KEY", "").strip(),
        "embedding_api_key": (
            os.environ.get("UNDERSTORY_EMBEDDING_API_KEY")
            or os.environ.get("ZHIPU_API_KEY", "")
        ).strip(),
        "llm_api_key": (
            os.environ.get("UNDERSTORY_LLM_API_KEY")
            or os.environ.get("ZHIPU_API_KEY", "")
        ).strip(),
        "base_url": (
            os.environ.get("UNDERSTORY_ZHIPU_BASE_URL")
            or os.environ.get("ZHIPU_BASE_URL", _default_base_url())
        ).strip(),
        "embedding_base_url": (
            os.environ.get("UNDERSTORY_EMBEDDING_BASE_URL")
            or os.environ.get("UNDERSTORY_ZHIPU_BASE_URL")
            or os.environ.get("ZHIPU_BASE_URL", _default_base_url())
        ).strip(),
        "llm_base_url": (
            os.environ.get("UNDERSTORY_LLM_BASE_URL")
            or os.environ.get("UNDERSTORY_ZHIPU_BASE_URL")
            or os.environ.get("ZHIPU_BASE_URL", _default_base_url())
        ).strip(),
        "embedding_model": (
            os.environ.get("UNDERSTORY_EMBEDDING_MODEL")
            or os.environ.get("UNDERSTORY_ZHIPU_EMBEDDING_MODEL")
            or os.environ.get("ZHIPU_EMBEDDING_MODEL", _default_embedding_model())
        ).strip(),
        "model": (
            os.environ.get("UNDERSTORY_EMBEDDING_MODEL")
            or os.environ.get("UNDERSTORY_ZHIPU_EMBEDDING_MODEL")
            or os.environ.get("ZHIPU_EMBEDDING_MODEL", _default_embedding_model())
        ).strip(),
        "dimensions": int((
            os.environ.get("UNDERSTORY_EMBEDDING_DIMENSIONS")
            or os.environ.get("ZHIPU_EMBEDDING_DIMENSIONS", str(_default_embedding_dimensions()))
        ).strip() or _default_embedding_dimensions()),
        "llm_model": (
            os.environ.get("UNDERSTORY_LLM_MODEL")
            or os.environ.get("UNDERSTORY_ZHIPU_LLM_MODEL")
            or os.environ.get("ZHIPU_LLM_MODEL", _default_llm_model())
        ).strip(),
    }


def _parse_json_from_text(content: str):
    text = content or ""
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    return json.loads(text)


class ZhipuEmbeddingProvider(EmbeddingProvider):
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        dimensions: int | None = None,
        env: dict | None = None,
    ):
        merged = {**_load_default_env(), **(env or {})}
        self.api_key = (api_key or _env_value(merged, "embedding_api_key", "api_key", default="")).strip()
        self.base_url = (base_url or _env_value(merged, "embedding_base_url", "base_url", default=_default_base_url())).strip()
        self.model = (model or _env_value(merged, "embedding_model", "model", default=_default_embedding_model())).strip()
        self.dimensions = int(dimensions or _env_value(merged, "dimensions", default=_default_embedding_dimensions()))

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        ensure_embedding_allowed()
        if not self.api_key:
            raise RuntimeError("ZHIPU_API_KEY 未配置")
        try:
            import requests
        except Exception as exc:
            raise RuntimeError("缺少可选依赖 'requests'，无法调用 Embedding API。请执行: pip install requests") from exc

        url = self.base_url.rstrip("/") + "/embeddings"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "input": texts,
            "model": self.model,
            "dimensions": self.dimensions,
        }
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        if "data" not in data:
            raise RuntimeError(f"Embedding API 返回异常: {data}")
        return [item["embedding"] for item in data["data"]]


class ZhipuLLMProvider(LLMProvider):
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        env: dict | None = None,
    ):
        merged = {**_load_default_env(), **(env or {})}
        self.api_key = (api_key or _env_value(merged, "llm_api_key", "api_key", default="")).strip()
        self.base_url = (base_url or _env_value(merged, "llm_base_url", "base_url", default=_default_base_url())).strip()
        self.model = (model or _env_value(merged, "llm_model", default=_default_llm_model())).strip()

    def complete(
        self,
        prompt: str,
        system: str = "你是一个严谨的知识提取助手，只输出合法 JSON。",
        temperature: float = 0.1,
        timeout: int = 60,
    ) -> Optional[str]:
        if not llm_allowed():
            return None
        if not self.api_key:
            return None
        try:
            import requests
        except Exception:
            return None

        url = self.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
        }
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def extract_concepts(self, title: str, snippet: str, max_concepts: int = 4) -> list[str]:
        prompt = (
            f"你是一个知识管理助手。请根据下面的文档标题和摘要，提取 {max_concepts} 个最核心、"
            f"最具区分度的关键词或短语。\n\n"
            f"要求：\n"
            f"1. 每个关键词长度在 2~10 个字符之间（中文）或 1~3 个英文单词之间。\n"
            f"2. 优先使用文档本身的主题词、技术术语、产品名、场景名。\n"
            f"3. 不要输出通用词（如\"技术\"、\"工具\"、\"平台\"、\"应用\"、\"产品\"、\"分析\"、\"报告\"、\"介绍\"、\"总结\"）。\n"
            f"4. 只输出 JSON 数组，格式: [\"关键词1\", \"关键词2\", \"关键词3\"]\n\n"
            f"文档标题: {title}\n"
            f"文档摘要: {snippet}\n"
        )
        content = ""
        try:
            content = self.complete(
                prompt,
                system="你是一个严谨的知识提取助手，只输出合法 JSON 数组。",
                temperature=0.1,
                timeout=60,
            ) or ""
            data = _parse_json_from_text(content)
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
        except Exception:
            pass
        items = re.findall(r'"([^"]+)"', content)
        return [i.strip() for i in items if i.strip()]

    def group_titles(self, titles: list[str], max_groups: int = 4) -> dict[str, list[str]]:
        if not titles:
            return {}
        prompt = (
            f"你是一位知识管理助手。请将以下 {len(titles)} 个文档标题分成 {max_groups} 个以内的主题维度。\n"
            f"要求：\n"
            f"1. 每个维度名是 2~6 个字的中文短语，能解释'为什么这些文档相关'。\n"
            f"2. 不要出现文件夹名、路径名、纯标点或生硬的分类名。\n"
            f"3. 优先使用主题词、技术领域、应用场景、核心概念来命名。\n"
            f"4. 只输出 JSON 对象，格式: {{\"主题1\": [\"标题A\", \"标题B\"], \"主题2\": [\"标题C\"]}}\n"
            f"5. 每个文档标题都必须归入某一主题，不允许有剩余。\n"
            f"6. 如果某个标题和多个主题都相关，选择最相关的一个主题归入。\n\n"
            f"文档标题列表：\n" + "\n".join(f"- {t}" for t in titles)
        )
        try:
            content = self.complete(
                prompt,
                system="你是一个严谨的知识整理助手，只输出合法 JSON 对象。",
                temperature=0.1,
                timeout=60,
            ) or ""
            data = _parse_json_from_text(content)
            if isinstance(data, dict):
                return {str(k): [str(x).strip() for x in v if str(x).strip()] for k, v in data.items()}
        except Exception:
            pass
        return {}

    def judge_contradiction(
        self,
        principle_a: str,
        doc_a: str,
        principle_b: str,
        doc_b: str,
    ) -> dict:
        prompt = f"""判断以下两条原则/断言是否矛盾。

原则 A（来自 {doc_a}）：
{principle_a}

原则 B（来自 {doc_b}）：
{principle_b}

只输出 JSON：{{"judgment": "contradiction|evolution|no_contradiction|uncertain", "reason": "...", "confidence": 0.0-1.0}}
"""
        try:
            content = self.complete(prompt, timeout=20) or ""
            data = _parse_json_from_text(content)
            if isinstance(data, dict) and data.get("judgment"):
                return {
                    "judgment": str(data["judgment"]),
                    "reason": str(data.get("reason", "")),
                    "confidence": float(data.get("confidence", 0.6)),
                }
        except Exception:
            pass
        return {"judgment": "uncertain", "reason": "", "confidence": 0.0}
