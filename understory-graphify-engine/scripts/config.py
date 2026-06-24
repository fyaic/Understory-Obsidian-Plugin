import copy
import json
import os
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent


DEFAULTS = {
    "embedding": {
        "floor": 0.40,
        "top_k": 15,
        "dimensions": 1024,
        "batch_size": 64,
        "max_chars": 2000,
    },
    "fusion": {
        "kw_weight": 0.45,
        "fusion_floor": 3.5,
        "kw_floor": 3.0,
        "emb_floor": 0.40,
    },
    "relations": {
        "short_doc_threshold": 300,
        "same_similarity_threshold": 0.65,
    },
    "link_merge": {
        "ttl_days": 30,
    },
    "lint": {
        "max_pairwise": 1500,
        "max_candidate_pairs": 200,
        "max_llm_contra_calls": 12,
        "llm_contra_budget_sec": 45,
        "contra_llm_timeout": 20,
        "contra_difflib_threshold": 0.70,
        "contra_common_word_min": 0.30,
        "contra_confirm_conf": 0.55,
    },
    "graph": {
        "sim_threshold": 0.5,
        "top_k_neighbors": 15,
        "min_community_size": 3,
        "surprise_threshold": 0.6,
        "god_node_min_communities": 3,
        "mention_scan_time": 20,
        "max_edges_per_type": 5000,
    },
    "network": {
        "mode": "local",
    },
    "provider": {
        "embedding": "zhipu",
        "llm": "zhipu",
    },
    "zhipu": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4/",
        "embedding_model": "embedding-3",
        "llm_model": "glm-4-flash",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1/",
        "embedding_model": "text-embedding-3-small",
        "llm_model": "gpt-4o-mini",
    },
    "custom": {
        "base_url": "",
        "embedding_model": "",
        "llm_model": "",
    },
    "webhook": {
        "enabled": False,
    },
    "noisy_paths": [
        "linear issues/",
        "daily",
        "日报",
        "晨会",
        "untitled",
    ],
    "junk_titles": [
        "report",
        "raw_report",
        "worklog",
        "linear",
        "recap",
    ],
}


def _deep_update(base: dict, override: dict) -> dict:
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_update(base[key], value)
        else:
            base[key] = value
    return base


def _coerce_int(value: str):
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _coerce_bool(value: str):
    return (value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _load_mapping_file(path: Path) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(text)
    except Exception:
        data = json.loads(text)
    return data if isinstance(data, dict) else {}


def _load_dotenv(root: Path):
    env_file = root / ".env"
    if not env_file.exists():
        return
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv(env_file, override=False)
    except Exception:
        return


class Config:
    def __init__(self, root: Path | None = None):
        self.root = root or SKILL_ROOT
        self._data = {}
        self.reload()

    def reload(self):
        _load_dotenv(self.root)
        data = copy.deepcopy(DEFAULTS)
        _deep_update(data, _load_mapping_file(self.root / "config.defaults.yaml"))
        _deep_update(data, _load_mapping_file(self.root / "config.yaml"))
        self._load_env(data)
        self._data = data

    def _load_env(self, data: dict):
        network_mode = os.environ.get("UNDERSTORY_NETWORK_MODE", "").strip().lower()
        if network_mode:
            data.setdefault("network", {})["mode"] = network_mode

        provider = os.environ.get("PROVIDER_TYPE", "").strip().lower()
        embedding_provider = (
            os.environ.get("UNDERSTORY_EMBEDDING_PROVIDER")
            or os.environ.get("EMBEDDING_PROVIDER")
            or provider
        ).strip().lower()
        llm_provider = (
            os.environ.get("UNDERSTORY_LLM_PROVIDER")
            or os.environ.get("LLM_PROVIDER")
            or provider
        ).strip().lower()
        if embedding_provider:
            data["provider"]["embedding"] = embedding_provider
        if llm_provider:
            data["provider"]["llm"] = llm_provider

        zhipu_base = (
            os.environ.get("UNDERSTORY_ZHIPU_BASE_URL")
            or os.environ.get("ZHIPU_BASE_URL", "")
        ).strip()
        if zhipu_base:
            data["zhipu"]["base_url"] = zhipu_base
        embedding_model = (
            os.environ.get("UNDERSTORY_ZHIPU_EMBEDDING_MODEL")
            or os.environ.get("ZHIPU_EMBEDDING_MODEL", "")
        ).strip()
        if embedding_model:
            data["zhipu"]["embedding_model"] = embedding_model
        llm_model = (
            os.environ.get("UNDERSTORY_ZHIPU_LLM_MODEL")
            or os.environ.get("ZHIPU_LLM_MODEL", "")
        ).strip()
        if llm_model:
            data["zhipu"]["llm_model"] = llm_model
        dimensions = (
            os.environ.get("UNDERSTORY_EMBEDDING_DIMENSIONS")
            or os.environ.get("ZHIPU_EMBEDDING_DIMENSIONS", "")
        ).strip()
        if dimensions:
            data["embedding"]["dimensions"] = _coerce_int(dimensions)

        openai_base = os.environ.get("OPENAI_BASE_URL", "").strip()
        if openai_base:
            data["openai"]["base_url"] = openai_base
        openai_embedding_model = os.environ.get("OPENAI_EMBEDDING_MODEL", "").strip()
        if openai_embedding_model:
            data["openai"]["embedding_model"] = openai_embedding_model
        openai_llm_model = os.environ.get("OPENAI_LLM_MODEL", "").strip()
        if openai_llm_model:
            data["openai"]["llm_model"] = openai_llm_model

        custom_base = (
            os.environ.get("UNDERSTORY_CUSTOM_BASE_URL")
            or os.environ.get("CUSTOM_OPENAI_BASE_URL", "")
        ).strip()
        if custom_base:
            data["custom"]["base_url"] = custom_base
        custom_embedding_model = (
            os.environ.get("UNDERSTORY_CUSTOM_EMBEDDING_MODEL")
            or os.environ.get("CUSTOM_OPENAI_EMBEDDING_MODEL", "")
        ).strip()
        if custom_embedding_model:
            data["custom"]["embedding_model"] = custom_embedding_model
        custom_llm_model = (
            os.environ.get("UNDERSTORY_CUSTOM_LLM_MODEL")
            or os.environ.get("CUSTOM_OPENAI_LLM_MODEL", "")
        ).strip()
        if custom_llm_model:
            data["custom"]["llm_model"] = custom_llm_model

        webhook_enabled = os.environ.get("UNDERSTORY_WEBHOOK_ENABLED")
        if webhook_enabled is not None:
            data.setdefault("webhook", {})["enabled"] = _coerce_bool(webhook_enabled)

    def get(self, key: str, default=None):
        current = self._data
        for part in key.split("."):
            if not isinstance(current, dict) or part not in current:
                return default
            current = current[part]
        return current

    def as_dict(self) -> dict:
        return copy.deepcopy(self._data)


config = Config()
