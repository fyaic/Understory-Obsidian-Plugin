from typing import Optional

from .base import EmbeddingProvider, LLMProvider


class NoneEmbeddingProvider(EmbeddingProvider):
    def embed(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("Embedding provider is disabled.")


class NoneLLMProvider(LLMProvider):
    def complete(
        self,
        prompt: str,
        system: str = "你是一个严谨的知识提取助手，只输出合法 JSON。",
        temperature: float = 0.1,
        timeout: int = 60,
    ) -> Optional[str]:
        return None

    def extract_concepts(self, title: str, snippet: str, max_concepts: int = 4) -> list[str]:
        return []

    def group_titles(self, titles: list[str], max_groups: int = 4) -> dict[str, list[str]]:
        return {}

    def judge_contradiction(
        self,
        principle_a: str,
        doc_a: str,
        principle_b: str,
        doc_b: str,
    ) -> dict:
        return {
            "judgment": "uncertain",
            "reason": "LLM provider is disabled.",
            "confidence": 0.0,
        }
