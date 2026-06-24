import hashlib
import json
from typing import Optional

from .base import EmbeddingProvider, LLMProvider


class MockEmbeddingProvider(EmbeddingProvider):
    def __init__(self, dimension: int = 3, vectors: dict[str, list[float]] | None = None, **_kwargs):
        self.dimension = dimension
        self.vectors = vectors or {}

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self.vectors.get(text, self._vector_for(text)) for text in texts]

    def _vector_for(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        return [round(digest[i] / 255.0, 6) for i in range(self.dimension)]


class MockLLMProvider(LLMProvider):
    def __init__(
        self,
        concepts: list[str] | None = None,
        groups: dict[str, list[str]] | None = None,
        judgment: dict | None = None,
        raw_response: str | None = None,
        **_kwargs,
    ):
        self.concepts = concepts or ["概念A", "概念B"]
        self.groups = groups
        self.judgment = judgment or {"judgment": "no_contradiction", "reason": "mock", "confidence": 1.0}
        self.raw_response = raw_response

    def complete(
        self,
        prompt: str,
        system: str = "你是一个严谨的知识提取助手，只输出合法 JSON。",
        temperature: float = 0.1,
        timeout: int = 60,
    ) -> Optional[str]:
        if self.raw_response is not None:
            return self.raw_response
        return json.dumps([], ensure_ascii=False)

    def extract_concepts(self, title: str, snippet: str, max_concepts: int = 4) -> list[str]:
        return self.concepts[:max_concepts]

    def group_titles(self, titles: list[str], max_groups: int = 4) -> dict[str, list[str]]:
        if self.groups is not None:
            return self.groups
        if not titles:
            return {}
        midpoint = max(1, len(titles) // 2)
        groups = {"主题1": titles[:midpoint]}
        if titles[midpoint:]:
            groups["主题2"] = titles[midpoint:]
        return dict(list(groups.items())[:max_groups])

    def judge_contradiction(
        self,
        principle_a: str,
        doc_a: str,
        principle_b: str,
        doc_b: str,
    ) -> dict:
        return dict(self.judgment)
