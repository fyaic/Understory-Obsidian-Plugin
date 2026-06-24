import json
import os
import re
from typing import Optional

from config import config
from network_policy import ensure_embedding_allowed, llm_allowed
from .base import EmbeddingProvider, LLMProvider


def _env_value(env: dict | None, *keys: str, default=None):
    env = env or {}
    for key in keys:
        value = env.get(key)
        if value not in (None, ""):
            return value
    return default


def _int_value(value, default: int | None = None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_json_from_text(content: str):
    text = content or ""
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    return json.loads(text)


class OpenAICompatibleEmbeddingProvider(EmbeddingProvider):
    provider_key = "openai"
    env_prefix = "OPENAI"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        dimensions: int | None = None,
        env: dict | None = None,
    ):
        merged = dict(env or {})
        provider_key = self.provider_key
        env_prefix = self.env_prefix
        default_base_url = str(config.get(f"{provider_key}.base_url", ""))
        default_model = str(config.get(f"{provider_key}.embedding_model", ""))
        default_dimensions = _int_value(config.get("embedding.dimensions", 1024), 1024)

        self.api_key = (api_key or _env_value(
            merged,
            "embedding_api_key",
            "api_key",
            default=(
                os.environ.get("UNDERSTORY_EMBEDDING_API_KEY")
                or os.environ.get(f"{env_prefix}_API_KEY")
                or ""
            ),
        )).strip()
        self.base_url = (base_url or _env_value(
            merged,
            "embedding_base_url",
            "base_url",
            default=(
                os.environ.get("UNDERSTORY_EMBEDDING_BASE_URL")
                or os.environ.get(f"{env_prefix}_BASE_URL")
                or default_base_url
            ),
        )).strip()
        self.model = (model or _env_value(
            merged,
            "embedding_model",
            "model",
            default=(
                os.environ.get("UNDERSTORY_EMBEDDING_MODEL")
                or os.environ.get(f"{env_prefix}_EMBEDDING_MODEL")
                or default_model
            ),
        )).strip()
        self.dimensions = _int_value(
            dimensions
            or _env_value(
                merged,
                "dimensions",
                default=(
                    os.environ.get("UNDERSTORY_EMBEDDING_DIMENSIONS")
                    or os.environ.get(f"{env_prefix}_EMBEDDING_DIMENSIONS")
                    or default_dimensions
                ),
            ),
            default_dimensions,
        )

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        ensure_embedding_allowed()
        if not self.api_key:
            raise RuntimeError("Embedding API key is not configured.")
        if not self.base_url:
            raise RuntimeError("Embedding base URL is not configured.")
        if not self.model:
            raise RuntimeError("Embedding model is not configured.")
        try:
            import requests
        except Exception as exc:
            raise RuntimeError("Missing optional dependency 'requests'. Run: pip install requests") from exc

        payload = {"input": texts, "model": self.model}
        if self.dimensions:
            payload["dimensions"] = self.dimensions
        resp = requests.post(
            self.base_url.rstrip("/") + "/embeddings",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        if "data" not in data:
            raise RuntimeError(f"Embedding API returned unexpected data: {data}")
        return [item["embedding"] for item in data["data"]]


class OpenAICompatibleLLMProvider(LLMProvider):
    provider_key = "openai"
    env_prefix = "OPENAI"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        env: dict | None = None,
    ):
        merged = dict(env or {})
        provider_key = self.provider_key
        env_prefix = self.env_prefix
        default_base_url = str(config.get(f"{provider_key}.base_url", ""))
        default_model = str(config.get(f"{provider_key}.llm_model", ""))

        self.api_key = (api_key or _env_value(
            merged,
            "llm_api_key",
            "api_key",
            default=(
                os.environ.get("UNDERSTORY_LLM_API_KEY")
                or os.environ.get(f"{env_prefix}_API_KEY")
                or ""
            ),
        )).strip()
        self.base_url = (base_url or _env_value(
            merged,
            "llm_base_url",
            "base_url",
            default=(
                os.environ.get("UNDERSTORY_LLM_BASE_URL")
                or os.environ.get(f"{env_prefix}_BASE_URL")
                or default_base_url
            ),
        )).strip()
        self.model = (model or _env_value(
            merged,
            "llm_model",
            default=(
                os.environ.get("UNDERSTORY_LLM_MODEL")
                or os.environ.get(f"{env_prefix}_LLM_MODEL")
                or default_model
            ),
        )).strip()

    def complete(
        self,
        prompt: str,
        system: str = "你是一个严谨的知识提取助手，只输出合法 JSON。",
        temperature: float = 0.1,
        timeout: int = 60,
    ) -> Optional[str]:
        if not llm_allowed():
            return None
        if not self.api_key or not self.base_url or not self.model:
            return None
        try:
            import requests
        except Exception:
            return None

        resp = requests.post(
            self.base_url.rstrip("/") + "/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "temperature": temperature,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def extract_concepts(self, title: str, snippet: str, max_concepts: int = 4) -> list[str]:
        prompt = (
            f"请根据下面的文档标题和摘要，提取 {max_concepts} 个最核心、最具区分度的关键词或短语。\n"
            f"只输出 JSON 数组。\n\n标题: {title}\n摘要: {snippet}\n"
        )
        content = ""
        try:
            content = self.complete(prompt, system="只输出合法 JSON 数组。", timeout=60) or ""
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
            f"请将以下 {len(titles)} 个文档标题分成 {max_groups} 个以内的主题维度。"
            f"只输出 JSON 对象。\n\n" + "\n".join(f"- {t}" for t in titles)
        )
        try:
            content = self.complete(prompt, system="只输出合法 JSON 对象。", timeout=60) or ""
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


class CustomOpenAICompatibleEmbeddingProvider(OpenAICompatibleEmbeddingProvider):
    provider_key = "custom"
    env_prefix = "CUSTOM_OPENAI"


class CustomOpenAICompatibleLLMProvider(OpenAICompatibleLLMProvider):
    provider_key = "custom"
    env_prefix = "CUSTOM_OPENAI"
