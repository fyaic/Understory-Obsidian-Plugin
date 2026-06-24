import os

from config import config
from .base import EmbeddingProvider, LLMProvider
from .mock import MockEmbeddingProvider, MockLLMProvider
from .none import NoneEmbeddingProvider, NoneLLMProvider
from .openai_compatible import (
    CustomOpenAICompatibleEmbeddingProvider,
    CustomOpenAICompatibleLLMProvider,
    OpenAICompatibleEmbeddingProvider,
    OpenAICompatibleLLMProvider,
)
from .zhipu import ZhipuEmbeddingProvider, ZhipuLLMProvider


_EMBEDDING_PROVIDERS = {
    "none": NoneEmbeddingProvider,
    "off": NoneEmbeddingProvider,
    "disabled": NoneEmbeddingProvider,
    "zhipu": ZhipuEmbeddingProvider,
    "openai": OpenAICompatibleEmbeddingProvider,
    "openai-compatible": CustomOpenAICompatibleEmbeddingProvider,
    "openai_compatible": CustomOpenAICompatibleEmbeddingProvider,
    "custom": CustomOpenAICompatibleEmbeddingProvider,
    "custom-openai": CustomOpenAICompatibleEmbeddingProvider,
    "custom_openai": CustomOpenAICompatibleEmbeddingProvider,
    "mock": MockEmbeddingProvider,
}

_LLM_PROVIDERS = {
    "none": NoneLLMProvider,
    "off": NoneLLMProvider,
    "disabled": NoneLLMProvider,
    "zhipu": ZhipuLLMProvider,
    "openai": OpenAICompatibleLLMProvider,
    "openai-compatible": CustomOpenAICompatibleLLMProvider,
    "openai_compatible": CustomOpenAICompatibleLLMProvider,
    "kimi-cn": CustomOpenAICompatibleLLMProvider,
    "kimi-global": CustomOpenAICompatibleLLMProvider,
    "custom": CustomOpenAICompatibleLLMProvider,
    "custom-openai": CustomOpenAICompatibleLLMProvider,
    "custom_openai": CustomOpenAICompatibleLLMProvider,
    "mock": MockLLMProvider,
}


def _default_provider_name(kind: str) -> str:
    if kind == "embedding":
        return (
            os.environ.get("UNDERSTORY_EMBEDDING_PROVIDER")
            or os.environ.get("EMBEDDING_PROVIDER")
            or os.environ.get("PROVIDER_TYPE")
            or config.get("provider.embedding", "zhipu")
        ).strip().lower()
    return (
        os.environ.get("UNDERSTORY_LLM_PROVIDER")
        or os.environ.get("LLM_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or config.get("provider.llm", "zhipu")
    ).strip().lower()


def get_embedding_provider(name: str | None = None, **kwargs) -> EmbeddingProvider:
    provider_name = (name or _default_provider_name("embedding")).strip().lower()
    cls = _EMBEDDING_PROVIDERS.get(provider_name)
    if not cls:
        raise ValueError(f"Unknown embedding provider: {provider_name}")
    return cls(**kwargs)


def get_llm_provider(name: str | None = None, **kwargs) -> LLMProvider:
    provider_name = (name or _default_provider_name("llm")).strip().lower()
    cls = _LLM_PROVIDERS.get(provider_name)
    if not cls:
        raise ValueError(f"Unknown LLM provider: {provider_name}")
    return cls(**kwargs)
