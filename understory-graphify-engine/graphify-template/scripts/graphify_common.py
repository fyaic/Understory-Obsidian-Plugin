#!/usr/bin/env python3
"""
graphify_common —— .understory/ AI 隐藏层各模块的公共基础设施。

职责：
  - 路径解析（vault / .understory / kg skill / embedding 缓存）
  - 分级日志（写入 .understory/logs/{name}-YYYY-MM-DD.log）
  - 缓存 embedding 访问（直接读 kg 的 .cache/embedding_index.sqlite，离线可用）
  - LLM / embedding API 调用封装（复用 kg 的智谱配置，缺 Key 时优雅降级）
  - 通用文本工具（清洗、hash、余弦相似度、时间标记提取）

设计原则：
  - 不依赖 numpy/networkx/sklearn（这些只在 graph_analyzer 内部按需 import）
  - 缺少 API Key 时不抛异常，返回 None / [] 让上层降级
  - 不修改 understory-graphify-engine 的任何文件
"""
import hashlib
import json
import logging
import math
import os
import re
import sqlite3
import datetime
from pathlib import Path
from typing import Optional

HIDDEN_DIR_NAME = ".understory"

# ───────────────────────────────────────────
# 路径解析
# ───────────────────────────────────────────

# 默认 kg skill 根路径（可被环境变量 KG_SKILL_PATH 覆盖）
_DEFAULT_KG_SKILL = Path(os.path.expanduser("C:/Hello-World/understory-graphify-engine"))


def get_kg_skill_path() -> Path:
    """定位 understory-graphify-engine skill 根目录。"""
    env = os.environ.get("KG_SKILL_PATH", "").strip()
    if env and Path(env).exists():
        return Path(env)
    return _DEFAULT_KG_SKILL


def get_vault_path(explicit: Optional[str] = None) -> Path:
    """
    解析 vault 根路径。优先级：显式参数 > GRAPHIFY_VAULT 环境变量 >
    从本脚本位置上推（.understory/scripts/ -> vault） > kg 的 detect_vault_path > 默认。
    """
    if explicit:
        return Path(explicit)
    env = os.environ.get("GRAPHIFY_VAULT", "").strip()
    if env:
        return Path(env)
    # 本脚本位于 {vault}/.understory/scripts/graphify_common.py
    here = Path(__file__).resolve()
    candidate = here.parent.parent.parent
    if (candidate / HIDDEN_DIR_NAME).exists():
        return candidate
    # 退回 kg 的检测逻辑
    try:
        import sys
        sys.path.insert(0, str(get_kg_skill_path() / "scripts"))
        from vault_ops import detect_vault_path  # type: ignore
        return Path(detect_vault_path())
    except Exception:
        return Path(os.path.expanduser("~/Documents/AIC-000"))


def get_graphify_dir(vault_path: Path) -> Path:
    d = vault_path / HIDDEN_DIR_NAME
    d.mkdir(exist_ok=True)
    return d


def get_principles_db(vault_path: Path) -> Path:
    return get_graphify_dir(vault_path) / "principles.sqlite"


def get_embedding_cache_db() -> Path:
    """kg 的 embedding 缓存（只读复用）。"""
    return get_kg_skill_path() / ".cache" / "embedding_index.sqlite"


# 与 kg 一致的噪声路径过滤
NOISY_PATH_KEYWORDS = (
    "linear issues/", "daily", "日报", "晨会", "untitled",
    ".understory/", ".obsidian/", "templates/", "模板/", ".trash/",
)


def is_noisy_path(rel_path: str) -> bool:
    low = rel_path.lower().replace("\\", "/")
    return any(k in low for k in NOISY_PATH_KEYWORDS)


def list_vault_markdown(vault_path: Path) -> list[Path]:
    """列出 vault 中非噪声的 .md 文件。"""
    out = []
    for f in vault_path.rglob("*.md"):
        if not f.is_file():
            continue
        try:
            rel = str(f.relative_to(vault_path)).replace("\\", "/")
        except ValueError:
            continue
        if is_noisy_path(rel):
            continue
        out.append(f)
    return out


# ───────────────────────────────────────────
# 日志
# ───────────────────────────────────────────

def setup_logger(name: str, vault_path: Path, level: str = "INFO") -> logging.Logger:
    """配置脚本日志，写入 .understory/logs/{name}-YYYY-MM-DD.log。"""
    log_dir = get_graphify_dir(vault_path) / "logs"
    log_dir.mkdir(exist_ok=True)
    date_str = datetime.datetime.now().strftime("%Y-%m-%d")
    log_file = log_dir / f"{name}-{date_str}.log"

    logger = logging.getLogger(f"graphify.{name}")
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    # 防止重复添加 handler
    if not any(isinstance(h, logging.FileHandler) and getattr(h, "_gfile", None) == str(log_file)
               for h in logger.handlers):
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(logging.Formatter(
            "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        fh._gfile = str(log_file)  # type: ignore
        logger.addHandler(fh)
    logger.propagate = False
    return logger


def rotate_logs(vault_path: Path, retention_days: int = 7) -> int:
    """删除超过保留期的日志，返回删除数量。"""
    log_dir = get_graphify_dir(vault_path) / "logs"
    if not log_dir.exists():
        return 0
    cutoff = datetime.datetime.now() - datetime.timedelta(days=retention_days)
    removed = 0
    for log_file in log_dir.glob("*.log"):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", log_file.stem)
        if not m:
            continue
        try:
            file_date = datetime.datetime.strptime(m.group(1), "%Y-%m-%d")
            if file_date < cutoff:
                log_file.unlink()
                removed += 1
        except (ValueError, OSError):
            pass
    return removed


def rotate_notifications(vault_path: Path, retention_days: int = 30) -> int:
    """删除超过保留期的通知文件，返回删除数量。"""
    ndir = get_graphify_dir(vault_path) / "notifications"
    if not ndir.exists():
        return 0
    cutoff = datetime.datetime.now() - datetime.timedelta(days=retention_days)
    removed = 0
    for f in ndir.glob("*.md"):
        m = re.search(r"(\d{4}-\d{2}-\d{2})", f.stem)
        if not m:
            continue
        try:
            file_date = datetime.datetime.strptime(m.group(1), "%Y-%m-%d")
            if file_date < cutoff:
                f.unlink()
                removed += 1
        except (ValueError, OSError):
            pass
    return removed


# ───────────────────────────────────────────
# 文本工具
# ───────────────────────────────────────────

def clean_markdown(content: str) -> str:
    """清理 Markdown 噪声，保留纯文本语义（与 kg 的 _clean_markdown 等价）。"""
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            content = parts[2]
    content = re.sub(r"```[\s\S]*?```", " ", content)
    content = re.sub(r"`[^`]+`", " ", content)
    content = re.sub(r"!\[.*?\]\(.*?\)", " ", content)
    content = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", content)
    content = re.sub(r"<[^>]+>", " ", content)
    content = re.sub(r"^#{1,6}\s+", "", content, flags=re.MULTILINE)
    content = re.sub(r"\*\*|\*|__|_", " ", content)
    content = re.sub(r"\s+", " ", content).strip()
    return content


def _clean_markdown(content: str) -> str:
    return clean_markdown(content)


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def cosine_similarity(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-10)


def _cosine_similarity(a, b) -> float:
    return cosine_similarity(a, b)


# 中文/英文常见的待办、决策、原则触发词
DECISION_VERBS = (
    "决定", "采用", "选择", "确定", "计划", "将", "把", "改为", "迁移",
    "上线", "下线", "废弃", "替换", "优先", "禁止", "必须", "应该", "需要",
    "目标是", "策略是", "方案是", "原则是", "规范",
)
QUESTION_MARKERS = ("？", "?", "如何", "怎么", "是否", "尚不明确", "待解决", "待确认", "TODO", "待定")

# 时间标记：用于过期检测与时间型断言识别
TIME_PATTERNS = [
    re.compile(r"(20\d{2})\s*年?\s*[Qq]([1-4])"),       # 2025年Q3 / 2025 Q3
    re.compile(r"[Qq]([1-4])\s*(20\d{2})"),             # Q3 2025
    re.compile(r"(20\d{2})\s*[-/年]\s*(\d{1,2})\s*[-/月]?"),  # 2025-09 / 2025/9 / 2025年9月
    re.compile(r"(20\d{2})\s*年"),                       # 2025年
]
RELATIVE_TIME = ("下季度", "下个月", "下周", "本季度", "本月", "近期", "即将")


def extract_time_markers(text: str) -> list[dict]:
    """
    从文本中提取时间标记，返回 [{"raw": "...", "year": int, "month": int|None, "quarter": int|None}]。
    用于过期断言检测。
    """
    markers = []
    for m in TIME_PATTERNS[0].finditer(text):
        markers.append({"raw": m.group(0), "year": int(m.group(1)),
                        "quarter": int(m.group(2)), "month": None})
    for m in TIME_PATTERNS[1].finditer(text):
        markers.append({"raw": m.group(0), "year": int(m.group(2)),
                        "quarter": int(m.group(1)), "month": None})
    for m in TIME_PATTERNS[2].finditer(text):
        mon = int(m.group(2))
        if 1 <= mon <= 12:
            markers.append({"raw": m.group(0), "year": int(m.group(1)),
                            "quarter": None, "month": mon})
    return markers


def marker_deadline(marker: dict) -> Optional[datetime.date]:
    """把时间标记换算为该时间段的截止日期（用于判断是否过期）。"""
    try:
        year = marker["year"]
        if marker.get("quarter"):
            month = marker["quarter"] * 3  # Q1->3, Q2->6, Q3->9, Q4->12
            return datetime.date(year, month, 28)
        if marker.get("month"):
            return datetime.date(year, marker["month"], 28)
        return datetime.date(year, 12, 31)
    except (ValueError, KeyError, TypeError):
        return None


# ───────────────────────────────────────────
# 内容时间（时序记忆：判断文档新旧 / 演进方向）
# ───────────────────────────────────────────

_FM_DATE_KEYS = ("date", "created", "updated", "日期", "创建时间", "时间", "撰写时间")
_DATE_IN_TEXT = re.compile(r"(20\d{2})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2}))?")


def _parse_date_str(s: str) -> Optional[datetime.date]:
    """从字符串解析日期，支持 2025-06-15 / 2025/6 / 2025年6月15日 等。"""
    if not s:
        return None
    m = _DATE_IN_TEXT.search(str(s))
    if not m:
        return None
    try:
        y = int(m.group(1))
        mo = min(max(int(m.group(2)), 1), 12)
        d = min(max(int(m.group(3) or 1), 1), 28)
        return datetime.date(y, mo, d)
    except (ValueError, TypeError):
        return None


def _frontmatter_date(content: str) -> Optional[datetime.date]:
    if not content.startswith("---"):
        return None
    end = content.find("\n---", 3)
    if end == -1:
        return None
    for line in content[3:end].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip().lower() in _FM_DATE_KEYS:
                dt = _parse_date_str(v)
                if dt:
                    return dt
    return None


def get_content_date(doc_path) -> tuple[Optional[datetime.date], str]:
    """
    获取文档"内容时间"用于判断新旧。三层回退，返回 (date, source)。
    source ∈ {"frontmatter", "title", "mtime"}；前两者视为可靠，mtime 不可靠。
    """
    p = Path(doc_path)
    try:
        content = p.read_text(encoding="utf-8")
    except Exception:
        content = ""
    dt = _frontmatter_date(content)
    if dt:
        return dt, "frontmatter"
    dt = _parse_date_str(p.stem)   # 标题中的日期
    if dt:
        return dt, "title"
    try:
        return datetime.datetime.fromtimestamp(p.stat().st_mtime).date(), "mtime"
    except OSError:
        return None, "none"


def date_is_reliable(source: str) -> bool:
    return source in ("frontmatter", "title")


# ───────────────────────────────────────────
# 缓存 embedding 访问（离线可用）
# ───────────────────────────────────────────

def load_cached_embeddings(vault_path: Optional[Path] = None) -> dict:
    """
    读取 kg 的 embedding 缓存，返回 {rel_path: {"title", "embedding", "mtime"}}。
    若提供 vault_path，过滤掉 vault 中已不存在的文件。完全离线，不调用 API。
    """
    db = get_embedding_cache_db()
    out: dict = {}
    if not db.exists():
        return out
    conn = sqlite3.connect(str(db))
    try:
        cur = conn.cursor()
        cur.execute("SELECT path, mtime, embedding FROM embeddings")
        for path, mtime, emb in cur.fetchall():
            if is_noisy_path(path):
                continue
            if vault_path is not None:
                fp = vault_path / path.replace("/", os.sep)
                if not fp.exists():
                    continue
            try:
                vec = json.loads(emb)
            except (json.JSONDecodeError, TypeError):
                continue
            out[path] = {"title": Path(path).stem, "embedding": vec, "mtime": mtime}
    finally:
        conn.close()
    return out


# ───────────────────────────────────────────
# LLM / embedding Provider（缺 Key 时返回 None，上层降级）
# ───────────────────────────────────────────

def _load_env_from_kg() -> dict:
    """复用 kg 的 .env / 环境变量读取模型配置。"""
    cfg = None
    try:
        cfg = _load_skill_config()
    except Exception:
        pass
    embedding_provider = (
        os.environ.get("UNDERSTORY_EMBEDDING_PROVIDER")
        or os.environ.get("EMBEDDING_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or (cfg.get("provider.embedding", "zhipu") if cfg else "zhipu")
    ).strip().lower()
    llm_provider = (
        os.environ.get("UNDERSTORY_LLM_PROVIDER")
        or os.environ.get("LLM_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or (cfg.get("provider.llm", "zhipu") if cfg else "zhipu")
    ).strip().lower()

    def provider_base(provider: str, kind: str) -> str:
        if provider == "openai":
            return os.environ.get("OPENAI_BASE_URL", str(cfg.get("openai.base_url", "https://api.openai.com/v1/") if cfg else "https://api.openai.com/v1/")).strip()
        if provider in {"custom", "custom-openai", "custom_openai", "openai-compatible", "openai_compatible"}:
            return (
                os.environ.get("CUSTOM_OPENAI_BASE_URL")
                or os.environ.get("UNDERSTORY_CUSTOM_BASE_URL")
                or str(cfg.get("custom.base_url", "") if cfg else "")
            ).strip()
        return os.environ.get("ZHIPU_BASE_URL", str(cfg.get("zhipu.base_url", "https://open.bigmodel.cn/api/paas/v4/") if cfg else "https://open.bigmodel.cn/api/paas/v4/")).strip()

    def provider_model(provider: str, kind: str) -> str:
        if provider == "openai":
            key = "embedding_model" if kind == "embedding" else "llm_model"
            env_name = "OPENAI_EMBEDDING_MODEL" if kind == "embedding" else "OPENAI_LLM_MODEL"
            default = "text-embedding-3-small" if kind == "embedding" else "gpt-4o-mini"
            return os.environ.get(env_name, str(cfg.get(f"openai.{key}", default) if cfg else default)).strip()
        if provider in {"custom", "custom-openai", "custom_openai", "openai-compatible", "openai_compatible"}:
            env_name = "CUSTOM_OPENAI_EMBEDDING_MODEL" if kind == "embedding" else "CUSTOM_OPENAI_LLM_MODEL"
            custom_key = "embedding_model" if kind == "embedding" else "llm_model"
            return (
                os.environ.get(env_name)
                or os.environ.get(f"UNDERSTORY_CUSTOM_{kind.upper()}_MODEL")
                or str(cfg.get(f"custom.{custom_key}", "") if cfg else "")
            ).strip()
        env_name = "ZHIPU_EMBEDDING_MODEL" if kind == "embedding" else "ZHIPU_LLM_MODEL"
        zhipu_key = "embedding_model" if kind == "embedding" else "llm_model"
        default = "embedding-3" if kind == "embedding" else "glm-4-flash"
        return os.environ.get(env_name, str(cfg.get(f"zhipu.{zhipu_key}", default) if cfg else default)).strip()

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
        "base_url": provider_base(embedding_provider, "embedding"),
        "embedding_base_url": (
            os.environ.get("UNDERSTORY_EMBEDDING_BASE_URL")
            or provider_base(embedding_provider, "embedding")
        ).strip(),
        "llm_base_url": (
            os.environ.get("UNDERSTORY_LLM_BASE_URL")
            or provider_base(llm_provider, "llm")
        ).strip(),
        "embedding_model": (
            os.environ.get("UNDERSTORY_EMBEDDING_MODEL")
            or provider_model(embedding_provider, "embedding")
        ).strip(),
        "dimensions": int((
            os.environ.get("UNDERSTORY_EMBEDDING_DIMENSIONS")
            or os.environ.get("ZHIPU_EMBEDDING_DIMENSIONS", str(cfg.get("embedding.dimensions", 1024) if cfg else 1024))
        ).strip() or "1024"),
        "llm_model": (
            os.environ.get("UNDERSTORY_LLM_MODEL")
            or provider_model(llm_provider, "llm")
        ).strip(),
    }


def llm_available() -> bool:
    try:
        import sys
        scripts_dir = get_kg_skill_path() / "scripts"
        scripts_path = str(scripts_dir)
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
        from network_policy import llm_allowed  # type: ignore
        if not llm_allowed():
            return False
    except Exception:
        pass
    env = _load_env_from_kg()
    provider = (
        os.environ.get("UNDERSTORY_LLM_PROVIDER")
        or os.environ.get("LLM_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or "zhipu"
    ).strip().lower()
    if provider == "mock":
        return True
    if provider in {"none", "off", "disabled"}:
        return False
    return bool(env.get("llm_api_key") or env.get("api_key"))


def _load_provider_factories():
    import sys

    scripts_dir = get_kg_skill_path() / "scripts"
    scripts_path = str(scripts_dir)
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from providers import get_embedding_provider, get_llm_provider  # type: ignore
    return get_embedding_provider, get_llm_provider


def _load_skill_config():
    import sys

    scripts_dir = get_kg_skill_path() / "scripts"
    scripts_path = str(scripts_dir)
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from config import config  # type: ignore
    return config


def call_llm(prompt: str, system: str = "你是一个严谨的知识提取助手，只输出合法 JSON。",
             temperature: float = 0.1, timeout: int = 60) -> Optional[str]:
    """
    通过 LLM Provider 返回原始文本；缺 Key 或失败时返回 None（上层降级）。
    """
    env = _load_env_from_kg()
    if not llm_available():
        return None
    try:
        _, get_llm_provider = _load_provider_factories()
        return get_llm_provider(env=env).complete(
            prompt,
            system=system,
            temperature=temperature,
            timeout=timeout,
        )
    except Exception:
        return None


def call_embedding(texts: list[str], timeout: int = 120) -> Optional[list[list[float]]]:
    """通过 Embedding Provider 获取向量。缺 Key/失败返回 None（上层降级到文本相似度）。"""
    env = _load_env_from_kg()
    if not texts:
        return None
    try:
        import sys
        scripts_dir = get_kg_skill_path() / "scripts"
        scripts_path = str(scripts_dir)
        if scripts_path not in sys.path:
            sys.path.insert(0, scripts_path)
        from network_policy import embedding_allowed  # type: ignore
        if not embedding_allowed():
            return None
    except Exception:
        pass
    provider = (
        os.environ.get("UNDERSTORY_EMBEDDING_PROVIDER")
        or os.environ.get("EMBEDDING_PROVIDER")
        or os.environ.get("PROVIDER_TYPE")
        or "zhipu"
    ).strip().lower()
    if provider in {"none", "off", "disabled"}:
        return None
    if provider != "mock" and not (env.get("embedding_api_key") or env.get("api_key")):
        return None
    try:
        get_embedding_provider, _ = _load_provider_factories()
        return get_embedding_provider(env=env).embed(texts)
    except Exception:
        return None


def parse_json_from_llm(text: Optional[str]):
    """从 LLM 返回中稳健解析 JSON（容忍 ```json 包裹）。失败返回 None。"""
    if not text:
        return None
    t = text.strip()
    if "```json" in t:
        t = t.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in t:
        t = t.split("```", 1)[1].split("```", 1)[0].strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        # 尝试截取第一个 [ ... ] 或 { ... }
        for op, cl in (("[", "]"), ("{", "}")):
            i, j = t.find(op), t.rfind(cl)
            if i != -1 and j != -1 and j > i:
                try:
                    return json.loads(t[i:j + 1])
                except json.JSONDecodeError:
                    continue
    return None


def atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    """原子写文件（先写 .tmp 再 rename），避免半写状态。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding=encoding)
    os.replace(tmp, path)


def now_iso() -> str:
    return datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()
