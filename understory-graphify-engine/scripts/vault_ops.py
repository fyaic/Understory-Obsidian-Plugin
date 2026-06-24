#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from config import config  # noqa: F401 - importing config centralizes .env loading

DEFAULT_VAULT = os.path.expanduser("~/Documents/AIC-000")
DEFAULT_REPO = os.path.expanduser("~/Projects/obsidian-remote")
NOISY_PATH_KEYWORDS = (
    "linear issues/",
    "daily",
    "日报",
    "晨会",
    "untitled",
    ".understory/",
    ".obsidian/",
)
PRIORITY_PATH_KEYWORDS = (
    "obsidian-remote",
    "openclaw",
    "skills/",
    "skill",
    "share",
    "安全方案",
    "分享方案",
)
STOP_TERMS = {
    "的",
    "了",
    "和",
    "与",
    "及",
    "并",
    "方案",
    "问题",
    "怎么",
    "如何",
    "什么",
    "一个",
    "一下",
}

# 可选 Hybrid 模块
try:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from hybrid_search import hybrid_search, build_hybrid_search_results
    from embedding_index import EmbeddingIndex, check_embedding_ready, _clean_markdown

    _HYBRID_AVAILABLE = True
except Exception:
    _HYBRID_AVAILABLE = False


def _list_embedding_docs(vault: Path, max_chars: int = 2000):
    """为 Embedding 检索准备文档列表（排除噪声路径）。"""
    docs = []
    for path in list_markdown_files(vault):
        rel = str(path.relative_to(vault)).lower()
        if any(k in rel for k in NOISY_PATH_KEYWORDS):
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except Exception:
            continue
        text = (path.stem + "\n" + _clean_markdown(content)[:max_chars]).strip()
        if len(text) < 10:
            continue
        docs.append({
            "path": str(path.relative_to(vault)),
            "title": path.stem,
            "text": text,
        })
    return docs


def _hybrid_results(vault: Path, query: str, limit: int, retries: int):
    """
    统一 Hybrid 检索入口。
    若 Hybrid 模块不可用或 Embedding 未就绪，自动降级为纯关键词检索。
    返回: (results, meta_info)
    """
    # 1. 先做关键词检索（原有逻辑）
    keyword_results, attempts = build_search_results_with_retry(vault, query, limit, retries)

    if not _HYBRID_AVAILABLE:
        for item in keyword_results:
            item["channel"] = "keyword"
        return keyword_results, {"attempts": attempts, "embedding_ready": False, "message": "Hybrid 模块未加载，仅返回关键词结果。"}

    ready, msg = check_embedding_ready()
    if not ready:
        for item in keyword_results:
            item["channel"] = "keyword"
        return keyword_results, {"attempts": attempts, "embedding_ready": False, "message": msg}

    # 2. 准备 Embedding 文档列表
    docs = _list_embedding_docs(vault)

    # 3. 调用 Hybrid 搜索
    index = EmbeddingIndex()
    try:
        results, emb_meta = hybrid_search(
            vault=vault,
            query=query,
            limit=limit,
            keyword_builder_fn=lambda v, q, l: build_search_results_with_retry(v, q, l, retries)[0],
            docs_for_embedding=docs,
            snippet_fn=snippet_lines,
            top_k_embedding=100,
            index=index,
        )
    except Exception as exc:
        # 任何异常都降级到关键词
        for item in keyword_results:
            item["channel"] = "keyword"
        return keyword_results, {"attempts": attempts, "embedding_ready": True, "error": str(exc), "message": f"Hybrid 检索异常，已降级。原因: {exc}"}
    finally:
        index.close()

    meta = {"attempts": attempts, **emb_meta}
    return results, meta


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "command failed")
    return result.stdout


def detect_vault_path():
    env_path = os.environ.get("OBSIDIAN_VAULT_PATH", "").strip()
    if env_path:
        return Path(env_path).expanduser().resolve()
    try:
        output = run(["obsidian-cli", "print-default"])
        for line in output.splitlines():
            if line.lower().startswith("default vault path:"):
                candidate = Path(line.split(":", 1)[1].strip()).expanduser().resolve()
                if candidate.exists():
                    return candidate
    except Exception:
        pass
    return Path(DEFAULT_VAULT).expanduser().resolve()


def detect_repo_root():
    env_path = os.environ.get("OBSIDIAN_REMOTE_REPO", "").strip()
    if env_path:
        return Path(env_path).expanduser().resolve()
    candidate = Path(DEFAULT_REPO).expanduser().resolve()
    if candidate.exists():
        return candidate
    return candidate


def normalize_note_name(value: str) -> str:
    text = value.strip()
    return text if text.endswith(".md") else f"{text}.md"


def ensure_within_vault(vault: Path, target: Path) -> Path:
    resolved = target.resolve()
    resolved.relative_to(vault)
    return resolved


def list_markdown_files(vault: Path):
    return sorted(path for path in vault.rglob("*.md") if path.is_file())


def should_include_repo_docs(query: str) -> bool:
    lowered = query.lower()
    return any(token in lowered for token in ("skill", "skills", "openclaw", "author", "qa", "share", "obsidian", "remote", "cookie", "门禁", "编辑"))


def is_skill_query(query: str) -> bool:
    lowered = query.lower()
    return any(token in lowered for token in ("skill", "skills", "openclaw", "author", "qa"))


def list_repo_skill_files(repo_root: Path):
    skill_root = repo_root / "skills"
    if not skill_root.exists():
        return []
    files = []
    files.extend(sorted(skill_root.glob("openclaw-obsidian-*/SKILL.md")))
    files.extend(sorted(skill_root.glob("openclaw-obsidian-*/references/commands.md")))
    return [path for path in files if path.is_file()]


def list_repo_reference_files(repo_root: Path):
    candidates = [
        repo_root / "README.md",
        repo_root / "SETUP-GUIDE.md",
        repo_root / "基础设施实现.md",
        repo_root / "obsidian-remote-分享方案.md",
        repo_root / "obsidian-remote-安全方案.md",
        repo_root / "obsidian-remote-待解决问题.md",
    ]
    return [path for path in candidates if path.is_file()]


def relative_note_path(vault: Path, note: Path) -> str:
    return str(note.relative_to(vault))


def relative_repo_path(repo_root: Path, path: Path) -> str:
    return f"repo:{path.relative_to(repo_root).as_posix()}"


def resolve_note(vault: Path, note: str) -> Path:
    if note.startswith("repo:"):
        repo_root = detect_repo_root()
        target = (repo_root / note.removeprefix("repo:")).resolve()
        if target.exists():
            return target
        raise FileNotFoundError(f"Cannot resolve repo doc: {note}")

    candidate = (vault / note).expanduser()
    if candidate.exists():
        return ensure_within_vault(vault, candidate)

    candidate_md = vault / normalize_note_name(note)
    if candidate_md.exists():
        return ensure_within_vault(vault, candidate_md)

    normalized = normalize_note_name(note).lower()
    matches = [path for path in list_markdown_files(vault) if path.name.lower() == normalized]
    if len(matches) == 1:
        return matches[0]

    stem = Path(note).stem.lower()
    matches = [path for path in list_markdown_files(vault) if path.stem.lower() == stem]
    if len(matches) == 1:
        return matches[0]

    raise FileNotFoundError(f"Cannot resolve note: {note}")


def snippet_lines(content: str, query: str, max_lines: int = 3):
    q = query.lower()
    terms = query_terms(query)
    snippets = []
    lines = content.splitlines()
    for idx, line in enumerate(lines):
        lowered_line = line.lower()
        if q in lowered_line or any(term in lowered_line for term in terms):
            start = max(0, idx - 1)
            end = min(len(lines), idx + 2)
            snippet = "\n".join(lines[start:end]).strip()
            if snippet:
                snippets.append(snippet)
        if len(snippets) >= max_lines:
            break
    return snippets


def query_terms(query: str):
    terms = [term.strip().lower() for term in re.split(r"[\s,，/\\|+-]+", query) if term.strip()]
    unique_terms = []
    for term in terms:
        if len(term) <= 1:
            continue
        if term not in unique_terms:
            unique_terms.append(term)
    return unique_terms


def query_variants(query: str):
    variants = []

    def add_variant(value: str):
        text = " ".join(value.strip().split())
        if len(text) <= 1:
            return
        if text not in variants:
            variants.append(text)

    add_variant(query)
    terms = query_terms(query)
    if terms:
        add_variant(" ".join(terms))
    filtered_terms = [term for term in terms if term not in STOP_TERMS]
    if filtered_terms and filtered_terms != terms:
        add_variant(" ".join(filtered_terms))
    if len(filtered_terms) >= 2:
        add_variant(filtered_terms[-1])
        add_variant(filtered_terms[0])

    # 增强：对无空格连续中文短语，生成 2~3 字滑动窗口变体，提升部分命中召回
    raw = query.strip()
    if any("\u4e00" <= ch <= "\u9fff" for ch in raw) and not re.search(r"[\s,，/\\|+-]", raw):
        for window in (2, 3):
            if len(raw) >= window:
                for i in range(0, len(raw) - window + 1):
                    add_variant(raw[i : i + window])

    return variants


def path_penalty(path: Path) -> int:
    rel_path = str(path).lower()
    penalty = 0
    for keyword in NOISY_PATH_KEYWORDS:
        if keyword in rel_path:
            penalty += 3
    return penalty


def priority_bonus(path: Path, query: str) -> int:
    rel_path = path.as_posix().lower()
    lowered_query = query.lower()
    bonus = 0

    if any(keyword in rel_path for keyword in PRIORITY_PATH_KEYWORDS):
        if any(token in lowered_query for token in ("obsidian", "share", "remote", "openclaw", "skill", "编辑", "知识库", "门禁")):
            bonus += 6

    if "obsidian-remote" in rel_path and any(token in lowered_query for token in ("obsidian", "share", "remote", "编辑", "门禁", "cookie")):
        bonus += 10

    if "skills/" in rel_path and any(token in lowered_query for token in ("skill", "skills", "openclaw", "qa", "author", "share")):
        bonus += 10

    return bonus


def content_score(path: Path, content: str, query: str) -> int:
    lowered_query = query.lower()
    title = path.stem.lower()
    rel_path = path.as_posix().lower()
    body = content.lower()
    score = 0
    terms = query_terms(query)
    title_term_hits = 0
    path_term_hits = 0
    body_term_hits = 0

    if lowered_query in title:
        score += 18
    if lowered_query in rel_path:
        score += 8
    exact_hits = body.count(lowered_query)
    score += exact_hits * 3
    for term in terms:
        if term in title:
            score += 5
            title_term_hits += 1
        if term in rel_path:
            score += 2
            path_term_hits += 1
        hits = min(body.count(term), 6)
        score += hits
        if hits:
            body_term_hits += 1

    if terms:
        score += title_term_hits * 3
        score += path_term_hits * 2
        score += body_term_hits
        if title_term_hits >= 2:
            score += 6
        if path_term_hits >= 2:
            score += 4
        if title_term_hits == len(terms):
            score += 8

    if exact_hits and title == lowered_query:
        score += 10
    score += priority_bonus(path, query)
    score -= path_penalty(path)
    return score


def build_search_results(vault: Path, query: str, limit: int):
    results = []
    for path in list_markdown_files(vault):
        try:
            content = path.read_text(encoding="utf-8")
        except Exception:
            continue
        score = content_score(path, content, query)
        if score <= 0:
            continue
        results.append(
            {
                "path": relative_note_path(vault, path),
                "title": path.stem,
                "score": score,
                "penalty": path_penalty(path),
                "snippets": snippet_lines(content, query),
                "source_type": "vault",
            }
        )

    if should_include_repo_docs(query):
        repo_root = detect_repo_root()
        skill_query = is_skill_query(query)
        for path in list_repo_skill_files(repo_root):
            try:
                content = path.read_text(encoding="utf-8")
            except Exception:
                continue
            score = content_score(path, content, query) + (12 if skill_query else 2)
            if score <= 0:
                continue
            results.append(
                {
                    "path": relative_repo_path(repo_root, path),
                    "title": path.parent.name if path.name == "SKILL.md" else f"{path.parent.parent.name}:{path.stem}",
                    "score": score,
                    "penalty": 0,
                    "snippets": snippet_lines(content, query),
                    "source_type": "repo",
                }
            )

        for path in list_repo_reference_files(repo_root):
            try:
                content = path.read_text(encoding="utf-8")
            except Exception:
                continue
            score = content_score(path, content, query) + (8 if skill_query else 14)
            if score <= 0:
                continue
            results.append(
                {
                    "path": relative_repo_path(repo_root, path),
                    "title": path.stem,
                    "score": score,
                    "penalty": 0,
                    "snippets": snippet_lines(content, query),
                    "source_type": "repo",
                }
            )

    results.sort(key=lambda item: (-item["score"], item["path"]))
    return results[:limit]


def build_search_results_with_retry(vault: Path, query: str, limit: int, retries: int):
    merged = {}
    attempts = []
    for index, variant in enumerate(query_variants(query)):
        if index > retries:
            break
        variant_results = build_search_results(vault, variant, limit)
        attempts.append({"query": variant, "result_count": len(variant_results)})
        for item in variant_results:
            current = merged.get(item["path"])
            boosted = dict(item)
            boosted["matched_query"] = variant
            if current is None or boosted["score"] > current["score"]:
                merged[item["path"]] = boosted
        if len(merged) >= limit and variant_results:
            break
    results = sorted(merged.values(), key=lambda item: (-item["score"], item["path"]))[:limit]
    return results, attempts


def command_vault_path(_args):
    vault = detect_vault_path()
    print(json.dumps({"vault_path": str(vault)}, ensure_ascii=False, indent=2))


def command_search(args):
    vault = detect_vault_path()
    query = args.query.strip()
    results, meta = _hybrid_results(vault, query, args.limit, args.retries)
    output = {
        "vault_path": str(vault),
        "query": query,
        "results": results[: args.limit],
    }
    # 向后兼容：保留 attempts 字段
    if "attempts" in meta:
        output["attempts"] = meta["attempts"]
    # 添加 embedding 状态提示
    output["embedding_meta"] = {k: v for k, v in meta.items() if k != "attempts"}
    print(json.dumps(output, ensure_ascii=False, indent=2))


def command_read(args):
    vault = detect_vault_path()
    note = resolve_note(vault, args.note)
    content = note.read_text(encoding="utf-8")
    print(
        json.dumps(
            {
                "vault_path": str(vault),
                "path": relative_note_path(vault, note),
                "title": note.stem,
                "content": content,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def command_create(args):
    vault = detect_vault_path()
    note_name = normalize_note_name(args.note)
    cmd = ["obsidian-cli", "create", note_name, "-c", args.content]
    if args.overwrite:
        cmd.append("-o")
    run(cmd)
    note = resolve_note(vault, note_name)
    print(
        json.dumps(
            {
                "status": "ok",
                "path": relative_note_path(vault, note),
                "title": note.stem,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def command_append(args):
    vault = detect_vault_path()
    note = resolve_note(vault, args.note)
    with note.open("a", encoding="utf-8") as handle:
        if note.stat().st_size > 0:
            handle.write("\n")
        handle.write(args.content.rstrip() + "\n")
    print(
        json.dumps(
            {
                "status": "ok",
                "path": relative_note_path(vault, note),
                "title": note.stem,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def command_answer_pack(args):
    vault = detect_vault_path()
    query = args.query.strip()
    results, meta = _hybrid_results(vault, query, args.limit, args.retries)
    packed_sources = []
    for item in results[: args.read_limit]:
        note = resolve_note(vault, item["path"])
        content = note.read_text(encoding="utf-8")
        packed_sources.append(
            {
                "path": item["path"],
                "title": item["title"],
                "score": item["score"],
                "penalty": item.get("penalty", 0),
                "snippets": item["snippets"],
                "preview": content[: args.preview_chars],
                "source_type": item.get("source_type", "vault"),
                "channel": item.get("channel", "keyword"),
            }
        )
    payload = {
        "vault_path": str(vault),
        "query": query,
        "guidance": [
            "先基于 sources 回答，不要把模型常识混入知识库事实。",
            "回答后附上来源路径。",
            "如果 sources 不足以支撑结论，明确说明信息不足。",
            "如果 attempts 显示做过多轮检索，优先采用得分最高且 penalty 更低的来源。",
        ],
        "sources": packed_sources,
    }
    if "attempts" in meta:
        payload["attempts"] = meta["attempts"]
    payload["embedding_meta"] = {k: v for k, v in meta.items() if k != "attempts"}
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def command_draft_answer(args):
    vault = detect_vault_path()
    query = args.query.strip()
    results, meta = _hybrid_results(vault, query, args.limit, args.retries)
    sources = []
    summary_lines = []
    answer_lines = []
    for item in results[: args.read_limit]:
        note = resolve_note(vault, item["path"])
        content = note.read_text(encoding="utf-8")
        preview = content[: args.preview_chars].strip()
        sources.append(
            {
                "path": item["path"],
                "title": item["title"],
                "score": item["score"],
                "snippets": item["snippets"],
                "source_type": item.get("source_type", "vault"),
                "channel": item.get("channel", "keyword"),
            }
        )
        if item["snippets"]:
            summary_lines.append(f"- {item['title']}：{item['snippets'][0]}")
            answer_lines.append(f"- 根据《{item['title']}》，{item['snippets'][0].splitlines()[-1].strip()}")
        elif preview:
            one_line = " ".join(preview.splitlines()[:2]).strip()
            summary_lines.append(f"- {item['title']}：{one_line[:180]}")
            answer_lines.append(f"- 根据《{item['title']}》，{one_line[:180]}")
    if not summary_lines:
        summary_lines.append("- 当前检索结果不足，建议调整关键词后重试。")
        answer_lines.append("- 当前知识库检索结果不足，暂时无法给出可靠结论。")

    cited_paths = "\n".join(f"- {item['path']}" for item in sources) or "- 暂无可靠来源"
    draft = "\n".join(
        [
            f"问题：{query}",
            "",
            "答复草案：",
            "以下内容基于本地 Obsidian 知识库检索结果整理：",
            *answer_lines,
            "",
            "来源：",
            cited_paths,
            "",
            "如来源不足以支持明确结论，请在正式回复中明确说明“当前知识库信息不足”。",
        ]
    )
    payload = {
        "vault_path": str(vault),
        "query": query,
        "draft_answer": draft,
        "sources": sources,
    }
    if "attempts" in meta:
        payload["attempts"] = meta["attempts"]
    payload["embedding_meta"] = {k: v for k, v in meta.items() if k != "attempts"}
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def command_init(_args):
    import sys as _sys
    vault = detect_vault_path()

    def _print_line(text):
        # 实时输出，避免在长时间任务中无反馈
        payload = {"status": "progress", "message": text}
        print(json.dumps(payload, ensure_ascii=False), flush=True)

    _print_line(f"Vault 路径: {vault}")
    _print_line(f"Markdown 文档总数: {len(list_markdown_files(vault))}")

    # 检查 .env
    env_file = _skill_root / ".env"
    if env_file.exists():
        _print_line(".env 配置文件: 已存在")
    else:
        example = _skill_root / ".env.example"
        _print_line(".env 配置文件: 未找到")
        if example.exists():
            _print_line(f"  提示: 可复制 {example.name} 为 .env 后填入你的 API Key")

    # 检查可选依赖
    missing = []
    try:
        import requests
    except Exception:
        missing.append("requests")
    try:
        import dotenv
    except Exception:
        missing.append("python-dotenv")

    if missing:
        _print_line(f"可选依赖缺失: {', '.join(missing)}")
        _print_line(f"  安装命令: pip install {' '.join(missing)}")
    else:
        _print_line("可选依赖: 已安装 (requests, python-dotenv)")

    # 检查 Embedding 就绪状态
    if _HYBRID_AVAILABLE:
        ready, msg = check_embedding_ready()
        _print_line(f"Embedding 语义检索: {'就绪' if ready else '未就绪'}")
        if msg:
            _print_line(f"  说明: {msg}")
    else:
        _print_line("Embedding 语义检索: 模块未加载（请检查 scripts/ 目录下 hybrid_search.py 和 embedding_index.py 是否存在）")

    # 首次建立索引
    if _HYBRID_AVAILABLE:
        ready, _ = check_embedding_ready()
        if ready:
            _print_line("正在建立 Embedding 索引...")
            docs = _list_embedding_docs(vault)
            index = EmbeddingIndex()
            try:
                def progress(current, total, msg):
                    if total == 0:
                        _print_line(f"  {msg}")
                    else:
                        _print_line(f"  进度 {current}/{total}: {msg}")

                success, fail = index.ensure_index(docs, progress_callback=progress, base_path=vault)
                _print_line(f"索引完成: 成功 {success} 篇, 失败 {fail} 篇")
            except Exception as exc:
                _print_line(f"索引异常: {exc}")
            finally:
                index.close()

    _print_line("")
    _print_line("初始化完成。常用命令:")
    _print_line("  python scripts/vault_ops.py search \"你的问题\"")
    _print_line("  python scripts/vault_ops.py answer-pack \"你的问题\"")

    print(json.dumps({"status": "ok", "message": "init completed"}, ensure_ascii=False, indent=2))


def build_parser():
    parser = argparse.ArgumentParser(description="Operate local Obsidian vault for OpenClaw skills.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("vault-path").set_defaults(func=command_vault_path)

    search = subparsers.add_parser("search")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=8)
    search.add_argument("--retries", type=int, default=2)
    search.set_defaults(func=command_search)

    read = subparsers.add_parser("read")
    read.add_argument("note")
    read.set_defaults(func=command_read)

    create = subparsers.add_parser("create")
    create.add_argument("note")
    create.add_argument("--content", default="")
    create.add_argument("--overwrite", action="store_true")
    create.set_defaults(func=command_create)

    append = subparsers.add_parser("append")
    append.add_argument("note")
    append.add_argument("--content", required=True)
    append.set_defaults(func=command_append)

    answer_pack = subparsers.add_parser("answer-pack")
    answer_pack.add_argument("query")
    answer_pack.add_argument("--limit", type=int, default=8)
    answer_pack.add_argument("--read-limit", type=int, default=3)
    answer_pack.add_argument("--preview-chars", type=int, default=1800)
    answer_pack.add_argument("--retries", type=int, default=2)
    answer_pack.set_defaults(func=command_answer_pack)

    draft_answer = subparsers.add_parser("draft-answer")
    draft_answer.add_argument("query")
    draft_answer.add_argument("--limit", type=int, default=8)
    draft_answer.add_argument("--read-limit", type=int, default=3)
    draft_answer.add_argument("--preview-chars", type=int, default=600)
    draft_answer.add_argument("--retries", type=int, default=2)
    draft_answer.set_defaults(func=command_draft_answer)

    init = subparsers.add_parser("init")
    init.set_defaults(func=command_init)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
