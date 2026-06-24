#!/usr/bin/env python3
"""
lint —— L3 冲突检测模块。

扫描全库，检测 6 类问题并写入 .understory/conflicts.json（含生命周期 open/resolved/ignored）：
  1. principle_contradiction 原则矛盾（LLM 判断；缺 Key 时降级为相似度+对立词启发，标 llm_skipped）
  2. expired_claim         过期断言（时间标记 vs 当前日期，full 离线）
  3. orphan_page           孤儿页（无出链/无关联区块/无反链/无原则，full 离线）
  4. dead_link             死链（关联区块指向不存在的笔记，--fix 可清理，full 离线）
  5. duplicate_principle   重复原则（跨文档高相似原则，full 离线）
  6. inconsistent_term     术语不一致（同概念不同名，启发式）

冲突按内容签名生成稳定 ID，跨多次 lint 合并而非覆盖；detected_count 递增，
持续 >7 天且 count>=3 时 severity 自动升一级；涉及原则消失则自动 resolved。

用法：
    python lint.py --vault "C:/Users/ryshi/Documents/AIC-000" [--fix] [--doc "某文档.md"]
"""
import argparse
import difflib
import hashlib
import json
import re
import sqlite3
import sys
import time
from datetime import datetime, date, timedelta
from pathlib import Path

import graphify_common as gc

try:
    scripts_dir = gc.get_kg_skill_path() / "scripts"
    scripts_path = str(scripts_dir)
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from config import config  # type: ignore
except Exception:
    config = None

RELATED_HEADER = "## 🏷️关联文件"
CONFLICT_HEADER = "## ⚠️冲突发现"
SEV_ORDER = ["low", "medium", "high"]
def _today() -> date:
    return datetime.now().date()


def _sig(*parts) -> str:
    return hashlib.sha256("||".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:12]


# ───────────────────────────────────────────
# 原则加载
# ───────────────────────────────────────────

def _load_principles(db_path: Path) -> list[dict]:
    if not db_path.exists():
        return []
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, doc_path, doc_title, type, content, confidence, scope, updated_at "
            "FROM principles WHERE deleted_at IS NULL"
        )
        return [{"id": r[0], "doc_path": r[1], "doc_title": r[2], "type": r[3],
                 "content": r[4], "confidence": r[5] or 0, "scope": r[6] or "local",
                 "updated_at": r[7]} for r in cur.fetchall()]
    finally:
        conn.close()


def _load_doc_dates(db_path: Path) -> dict:
    """从 doc_meta 读取每篇文档的内容时间，返回 {doc_path: (date|None, source)}。"""
    out = {}
    if not db_path.exists():
        return out
    conn = sqlite3.connect(str(db_path))
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(doc_meta)")}
        if "content_date" not in cols:
            return out
        for path, cd, src in conn.execute(
                "SELECT doc_path, content_date, content_date_source FROM doc_meta"):
            d = None
            if cd:
                try:
                    d = date.fromisoformat(str(cd)[:10])
                except ValueError:
                    d = None
            out[path] = (d, src or "none")
    except sqlite3.Error:
        pass
    finally:
        conn.close()
    return out


def _vault_doc_paths(vault_path: Path) -> set[str]:
    """Return normalized markdown paths that currently exist in the vault."""
    return {str(p.relative_to(vault_path)).replace("\\", "/") for p in gc.list_vault_markdown(vault_path)}


# ───────────────────────────────────────────
# 策略 A：原则矛盾
# ───────────────────────────────────────────

CONTRADICTION_CHECK_PROMPT = """判断以下两条原则/断言是否矛盾。

原则 A（来自 {doc_a}）：
{principle_a}

原则 B（来自 {doc_b}）：
{principle_b}

判断规则：
1. 直接矛盾：A 说 X，B 说 not X，且两者应当同时成立却冲突 → "contradiction"
2. 范围矛盾：A 说"全局策略 X"，B 说"项目策略 Y"，X 与 Y 冲突 → "contradiction"
3. **版本演进**：A、B 是**同一主题在不同时期的说法**，新的取代旧的（如"先用单体"后"改用微服务"），不是并存的矛盾而是升级 → "evolution"
4. 不矛盾：A、B 只是不同角度或适用不同场景 → "no_contradiction"
5. 不确定：信息不足 → "uncertain"

区分要点：若两条更像"同一件事被更新换代"（演进），选 evolution；若是"本应一致却互相打架"（需要人来裁决），选 contradiction。

只输出 JSON：{{"judgment": "contradiction|evolution|no_contradiction|uncertain", "reason": "...", "confidence": 0.0-1.0}}
"""

# 对立词对（启发式，无 LLM 时用）
ANTONYM_PAIRS = [
    ("B端", "C端"), ("企业", "个人"), ("微服务", "单体"), ("同步", "异步"),
    ("开源", "闭源"), ("自研", "外采"), ("集中", "分布"), ("上线", "下线"),
    ("增加", "减少"), ("提高", "降低"), ("启用", "禁用"), ("保留", "废弃"),
    ("公有云", "私有云"), ("线上", "线下"),
]
NEGATIONS = ("不", "无", "非", "未", "禁止", "停止", "取消")


def _cfg(key: str, default):
    if config is None:
        return default
    return config.get(key, default)


def _pairwise_cap() -> int:
    return int(_cfg("lint.max_pairwise", 1500))


def _candidate_pair_cap() -> int:
    return int(_cfg("lint.max_candidate_pairs", 200))


def _llm_contra_call_cap() -> int:
    return int(_cfg("lint.max_llm_contra_calls", 12))


def _llm_contra_budget_sec() -> int:
    return int(_cfg("lint.llm_contra_budget_sec", 45))


def _contra_llm_timeout() -> int:
    return int(_cfg("lint.contra_llm_timeout", 20))

# 冲突子类型 → 严重度映射（severity=None 表示该子类型不生成冲突）。
# 各检测器已在生成 issue 时内联设置 subtype/severity；本表作为权威定义与文档。
CONFLICT_SUBTYPES = {
    "expired_claim": {
        "plan": {"label": "计划/目标过期", "severity": "high"},
        "deadline": {"label": "截止期限过期", "severity": "high"},
        "data": {"label": "数据时效性过期", "severity": "low"},
        "record": {"label": "记录性时间", "severity": None},
    },
    "orphan_page": {
        "valuable": {"label": "有原则的孤儿页", "severity": "medium"},
        "fleeting": {"label": "fleeting note", "severity": None},
    },
    "principle_contradiction": {
        "llm_confirmed": {"label": "LLM 确认矛盾", "severity": "high"},
        "heuristic": {"label": "启发式疑似矛盾", "severity": None},
    },
    "dead_link": {
        "internal": {"label": "内部死链", "severity": "medium"},
        "external": {"label": "外部死链", "severity": "low"},
    },
    "inconsistent_term": {
        "case": {"label": "大小写不一致", "severity": "low"},
        "synonym": {"label": "同义词混用", "severity": "low"},
    },
    "duplicate_principle": {
        "exact": {"label": "完全重复", "severity": "low"},
        "partial": {"label": "部分重复", "severity": "low"},
    },
}


def _contra_difflib_threshold() -> float:
    return float(_cfg("lint.contra_difflib_threshold", 0.70))


def _contra_common_word_min() -> float:
    return float(_cfg("lint.contra_common_word_min", 0.30))


def _contra_confirm_conf() -> float:
    return float(_cfg("lint.contra_confirm_conf", 0.55))


def _common_word_ratio(a: str, b: str) -> float:
    """共同 2-gram 字符比例（无 jieba 的轻量近似），衡量两句是否在谈同一件事。"""
    def grams(t, n=2):
        t = re.sub(r"\s+", "", t)
        return set(t[i:i + n] for i in range(len(t) - n + 1))
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / max(len(ga), len(gb))


def _pair_hash(a: str, b: str) -> str:
    lo, hi = sorted([a.strip(), b.strip()])
    return hashlib.md5((lo + "|" + hi).encode("utf-8")).hexdigest()[:12]


def _has_antonym(a: str, b: str) -> bool:
    for x, y in ANTONYM_PAIRS:
        if (x in a and y in b) or (y in a and x in b):
            return True
    return False


def _llm_judge_contradiction(a: dict, b: dict):
    """调用 LLM 判定矛盾，返回 {judgment, reason, confidence} 或 None。"""
    raw = gc.call_llm(CONTRADICTION_CHECK_PROMPT.format(
        doc_a=a["doc_title"], doc_b=b["doc_title"],
        principle_a=a["content"], principle_b=b["content"]), timeout=_contra_llm_timeout())
    data = gc.parse_json_from_llm(raw)
    if isinstance(data, dict) and data.get("judgment"):
        return {"judgment": data["judgment"], "reason": str(data.get("reason", ""))[:120],
                "confidence": float(data.get("confidence", 0.6))}
    return None


def _pair_id(a, b) -> str:
    """同一对原则的稳定 ID（矛盾/演进判定切换时仍可被生命周期合并）。"""
    return "C-" + _sig("pair", min(a["id"], b["id"]), max(a["id"], b["id"]))


def _mk_contra_issue(a, b, reason, conf, date_map=None):
    issue = {
        "id": _pair_id(a, b),
        "type": "principle_contradiction",
        "subtype": "llm_confirmed",
        "severity": "high",
        "doc_a": a["doc_path"], "doc_b": b["doc_path"],
        "principle_a_id": a["id"], "principle_b_id": b["id"],
        "principle_a_content": a["content"], "principle_b_content": b["content"],
        "description": reason or "LLM 判定两条原则矛盾",
        "suggestion": "确认两条原则是否仍同时有效，如有取代关系请更新或标注。",
        "confidence": conf,
        "llm_confirmed": True,
        "llm_skipped": False,
    }
    # 真矛盾保持 high，但若日期可靠则附注时间方向（仅提示，不改判定）
    if date_map:
        newer, older, days, dconf = _evo_direction(a, b, date_map)
        if newer and days:
            issue["description"] += f"（注：{_stem(newer['doc_path'])} 比 {_stem(older['doc_path'])} 新约 {days} 天）"
    return issue


def _stem(doc_path: str) -> str:
    return doc_path.split("/")[-1].replace(".md", "") if doc_path else "-"


def _evo_direction(a, b, date_map):
    """根据 content_date 判断 a/b 谁新谁旧。返回 (newer, older, days_diff, dir_conf)。"""
    da, sa = date_map.get(a["doc_path"], (None, "none"))
    db_, sb = date_map.get(b["doc_path"], (None, "none"))
    if da and db_:
        days = abs((db_ - da).days)
        newer, older = (b, a) if db_ > da else (a, b)
        dconf = "reliable" if (gc.date_is_reliable(sa) or gc.date_is_reliable(sb)) else "low"
        return newer, older, days, dconf
    return None, None, None, "unknown"


def _mk_evolution_issue(a, b, reason, conf, date_map):
    newer, older, days, dconf = _evo_direction(a, b, date_map)
    if newer and dconf == "reliable":
        sug = (f"疑似 [[{_stem(newer['doc_path'])}]] 取代 [[{_stem(older['doc_path'])}]]；"
               f"确认无误可用命令「采纳版本演进」标记 superseded（不会自动改库）。")
    else:
        sug = "疑似版本演进，但无法可靠判断新旧方向，请人工确认后再决定取代关系。"
    desc = reason or "LLM 判定为同一主题的版本演进（新版取代旧版）"
    if days:
        desc += f"（相隔约 {days} 天）"
    return {
        "id": _pair_id(a, b),
        "type": "principle_contradiction",
        "subtype": "evolution",
        "severity": "low",
        "doc_a": a["doc_path"], "doc_b": b["doc_path"],
        "principle_a_id": a["id"], "principle_b_id": b["id"],
        "principle_a_content": a["content"], "principle_b_content": b["content"],
        "newer_doc": newer["doc_path"] if newer else None,
        "older_doc": older["doc_path"] if older else None,
        "newer_principle_id": newer["id"] if newer else None,
        "older_principle_id": older["id"] if older else None,
        "days_diff": days,
        "direction_confidence": dconf,
        "description": desc,
        "suggestion": sug,
        "confidence": conf,
        "llm_confirmed": True,
        "llm_skipped": False,
    }


def _emit_judgment(a, b, judgment, reason, conf, date_map):
    """按 LLM 判定生成冲突 issue（contradiction→high / evolution→low），否则 None。"""
    if conf is None or conf <= _contra_confirm_conf():
        return None
    if judgment == "contradiction":
        return _mk_contra_issue(a, b, reason, conf, date_map)
    if judgment == "evolution":
        return _mk_evolution_issue(a, b, reason, conf, date_map)
    return None


def detect_principle_contradictions(principles: list[dict], logger, llm_cache: dict | None = None,
                                    date_map: dict | None = None) -> list[dict]:
    """
    检测原则矛盾。质量原则：宁可漏报，不可误报。
    流程：difflib≥0.70 预筛 → 共同词比例≥0.30 过滤 → 含对立词者优先 →
          LLM 精判（带缓存，判定含 contradiction/evolution）。
    LLM 说 evolution（同主题版本演进）→ 降级 low + superseded 建议；说 contradiction → high；
    未确认（含预算耗尽）一律不生成冲突。content_date 仅用于判断演进方向。
    """
    if llm_cache is None:
        llm_cache = {}
    if date_map is None:
        date_map = {}
    candidates = [p for p in principles if p["type"] in ("principle", "claim", "decision")
                  and p["confidence"] >= 0.4]
    pairwise_cap = _pairwise_cap()
    if len(candidates) > pairwise_cap:
        candidates = sorted(candidates, key=lambda p: p["confidence"], reverse=True)[:pairwise_cap]
        logger.info(f"contradiction: capped candidates to top {pairwise_cap} by confidence")
    issues = []
    llm_ok = gc.llm_available()

    pairs = []
    n = len(candidates)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = candidates[i], candidates[j]
            if a["doc_path"] == b["doc_path"]:
                continue
            sim = difflib.SequenceMatcher(None, a["content"], b["content"]).ratio()
            if sim < _contra_difflib_threshold():
                continue
            if _common_word_ratio(a["content"], b["content"]) < _contra_common_word_min():
                continue
            # 对立词仅用于"提高优先级"（让其优先获得 LLM 预算），不作为判定依据
            antonym = _has_antonym(a["content"], b["content"])
            pairs.append((a, b, sim, antonym))
    # 含对立词的候选优先，其次按相似度
    pairs.sort(key=lambda x: (1 if x[3] else 0, x[2]), reverse=True)
    pairs = pairs[:_candidate_pair_cap()]
    logger.info(f"contradiction candidates: {len(pairs)} (llm={llm_ok}, cache={len(llm_cache)})")

    start = time.time()
    llm_calls = 0
    cache_hits = 0
    for a, b, sim, antonym in pairs:
        h = _pair_hash(a["content"], b["content"])
        if h in llm_cache:
            cache_hits += 1
            c = llm_cache[h]
            iss = _emit_judgment(a, b, c.get("judgment"), c.get("reason", ""),
                                 c.get("confidence", 0), date_map)
            if iss:
                issues.append(iss)
            continue  # 缓存判过（无论何种结论）都不重复调用
        # 无缓存：仅在预算内调用 LLM；预算耗尽/无 LLM → 跳过，不生成启发式冲突
        if not (llm_ok and llm_calls < _llm_contra_call_cap()
                and (time.time() - start) < _llm_contra_budget_sec()):
            continue
        llm_calls += 1
        res = _llm_judge_contradiction(a, b)
        if res is None:
            continue
        res["at"] = gc.now_iso()
        llm_cache[h] = res
        iss = _emit_judgment(a, b, res["judgment"], res["reason"], res["confidence"], date_map)
        if iss:
            issues.append(iss)
    evo = sum(1 for i in issues if i.get("subtype") == "evolution")
    logger.info(f"contradiction: llm_calls={llm_calls} cache_hits={cache_hits} "
                f"issues={len(issues)} (evolution={evo})")
    return issues


# ───────────────────────────────────────────
# 策略 B：过期断言
# ───────────────────────────────────────────

HISTORY_HINTS = ("历史", "archive", "归档", "回顾", "复盘", "当时", "曾经", "过去")

# 承诺性关键词：内容涉及未来计划/目标/截止，才值得检测"过期"。
# 不含这些词的含日期句子多为记录性（生成时间、数据范围、纯日期），不应报过期。
COMMITMENT_KEYWORDS = (
    "计划", "目标", "截止", "deadline", "milestone", "里程碑", "期限",
    "上线", "交付", "验收", "预计", "预期", "完成", "发布", "排期", "节点",
)
# 记录性时间标记的负向信号：命中则一定不是承诺
RECORD_HINTS = (
    "生成时间", "创建时间", "更新时间", "导出时间", "数据覆盖", "数据范围",
    "统计周期", "采集时间", "记录于", "整理于",
)


def _is_commitment(content: str) -> bool:
    """内容是否为承诺性声明（计划/目标/deadline）→ 才检测过期。"""
    if any(r in content for r in RECORD_HINTS):
        return False
    return any(kw in content for kw in COMMITMENT_KEYWORDS)


def _expired_subtype(content: str) -> str:
    low = content.lower()
    if "截止" in content or "期限" in content or "deadline" in low:
        return "deadline"
    if "计划" in content or "目标" in content or "里程碑" in content or "milestone" in low:
        return "plan"
    return "plan"  # 已通过 _is_commitment，默认按计划类处理


def _expired_suggestion(subtype: str, months: int) -> str:
    if subtype == "deadline":
        return f"截止期限已过约 {months} 个月，请确认是否已完成或需要延期。"
    if subtype == "data":
        return f"数据时间范围已过期约 {months} 个月，请确认是否需要刷新数据。"
    return f"该计划已过期约 {months} 个月，请确认当前进度或调整计划时间。"


def detect_expired_claims(principles: list[dict]) -> list[dict]:
    today = _today()
    issues = []
    for p in principles:
        if p["type"] not in ("claim", "decision"):
            continue
        if any(h in p["doc_path"].lower() or h in (p["doc_title"] or "") for h in HISTORY_HINTS):
            continue
        # Layer 2：只对承诺性内容检测过期（计划/目标/截止），过滤记录性日期误报
        if not _is_commitment(p["content"]):
            continue
        markers = gc.extract_time_markers(p["content"])
        for mk in markers:
            dl = gc.marker_deadline(mk)
            if dl and dl < today:
                months = (today.year - dl.year) * 12 + (today.month - dl.month)
                if months < 1:
                    continue
                subtype = _expired_subtype(p["content"])
                issues.append({
                    "id": "C-" + _sig("expired", p["id"], mk["raw"]),
                    "type": "expired_claim",
                    "subtype": subtype,
                    "severity": "high" if subtype in ("plan", "deadline") else "low",
                    "doc": p["doc_path"], "principle_id": p["id"],
                    "content": p["content"],
                    "description": f"时间标记「{mk['raw']}」已过期约 {months} 个月",
                    "suggestion": _expired_suggestion(subtype, months),
                    "llm_skipped": False,
                })
                break
    return issues


# ───────────────────────────────────────────
# 策略 C/D：孤儿页 + 死链（共用 vault 扫描）
# ───────────────────────────────────────────

WIKILINK_RE = re.compile(r"(?<!!)\[\[([^\]\|]+)(?:\|[^\]]*)?\]\]")


def _link_target(raw: str) -> str:
    """规范化 wikilink 目标：去掉 #锚点、块引用 ^id，取 / 后的 basename。"""
    t = raw.strip()
    t = t.split("#", 1)[0].split("^", 1)[0].strip()
    if "/" in t:
        t = t.rsplit("/", 1)[-1].strip()
    return t


def _scan_vault_links(vault_path: Path):
    """
    单次扫描，返回 (file_info, all_stems, referenced)。
    - all_stems：全库（含 daily 等噪声目录）所有 .md 的 stem，用于死链存在性判断，
      避免把指向被过滤目录的链接误判为死链。
    - file_info / referenced：仅非噪声文档，用于孤儿与死链分析。
    """
    all_stems = set()
    for f in vault_path.rglob("*.md"):
        if f.is_file():
            all_stems.add(f.stem)

    referenced = set()
    file_info = []
    for f in gc.list_vault_markdown(vault_path):
        rel = str(f.relative_to(vault_path)).replace("\\", "/")
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            text = ""
        raw_links = WIKILINK_RE.findall(text)
        links = [_link_target(lk) for lk in raw_links]
        for lk in links:
            if lk:
                referenced.add(lk)
        file_info.append({"rel": rel, "stem": f.stem, "path": f,
                          "text": text, "links": links})
    return file_info, all_stems, referenced


def detect_orphans_and_deadlinks(vault_path: Path, principle_docs: set, auto_fix: bool, logger):
    file_info, all_stems, referenced = _scan_vault_links(vault_path)
    today = _today()
    orphans, dead = [], []
    fixed = 0

    for fi in file_info:
        rel, stem, text, links = fi["rel"], fi["stem"], fi["text"], fi["links"]
        has_related = RELATED_HEADER in text
        has_out = len(links) > 0
        is_referenced = stem in referenced
        has_principle = rel in principle_docs

        # 孤儿（有原则才报告）：有知识价值（已提取原则）却被孤立才值得提醒；
        # 无原则的孤立文档多为剪藏/群聊/周报/草稿，无连接是预期行为，不报告。
        try:
            age_h = (datetime.now().timestamp() - fi["path"].stat().st_mtime) / 3600
        except OSError:
            age_h = 999
        if has_principle and not has_out and not has_related and not is_referenced and age_h > 24:
            orphans.append({
                "id": "C-" + _sig("orphan", rel),
                "type": "orphan_page", "subtype": "valuable", "severity": "medium",
                "doc": rel,
                "description": "该文档已提取知识原则，却无出链、无反链、无关联区块（被孤立）",
                "suggestion": "考虑运行关联发现为其补充关联，或主动加入相关 wikilink。",
                "llm_skipped": False,
            })

        # 死链：关联区块内的 [[title]] 指向不存在文件
        if has_related:
            dead_in_doc = [lk for lk in links if lk and lk not in all_stems]
            if dead_in_doc:
                for lk in set(dead_in_doc):
                    dead.append({
                        "id": "C-" + _sig("dead", rel, lk),
                        "type": "dead_link", "subtype": "internal", "severity": "medium",
                        "doc": rel, "link_text": f"[[{lk}]]",
                        "target_exists": False,
                        "description": f"关联区块指向不存在的笔记 [[{lk}]]",
                        "suggestion": "创建该文档或删除死链",
                        "auto_fixed": False,
                        "llm_skipped": False,
                    })
                if auto_fix:
                    new_text = _remove_dead_links(text, set(dead_in_doc), all_stems)
                    if new_text != text:
                        try:
                            gc.atomic_write_text(fi["path"], new_text)
                            fixed += 1
                            for d in dead:
                                if d["doc"] == rel:
                                    d["auto_fixed"] = True
                        except OSError:
                            pass
    logger.info(f"orphans={len(orphans)} dead_links={len(dead)} fixed={fixed}")
    return orphans, dead, fixed


def _remove_dead_links(text: str, dead_titles: set, all_stems: set) -> str:
    """从文本中删除指向不存在文件的 [[title]]（尝试大小写匹配修复，否则删除链接）。"""
    lower_map = {s.lower(): s for s in all_stems}

    def repl(m):
        title = _link_target(m.group(1))
        if title in dead_titles:
            fix = lower_map.get(title.lower())
            if fix:
                return f"[[{fix}]]"
            return ""  # 删除死链
        return m.group(0)

    out = WIKILINK_RE.sub(repl, text)
    # 清理因删除产生的连续分隔符/空行
    out = re.sub(r"(\|\s*){2,}", "| ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out


# ───────────────────────────────────────────
# 策略 E：重复原则
# ───────────────────────────────────────────

def detect_duplicate_principles(principles: list[dict]) -> list[dict]:
    issues = []
    ps = [p for p in principles if p["type"] in ("principle", "claim")]
    pairwise_cap = _pairwise_cap()
    if len(ps) > pairwise_cap:
        ps = sorted(ps, key=lambda p: p["confidence"], reverse=True)[:pairwise_cap]
    n = len(ps)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = ps[i], ps[j]
            if a["doc_path"] == b["doc_path"]:
                continue
            ratio = difflib.SequenceMatcher(None, a["content"], b["content"]).ratio()
            if ratio >= 0.88:
                issues.append({
                    "id": "C-" + _sig("dup", min(a["id"], b["id"]), max(a["id"], b["id"])),
                    "type": "duplicate_principle",
                    "subtype": "exact" if ratio >= 0.98 else "partial",
                    "severity": "low",
                    "doc_a": a["doc_path"], "doc_b": b["doc_path"],
                    "principle_a_id": a["id"], "principle_b_id": b["id"],
                    "description": f"原则在多文档重复声明（相似度 {ratio:.2f}）",
                    "suggestion": "考虑合并或统一表述来源",
                    "llm_skipped": False,
                })
    return issues[:40]


# ───────────────────────────────────────────
# 策略 F：术语不一致（轻量启发）
# ───────────────────────────────────────────

def detect_inconsistent_terms(principles: list[dict]) -> list[dict]:
    """启发式：同一英文缩写有多种大小写/中英混用写法（轻量，不依赖 LLM）。"""
    issues = []
    term_variants = {}
    for p in principles:
        for term in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", p["content"]):
            key = term.lower()
            term_variants.setdefault(key, {}).setdefault(term, []).append(p["doc_path"])
    for key, variants in term_variants.items():
        if len(variants) >= 2 and sum(len(v) for v in variants.values()) >= 3:
            forms = list(variants.keys())
            issues.append({
                "id": "C-" + _sig("term", key),
                "type": "inconsistent_term", "subtype": "case", "severity": "low",
                "term": key,
                "variants": forms,
                "description": f"术语「{key}」存在不一致写法：{', '.join(forms)}",
                "suggestion": "统一术语大小写/命名",
                "llm_skipped": False,
            })
    return issues[:20]


# ───────────────────────────────────────────
# 冲突生命周期合并
# ───────────────────────────────────────────

def _issue_docs(it: dict) -> set:
    return {d for d in (it.get("doc_a"), it.get("doc_b"), it.get("doc")) if d}


def _issue_principle_ids(it: dict) -> set:
    ids = {it.get("principle_id"), it.get("principle_a_id"), it.get("principle_b_id")}
    return {pid for pid in ids if pid is not None}


def _resolve_issue(it: dict, now: str, reason: str) -> dict:
    it["status"] = "resolved"
    it["resolved_at"] = it.get("resolved_at") or now
    if not it.get("resolution"):
        it["resolution"] = reason
    return it


def _merge_conflicts(new_issues: list[dict], existing: dict, present_pids: set, now: str,
                     scanned_docs: set | None = None, scanned_types: set | None = None,
                     present_docs: set | None = None) -> dict:
    """
    非覆盖式合并：保留历史、递增 detected_count、自动 resolved、severity 升级。

    scanned_docs / scanned_types 界定"本次实际扫描的范围"：
      - 全量 lint：均为 None（= 全覆盖），未再检测到的旧冲突判定为 resolved。
      - 增量 lint：仅扫描了某文档的某几类冲突；超出该范围的旧冲突保持原状，
        绝不因"本轮没扫到"而误判 resolved（修复增量 lint 错误清空全量结果的 bug）。
    """
    old_by_id = {it["id"]: it for it in existing.get("issues", [])}
    today = _today()
    merged = {}

    new_by_id = {it["id"]: it for it in new_issues}

    # 1. 处理新检测到的
    for iid, it in new_by_id.items():
        if iid in old_by_id:
            o = old_by_id[iid]
            it["status"] = o.get("status", "open")
            it["first_detected"] = o.get("first_detected", now)
            it["detected_count"] = o.get("detected_count", 1) + 1
            it["last_detected"] = now
            it["resolved_at"] = o.get("resolved_at")
            it["resolution"] = o.get("resolution")
            if it["status"] == "ignored":
                it["severity"] = o.get("severity", it["severity"])
            else:
                # severity 自动升级：count>=3 且持续 >7 天
                try:
                    first = datetime.fromisoformat(it["first_detected"]).date()
                    days = (today - first).days
                except (ValueError, TypeError):
                    days = 0
                if it["detected_count"] >= 3 and days > 7:
                    cur_idx = SEV_ORDER.index(it["severity"]) if it["severity"] in SEV_ORDER else 0
                    it["severity"] = SEV_ORDER[min(cur_idx + 1, len(SEV_ORDER) - 1)]
        else:
            it["status"] = "open"
            it["first_detected"] = now
            it["last_detected"] = now
            it["detected_count"] = 1
            it["resolved_at"] = None
            it["resolution"] = None
        merged[iid] = it

    # 2. 处理上次有、这次没检测到的（仅在"本次扫描范围内"才可判 resolved）
    for iid, o in old_by_id.items():
        if iid in merged:
            continue
        docs = _issue_docs(o)
        pids = _issue_principle_ids(o)
        if o.get("status") in ("ignored", "resolved"):
            if o.get("status") == "resolved" and not o.get("resolution"):
                if present_docs is not None and docs and any(d not in present_docs for d in docs):
                    o["resolution"] = "自动判定：来源文档已不存在"
                elif pids and not pids.issubset(present_pids):
                    o["resolution"] = "自动判定：来源原则已不存在"
            merged[iid] = o  # 保留既有终态
            continue
        if present_docs is not None and docs and any(d not in present_docs for d in docs):
            merged[iid] = _resolve_issue(o, now, "自动判定：来源文档已不存在")
            continue
        if pids and not pids.issubset(present_pids):
            merged[iid] = _resolve_issue(o, now, "自动判定：来源原则已不存在")
            continue
        # 是否落在本次扫描范围内？
        if scanned_types is not None and o.get("type") not in scanned_types:
            merged[iid] = o  # 本轮根本没检测这一类 → 保持原状
            continue
        if scanned_docs is not None and not (_issue_docs(o) & scanned_docs):
            merged[iid] = o  # 本轮没扫这些文档 → 保持原状
            continue
        # 在范围内且本轮未再检测到 → 判定已解决
        merged[iid] = _resolve_issue(o, now, "自动判定：本轮扫描未再检测到")

    return {"issues": list(merged.values())}


def _prune_llm_cache(cache: dict, max_entries: int = 5000, max_age_days: int = 90) -> dict:
    """按容量和时间淘汰 LLM 判定缓存，返回精简后的缓存。"""
    # cutoff 与 gc.now_iso() 同格式（带时区、无微秒），确保字符串比较安全
    cutoff = (datetime.now().astimezone().replace(microsecond=0) - timedelta(days=max_age_days)).isoformat()
    filtered = {k: v for k, v in cache.items() if v.get("at", "") >= cutoff}
    if len(filtered) <= max_entries:
        return filtered
    sorted_items = sorted(filtered.items(), key=lambda x: x[1].get("at", ""), reverse=True)
    return dict(sorted_items[:max_entries])


def _prune_resolved(issues: list, max_age_days: int = 30) -> list:
    """清理 resolved 超过 max_age_days 的冲突，减少 JSON 体积。"""
    cutoff = (datetime.now().astimezone().replace(microsecond=0) - timedelta(days=max_age_days)).isoformat()
    return [i for i in issues if i.get("status") != "resolved" or (i.get("resolved_at") or "") >= cutoff]


# ───────────────────────────────────────────
# 冲突看板（.understory/conflicts.md）—— 人类可读
# ───────────────────────────────────────────

TYPE_LABEL = {
    "principle_contradiction": "原则矛盾", "expired_claim": "过期计划/断言",
    "orphan_page": "孤儿页", "dead_link": "死链",
    "duplicate_principle": "重复原则", "inconsistent_term": "术语不一致",
    "er_entity_missing_in_db": "ER 实体未同步",
    "er_entity_out_of_sync": "ER 实体不同步",
    "er_entity_schema_violation": "ER 实体约束问题",
    "er_relation_schema_violation": "ER 关系约束问题",
}


def _board_doc(d: str) -> str:
    return d.split("/")[-1].replace(".md", "") if d else "-"


def generate_conflict_board(data: dict, vault_path: Path) -> Path:
    """生成人类友好的冲突看板 .understory/conflicts.md。"""
    gdir = gc.get_graphify_dir(vault_path)
    issues = [i for i in data.get("issues", []) if i.get("status") == "open"]
    s = data.get("summary", {})
    high = [i for i in issues if i.get("severity") == "high"]
    medium = [i for i in issues if i.get("severity") == "medium"]
    low = [i for i in issues if i.get("severity") == "low"]

    lines = [
        "# Understory 冲突看板",
        "",
        f"> 最后更新：{datetime.now().strftime('%Y-%m-%d %H:%M')} ｜ "
        f"活跃冲突 {len(issues)} 项（🔴 {len(high)} · 🟡 {len(medium)} · 🟢 {len(low)}）｜ "
        f"本次自动解决 {s.get('resolved', 0)} 项 ｜ 已自动修复死链 {s.get('auto_fixed', 0)} 项",
        "",
        "---",
        "",
    ]

    def render_group(title, group):
        lines.append(f"## {title}（{len(group)} 项）")
        lines.append("")
        if not group:
            lines.append("*（无）*")
            lines.append("")
            return
        bytype: dict = {}
        for i in group:
            bytype.setdefault(i["type"], []).append(i)
        for t, items in bytype.items():
            lines.append(f"### {TYPE_LABEL.get(t, t)}（{len(items)}）")
            lines.append("")
            for i in items:
                if t in ("principle_contradiction", "duplicate_principle"):
                    head = f"`{_board_doc(i.get('doc_a'))}` ↔ `{_board_doc(i.get('doc_b'))}`"
                elif t == "inconsistent_term":
                    head = f"术语「{i.get('term', '')}」：{', '.join(i.get('variants', []))}"
                else:
                    head = f"`{_board_doc(i.get('doc'))}`"
                    if i.get("link_text"):
                        head += f" → {i['link_text']}"
                fixed = "（已自动修复）" if i.get("auto_fixed") else ""
                lines.append(f"- [ ] **[{i.get('id', '')}]** {head}{fixed}")
                if i.get("content"):
                    lines.append(f"  - 内容：{i['content'][:80]}")
                if i.get("description"):
                    lines.append(f"  - 说明：{i['description']}")
                if i.get("suggestion"):
                    lines.append(f"  - 建议：{i['suggestion']}")
            lines.append("")

    render_group("🔴 High", high)
    render_group("🟡 Medium", medium)
    render_group("🟢 Low", low)
    lines.append("---")
    lines.append("*本看板由 Understory 自动生成，手动修改将在下次 lint 时被覆盖。*")

    board_path = gdir / "conflicts.md"
    gc.atomic_write_text(board_path, "\n".join(lines) + "\n")
    return board_path


def _append_er_issues(vault_path: Path, new_issues: list[dict], logger, single_doc: str | None,
                      scanned_types: set | None) -> set | None:
    """Append ER schema/sync issues without changing the existing lint contract."""
    try:
        from er_lint_checks import ER_ISSUE_TYPES, check_er_conflicts

        er_issues = check_er_conflicts(vault_path, doc_path=single_doc)
        new_issues.extend(er_issues)
        if scanned_types is not None:
            scanned_types = set(scanned_types) | set(ER_ISSUE_TYPES)
        logger.info("er lint: %s issues", len(er_issues))
    except Exception as exc:
        logger.error("er lint failed: %s", exc)
    return scanned_types


# ───────────────────────────────────────────
# 主入口
# ───────────────────────────────────────────

def lint_vault(vault_path: Path, auto_fix: bool = False, single_doc: str | None = None) -> dict:
    vault_path = Path(vault_path)
    logger = gc.setup_logger("lint", vault_path)
    gdir = gc.get_graphify_dir(vault_path)
    db_path = gc.get_principles_db(vault_path)
    now = gc.now_iso()

    all_principles = _load_principles(db_path)
    vault_docs = _vault_doc_paths(vault_path)
    missing_principle_docs = sorted({p["doc_path"] for p in all_principles} - vault_docs)
    principles = [p for p in all_principles if p["doc_path"] in vault_docs]
    if missing_principle_docs:
        logger.info("ignored stale principles from missing docs: count=%s examples=%s",
                    len(missing_principle_docs), missing_principle_docs[:5])
    present_pids = {p["id"] for p in principles}
    principle_docs = {p["doc_path"] for p in principles}

    # 载入上次 conflicts.json（用于增量合并 + LLM 判定缓存持久化，避免重复调用）
    cpath = gdir / "conflicts.json"
    existing = {}
    if cpath.exists():
        try:
            existing = json.loads(cpath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = {}
    llm_cache = dict(existing.get("llm_judgment_cache", {}))
    date_map = {path: value for path, value in _load_doc_dates(db_path).items() if path in vault_docs}  # 时序记忆：文档内容时间，用于演进方向

    if single_doc:
        rel = str(single_doc).replace("\\", "/")
        scope_ps = [p for p in principles if p["doc_path"] == rel]
        others = [p for p in principles if p["doc_path"] != rel]
        contra = detect_principle_contradictions(scope_ps + others[:200], logger, llm_cache, date_map) if scope_ps else []
        expired = detect_expired_claims(scope_ps)
        new_issues = contra + expired
        scanned_docs = {rel}
        scanned_types = {"principle_contradiction", "expired_claim"}
        logger.info(f"incremental lint for {rel}: {len(new_issues)} issues")
    else:
        contra = detect_principle_contradictions(principles, logger, llm_cache, date_map)
        expired = detect_expired_claims(principles)
        orphans, dead, fixed = detect_orphans_and_deadlinks(vault_path, principle_docs, auto_fix, logger)
        dup = detect_duplicate_principles(principles)
        terms = detect_inconsistent_terms(principles)
        new_issues = contra + expired + orphans + dead + dup + terms
        scanned_docs = None
        scanned_types = None

    scanned_types = _append_er_issues(vault_path, new_issues, logger, single_doc, scanned_types)

    merged = _merge_conflicts(new_issues, existing, present_pids, now,
                              scanned_docs=scanned_docs, scanned_types=scanned_types,
                              present_docs=vault_docs)
    issues = merged["issues"]

    # 清理无限增长：resolved 超期移除，llm_cache 超容量/超期淘汰
    issues = _prune_resolved(issues)
    llm_cache = _prune_llm_cache(llm_cache)

    open_issues = [i for i in issues if i.get("status") == "open"]
    summary = {
        "high": sum(1 for i in open_issues if i.get("severity") == "high"),
        "medium": sum(1 for i in open_issues if i.get("severity") == "medium"),
        "low": sum(1 for i in open_issues if i.get("severity") == "low"),
        "resolved": sum(1 for i in issues if i.get("status") == "resolved"),
        "ignored": sum(1 for i in issues if i.get("status") == "ignored"),
        "auto_fixed": sum(1 for i in issues if i.get("auto_fixed")),
        "total": len(issues),
        "open_total": len(open_issues),
    }

    out = {
        "scan_id": "lint-" + datetime.now().strftime("%Y%m%d-%H%M%S"),
        "scan_time": now,
        "vault_path": str(vault_path).replace("\\", "/"),
        "llm_available": gc.llm_available(),
        "total_docs_scanned": len(gc.list_vault_markdown(vault_path)) if not single_doc else 1,
        "total_principles_scanned": len(principles),
        "issues": issues,
        "summary": summary,
        "llm_judgment_cache": llm_cache,
    }
    gc.atomic_write_text(cpath, json.dumps(out, ensure_ascii=False, indent=2))
    try:
        generate_conflict_board(out, vault_path)
    except Exception as e:
        logger.error(f"conflict board failed: {e}")
    gc.rotate_logs(vault_path)
    logger.info(f"lint done: {summary}")
    return {"status": "ok", "summary": summary, "llm_available": gc.llm_available()}


def main():
    parser = argparse.ArgumentParser(description="Lint vault for knowledge conflicts")
    parser.add_argument("--vault", help="Vault 根路径")
    parser.add_argument("--fix", action="store_true", help="自动清理死链")
    parser.add_argument("--doc", help="增量 lint：仅检测该文档相关冲突")
    args = parser.parse_args()
    vault = gc.get_vault_path(args.vault)
    print(json.dumps(lint_vault(vault, auto_fix=args.fix, single_doc=args.doc), ensure_ascii=False))


if __name__ == "__main__":
    main()
