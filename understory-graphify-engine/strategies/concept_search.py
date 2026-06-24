#!/usr/bin/env python3
"""
基于概念搜索的关联发现策略。
提取新文档中的关键词、标签、显式链接，调用 obsidian_qa 做验证搜索。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

_SELF_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "vault_ops.py"


def _extract_concepts(text: str, max_concepts: int = 5) -> list[str]:
    """提取显式链接、标签、以及高频关键词作为搜索概念。"""
    concepts = []

    # 1. 显式 Obsidian 链接 [[...]]
    wiki_links = re.findall(r"\[\[(.*?)\]\]", text)
    for link in wiki_links:
        # 取别名前的部分
        concepts.append(link.split("|")[0].strip())

    # 2. 标签 #tag
    tags = re.findall(r"#([\w\u4e00-\u9fff_-]+)", text)
    for tag in tags:
        if len(tag) > 1:
            concepts.append(tag)

    # 3. 高频关键词（简单统计：去除停用词后按长度和频率排序）
    stop_words = {"的", "了", "和", "与", "及", "并", "是", "在", "有", "为", "以", "及", "或", "等", "对", "将", "从", "到", "中", "上", "下", "一个", "可以", "我们", "这个", "进行", "使用", "通过", "作为", "需要", "根据", "已经", "进行", "实现", "完成", "开始", "如果", "然后", "因此", "因为", "但是", "或者", "以及", "对于", "关于", "由于", "随着", "从而", "而且", "不过", "只是", "这样", "那么", "一些", "这些", "那些", "没有", "不是", "不能", "不会", "不要", "不能", "无法", "必须", "应该", "应当", "可能", "也许", "大概", "一定", "非常", "比较", "相当", "特别", "尤其", "主要", "重要", "关键", "核心", "基本", "根本", "总体", "整体", "部分", "局部", "相关", "有关", "涉及", "包含", "包括", "涵盖", "覆盖", "针对", "面向", "基于", "建立在", "依赖于", "取决于", "来源于", "来自于", "产生于", "形成于", "发展于", "起源于", "来自于"}

    words = re.findall(r"[\w\u4e00-\u9fff]+", text)
    freq = {}
    for w in words:
        w = w.strip().lower()
        if len(w) <= 1 or w in stop_words or w.isdigit():
            continue
        freq[w] = freq.get(w, 0) + 1

    # 优先选长度较长且出现次数较多的词
    sorted_words = sorted(freq.items(), key=lambda x: (len(x[0]), x[1]), reverse=True)
    for word, _ in sorted_words[:max_concepts]:
        if word not in concepts:
            concepts.append(word)

    return concepts[:max_concepts]


def _call_obsidian_qa_search(query: str, limit: int = 5) -> list[dict]:
    """调用 obsidian_qa 的 search 命令。"""
    cmd = [
        sys.executable,
        str(_SELF_SCRIPT),
        "search",
        query,
        "--limit",
        str(limit),
        "--retries",
        "1",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        return []
    try:
        data = json.loads(result.stdout)
        return data.get("results", [])
    except Exception:
        return []


def discover_by_concepts(new_doc_path: Path, max_concepts: int = 5, limit_per_concept: int = 5):
    """
    基于概念搜索发现关联文档。
    返回: list[{"path": str, "title": str, "matched_concepts": list[str], "source_type": str}]
    """
    text = new_doc_path.read_text(encoding="utf-8")
    concepts = _extract_concepts(text, max_concepts)
    if not concepts:
        return []

    merged = {}
    for concept in concepts:
        results = _call_obsidian_qa_search(concept, limit=limit_per_concept)
        for item in results:
            path = item["path"]
            if path not in merged:
                merged[path] = {
                    "path": path,
                    "title": item["title"],
                    "matched_concepts": [],
                    "source_type": item.get("source_type", "vault"),
                }
            if concept not in merged[path]["matched_concepts"]:
                merged[path]["matched_concepts"].append(concept)

    # 按匹配概念数量排序
    final = sorted(merged.values(), key=lambda x: -len(x["matched_concepts"]))
    return final
