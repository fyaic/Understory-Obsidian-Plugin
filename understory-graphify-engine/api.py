#!/usr/bin/env python3
"""
understory-graphify-engine 的统一 Python API 入口。

面向外部 Agent 设计，所有核心功能都通过本模块的函数暴露。

典型调用方式：
    from api import init_index, discover_relations, build_orphan_links, on_file_changed

    # 场景 1: 用户主动说"帮我把孤儿关联上"
    report = build_orphan_links(limit=50, dry_run=False)

    # 场景 2: Agent 的肌肉反应 —— 文件刚被保存
    on_file_changed("T-B 新文档.md")
"""
import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Optional
from collections import defaultdict

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "graphify-template" / "scripts"))

from embedding_index import _get_env as get_env, EmbeddingIndex, check_embedding_ready, _embedding_provider_name
from graphify_common import clean_markdown as _clean_markdown, cosine_similarity as _cosine_similarity
from vault_ops import detect_vault_path, list_markdown_files
from config import config
from providers import get_embedding_provider, get_llm_provider
from network_policy import current_network_mode, embedding_allowed, llm_allowed

# AIC-2108 关联融合（哨兵区 + 删除记忆），与 api.py 同目录
sys.path.insert(0, str(ROOT))
import link_merge

# ───────────────────────────────────────────
# 内部工具函数
# ───────────────────────────────────────────


JUNK_TITLES = {
    "report", "raw_report", "worklog", "linear", "recap", "roadmap",
    "readme", "1", "concept_draft", "proposed_method", "onboard yourself",
    "final_delivery",
}


def _has_wikilinks(content: str) -> bool:
    # 只匹配真正的 [[...]] 链接，排除 ![[...]] 图片/附件嵌入
    return bool(re.search(r"(?<!!)\[\[.*?\]\]", content))


def _collect_backlinks(title: str, vault: Path, doc_rel_path: str, max_snippets: int = 3) -> list[str]:
    """
    扫描 vault 中引用过该文档的其他文档，收集其文本片段作为反向链接上下文。
    优先扫描同文件夹，再扫描全库，性能可控。
    """
    target = title.strip()
    if not target:
        return []

    pattern = re.compile(rf"\[\[{re.escape(target)}(?:\|.*?)?\]\]")
    snippets = []
    seen = set()

    doc_dir = (vault / doc_rel_path).parent if doc_rel_path else vault

    all_markdown_files = list_markdown_files(vault)

    def _scan_files(files: list[Path]):
        nonlocal snippets
        for f in files:
            rel = str(f.relative_to(vault)).replace("\\", "/")
            if rel == doc_rel_path or rel in seen:
                continue
            try:
                text = f.read_text(encoding="utf-8")
            except Exception:
                continue
            if pattern.search(text):
                seen.add(rel)
                snippet = (f.stem + "：" + text[:300]).replace("\n", " ")
                snippets.append(snippet)
                if len(snippets) >= max_snippets:
                    return True
        return False

    # 1. 优先扫描同文件夹
    try:
        doc_dir_resolved = doc_dir.resolve()
        same_folder_files = [
            f for f in all_markdown_files
            if f.resolve() == doc_dir_resolved or doc_dir_resolved in f.resolve().parents
        ]
    except Exception:
        same_folder_files = []

    if _scan_files(same_folder_files):
        return snippets

    # 2. 同文件夹不足时扫描全库（限制读取数量以控制性能）
    # 从 vault 根开始，但跳过已经扫描过的同文件夹路径
    for f in all_markdown_files:
        rel = str(f.relative_to(vault)).replace("\\", "/")
        if rel == doc_rel_path or rel in seen:
            continue
        # 如果该文件在同文件夹下，已经扫描过，跳过
        if doc_dir in f.parents or f.parent == doc_dir:
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except Exception:
            continue
        if pattern.search(text):
            seen.add(rel)
            snippet = (f.stem + "：" + text[:300]).replace("\n", " ")
            snippets.append(snippet)
            if len(snippets) >= max_snippets:
                break

    return snippets


def _call_embedding_api(texts: list[str]) -> list[list[float]]:
    env = get_env()
    return get_embedding_provider(env=env).embed(texts)


def _call_llm_extract_concepts(title: str, snippet: str, max_concepts: int = 4) -> list[str]:
    """调用轻量 LLM 提取 3~4 个干净的核心概念词。"""
    env = get_env()
    return get_llm_provider(env=env).extract_concepts(title, snippet, max_concepts=max_concepts)


def _keyword_recall(
    target_title: str,
    target_text: str,
    cached_docs: list[dict],
    top_n: int = 20,
) -> list[dict]:
    """轻量关键词召回：基于标题匹配补充 embedding 盲区，无需 LLM。"""
    # 提取候选关键词：标题本身 + 标题中的中文词组
    keywords = [target_title.lower().strip()]
    chars = target_title.replace(" ", "")
    for length in range(min(4, len(chars)), 1, -1):
        for i in range(len(chars) - length + 1):
            word = chars[i:i + length]
            if len(word) >= 2 and word not in keywords:
                keywords.append(word)
    # 去重
    seen = set()
    unique_keywords = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique_keywords.append(kw)
    keywords = unique_keywords

    scored = []
    for doc in cached_docs:
        doc_title = doc.get("title", "").lower().strip()
        if doc_title == target_title.lower().strip():
            continue
        doc_path = doc.get("path", "").lower()

        score = 0
        for kw in keywords:
            if kw == doc_title:
                score += 10
            elif kw in doc_title:
                score += 5
            elif kw in doc_path:
                score += 2

        if score > 0:
            scored.append({
                "path": doc["path"],
                "title": doc["title"],
                "score": score,
                "embedding": doc.get("embedding"),
            })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_n]


def _local_keyword_terms(title: str, text: str, limit: int = 80) -> list[str]:
    """Extract deterministic local search terms without network calls."""
    terms: list[str] = []

    def add(term: str) -> None:
        term = term.lower().strip()
        if len(term) < 2 or term in terms:
            return
        terms.append(term)

    source = f"{title}\n{text[:1200]}"
    for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", source):
        if token.lower() not in JUNK_TITLES:
            add(token)

    for seq in re.findall(r"[\u4e00-\u9fff]{2,}", source):
        compact = seq.strip()
        if len(compact) <= 6:
            add(compact)
            continue
        for size in (4, 3, 2):
            for idx in range(0, len(compact) - size + 1):
                add(compact[idx:idx + size])
                if len(terms) >= limit:
                    return terms

    return terms[:limit]


def _local_keyword_recall(
    target_title: str,
    target_text: str,
    vault: Path,
    target_rel: str,
    top_n: int = 20,
) -> list[dict]:
    """Local-only relation recall for privacy mode without embeddings."""
    terms = _local_keyword_terms(target_title, target_text)
    if not terms:
        return []

    scored: list[dict] = []
    for file in list_markdown_files(vault):
        rel = str(file.relative_to(vault)).replace("\\", "/")
        if rel == target_rel:
            continue
        try:
            content = file.read_text(encoding="utf-8")
        except Exception:
            continue
        clean = _clean_markdown(content)[:1600].lower()
        title = file.stem.lower()
        path = rel.lower()
        score = 0.0
        for term in terms:
            weight = min(len(term), 6)
            if term == title:
                score += 10.0
            elif term in title:
                score += 4.0 + weight * 0.35
            if term in path:
                score += 1.5
            hits = clean.count(term)
            if hits:
                score += min(3.0, hits * 0.7)
        if score <= 0:
            continue
        scored.append({
            "path": rel,
            "title": file.stem,
            "keyword_score": score,
            "source": "keyword",
        })

    scored.sort(key=lambda item: item["keyword_score"], reverse=True)
    max_score = scored[0]["keyword_score"] if scored else 1.0
    results = []
    for item in scored[:top_n]:
        normalized = min(0.95, max(0.05, item["keyword_score"] / max_score))
        results.append({
            "path": item["path"],
            "title": item["title"],
            "similarity": normalized,
            "source": "keyword",
        })
    return results


def _merge_recalls(
    emb_rels: list[dict],
    kw_rels: list[dict],
    emb_weight: float = 0.7,
) -> list[dict]:
    """融合 embedding 和 keyword 两路召回，返回兼容原格式的 relations 列表。"""
    merged = {}

    for r in emb_rels:
        key = r["path"]
        merged[key] = {
            "path": r["path"],
            "title": r["title"],
            "similarity": r.get("similarity", 0),
            "kw_score": 0,
            "embedding": r.get("embedding"),
        }

    max_kw = max((r["score"] for r in kw_rels), default=1) or 1
    for r in kw_rels:
        key = r["path"]
        if key in merged:
            merged[key]["kw_score"] = r["score"] / max_kw
        else:
            merged[key] = {
                "path": r["path"],
                "title": r["title"],
                "similarity": 0,
                "kw_score": r["score"] / max_kw,
                "embedding": r.get("embedding"),
            }

    results = []
    for item in merged.values():
        # 用 fusion_score 替代 similarity，保持下游兼容
        item["similarity"] = emb_weight * item["similarity"] + (1 - emb_weight) * item["kw_score"]
        item.pop("kw_score", None)
        results.append(item)

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results


def _cache_db() -> Path:
    return Path(__file__).resolve().parent / ".cache" / "embedding_index.sqlite"


def _embedding_index_metadata() -> dict:
    db = _cache_db()
    metadata = {
        "index_exists": db.exists(),
        "indexed_count": 0,
        "db_path": str(db),
        "index_mtime": db.stat().st_mtime if db.exists() else None,
    }
    if not db.exists():
        return metadata
    try:
        conn = sqlite3.connect(str(db))
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM embeddings")
        row = cur.fetchone()
        metadata["indexed_count"] = int(row[0] or 0) if row else 0
        conn.close()
    except Exception as exc:
        metadata["index_error"] = str(exc)
    return metadata


def embedding_status(vault: Optional[Path] = None) -> dict:
    """
    Return semantic embedding/index readiness without building the index.
    This is a setup status probe: it must not call provider APIs.
    """
    network_mode = current_network_mode()
    provider_name = _embedding_provider_name()
    allowed = embedding_allowed()
    ready, ready_message = check_embedding_ready()
    metadata = _embedding_index_metadata()
    index_ready = bool(metadata.get("index_exists")) and not metadata.get("index_error")

    if not allowed:
        status = "ok"
        semantic_state = "local_only"
        indexing = "skipped"
        recommended_action = "configure_vector_model"
        message = "Semantic vector embedding is off in Local only mode."
    elif provider_name in {"none", "off", "disabled"}:
        status = "warning"
        semantic_state = "provider_disabled"
        indexing = "unavailable"
        recommended_action = "choose_embedding_provider"
        message = ready_message
    elif not ready:
        status = "warning"
        semantic_state = "provider_unavailable"
        indexing = "unavailable"
        recommended_action = "configure_embedding_api"
        message = ready_message
    elif index_ready:
        status = "ok"
        semantic_state = "ready"
        indexing = "ready"
        recommended_action = "rebuild_embedding_index"
        message = "Semantic index ready."
    else:
        status = "warning"
        semantic_state = "index_missing"
        indexing = "missing"
        recommended_action = "build_embedding_index"
        message = "Embedding API is configured, but the local semantic index has not been built."

    return {
        "status": status,
        "network_mode": network_mode,
        "embedding_allowed": allowed,
        "provider": provider_name,
        "provider_ready": bool(ready),
        "provider_message": ready_message,
        "semantic_state": semantic_state,
        "indexing": indexing,
        "index_ready": index_ready,
        "recommended_action": recommended_action,
        "message": message,
        **metadata,
    }


def _refresh_state_path() -> Path:
    return Path(__file__).resolve().parent / ".cache" / "refresh_state.json"


def _load_refresh_state() -> dict:
    """AIC-2191: 加载刷新状态，记录每个文档的上次内容 hash。"""
    path = _refresh_state_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_refresh_state(state: dict) -> None:
    """AIC-2191: 保存刷新状态。"""
    path = _refresh_state_path()
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_all_cached_embeddings():
    db = _cache_db()
    if not db.exists():
        raise FileNotFoundError(
            f"未找到 Embedding 缓存: {db}\n"
            f"请先运行: python {Path(__file__).resolve().parent / 'scripts' / 'vault_ops.py'} init"
        )
    conn = sqlite3.connect(str(db))
    cur = conn.cursor()
    cur.execute("SELECT path, embedding FROM embeddings")
    results = []
    for row in cur.fetchall():
        results.append({"path": row[0], "title": Path(row[0]).stem, "embedding": json.loads(row[1])})
    conn.close()
    return results


def _embedding_index_fix(vault: Path) -> dict:
    api_path = Path(__file__).resolve()
    command = f'python "{api_path}" init --vault "{Path(vault).resolve()}"'
    if _ui_language() == "zh":
        return {
            "id": "embedding_index_missing",
            "severity": "warning",
            "title": "需要构建 Embedding 索引",
            "message": "当前先使用本地关键词降级结果。要启用语义关联，请在命令面板运行「准备本地搜索索引」，或执行下方命令。",
            "command_palette": "准备本地搜索索引",
            "command_id": "init-embedding-index",
            "command": command,
            "fallback_mode": "local-keyword",
        }
    return {
        "id": "embedding_index_missing",
        "severity": "warning",
        "title": "Embedding index needs to be built",
        "message": "Understory is using local keyword fallback for now. To enable semantic relations, run \"Prepare local search index\" from the command palette or run the command below.",
        "command_palette": "Prepare local search index",
        "command_id": "init-embedding-index",
        "command": command,
        "fallback_mode": "local-keyword",
    }


def _embedding_index_missing_guidance(vault: Path) -> tuple[list[str], list[dict]]:
    if not embedding_allowed() or _cache_db().exists():
        return [], []
    fix = _embedding_index_fix(vault)
    return [f"{fix['title']}: {_cache_db()}"], [fix]


def _filter_existing_docs(cached_docs: list[dict], vault: Path) -> list[dict]:
    """过滤掉 vault 中已不存在的文件条目（防止索引残留僵尸条目生成无效 wikilink）。"""
    filtered = []
    for doc in cached_docs:
        p = vault / doc["path"].replace("/", os.sep)
        if p.exists():
            filtered.append(doc)
    return filtered


def _ensure_index_fresh(vault: Path) -> dict:
    """
    增量更新 Embedding 索引：清理僵尸条目 + 索引新增/变更的文档。
    AIC-2190: 引入 mtime 预筛选，只处理变更的文件，避免每次全库扫描。
    返回简要报告，供上层日志使用。
    """
    network_mode = current_network_mode()
    if not embedding_allowed():
        return {
            "status": "ok",
            "network_mode": network_mode,
            "indexing": "skipped",
            "message": "Embedding index skipped because network mode is local.",
            "pruned": 0,
            "indexed_success": 0,
            "indexed_fail": 0,
            "skipped_by_mtime": 0,
            "scanned": 0,
            **_embedding_index_metadata(),
        }

    ready, ready_message = check_embedding_ready()
    if not ready:
        return {
            "status": "error",
            "network_mode": network_mode,
            "indexing": "unavailable",
            "message": ready_message,
            "pruned": 0,
            "indexed_success": 0,
            "indexed_fail": 0,
            "skipped_by_mtime": 0,
            "scanned": 0,
            **_embedding_index_metadata(),
        }

    index = None
    try:
        index = EmbeddingIndex()
        # AIC-2190: 先批量获取缓存中的 mtime，用于预筛选
        cached_mtimes = index.fetch_all_mtimes()

        # 1. 准备文档列表（只处理新增或 mtime 变更的文件）
        docs = []
        skipped_by_mtime = 0
        for f in list_markdown_files(vault):
            rel = str(f.relative_to(vault)).replace("\\", "/")
            # 排除噪声路径
            noisy = ("linear issues/", "daily", "日报", "晨会", "untitled")
            if any(k in rel.lower() for k in noisy):
                continue

            # AIC-2190: mtime 预筛选
            current_mtime = f.stat().st_mtime
            cached_mtime = cached_mtimes.get(rel)
            if cached_mtime is not None and current_mtime <= cached_mtime:
                skipped_by_mtime += 1
                continue

            try:
                content = f.read_text(encoding="utf-8")
            except Exception:
                continue
            clean = _clean_markdown(content)
            text = (f.stem + "\n" + clean[:2000]).strip()
            if len(text) < 10:
                continue
            docs.append({"path": rel, "title": f.stem, "text": text})

        # 2. 清理僵尸条目 + 增量更新
        pruned = index.prune_missing(vault)
        success, fail = index.ensure_index(docs, base_path=vault)
        status = "ok" if fail == 0 else "error"
        message = (
            "Embedding index is up to date."
            if fail == 0
            else f"Embedding index failed for {fail} document(s)."
        )
        return {
            "status": status,
            "network_mode": network_mode,
            "indexing": "complete" if fail == 0 else "failed",
            "message": message,
            "pruned": pruned,
            "indexed_success": success,
            "indexed_fail": fail,
            "skipped_by_mtime": skipped_by_mtime,
            "scanned": len(docs) + skipped_by_mtime,
            **_embedding_index_metadata(),
        }
    except Exception as exc:
        return {
            "status": "error",
            "network_mode": network_mode,
            "indexing": "failed",
            "message": str(exc),
            "error": str(exc),
            **_embedding_index_metadata(),
        }
    finally:
        if index is not None:
            index.close()


# ───────────────────────────────────────────
# Hybrid 概念分组核心
# ───────────────────────────────────────────


def _keyword_score(concept: str, title: str, path: str, content_snippet: str) -> float:
    """轻量关键词评分 0~10"""
    c = concept.lower()
    t = title.lower()
    p = path.lower()
    s = content_snippet.lower()
    score = 0.0

    if c in t:
        score += 6.0
    else:
        chars = [ch for ch in c if "\u4e00" <= ch <= "\u9fff"]
        hit_chars = sum(1 for ch in chars if ch in t)
        score += min(hit_chars * 0.5, 3.0)
        if c in p:
            score += 4.0
        if c in s:
            score += 2.0
        hit_chars_s = sum(1 for ch in chars if ch in s)
        score += min(hit_chars_s * 0.3, 2.0)

    return min(score, 10.0)


def _fusion_score(keyword_score: float, embedding_sim: float, kw_weight: float = 0.45) -> float:
    """原始分加权融合：keyword 0-10 + embedding 0-1→0-10，范围近似 0-10。"""
    return kw_weight * keyword_score + (1 - kw_weight) * embedding_sim * 10


def _llm_group_titles(titles: list[str], max_groups: int = 4) -> dict[str, list[str]]:
    """调用轻量 LLM 为文档标题列表生成主题分组名，解释'为什么相关'。"""
    env = get_env()
    return get_llm_provider(env=env).group_titles(titles, max_groups=max_groups)


def _post_process_groups(grouped: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """对语义兜底桶做二次拆分：强制用 LLM 主题归纳，不保留泛化兜底标题。"""
    semantic_key = None
    for key in (_default_group_heading(), link_merge.default_group_heading("zh"), "语义相近"):
        if key in grouped:
            semantic_key = key
            break
    if semantic_key is None:
        return grouped
    semantic_items = grouped[semantic_key]

    title_to_item = {r["title"]: r for r in semantic_items}
    llm_groups = _llm_group_titles(list(title_to_item.keys()), max_groups=4)

    if llm_groups:
        new_grouped = {k: v for k, v in grouped.items() if k != semantic_key}
        used_titles = set()
        for theme, titles in llm_groups.items():
            items = [title_to_item[t] for t in titles if t in title_to_item]
            if items:
                new_grouped[theme] = items
                used_titles.update(titles)
        # 强制分配剩余文档：不再保留「语义相近」，塞到最接近的组
        remaining = [r for r in semantic_items if r["title"] not in used_titles]
        if remaining:
            # 把剩余文档分配到已有组中标题数量最多的那个组（兜底策略）
            if new_grouped:
                largest_theme = max(new_grouped.keys(), key=lambda k: len(new_grouped[k]))
                new_grouped[largest_theme].extend(remaining)
            else:
                # 极端情况：如果 LLM 一个主题都没生成出来，按文件夹名兜底
                folder_groups = defaultdict(list)
                for r in remaining:
                    folder = Path(r["path"]).parent.name or ("相关参考" if _ui_language() == "zh" else "Related references")
                    folder_groups[folder].append(r)
                for folder, items in folder_groups.items():
                    new_grouped[folder] = items
        return new_grouped

    # LLM 失败时回退到文件夹分组，但绝不用泛化语义兜底标题
    folder_groups = defaultdict(list)
    for r in semantic_items:
        folder = Path(r["path"]).parent.name or ("相关参考" if _ui_language() == "zh" else "Related references")
        folder_groups[folder].append(r)
    sorted_folders = sorted(folder_groups.items(), key=lambda x: -len(x[1]))
    new_grouped = {k: v for k, v in grouped.items() if k != semantic_key}
    for folder, items in sorted_folders:
        new_grouped[folder] = items
    return new_grouped


def _group_by_concept_hybrid(
    relations: list[dict],
    concepts: list[str],
    concept_embs: list[list[float]],
    vault: Path,
) -> dict[str, list[dict]]:
    """基于 Hybrid (keyword + embedding) 融合分做排他性概念分组。"""
    semantic_heading = _default_group_heading()
    if not concepts:
        return {semantic_heading: relations}

    snippets = {}
    for r in relations:
        note_path = vault / r["path"].replace("/", os.sep)
        if note_path not in snippets:
            try:
                snippets[note_path] = note_path.read_text(encoding="utf-8")[:500].lower()
            except Exception:
                snippets[note_path] = ""

    groups = defaultdict(list)
    assigned = set()

    for r in relations:
        title = r["title"]
        if title in assigned or title.lower().strip() in JUNK_TITLES:
            continue

        best_concept = None
        best_fusion = -1.0
        best_emb_sim = -1.0
        best_kw = -1.0
        note_path = vault / r["path"].replace("/", os.sep)
        snippet = snippets.get(note_path, "")
        for c, c_emb in zip(concepts, concept_embs):
            emb = r.get("embedding")
            emb_sim = _cosine_similarity(emb, c_emb) if emb is not None else 0.0
            kw = _keyword_score(c, title, r["path"], snippet)
            fusion = _fusion_score(kw, emb_sim, kw_weight=0.45)
            if fusion > best_fusion:
                best_fusion = fusion
                best_concept = c
                best_emb_sim = emb_sim
                best_kw = kw

        # 排序与准入拆开：embedding 保语义底线，keyword 保显式命中底线
        emb_floor = float(config.get("fusion.emb_floor", 0.40))
        fusion_floor = float(config.get("fusion.fusion_floor", 3.5))
        kw_floor = float(config.get("fusion.kw_floor", 3.0))
        has_embedding = r.get("embedding") is not None
        if best_concept and (
            (has_embedding and best_emb_sim >= emb_floor and (best_fusion >= fusion_floor or best_kw >= kw_floor))
            or (not has_embedding and best_kw >= kw_floor)
        ):
            groups[best_concept].append(r)
            assigned.add(title)

    semantic = [r for r in relations if r["title"] not in assigned]
    if semantic:
        groups[semantic_heading] = semantic

    ordered = {}
    for c in concepts:
        if c in groups:
            ordered[c] = groups[c]
    if semantic_heading in groups:
        ordered[semantic_heading] = groups[semantic_heading]
    return _post_process_groups(ordered)


# ───────────────────────────────────────────
# 1. 初始化索引
# ───────────────────────────────────────────


def init_index(vault: Optional[Path] = None) -> dict:
    """
    重建 Embedding 索引。
    删除旧缓存后全量重建，复用 _ensure_index_fresh 的逻辑（含清理 + 2000 字符）。

    返回: {"status": "ok" | "error", "message": str, ...}
    """
    vault = Path(vault or detect_vault_path()).expanduser().resolve()
    db = _cache_db()
    try:
        if not embedding_allowed():
            return _ensure_index_fresh(vault)

        ready, ready_message = check_embedding_ready()
        if not ready:
            return {
                "status": "error",
                "network_mode": current_network_mode(),
                "indexing": "unavailable",
                "message": ready_message,
            }

        if db.exists():
            db.unlink()
        return _ensure_index_fresh(vault)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _merge_er_relation_results(base_relations: list[dict], er_relations: list[dict], limit: int) -> list[dict]:
    """Merge one-hop ER results into existing relation recalls without replacing them."""
    merged: dict[str, dict] = {}
    for item in base_relations:
        merged[item["path"]] = item

    for item in er_relations:
        path = item.get("path")
        if not path:
            continue
        if path in merged:
            existing = merged[path]
            existing["similarity"] = max(float(existing.get("similarity") or 0), float(item.get("similarity") or 0))
            existing["er_relation_types"] = item.get("er_relation_types") or []
            existing["er_entities"] = item.get("er_entities") or []
            existing["er_source_entities"] = item.get("er_source_entities") or []
            existing["er_reason"] = item.get("reason") or item.get("er_reason")
            continue
        merged[path] = item

    out = list(merged.values())
    out.sort(key=lambda value: float(value.get("similarity") or 0), reverse=True)
    return out[:limit]


# ───────────────────────────────────────────
# 2. 单篇文档关联发现
# ───────────────────────────────────────────


def discover_relations(
    doc_path: str | Path,
    vault: Optional[Path] = None,
    top_k: int = 15,
    cross_folder_first: bool = True,
    use_llm_concepts: bool = True,
    ensure_index: bool = True,
) -> dict:
    """
    对单篇文档发现关联。
    返回结构化的关联建议报告。

    默认优先返回跨文件夹的关联，因为同文件夹的关联树状目录已经能体现。
    当 use_llm_concepts=True 时，会尝试用 Hybrid (keyword+embedding) 做概念分组。

    AIC-2194: ensure_index=False 时跳过 _ensure_index_fresh，避免全库扫描。
    适用于全量刷新、批量处理等已由独立索引守护覆盖索引新鲜度的场景。
    """
    vault = vault or detect_vault_path()
    network_mode = current_network_mode()
    can_embed = embedding_allowed()
    can_llm = llm_allowed()
    warnings: list[str] = []
    fixes: list[dict] = []
    if ensure_index and can_embed:
        index_report = _ensure_index_fresh(vault)
        if index_report.get("status") != "ok":
            warnings.append(index_report.get("message") or index_report.get("error") or "Embedding index refresh failed.")
    doc = Path(doc_path).expanduser()
    if not doc.is_absolute():
        doc = vault / doc
    doc = doc.resolve()

    if not doc.exists():
        return {"status": "error", "message": f"文档不存在: {doc}"}

    content = doc.read_text(encoding="utf-8")
    clean = _clean_markdown(content)
    text = (doc.stem + "\n" + clean[:2000]).strip()

    # 短文档：利用反向链接扩展上下文，提升 embedding 表征能力
    short_doc_threshold = int(config.get("relations.short_doc_threshold", 300))
    if len(content) < short_doc_threshold:
        rel_posix = str(doc.relative_to(vault)).replace("\\", "/")
        backlinks = _collect_backlinks(doc.stem, vault, rel_posix, max_snippets=3)
        if backlinks:
            text = text + "\n\n被以下文档引用：\n" + "\n".join(backlinks)

    if len(text) < 10:
        return {"status": "error", "message": "文档内容过短"}

    rel_posix = str(doc.relative_to(vault)).replace("\\", "/")
    target_parent = Path(rel_posix).parent.name
    cached_docs = []
    recall_mode = "local-keyword"

    if can_embed:
        try:
            new_emb = _call_embedding_api([text])[0]
            cached_docs = _filter_existing_docs(_load_all_cached_embeddings(), vault)

            # Embedding 召回
            emb_rels = []
            for cached in cached_docs:
                if cached["path"] == rel_posix:
                    continue
                sim = _cosine_similarity(new_emb, cached["embedding"])
                emb_rels.append({"path": cached["path"], "title": cached["title"], "similarity": sim, "embedding": cached["embedding"]})

            emb_rels.sort(key=lambda x: x["similarity"], reverse=True)
            emb_rels = emb_rels[:top_k * 2]

            # Keyword 召回（补充 embedding 盲区）
            kw_rels = _keyword_recall(doc.stem, text, cached_docs, top_n=top_k * 2)

            # 融合两路召回
            relations = _merge_recalls(emb_rels, kw_rels, emb_weight=0.7)
            relations = relations[:top_k * 3]  # 多留一些给 cross_folder 逻辑筛选
            recall_mode = "embedding+keyword"
        except FileNotFoundError as exc:
            fix = _embedding_index_fix(vault)
            fixes.append(fix)
            warnings.append(f"{fix['title']}: {exc}")
            cached_docs = []
            relations = _local_keyword_recall(doc.stem, text, vault, rel_posix, top_n=top_k * 3)
            recall_mode = "local-keyword-fallback"
        except Exception as exc:
            warnings.append(f"Embedding recall unavailable, fell back to local keyword search: {exc}")
            cached_docs = []
            relations = _local_keyword_recall(doc.stem, text, vault, rel_posix, top_n=top_k * 3)
            recall_mode = "local-keyword-fallback"
    else:
        relations = _local_keyword_recall(doc.stem, text, vault, rel_posix, top_n=top_k * 3)

    # ER 权威关系扩展：doc -> mentioned entity -> related entity -> docs
    try:
        from er_bridge_search import er_extend_relations, refresh_doc_entities_for_content

        refresh_doc_entities_for_content(rel_posix, content, vault)
        er_rels = er_extend_relations(rel_posix, vault, top_k=top_k)
        if er_rels:
            cached_by_path = {item["path"]: item for item in cached_docs}
            for er_item in er_rels:
                cached = cached_by_path.get(er_item.get("path"))
                if cached and cached.get("embedding") is not None:
                    er_item["embedding"] = cached["embedding"]
            relations = _merge_er_relation_results(relations, er_rels, limit=top_k * 3)
    except Exception:
        pass

    if cross_folder_first:
        cross = [r for r in relations if Path(r["path"]).parent.name != target_parent]
        same = [r for r in relations if Path(r["path"]).parent.name == target_parent]

        # 收集目标文档中的显式 wikilink 引用（取别名前的部分）
        wiki_links = set()
        for link in re.findall(r"\[\[(.*?)\]\]", content):
            wiki_links.add(link.split("|")[0].strip())

        # 同文件夹中，被显式引用或相似度足够高的视为强关联，必须保留
        same_similarity_threshold = float(config.get("relations.same_similarity_threshold", 0.65))
        same_strong = [
            r for r in same
            if r["title"] in wiki_links or r["similarity"] >= same_similarity_threshold
        ]
        same_weak = [r for r in same if r not in same_strong]

        combined = cross[:top_k]
        # 先补 must-keep 的同文件夹强关联
        for r in same_strong:
            if r not in combined:
                combined.append(r)
        # 再补弱关联
        if len(combined) < top_k:
            combined.extend(same_weak[:top_k - len(combined)])
        # 最终按相似度重排并截断
        combined.sort(key=lambda x: x["similarity"], reverse=True)
        relations = combined[:top_k]
    else:
        relations = relations[:top_k]

    # 过滤 junk titles
    relations = [r for r in relations if r["title"].lower().strip() not in JUNK_TITLES]

    # 概念分组
    grouped = {}
    if use_llm_concepts and can_llm and recall_mode == "embedding+keyword" and relations:
        snippet = content[:300].replace("\n", " ")
        try:
            concepts = _call_llm_extract_concepts(doc.stem, snippet, max_concepts=4)
            if concepts:
                concept_embs = _call_embedding_api(concepts)
                grouped = _group_by_concept_hybrid(relations, concepts, concept_embs, vault)
        except Exception as exc:
            warnings.append(f"LLM concept grouping unavailable: {exc}")
    if not grouped:
        # Fallback: 按文件夹分组，但过滤同文件夹
        grouped = {}
        for r in relations:
            mod = Path(r["path"]).parent.name or "其他"
            if target_parent and mod == target_parent:
                continue
            grouped.setdefault(mod, []).append(r)

    return {
        "status": "ok",
        "network_mode": network_mode,
        "recall_mode": recall_mode,
        "target": rel_posix,
        "target_title": doc.stem,
        "relations": [{k: v for k, v in r.items() if k != "embedding"} for r in relations],
        "grouped": {k: [item["title"] for item in v] for k, v in grouped.items()},
        "warnings": warnings,
        "fixes": fixes,
    }


# ───────────────────────────────────────────
# 3. 批量为孤儿文档创建 wikilink
# ───────────────────────────────────────────


def _find_related_section(content: str) -> int:
    """查找关联区块的起始索引，兼容旧中文标题和当前本地化标题。"""
    for marker in link_merge.HEADERS:
        idx = content.find(marker)
        if idx != -1:
            return idx
    return -1


def _ui_language(language: str | None = None) -> str:
    return link_merge._normalize_language(language)


def _default_group_heading(language: str | None = None) -> str:
    return link_merge.default_group_heading(_ui_language(language))


def _format_block(grouped: dict[str, list[dict]], language: str | None = None) -> str:
    lines = ["", "", link_merge.related_section_heading(_ui_language(language)), ""]
    for dim, items in grouped.items():
        if not items:
            continue
        seen = set()
        deduped = []
        for item in items:
            t = item["title"]
            if t in seen:
                continue
            seen.add(t)
            deduped.append(item)
        if not deduped:
            continue
        lines.append(f"### {dim}")
        lines.append("")
        for item in deduped:
            lines.append(f"[[{item['title']}]]")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding=encoding)
    tmp.replace(path)


def build_orphan_links(
    vault: Optional[Path] = None,
    top_k: int = 15,
    limit: Optional[int] = None,
    dry_run: bool = False,
    use_llm_concepts: bool = True,
    ensure_index: bool = True,
) -> dict:
    """
    扫描 vault 中所有没有 wikilink 的孤立文档，为它们自动创建关联链接区块。

    参数:
        vault:   Obsidian vault 根目录（默认自动检测）
        top_k:   每篇文档最多关联多少篇
        limit:   仅处理前 N 篇（测试用）
        dry_run: True 时只预览不写入
        use_llm_concepts: 是否用 LLM 提取概念做 Hybrid 分组
        ensure_index: AIC-2194: 是否触发索引更新（批量场景可设为 False）

    返回:
        {
            "status": "ok",
            "total_orphans": int,
            "processed": int,
            "details": [
                {"path": str, "links_added": int, "modules": [str], "dry_run": bool},
                ...
            ]
        }
    """
    vault = vault or detect_vault_path()
    network_mode = current_network_mode()
    can_embed = embedding_allowed()
    can_llm = llm_allowed()
    recall_mode = "embedding+keyword" if can_embed else "local-keyword"
    if ensure_index and can_embed:
        _ensure_index_fresh(vault)
    cached_docs = _filter_existing_docs(_load_all_cached_embeddings(), vault) if can_embed else []

    orphans = []
    for f in list_markdown_files(vault):
        try:
            content = f.read_text(encoding="utf-8")
            if not _has_wikilinks(content):
                orphans.append(f)
        except Exception:
            pass

    total = len(orphans)
    if limit:
        orphans = orphans[:limit]

    # batch embedding
    batch_size = int(config.get("embedding.batch_size", 64))
    orphan_embs = {}
    orphan_texts = []
    for f in orphans:
        content = f.read_text(encoding="utf-8")
        clean = _clean_markdown(content)
        text = (f.stem + "\n" + clean[:2000]).strip()
        rel = str(f.relative_to(vault)).replace("\\", "/")
        if len(content) < int(config.get("relations.short_doc_threshold", 300)):
            backlinks = _collect_backlinks(f.stem, vault, rel, max_snippets=3)
            if backlinks:
                text = text + "\n\n被以下文档引用：\n" + "\n".join(backlinks)
        orphan_texts.append({"file": f, "text": text, "keyword_text": clean, "content": content, "rel": rel})

    if can_embed:
        for i in range(0, len(orphan_texts), batch_size):
            batch = orphan_texts[i : i + batch_size]
            embs = _call_embedding_api([b["text"] for b in batch])
            for ot, emb in zip(batch, embs):
                orphan_embs[ot["rel"]] = emb

    details = []
    processed = 0
    for ot in orphan_texts:
        f = ot["file"]
        rel = ot["rel"]
        content = ot["content"]
        keyword_text = ot["keyword_text"]

        if can_embed:
            emb = orphan_embs[rel]

            # Embedding 召回
            emb_rels = []
            for cached in cached_docs:
                if cached["path"] == rel:
                    continue
                sim = _cosine_similarity(emb, cached["embedding"])
                emb_rels.append({"path": cached["path"], "title": cached["title"], "similarity": sim, "embedding": cached["embedding"]})

            emb_rels.sort(key=lambda x: x["similarity"], reverse=True)
            emb_rels = emb_rels[:top_k * 2]

            # Keyword 召回（补充 embedding 盲区）
            kw_rels = _keyword_recall(f.stem, keyword_text, cached_docs, top_n=top_k * 2)

            # 融合两路召回
            relations = _merge_recalls(emb_rels, kw_rels, emb_weight=0.7)
        else:
            relations = _local_keyword_recall(f.stem, ot["text"], vault, rel, top_n=top_k * 2)
        top_relations = relations[:top_k]

        if not top_relations:
            details.append({"path": rel, "links_added": 0, "modules": [], "dry_run": dry_run, "reason": "no_relations"})
            continue

        target_parent = Path(rel).parent.name
        # 保留所有 top 关联（不再过滤同文件夹，让概念分组自然处理）
        relations_to_group = [r for r in top_relations if r["title"].lower().strip() not in JUNK_TITLES]

        if not relations_to_group:
            details.append({"path": rel, "links_added": 0, "modules": [], "dry_run": dry_run, "reason": "no_relations_after_filter"})
            continue

        grouped = {}
        if use_llm_concepts and can_llm:
            snippet = content[:300].replace("\n", " ")
            concepts = _call_llm_extract_concepts(f.stem, snippet, max_concepts=4)
            if concepts:
                concept_embs = _call_embedding_api(concepts)
                grouped = _group_by_concept_hybrid(relations_to_group, concepts, concept_embs, vault)
        if not grouped:
            # Fallback: 按文件夹分组
            for r in relations_to_group:
                mod = Path(r["path"]).parent.name or "其他"
                grouped.setdefault(mod, []).append(r)

        idx = _find_related_section(content)
        if idx != -1:
            body = content[:idx].rstrip()
            # 一并清理掉之前可能留下的 --- 和多余空行
            while body.endswith("---"):
                body = body[:-3].rstrip()
            old_section = content[idx:]
        else:
            body = content.rstrip()
            old_section = ""

        total_links = sum(len(v) for v in grouped.values())
        modules = list(grouped.keys())

        if not dry_run:
            # AIC-2108：哨兵区 + 删除记忆融合，保留用户手动维护的链接（compose 会持久化 tombstone，故仅非 dry_run 调用）
            section, _ = link_merge.compose_related_section(old_section, grouped, rel, vault, doc_body=body)
            new_content = (body.rstrip() + "\n\n" + section) if body.strip() else section
            _atomic_write_text(f, new_content, encoding="utf-8")

        details.append({"path": rel, "links_added": total_links, "modules": modules, "dry_run": dry_run})
        processed += 1

    return {
        "status": "ok",
        "network_mode": network_mode,
        "recall_mode": recall_mode,
        "total_orphans": total,
        "processed": processed,
        "details": details,
    }


# ───────────────────────────────────────────
# 4. 肌肉反应接口 —— 文件变化时自动处理
# ───────────────────────────────────────────


def _grouped_from_report(report: dict) -> dict:
    """从 discover_relations 报告还原 grouped 字典（供 link_merge 融合使用）。"""
    relations = report.get("relations", [])
    relations_to_group = [r for r in relations if r["title"].lower().strip() not in JUNK_TITLES]
    grouped = report.get("grouped", {})
    if grouped:
        title_to_rel = {r["title"]: r for r in relations_to_group}
        gd = {}
        for dim, titles in grouped.items():
            gd[dim] = [title_to_rel[t] for t in titles if t in title_to_rel]
        return gd
    return {_default_group_heading(): relations_to_group}


def _build_link_block(report: dict) -> tuple[str, list[dict], list[str]]:
    """根据 discover_relations 的报告生成关联区块、关联列表和模块列表。"""
    relations = report.get("relations", [])
    relations_to_group = [r for r in relations if r["title"].lower().strip() not in JUNK_TITLES]

    grouped = report.get("grouped", {})
    if grouped:
        title_to_rel = {r["title"]: r for r in relations_to_group}
        grouped_dict = {}
        for dim, titles in grouped.items():
            grouped_dict[dim] = [title_to_rel[t] for t in titles if t in title_to_rel]
        block = _format_block(grouped_dict)
        modules = list(grouped_dict.keys())
    else:
        group_heading = _default_group_heading()
        block = _format_block({group_heading: relations_to_group})
        modules = [group_heading]

    return block, relations_to_group, modules


def _queue_doc_for_relation_refresh(rel_path: str, vault: Path) -> dict:
    """Refresh relation suggestions for a doc affected by an ER entity update."""
    try:
        report = discover_relations(
            rel_path,
            vault=vault,
            top_k=15,
            use_llm_concepts=False,
            ensure_index=False,
        )
        return {"path": rel_path, "status": report.get("status", "unknown")}
    except Exception as exc:
        return {"path": rel_path, "status": "error", "message": str(exc)}


def _sync_er_bridge_for_change(doc: Path, vault: Path, content: str) -> dict:
    """Keep ER entity pages and doc_entities in sync when a markdown file changes."""
    rel = str(doc.relative_to(vault)).replace("\\", "/")
    result: dict[str, Any] = {"doc_entities": None, "entity_page": None, "affected_docs": [], "refresh": []}

    try:
        from er_vault_ops import sync_single_entity_page

        entity_result = sync_single_entity_page(doc, vault)
        result["entity_page"] = entity_result
    except Exception as exc:
        entity_result = {"status": "error", "message": str(exc)}
        result["entity_page"] = entity_result

    try:
        from er_bridge_search import refresh_doc_entities_for_content

        result["doc_entities"] = refresh_doc_entities_for_content(rel, content, vault)
    except Exception as exc:
        result["doc_entities"] = {"status": "error", "message": str(exc)}

    try:
        entity_id = result["entity_page"].get("entity_id") if isinstance(result.get("entity_page"), dict) else None
        if result["entity_page"].get("status") in {"created", "updated"} and entity_id is not None:
            from er_change_propagator import get_docs_affected_by_entity_change

            affected = [item for item in get_docs_affected_by_entity_change(int(entity_id), vault) if item != rel]
            result["affected_docs"] = affected
            result["refresh"] = [_queue_doc_for_relation_refresh(item, vault) for item in affected[:10]]
    except Exception as exc:
        result["entity_page"] = {"status": "error", "message": str(exc)}

    return result


def on_file_changed(doc_path: str | Path, vault: Optional[Path] = None, auto_write: bool = False) -> dict:
    """
    当 vault 中某个文件发生变化（新建或保存）时，自动判断是否需要关联处理。

    逻辑:
        1. 如果文档已有 wikilink -> 跳过（认为用户已手动维护链接）
        2. 如果文档没有 wikilink -> 自动跑 discover_relations 并返回建议
        3. 如果 auto_write=True -> 直接在文末追加关联链接区块

    参数:
        doc_path:   变化的文档路径
        vault:      vault 根目录
        auto_write: 是否自动把建议写回原文档（默认 False，Agent 可先审后写）

    返回:
        {"status": "ok" | "skipped" | "error", ...}
    """
    vault = vault or detect_vault_path()
    doc = Path(doc_path).expanduser()
    if not doc.is_absolute():
        doc = vault / doc
    doc = doc.resolve()

    if not doc.exists():
        return {"status": "error", "message": f"文档不存在: {doc}"}

    try:
        content = doc.read_text(encoding="utf-8")
    except Exception as exc:
        return {"status": "error", "message": str(exc)}

    er_bridge = _sync_er_bridge_for_change(doc, vault, content)

    if _has_wikilinks(content):
        return {
            "status": "skipped",
            "reason": "文档已包含 wikilink，跳过自动追加关联区块",
            "path": str(doc.relative_to(vault)),
            "er_bridge": er_bridge,
        }

    if _find_related_section(content) != -1:
        return {
            "status": "skipped",
            "reason": "文档已包含关联文件区块",
            "path": str(doc.relative_to(vault)),
            "er_bridge": er_bridge,
        }

    report = discover_relations(doc, vault=vault, top_k=15, use_llm_concepts=True)
    if report.get("status") != "ok":
        return report

    block, relations_to_group, modules = _build_link_block(report)
    if not relations_to_group:
        return {
            "status": "skipped",
            "reason": "未找到关联文档",
            "path": str(doc.relative_to(vault)),
            "er_bridge": er_bridge,
            "warnings": report.get("warnings", []),
            "fixes": report.get("fixes", []),
        }

    if auto_write:
        # on_file_changed 前面已确保无现有区块；AIC-2108：用哨兵区写入并登记 last_auto
        body = content.rstrip()
        rel = str(doc.relative_to(vault)).replace("\\", "/")
        grouped = _grouped_from_report(report)
        section, _ = link_merge.compose_related_section("", grouped, rel, vault, doc_body=body)
        new_content = (body.rstrip() + "\n\n" + section) if body.strip() else section
        _atomic_write_text(doc, new_content, encoding="utf-8")

    return {
        "status": "ok",
        "network_mode": report.get("network_mode"),
        "recall_mode": report.get("recall_mode"),
        "path": str(doc.relative_to(vault)),
        "auto_write": auto_write,
        "relations_count": len(relations_to_group),
        "relations": relations_to_group,
        "grouped": report.get("grouped", {}),
        "modules": modules,
        "suggested_block": block if not auto_write else None,
        "er_bridge": er_bridge,
        "warnings": report.get("warnings", []),
        "fixes": report.get("fixes", []),
    }


def refresh_relations(doc_path: str | Path, vault: Optional[Path] = None, auto_write: bool = False) -> dict:
    """
    AIC-2189 + AIC-2191: 为已有文档刷新关联区块（无视现有 wikilink/关联区块）。

    与 on_file_changed 的区别：
    - 不检查 _has_wikilinks（允许已有手动链接的文档也获得自动关联）
    - 不检查 _find_related_section（允许替换/更新已有的关联区块）
    - AIC-2191: 检查内容 hash，未变更则跳过（节省 API 调用）
    - 如果文档已有 ## 🏷️关联文件 区块，会替换为最新发现的结果

    参数:
        doc_path:   文档路径
        vault:      vault 根目录
        auto_write: 是否自动写回文件（默认 False）

    返回:
        {"status": "ok" | "skipped" | "error", ...}
    """
    vault = Path(vault or detect_vault_path()).expanduser().resolve()
    doc = Path(doc_path).expanduser()
    if not doc.is_absolute():
        doc = vault / doc
    doc = doc.resolve()

    if not doc.exists():
        return {"status": "error", "message": f"文档不存在: {doc}"}

    try:
        content = doc.read_text(encoding="utf-8")
    except Exception as exc:
        return {"status": "error", "message": str(exc)}

    er_bridge = _sync_er_bridge_for_change(doc, vault, content)

    # AIC-2191: 内容 hash 变化检测
    rel_path = str(doc.relative_to(vault)).replace("\\", "/")
    current_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    refresh_state = _load_refresh_state()
    last_hash = refresh_state.get(rel_path, {}).get("hash")

    if last_hash is not None and last_hash == current_hash:
        # 内容未变，跳过 API 调用
        warnings, fixes = _embedding_index_missing_guidance(vault)
        return {
            "status": "skipped",
            "reason": "文档内容未变更，跳过刷新",
            "path": rel_path,
            "unchanged": True,
            "er_bridge": er_bridge,
            "network_mode": current_network_mode(),
            "warnings": warnings,
            "fixes": fixes,
        }

    report = discover_relations(doc, vault=vault, top_k=15, use_llm_concepts=True, ensure_index=False)
    if report.get("status") != "ok":
        report["er_bridge"] = er_bridge
        return report

    block, relations_to_group, modules = _build_link_block(report)
    if not relations_to_group:
        # 即使未找到关联，也更新 hash（避免下次重复检查）
        refresh_state[rel_path] = {"hash": current_hash, "time": doc.stat().st_mtime}
        _save_refresh_state(refresh_state)
        return {
            "status": "skipped",
            "reason": "未找到关联文档",
            "path": rel_path,
            "network_mode": report.get("network_mode"),
            "recall_mode": report.get("recall_mode"),
            "er_bridge": er_bridge,
            "warnings": report.get("warnings", []),
            "fixes": report.get("fixes", []),
        }

    replaced = False
    if auto_write:
        idx = _find_related_section(content)
        if idx != -1:
            # 替换旧区块，一并清理可能残留的 --- 分隔线
            body = content[:idx].rstrip()
            while body.endswith("---"):
                body = body[:-3].rstrip()
            old_section = content[idx:]
            replaced = True
        else:
            # 在文末追加
            body = content.rstrip()
            old_section = ""
        # AIC-2108：哨兵区 + 删除记忆融合，保留用户手动维护的链接
        grouped = _grouped_from_report(report)
        section, _ = link_merge.compose_related_section(old_section, grouped, rel_path, vault, doc_body=body)
        new_content = (body.rstrip() + "\n\n" + section) if body.strip() else section
        _atomic_write_text(doc, new_content, encoding="utf-8")

    # AIC-2191: 更新刷新状态
    refresh_state[rel_path] = {"hash": current_hash, "time": doc.stat().st_mtime}
    _save_refresh_state(refresh_state)

    return {
        "status": "ok",
        "network_mode": report.get("network_mode"),
        "recall_mode": report.get("recall_mode"),
        "path": rel_path,
        "auto_write": auto_write,
        "replaced": replaced,
        "relations_count": len(relations_to_group),
        "relations": relations_to_group,
        "grouped": report.get("grouped", {}),
        "modules": modules,
        "suggested_block": block if not auto_write else None,
        "er_bridge": er_bridge,
        "warnings": report.get("warnings", []),
        "fixes": report.get("fixes", []),
    }


# ───────────────────────────────────────────
# Graphify AI 层桥接（新增，向后兼容：不改任何既有函数签名）
# 这些是高层封装，委托 vault 内 .understory/scripts/ 的独立模块执行。
# ───────────────────────────────────────────

_KG_SCRIPT_PATH = Path(__file__).resolve().parent


def _get_vault_graphify_dir(vault: Path) -> Path:
    return vault / ".understory"


def init_graphify(vault: Optional[Path] = None) -> dict:
    """部署 / 校验 vault 内 .understory AI 隐藏层骨架（幂等）。"""
    vault = vault or detect_vault_path()
    vault = Path(vault)
    import subprocess
    deploy = _KG_SCRIPT_PATH / "scripts" / "deploy_graphify.py"
    try:
        result = subprocess.run(
            [sys.executable, str(deploy), "--vault", str(vault)],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        return json.loads(result.stdout) if result.stdout.strip() else {
            "status": "error", "message": result.stderr[:300]}
    except Exception as e:
        return {"status": "error", "message": f"{type(e).__name__}: {e}"}


def _run_graphify_script(script_name: str, args: list[str], vault: Path, timeout: int = 1800) -> dict:
    """通用：运行 .understory/scripts/ 下的脚本并解析 JSON 输出。"""
    import subprocess
    script = _get_vault_graphify_dir(vault) / "scripts" / script_name
    if not script.exists():
        init_graphify(vault)
    if not script.exists():
        return {"status": "error", "message": f"script missing: {script_name}"}
    try:
        result = subprocess.run(
            [sys.executable, str(script), *args],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        out = result.stdout.strip()
        if out:
            try:
                return json.loads(out.splitlines()[-1])
            except json.JSONDecodeError:
                return {"status": "ok", "raw": out[-500:]}
        return {"status": "error", "message": result.stderr[:300]}
    except Exception as e:
        return {"status": "error", "message": f"{type(e).__name__}: {e}"}


def ingest_principles_for_doc(doc_path: str | Path, vault: Optional[Path] = None) -> dict:
    """对单篇文档执行原则提取（L2，供插件/Agent 调用）。"""
    vault = Path(vault or detect_vault_path())
    return _run_graphify_script("ingest_principles.py",
                                [str(doc_path), "--vault", str(vault)], vault, timeout=180)


def lint_vault_for_conflicts(vault: Optional[Path] = None, fix: bool = False) -> dict:
    """全库冲突检测（L3）。fix=True 时清理死链。"""
    vault = Path(vault or detect_vault_path())
    args = ["--vault", str(vault)] + (["--fix"] if fix else [])
    return _run_graphify_script("lint.py", args, vault)


def analyze_graph(vault: Optional[Path] = None) -> dict:
    """社区聚类 + god node 图分析（L4，离线复用 embedding 缓存）。"""
    vault = Path(vault or detect_vault_path())
    return _run_graphify_script("graph_analyzer.py", ["--vault", str(vault)], vault)


def generate_ai_index(vault: Optional[Path] = None) -> dict:
    """生成 .understory/index.md AI 知识索引（L5）。"""
    vault = Path(vault or detect_vault_path())
    return _run_graphify_script("index_generator.py", ["--vault", str(vault)], vault)


def run_full_maintenance(vault: Optional[Path] = None, fix: bool = True) -> dict:
    """一键全量维护：lint → 图分析 → 索引 → 通知摘要。"""
    vault = Path(vault or detect_vault_path())
    init_graphify(vault)
    return {
        "status": "ok",
        "lint": lint_vault_for_conflicts(vault, fix=fix),
        "graph": analyze_graph(vault),
        "index": generate_ai_index(vault),
        "notify": _run_graphify_script("notification_manager.py", ["--vault", str(vault)], vault),
    }


def accept_supersede(older_id: int, newer_id: int, vault: Optional[Path] = None) -> dict:
    """
    用户显式采纳"版本演进"（时序记忆）：把旧原则标记为被新原则取代。
    仅在用户主动调用时才改库（lint 绝不自动执行）。
    - principles: older.superseded_by=newer_id + 软删；newer.version 提升
    - conflicts.json 中对应 evolution 冲突标记 resolved
    """
    from datetime import datetime as _dt
    vault = Path(vault or detect_vault_path())
    gdir = _get_vault_graphify_dir(vault)
    db = gdir / "principles.sqlite"
    if not db.exists():
        init_graphify(vault)
    if not db.exists():
        return {"status": "error", "message": "principles.sqlite 不存在"}
    now = _dt.now().astimezone().replace(microsecond=0).isoformat()
    conn = sqlite3.connect(str(db))
    try:
        cur = conn.cursor()
        ro = cur.execute("SELECT version FROM principles WHERE id=?", (older_id,)).fetchone()
        rn = cur.execute("SELECT version FROM principles WHERE id=?", (newer_id,)).fetchone()
        if not ro or not rn:
            return {"status": "error", "message": "原则 ID 不存在"}
        new_ver = max((rn[0] or 1), (ro[0] or 1) + 1)
        cur.execute("UPDATE principles SET superseded_by=?, deleted_at=? WHERE id=?",
                    (newer_id, now, older_id))
        cur.execute("UPDATE principles SET version=? WHERE id=?", (new_ver, newer_id))
        conn.commit()
    finally:
        conn.close()
    # 标记对应 evolution 冲突为 resolved
    resolved = None
    cpath = gdir / "conflicts.json"
    if cpath.exists():
        try:
            data = json.loads(cpath.read_text(encoding="utf-8"))
            for it in data.get("issues", []):
                pids = {it.get("principle_a_id"), it.get("principle_b_id"),
                        it.get("older_principle_id"), it.get("newer_principle_id")}
                if older_id in pids and newer_id in pids:
                    it["status"] = "resolved"
                    it["resolved_at"] = now
                    it["resolution"] = "用户采纳版本演进（superseded）"
                    resolved = it.get("id")
            cpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except (json.JSONDecodeError, OSError):
            pass
    return {"status": "ok", "older_id": older_id, "newer_id": newer_id,
            "new_version": new_ver, "resolved_conflict": resolved}


# ───────────────────────────────────────────
# ER 权威结构层 API
# ───────────────────────────────────────────


def _default_er_db_path() -> Path:
    from er_models import get_er_db_path

    return get_er_db_path(ROOT)


def _default_er_schema_path() -> Path:
    return ROOT / "er_schema.yaml"


def _load_er_schema_for_validation(db_path: Path | str | None = None) -> dict:
    from er_schema import load_schema, load_schema_from_db

    schema_path = _default_er_schema_path()
    if schema_path.exists():
        return load_schema(schema_path)
    if db_path:
        cached = load_schema_from_db(db_path)
        if cached:
            return cached
    raise FileNotFoundError(f"ER schema not found: {schema_path}")


def _parse_json_mapping(value: str | dict | None) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    data = json.loads(value)
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object")
    return data


def _entity_to_dict(entity) -> dict:
    return {
        "id": entity.id,
        "er_id": entity.er_id,
        "name": entity.name,
        "type": entity.type,
        "attributes": entity.attributes,
        "description": entity.description,
        "aliases": entity.aliases,
        "disambiguation_context": entity.disambiguation_context,
        "source_doc": entity.source_doc,
        "embedding_id": entity.embedding_id,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
    }


def _relation_to_dict(relation) -> dict:
    return {
        "id": relation.id,
        "from_entity_id": relation.from_entity_id,
        "to_entity_id": relation.to_entity_id,
        "relation_type": relation.relation_type,
        "attributes": relation.attributes,
        "confidence": relation.confidence,
        "source": relation.source,
        "created_at": relation.created_at,
        "updated_at": relation.updated_at,
    }


def init_er_index(vault_root: str | Path) -> str:
    """Initialize .understory/er.sqlite for a vault and cache er_schema.yaml."""
    from er_models import get_er_db_path, init_er_database
    from er_schema import load_schema, save_schema_to_db

    vault = Path(vault_root).expanduser().resolve()
    db_path = init_er_database(get_er_db_path(vault))
    schema_path = ROOT / "er_schema.yaml"
    if schema_path.exists():
        schema = load_schema(schema_path)
        save_schema_to_db(schema, db_path)
    return str(db_path)


def add_entity(
    name: str,
    entity_type: str,
    er_id: Optional[str] = None,
    attributes: Optional[dict[str, Any]] = None,
    description: str = "",
    aliases: Optional[list[str]] = None,
    source: str = "api",
    source_doc: Optional[str] = None,
    db_path: Optional[str | Path] = None,
) -> int:
    """Create or update an authoritative entity and return its ID."""
    from er_models import Entity, EntityDAO
    from er_schema import validate_entity

    db = Path(db_path) if db_path else _default_er_db_path()
    schema = _load_er_schema_for_validation(db)
    entity_data = {
        "name": name,
        "type": entity_type,
        "attributes": attributes or {},
    }
    valid, errors = validate_entity(entity_data, schema)
    if not valid:
        raise ValueError("; ".join(errors))

    dao = EntityDAO(db)
    existing = dao.get_by_er_id(er_id) if er_id else None
    if existing is None:
        existing = dao.get_by_name_and_type(name, entity_type)
    entity = Entity(
        id=existing.id if existing else None,
        er_id=er_id,
        name=name,
        type=entity_type,
        attributes=attributes or {},
        description=description,
        aliases=aliases or [],
        source_doc=source_doc,
    )
    if existing:
        dao.update(entity)
        return int(existing.id)
    return dao.create(entity)


def get_entity(
    entity_id: Optional[int] = None,
    er_id: Optional[str] = None,
    name: Optional[str] = None,
    entity_type: Optional[str] = None,
    db_path: Optional[str | Path] = None,
):
    """Query entities by id, er_id, or name/type."""
    from er_models import EntityDAO

    dao = EntityDAO(Path(db_path) if db_path else _default_er_db_path())
    if entity_id is not None:
        return dao.get_by_id(entity_id)
    if er_id:
        return dao.get_by_er_id(er_id)
    if name:
        return dao.get_by_name(name, entity_type)
    return None


def update_entity(entity_id: int, db_path: Optional[str | Path] = None, **kwargs) -> bool:
    """Update an entity by applying keyword fields from the Entity dataclass."""
    from er_models import EntityDAO

    dao = EntityDAO(Path(db_path) if db_path else _default_er_db_path())
    entity = dao.get_by_id(entity_id)
    if entity is None:
        return False
    for key, value in kwargs.items():
        if hasattr(entity, key):
            setattr(entity, key, value)
    return dao.update(entity)


def delete_entity(entity_id: int, db_path: Optional[str | Path] = None) -> bool:
    """Delete an entity and cascade authoritative relations."""
    from er_models import EntityDAO

    return EntityDAO(Path(db_path) if db_path else _default_er_db_path()).delete(entity_id)


def list_entities(entity_type: Optional[str] = None, db_path: Optional[str | Path] = None) -> list:
    """List entities, optionally filtered by entity type."""
    from er_models import EntityDAO

    return EntityDAO(Path(db_path) if db_path else _default_er_db_path()).list_all(entity_type)


def search_entities(keyword: str, db_path: Optional[str | Path] = None) -> list:
    """Search entities by name, er_id, or aliases."""
    from er_models import EntityDAO

    return EntityDAO(Path(db_path) if db_path else _default_er_db_path()).search(keyword)


def _resolve_entity_ref(ref: int | str, dao) -> Any:
    if isinstance(ref, int):
        entity = dao.get_by_id(ref)
        if entity is None:
            raise ValueError(f"Entity not found by id: {ref}")
        return entity
    entity = dao.get_by_er_id(ref)
    if entity:
        return entity
    matches = dao.get_by_name(ref)
    if not matches:
        raise ValueError(f"Entity not found: {ref}")
    if len(matches) > 1:
        names = ", ".join(f"{item.name}({item.type}, id={item.id})" for item in matches)
        raise ValueError(f"Ambiguous entity name {ref}: {names}. Use er_id instead.")
    return matches[0]


def add_relation(
    from_entity: int | str,
    to_entity: int | str,
    relation_type: str,
    attributes: Optional[dict[str, Any]] = None,
    source: str = "api",
    db_path: Optional[str | Path] = None,
) -> int:
    """Create an authoritative relation and return its ID."""
    from er_models import EntityDAO, Relation, RelationDAO
    from er_schema import validate_relation

    db = Path(db_path) if db_path else _default_er_db_path()
    entity_dao = EntityDAO(db)
    from_obj = _resolve_entity_ref(from_entity, entity_dao)
    to_obj = _resolve_entity_ref(to_entity, entity_dao)
    schema = _load_er_schema_for_validation(db)
    valid, errors = validate_relation(
        {
            "relation_type": relation_type,
            "from_type": from_obj.type,
            "to_type": to_obj.type,
        },
        schema,
    )
    if not valid:
        raise ValueError("; ".join(errors))
    return RelationDAO(db).create(
        Relation(
            from_entity_id=int(from_obj.id),
            to_entity_id=int(to_obj.id),
            relation_type=relation_type,
            attributes=attributes or {},
            source=source,
        )
    )


def get_entity_neighbors(
    entity_id: int,
    relation_type: Optional[str] = None,
    direction: str = "both",
    db_path: Optional[str | Path] = None,
) -> list[dict]:
    """Return neighboring ER entities around an entity."""
    from er_models import RelationDAO

    return RelationDAO(Path(db_path) if db_path else _default_er_db_path()).get_neighbors(
        entity_id,
        relation_type=relation_type,
        direction=direction,
    )


def query_entity_paths(
    start_entity_id: int,
    depth: int = 1,
    relation_type: Optional[str] = None,
    db_path: Optional[str | Path] = None,
) -> list[dict]:
    """Query the ER relation network around an entity up to depth."""
    from er_models import RelationDAO

    return RelationDAO(Path(db_path) if db_path else _default_er_db_path()).path_query(
        start_entity_id,
        depth=depth,
        relation_type=relation_type,
    )


def delete_relation(relation_id: int, db_path: Optional[str | Path] = None) -> bool:
    """Delete an authoritative relation."""
    from er_models import RelationDAO

    return RelationDAO(Path(db_path) if db_path else _default_er_db_path()).delete(relation_id)


def sync_entities_from_vault(
    vault_path: str | Path,
    db_path: Optional[str | Path] = None,
    schema_path: Optional[str | Path] = None,
    path_patterns: Optional[list[str]] = None,
) -> dict:
    """Sync Obsidian entity pages into er.sqlite."""
    from er_vault_ops import sync_entities_from_vault as _sync

    return _sync(vault_path, db_path=db_path, schema_path=schema_path, path_patterns=path_patterns)


def get_current_schema(db_path: Optional[str | Path] = None) -> dict:
    """Return the active ER schema from er_schema.yaml or cached DB schema."""
    return _load_er_schema_for_validation(Path(db_path) if db_path else _default_er_db_path())


def reload_schema(yaml_path: str | Path, db_path: Optional[str | Path] = None) -> bool:
    """Reload ER schema YAML and save it into er.sqlite."""
    from er_schema import invalidate_cache, load_schema, save_schema_to_db

    db = Path(db_path) if db_path else _default_er_db_path()
    invalidate_cache()
    schema = load_schema(yaml_path)
    save_schema_to_db(schema, db)
    return True


# ───────────────────────────────────────────
# CLI 入口
# ───────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="understory-graphify-engine CLI")
    sub = parser.add_subparsers(dest="cmd")

    # auto-link: 为单篇文档自动发现关联
    link_parser = sub.add_parser("auto-link", help="Auto-link a single note")
    link_parser.add_argument("doc_path", help="Absolute or relative path to the markdown note")
    link_parser.add_argument("--auto-write", action=argparse.BooleanOptionalAction, default=True, help="Write the link block to the file")
    link_parser.add_argument("--vault", default=None, help="Vault root path (auto-detected if omitted)")

    # refresh-link: 刷新单篇文档的关联区块（AIC-2189）
    refresh_parser = sub.add_parser("refresh-link", help="Refresh link block for an existing note")
    refresh_parser.add_argument("doc_path", help="Absolute or relative path to the markdown note")
    refresh_parser.add_argument("--auto-write", action=argparse.BooleanOptionalAction, default=True, help="Write the refreshed link block to the file")
    refresh_parser.add_argument("--vault", default=None, help="Vault root path (auto-detected if omitted)")

    # init: 初始化索引
    init_parser = sub.add_parser("init", help="Initialize or update the embedding index")
    init_parser.add_argument("--vault", default=None, help="Vault root path")

    # embedding-status: 查询语义索引状态，不构建索引
    status_parser = sub.add_parser("embedding-status", help="Show semantic embedding/index readiness")
    status_parser.add_argument("--vault", default=None, help="Vault root path")

    # orphan-links: 为孤儿笔记批量建联
    orphan_parser = sub.add_parser("orphan-links", help="Build links for orphan notes (no wikilinks)")
    orphan_parser.add_argument("--vault", default=None, help="Vault root path")
    orphan_parser.add_argument("--top-k", type=int, default=15, help="Max links per note")
    orphan_parser.add_argument("--limit", type=int, default=None, help="Process only first N orphans")
    orphan_parser.add_argument("--dry-run", action="store_true", help="Preview only, don't write")
    orphan_parser.add_argument("--no-ensure-index", dest="ensure_index", action="store_false", default=True, help="Skip embedding index update")

    # ER: 初始化独立实体-关系数据库
    er_init_parser = sub.add_parser("er-init", help="Initialize ER database")
    er_init_parser.add_argument("--vault", default=".", help="Vault root path")

    # ER: 添加/更新实体
    er_add_entity_parser = sub.add_parser("er-add-entity", help="Add or update an ER entity")
    er_add_entity_parser.add_argument("--vault", default=".", help="Vault root path")
    er_add_entity_parser.add_argument("--name", required=True, help="Entity display name")
    er_add_entity_parser.add_argument("--type", required=True, dest="entity_type", help="Entity type from er_schema.yaml")
    er_add_entity_parser.add_argument("--er-id", default=None, help="Stable entity id")
    er_add_entity_parser.add_argument("--attrs", default="{}", help="JSON attributes")
    er_add_entity_parser.add_argument("--description", default="", help="Entity description")
    er_add_entity_parser.add_argument("--aliases", default="", help="Comma-separated aliases")
    er_add_entity_parser.add_argument("--source", default="api", help="Source label")

    # ER: 添加权威关系
    er_add_relation_parser = sub.add_parser("er-add-relation", help="Add an authoritative ER relation")
    er_add_relation_parser.add_argument("--vault", default=".", help="Vault root path")
    er_add_relation_parser.add_argument("--from", required=True, dest="from_entity", help="From entity name, er_id, or id")
    er_add_relation_parser.add_argument("--to", required=True, dest="to_entity", help="To entity name, er_id, or id")
    er_add_relation_parser.add_argument("--type", required=True, dest="relation_type", help="Relation type from er_schema.yaml")
    er_add_relation_parser.add_argument("--attrs", default="{}", help="JSON attributes")
    er_add_relation_parser.add_argument("--source", default="api", help="Source label")

    # ER: 列表和查询
    er_list_parser = sub.add_parser("er-list", help="List ER entities")
    er_list_parser.add_argument("--vault", default=".", help="Vault root path")
    er_list_parser.add_argument("--type", dest="entity_type", default=None, help="Filter by entity type")

    er_query_parser = sub.add_parser("er-query", help="Query an entity relation network")
    er_query_parser.add_argument("name", help="Entity name or er_id")
    er_query_parser.add_argument("--vault", default=".", help="Vault root path")
    er_query_parser.add_argument("--depth", type=int, default=1, help="Relation depth")
    er_query_parser.add_argument("--type", dest="entity_type", default=None, help="Entity type for disambiguation")

    er_schema_parser = sub.add_parser("er-schema", help="Show current ER schema summary")
    er_schema_parser.add_argument("--vault", default=".", help="Vault root path")

    args = parser.parse_args()

    if args.cmd == "er-init":
        try:
            db_path = init_er_index(Path(args.vault))
            print(json.dumps({"status": "ok", "db_path": db_path}, ensure_ascii=False, indent=2))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False, indent=2))
            sys.exit(1)

    elif args.cmd == "er-add-entity":
        try:
            from er_models import get_er_db_path

            vault = Path(args.vault).expanduser().resolve()
            db_path = get_er_db_path(vault)
            init_er_index(vault)
            aliases = [item.strip() for item in args.aliases.split(",") if item.strip()]
            entity_id = add_entity(
                name=args.name,
                entity_type=args.entity_type,
                er_id=args.er_id,
                attributes=_parse_json_mapping(args.attrs),
                description=args.description,
                aliases=aliases,
                source=args.source,
                db_path=db_path,
            )
            entity = get_entity(entity_id=entity_id, db_path=db_path)
            print(json.dumps({"status": "ok", "entity": _entity_to_dict(entity)}, ensure_ascii=False, indent=2))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False, indent=2))
            sys.exit(1)

    elif args.cmd == "er-add-relation":
        try:
            from er_models import get_er_db_path

            vault = Path(args.vault).expanduser().resolve()
            db_path = get_er_db_path(vault)
            init_er_index(vault)
            from_ref = int(args.from_entity) if str(args.from_entity).isdigit() else args.from_entity
            to_ref = int(args.to_entity) if str(args.to_entity).isdigit() else args.to_entity
            relation_id = add_relation(
                from_entity=from_ref,
                to_entity=to_ref,
                relation_type=args.relation_type,
                attributes=_parse_json_mapping(args.attrs),
                source=args.source,
                db_path=db_path,
            )
            from er_models import RelationDAO

            relation = RelationDAO(db_path).get_by_id(relation_id)
            print(json.dumps({"status": "ok", "relation": _relation_to_dict(relation)}, ensure_ascii=False, indent=2))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False, indent=2))
            sys.exit(1)

    elif args.cmd == "er-list":
        try:
            from er_models import get_er_db_path

            vault = Path(args.vault).expanduser().resolve()
            db_path = get_er_db_path(vault)
            init_er_index(vault)
            entities = [_entity_to_dict(entity) for entity in list_entities(args.entity_type, db_path=db_path)]
            print(json.dumps({"status": "ok", "entities": entities}, ensure_ascii=False, indent=2))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False, indent=2))
            sys.exit(1)

    elif args.cmd == "er-query":
        try:
            from er_models import get_er_db_path

            vault = Path(args.vault).expanduser().resolve()
            db_path = get_er_db_path(vault)
            init_er_index(vault)
            entity = get_entity(er_id=args.name, db_path=db_path)
            if entity is None:
                matches = get_entity(name=args.name, entity_type=args.entity_type, db_path=db_path)
                if not matches:
                    raise ValueError(f"Entity not found: {args.name}")
                if len(matches) > 1:
                    raise ValueError(f"Ambiguous entity name: {args.name}. Use --type or er_id.")
                entity = matches[0]
            paths = query_entity_paths(entity.id, depth=args.depth, db_path=db_path)
            payload = {
                "status": "ok",
                "entity": _entity_to_dict(entity),
                "paths": [
                    {
                        "depth": item["depth"],
                        "direction": item["direction"],
                        "relation": _relation_to_dict(item["relation"]),
                        "entity": _entity_to_dict(item["entity"]),
                    }
                    for item in paths
                ],
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False, indent=2))
            sys.exit(1)

    elif args.cmd == "er-schema":
        try:
            from er_models import get_er_db_path

            vault = Path(args.vault).expanduser().resolve()
            db_path = get_er_db_path(vault)
            init_er_index(vault)
            schema = get_current_schema(db_path=db_path)
            payload = {
                "status": "ok",
                "version": schema.get("version"),
                "entity_types": sorted((schema.get("entity_types") or {}).keys()),
                "relation_types": sorted((schema.get("relation_types") or {}).keys()),
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"{type(e).__name__}: {e}"}, ensure_ascii=False, indent=2))
            sys.exit(1)

    elif args.cmd == "auto-link":
        try:
            vault_path = Path(args.vault) if args.vault else None
            result = on_file_changed(args.doc_path, vault=vault_path, auto_write=args.auto_write)
            print(json.dumps(result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(0 if result.get("status") in ("ok", "skipped") else 1)
        except Exception as e:
            error_result = {
                "status": "error",
                "message": f"{type(e).__name__}: {str(e)}",
                "error_type": type(e).__name__,
                "error_detail": str(e)
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(1)

    elif args.cmd == "refresh-link":
        try:
            vault_path = Path(args.vault) if args.vault else None
            result = refresh_relations(args.doc_path, vault=vault_path, auto_write=args.auto_write)
            print(json.dumps(result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(0 if result.get("status") in ("ok", "skipped") else 1)
        except Exception as e:
            error_result = {
                "status": "error",
                "message": f"{type(e).__name__}: {str(e)}",
                "error_type": type(e).__name__,
                "error_detail": str(e)
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(1)

    elif args.cmd == "init":
        try:
            vault_path = Path(args.vault) if args.vault else None
            result = init_index(vault=vault_path)
            print(json.dumps(result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(0 if result.get("status") == "ok" else 1)
        except Exception as e:
            error_result = {
                "status": "error",
                "message": f"{type(e).__name__}: {str(e)}",
                "error_type": type(e).__name__,
                "error_detail": str(e)
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(1)

    elif args.cmd == "embedding-status":
        try:
            vault_path = Path(args.vault) if args.vault else None
            result = embedding_status(vault=vault_path)
            print(json.dumps(result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(0 if result.get("status") in ("ok", "warning") else 1)
        except Exception as e:
            error_result = {
                "status": "error",
                "message": f"{type(e).__name__}: {str(e)}",
                "error_type": type(e).__name__,
                "error_detail": str(e)
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(1)

    elif args.cmd == "orphan-links":
        try:
            vault_path = Path(args.vault) if args.vault else None
            result = build_orphan_links(
                vault=vault_path,
                top_k=args.top_k,
                limit=args.limit,
                dry_run=args.dry_run,
                ensure_index=args.ensure_index,
            )
            print(json.dumps(result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(0 if result.get("status") == "ok" else 1)
        except Exception as e:
            error_result = {
                "status": "error",
                "message": f"{type(e).__name__}: {str(e)}",
                "error_type": type(e).__name__,
                "error_detail": str(e)
            }
            print(json.dumps(error_result, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(1)

    else:
        parser.print_help()
        sys.exit(1)
