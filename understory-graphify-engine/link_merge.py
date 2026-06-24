#!/usr/bin/env python3
"""
link_merge —— AIC-2108 关联融合：重打 `## 🏷️关联文件` 时保留用户手动维护的链接。

核心：哨兵区 + 删除记忆（tombstone）。
- 哨兵区 `<!-- auto-links -->…<!-- /auto-links -->`：系统只重写这段；区内=系统建议，区外=用户手动，原样保留。
- 删除记忆：用户从哨兵区删掉的链接记入 `.understory/link_overrides.json`，重打时排除（避免复活）。
  · TTL：默认 30 天后自动过期，允许重新推荐。
  · target_hash：目标文档内容变化则 tombstone 立即失效。
  · 自动解封：用户手动重新写入该链接（区外/正文）→ 清除 tombstone。
- 旧区块迁移：已有但无哨兵的区块，首次重打时整体并入哨兵区（避免"无哨兵→全当手动→不再更新"停摆）。

被 api.py 的写入路径调用，不改变其对外函数签名。
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from config import config

SENT_START = "<!-- auto-links -->"
SENT_END = "<!-- /auto-links -->"
DEFAULT_LANGUAGE = "en"
RELATED_SECTION_HEADINGS = {
    "en": "## 🏷️ Related notes",
    "zh": "## 🏷️关联文件",
}
LEGACY_HEADERS = ("## 🏷️关联文件", "## 关联文件", "## Related notes")
HEADER = RELATED_SECTION_HEADINGS[DEFAULT_LANGUAGE]
HEADERS = tuple(dict.fromkeys((*RELATED_SECTION_HEADINGS.values(), *LEGACY_HEADERS)))

WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\]\|\n]+)(?:\|[^\]\n]*)?\]\]")


# ───────────────────────────────────────────
# overrides（tombstone）存取
# ───────────────────────────────────────────

def _overrides_path(vault: Path) -> Path:
    return Path(vault) / ".understory" / "link_overrides.json"


def _load_overrides(vault: Path) -> dict:
    p = _overrides_path(vault)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_overrides(vault: Path, data: dict) -> None:
    p = _overrides_path(vault)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


# ───────────────────────────────────────────
# 工具
# ───────────────────────────────────────────

def _norm_title(raw: str) -> str:
    t = raw.strip().split("#", 1)[0].split("|", 1)[0].strip()
    if "/" in t:
        t = t.rsplit("/", 1)[-1].strip()
    return t


def _wikilink_titles(text: str) -> list[str]:
    out, seen = [], set()
    for m in WIKILINK_RE.findall(text or ""):
        t = _norm_title(m)
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _find_target_file(vault: Path, title: str):
    try:
        return next(vault.rglob(f"{title}.md"), None)
    except (OSError, ValueError):
        return None


def _target_hash(vault: Path, title: str) -> str:
    f = _find_target_file(vault, title)
    if not f:
        return ""
    try:
        return hashlib.sha256(f.read_text(encoding="utf-8")[:4000].encode("utf-8")).hexdigest()[:12]
    except OSError:
        return ""


def _today() -> date:
    return datetime.now().date()


def _ttl_days() -> int:
    return int(config.get("link_merge.ttl_days", 30))


def _normalize_language(language: str | None = None) -> str:
    raw = (language or os.environ.get("UNDERSTORY_UI_LANGUAGE") or os.environ.get("UNDERSTORY_LANGUAGE") or "").strip().lower()
    if raw.startswith("zh"):
        return "zh"
    return DEFAULT_LANGUAGE


def related_section_heading(language: str | None = None) -> str:
    return RELATED_SECTION_HEADINGS[_normalize_language(language)]


def default_group_heading(language: str | None = None) -> str:
    return "语义相近" if _normalize_language(language) == "zh" else "Semantically related"


# ───────────────────────────────────────────
# 解析现有区块
# ───────────────────────────────────────────

def _strip_header(section_text: str) -> str:
    """去掉区块的 `## ...关联文件` 标题行，返回正文部分。"""
    s = section_text.lstrip("\n")
    for h in HEADERS:
        if s.startswith(h):
            return s[len(h):].lstrip("\n")
    # 容错：找到首个标题行后取其后内容
    lines = section_text.splitlines()
    for i, ln in enumerate(lines):
        if any(ln.strip().startswith(h) for h in HEADERS):
            return "\n".join(lines[i + 1:]).lstrip("\n")
    return section_text


def parse_section(section_text: str):
    """
    解析 `## 🏷️关联文件` 区块。
    返回 dict: has_sentinel, cur_auto_titles, user_extra(区外用户文本), legacy(无哨兵的旧区块)
    """
    if not section_text or not section_text.strip():
        return {"has_sentinel": False, "cur_auto_titles": [], "user_extra": "", "legacy": False}
    body = _strip_header(section_text)
    si = body.find(SENT_START)
    ei = body.find(SENT_END)
    if si != -1 and ei != -1 and ei > si:
        inner = body[si + len(SENT_START):ei]
        before = body[:si]
        after = body[ei + len(SENT_END):]
        user_extra = (before.strip() + "\n\n" + after.strip()).strip()
        return {"has_sentinel": True, "cur_auto_titles": _wikilink_titles(inner),
                "user_extra": user_extra, "legacy": False}
    # 无哨兵 = 旧区块：整体视为系统历史（迁移），不强行拆分用户内容
    return {"has_sentinel": False, "cur_auto_titles": _wikilink_titles(body),
            "user_extra": "", "legacy": True}


# ───────────────────────────────────────────
# 组合新区块
# ───────────────────────────────────────────

def _format_grouped_inner(grouped: dict) -> str:
    lines = []
    for dim, items in grouped.items():
        seen, deduped = set(), []
        for it in items:
            t = it.get("title")
            if t and t not in seen:
                seen.add(t)
                deduped.append(it)
        if not deduped:
            continue
        lines.append(f"### {dim}")
        lines.append("")
        for it in deduped:
            lines.append(f"[[{it['title']}]]")
        lines.append("")
    return "\n".join(lines).strip()


def compose_related_section(old_section_text: str, grouped: dict, doc_rel: str,
                            vault: Path, doc_body: str = "",
                            language: str | None = None) -> tuple[str, dict]:
    """
    生成新的 `## 🏷️关联文件` 区块（含哨兵区 + 保留的用户手动链接），并维护 tombstone。

    参数：
      old_section_text: 文档中从区块标题到 EOF 的原文（无区块则传 ""）
      grouped: 新发现的关联 {维度: [{"title":...}, ...]}
      doc_rel: 文档相对路径（overrides 的 key）
      vault: vault 根
      doc_body: 区块之前的正文（用于"用户手动重写链接 → 自动解封"）

    返回 (section_text, stats)
    """
    vault = Path(vault)
    parsed = parse_section(old_section_text)
    overrides = _load_overrides(vault)
    rec = overrides.get(doc_rel, {})
    last_auto = list(rec.get("last_auto", []))
    tombs = dict(rec.get("tombstones", {}))
    stats = {"migrated": parsed["legacy"], "new_tombstones": 0, "unsealed": 0, "filtered": 0}

    # 1. 清理过期 / 目标已变化的 tombstone
    today = _today()
    for t in list(tombs.keys()):
        info = tombs[t]
        try:
            at = datetime.fromisoformat(info.get("at", "")).date()
            ttl = int(info.get("ttl_days", _ttl_days()))
            if (today - at).days > ttl:
                del tombs[t]
                continue
        except (ValueError, TypeError):
            pass
        old_h = info.get("target_hash", "")
        if old_h and _target_hash(vault, t) != old_h:
            del tombs[t]  # 目标文档已变 → 失效，允许重新推荐

    # 2. 自动解封：用户手动重新写入的链接（区外用户文本 + 正文）
    manual_titles = set(_wikilink_titles(parsed["user_extra"])) | set(_wikilink_titles(doc_body))
    for t in list(tombs.keys()):
        if t in manual_titles:
            del tombs[t]
            stats["unsealed"] += 1

    # 3. 删除检测：上次系统写入(last_auto)中、现在哨兵区已不在的 → 用户删除 → tombstone
    cur_auto = set(parsed["cur_auto_titles"])
    if last_auto:  # 仅在有历史记录时检测（避免首次/迁移误判）
        for t in last_auto:
            if t not in cur_auto and t not in tombs and t not in manual_titles:
                tombs[t] = {"action": "deleted", "at": today.isoformat(),
                            "ttl_days": _ttl_days(), "target_hash": _target_hash(vault, t)}
                stats["new_tombstones"] += 1

    # 4. 过滤新建议中的 tombstone 项
    filtered = {}
    for dim, items in grouped.items():
        kept = [it for it in items if _norm_title(it.get("title", "")) not in tombs]
        stats["filtered"] += len(items) - len(kept)
        if kept:
            filtered[dim] = kept

    inner = _format_grouped_inner(filtered)
    new_auto_titles = _wikilink_titles(inner)

    # 5. 组装区块：标题 + 哨兵区(新建议) + 用户区外内容
    parts = [related_section_heading(language), "", SENT_START]
    if inner:
        parts.append(inner)
    parts.append(SENT_END)
    user_extra = parsed["user_extra"].strip()
    if user_extra:
        parts.append("")
        parts.append(user_extra)
    section_text = "\n".join(parts).strip() + "\n"

    # 6. 持久化状态
    overrides[doc_rel] = {"last_auto": new_auto_titles, "tombstones": tombs}
    _save_overrides(vault, overrides)

    stats["auto_count"] = len(new_auto_titles)
    stats["user_kept"] = len(_wikilink_titles(user_extra))
    return section_text, stats


# ───────────────────────────────────────────
# 自测
# ───────────────────────────────────────────

if __name__ == "__main__":
    import tempfile
    vault = Path(tempfile.mkdtemp())
    (vault / ".understory").mkdir()
    g = {"语义相近": [{"title": "A"}, {"title": "B"}, {"title": "C"}]}

    # 首次写入
    sec, st = compose_related_section("", g, "doc.md", vault)
    assert SENT_START in sec and "[[A]]" in sec, sec
    print("首次:", st)

    # 用户在区外加 [[U]]，再重打 → U 保留
    old = sec + "\n[[U]]\n"
    sec2, st2 = compose_related_section(old, g, "doc.md", vault)
    assert "[[U]]" in sec2, sec2
    print("保留用户链接:", "[[U]]" in sec2, st2)

    # 用户删掉 B（哨兵区只剩 A C），重打 → B 进 tombstone，不再出现
    old3 = HEADER + "\n\n" + SENT_START + "\n### 语义相近\n\n[[A]]\n[[C]]\n\n" + SENT_END + "\n"
    sec3, st3 = compose_related_section(old3, g, "doc.md", vault)
    assert "[[B]]" not in sec3, sec3
    print("删除记忆生效(B 不复活):", "[[B]]" not in sec3, st3)

    # 用户手动重新加回 [[B]] 到区外 → 自动解封
    old4 = sec3 + "\n[[B]]\n"
    sec4, st4 = compose_related_section(old4, g, "doc.md", vault)
    print("自动解封:", st4)

    # 旧区块迁移（无哨兵）
    legacy = HEADER + "\n\n### 旧\n\n[[X]]\n[[Y]]\n"
    sec5, st5 = compose_related_section(legacy, g, "doc2.md", vault)
    assert SENT_START in sec5, sec5
    print("旧区块迁移:", st5["migrated"], st5)
    print("ALL OK")
