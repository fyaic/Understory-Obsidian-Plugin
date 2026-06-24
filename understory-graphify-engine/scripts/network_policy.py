import os

from config import config


MODE_LOCAL = "local"
MODE_EMBEDDING = "embedding"
MODE_FULL = "full"


class NetworkDisabledError(RuntimeError):
    """Raised when a configured privacy mode blocks an outbound request."""


def normalize_network_mode(value: str | None) -> str:
    raw = (value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if raw in {"", "local", "local_only", "offline", "none", "no_network"}:
        return MODE_LOCAL
    if raw in {"embedding", "embeddings", "embedding_only", "vectors", "vector"}:
        return MODE_EMBEDDING
    if raw in {"full", "full_ai", "ai", "llm", "cloud"}:
        return MODE_FULL
    return MODE_LOCAL


def current_network_mode() -> str:
    return normalize_network_mode(
        os.environ.get("UNDERSTORY_NETWORK_MODE")
        or os.environ.get("NETWORK_MODE")
        or config.get("network.mode", MODE_LOCAL)
    )


def embedding_allowed() -> bool:
    return current_network_mode() in {MODE_EMBEDDING, MODE_FULL}


def llm_allowed() -> bool:
    return current_network_mode() == MODE_FULL


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def webhook_enabled(default: bool = False) -> bool:
    env_value = os.environ.get("UNDERSTORY_WEBHOOK_ENABLED")
    if env_value is not None:
        return _truthy(env_value)
    configured = config.get("webhook.enabled", default)
    return bool(configured)


def webhook_allowed(enabled: bool | None = None) -> bool:
    if current_network_mode() == MODE_LOCAL:
        return False
    return webhook_enabled(False) if enabled is None else bool(enabled)


def ensure_embedding_allowed() -> None:
    if not embedding_allowed():
        raise NetworkDisabledError(
            "Embedding requests are disabled by UNDERSTORY_NETWORK_MODE=local."
        )


def ensure_llm_allowed() -> None:
    if not llm_allowed():
        raise NetworkDisabledError(
            "LLM requests are disabled unless UNDERSTORY_NETWORK_MODE=full."
        )


def ensure_webhook_allowed(enabled: bool | None = None) -> None:
    if not webhook_allowed(enabled):
        raise NetworkDisabledError(
            "Webhook requests require an explicit opt-in and cannot run in local mode."
        )
