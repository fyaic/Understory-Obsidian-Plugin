from abc import ABC, abstractmethod
from typing import Optional


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return embedding vectors for the supplied texts."""
        raise NotImplementedError


class LLMProvider(ABC):
    @abstractmethod
    def complete(
        self,
        prompt: str,
        system: str = "你是一个严谨的知识提取助手，只输出合法 JSON。",
        temperature: float = 0.1,
        timeout: int = 60,
    ) -> Optional[str]:
        """Return raw model text for an arbitrary prompt, or None when unavailable."""
        raise NotImplementedError

    @abstractmethod
    def extract_concepts(self, title: str, snippet: str, max_concepts: int = 4) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def group_titles(self, titles: list[str], max_groups: int = 4) -> dict[str, list[str]]:
        raise NotImplementedError

    @abstractmethod
    def judge_contradiction(
        self,
        principle_a: str,
        doc_a: str,
        principle_b: str,
        doc_b: str,
    ) -> dict:
        raise NotImplementedError
