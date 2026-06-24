# Agent 接口文档（understory-graphify-engine）

> 本文档面向**其他 Agent 或自动化脚本**。如果你需要调用 understory-graphify-engine 的能力，请从这里开始。

---

## 一句话定位

`understory-graphify-engine` 负责**发现 Obsidian 文档之间的隐藏关联**，并**自动建立 wikilink 链接**。它基于 Embedding 语义相似度，而不是简单的关键词匹配。

---

## 功能入口总览

| 功能 | Python API | CLI | 主动场景 | 肌肉反应场景 |
|---|---|---|---|---|
| **初始化索引** | `init_index()` | `python api.py init` | 首次部署、缓存失效后 | ❌ 不适用 |
| **单篇关联发现** | `discover_relations("file.md")` | `python api.py auto-link "file.md"` | 用户问"这篇和什么有关" | ✅ 文件保存后自动调用 |
| **批量孤儿建链** | `build_orphan_links(limit=50)` | `python api.py orphan-links --limit 50` | 用户说"帮我把没关联的文档都连上" | ❌ 不推荐全库自动跑 |
| **文件变化响应** | `on_file_changed("file.md", auto_write=False)` | 无独立 CLI | 用户刚保存完一篇新笔记 | ✅ **核心肌肉反应入口** |

---

## 1. 初始化索引 `init_index()`

### 什么时候用
- 第一次部署 understory-graphify-engine
- 移动/删除了大量文档后想重建缓存
- 本地 `.cache/embedding_index.sqlite` 不存在或明显过时

### Python API
```python
from api import init_index

result = init_index()
# result = {"status": "ok", "message": "init completed"}
```

### CLI
```bash
python api.py init
```

### 说明
- 会遍历全库 markdown，批量调用智谱 Embedding API 生成向量，存入本地 SQLite
- 后续所有关联发现都依赖这个缓存
- 首次全量建索引约 3~5 分钟（3000 篇量级），成本约 ¥0.8~1.5
- 日常查询前会自动做增量检查，不需要频繁手动 init

---

## 2. 单篇关联发现 `discover_relations()`

### 什么时候用
- 用户主动问："这篇笔记应该和哪些内容关联？"
- 你想预览某篇文档的关联建议，但**不修改原文**

### Python API
```python
from api import discover_relations

report = discover_relations(
    doc_path="T-B 物流行业 -技术方案调研/运输情报/车队/Uber Freight.md",
    top_k=10
)

# report = {
#   "status": "ok",
#   "target": "T-B 物流行业 -技术方案调研/运输情报/车队/Uber Freight.md",
#   "target_title": "Uber Freight",
#   "relations": [
#       {"path": "...", "title": "Einride Saga 车队调度", "similarity": 0.8244},
#       ...
#   ]
# }
```

### CLI
```bash
python api.py auto-link "Uber Freight.md"
```

### 返回字段
| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | str | `ok` 或 `error` |
| `target` | str | 目标文档的相对路径 |
| `target_title` | str | 文档标题（文件名） |
| `relations` | list | 关联建议列表，按相似度降序 |
| `relations[].similarity` | float | 余弦相似度（0~1，越高越相关） |

---

## 3. 批量孤儿建链 `build_orphan_links()`

### 什么时候用
- 用户主动说："帮我把 vault 里那些孤零零的文档都连上"
- 需要做大规模的知识图谱补全

### Python API
```python
from api import build_orphan_links

report = build_orphan_links(
    top_k=10,      # 每篇文档关联多少篇
    limit=50,      # 仅处理前 50 篇（测试用，不填则全库）
    dry_run=True   # True 时只预览，不实际写入文件
)

# report = {
#   "status": "ok",
#   "total_orphans": 2063,
#   "processed": 50,
#   "details": [
#       {"path": "...", "links_added": 6, "modules": ["sources", "memory"], "dry_run": True},
#       ...
#   ]
# }
```

### CLI
```bash
# 预览
python build_links.py --dry-run --limit 10 --top-k 8

# 正式执行（谨慎！会修改大量文件）
python build_links.py --top-k 8
```

### 说明
- **孤儿文档**定义为：正文中完全没有 `[[...]]` wikilink 的 `.md` 文件
- 会在文档末尾追加统一格式的 `## 关联文件` 区块
- 关联文件按**父文件夹名**分组作为模块名
- 如果文档末尾已有 `## 关联文件`，会先替换旧区块

---

## 4. 肌肉反应入口 `on_file_changed()` ⭐

### 什么时候用
- **核心无感触发场景**：用户刚保存了一篇新笔记，Agent 在后台自动判断是否需要建立关联
- 可以作为文件 watcher（如 `watchdog`）的回调函数
- 也可以集成到 OpenClaw 的 `on-file-saved` hook 中

### Python API
```python
from api import on_file_changed

# 场景 A: 只返回建议，不写入文件（推荐，Agent 先审后写）
result = on_file_changed("新保存的文档.md", auto_write=False)

# 场景 B: 直接自动写入（真正的肌肉反应）
result = on_file_changed("新保存的文档.md", auto_write=True)
```

### 内部逻辑
```
on_file_changed(file)
    │
    ├─► 读取文件内容
    ├─► 如果已有 wikilink ──► 返回 skipped（不打扰已维护的文档）
    ├─► 如果无 wikilink ──► 调用 discover_relations()
    ├─► 如果没找到关联 ──► 返回 skipped
    └─► 如果 auto_write=True ──► 在文末追加 ## 关联文件 区块
```

### 返回示例（auto_write=False）
```python
{
    "status": "ok",
    "path": "T-B 新文档.md",
    "auto_write": False,
    "relations_count": 8,
    "modules": ["运输情报", "项目书撰写", "行业展会"],
    "suggested_block": "## 关联文件\n\n## 运输情报\n[[DrayEasy 北美卡车 小程序]]\n..."
}
```

### 为什么这是肌肉反应的最佳入口？
- **有保护机制**：已有 wikilink 的文档会被跳过，不会破坏用户手动维护的结构
- **成本低**：只计算 1 篇新文档的 embedding，本地比对即可
- **可解释**：返回的 `modules` 和 `suggested_block` 可以让人类/上层 Agent 审查

---

## 场景速查：我该调用哪个接口？

### 用户主动说："帮我把没关联的文档都连上"
→ 调用 `build_orphan_links(dry_run=True)` 做预览，确认后再执行 `build_orphan_links(dry_run=False)`

### 用户主动说："这篇笔记和什么有关？"
→ 调用 `discover_relations("file.md")`，输出 Markdown 报告

### 用户刚保存了一篇新笔记（肌肉反应）
→ 在文件 watcher 回调里调用 `on_file_changed("file.md", auto_write=False)`，把建议推给用户或上层 Agent

### 系统提示"Embedding 缓存不存在"
→ 先调用 `init_index()`，完成后再做关联发现

---

## 统一返回值约定

所有 Python API 都返回一个 `dict`，至少包含：

```python
{
    "status": "ok" | "error" | "skipped",
    ...
}
```

- `ok`：操作成功完成
- `error`：发生异常，`message` 字段会说明原因
- `skipped`：逻辑上决定不处理（如文档已有 wikilink），`reason` 字段说明原因

CLI 工具会把这个 dict 以 JSON 形式输出到 stdout。

---

## 常见错误处理

| 错误 | 原因 | 解决 |
|---|---|---|
| `未找到 Embedding 缓存` | 还没跑过 `init` | 调用 `init_index()` |
| `ZHIPU_API_KEY 未配置` | `.env` 缺失或 key 为空 | 创建 `.env` 并填入 key，或接受降级到纯关键词 |
| `Embedding API 请求超时` | 网络问题 | 检查网络，重试；系统不会自动崩溃 |

---

## 快速调用模板

```python
from api import init_index, discover_relations, build_orphan_links, on_file_changed
from pathlib import Path

# 1. 初始化
init_index()

# 2. 单篇发现
report = discover_relations("新文档.md")
for r in report["relations"]:
    print(r["title"], r["similarity"])

# 3. 批量建链
result = build_orphan_links(limit=20, dry_run=False)
print(f"处理了 {result['processed']} 篇孤儿文档")

# 4. 肌肉反应
result = on_file_changed("新文档.md", auto_write=False)
if result["status"] == "ok":
    print(result["suggested_block"])
```
