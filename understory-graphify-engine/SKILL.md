---
name: understory-graphify-engine
description: 为 Obsidian vault 中的文档自动发现关联关系并生成 wikilink。适用于新文档写入后、或批量整理孤儿笔记时，基于 Embedding 语义相似度 + LLM 概念提取做 Hybrid 关联推荐。
---

# understory-graphify-engine

为 Obsidian 知识库注入自动关联能力。基于文档 Embedding 语义相似度和 LLM 概念提取，发现跨文件夹、跨主题的隐藏关联，并输出可直接贴入 Obsidian 的 `[[wikilink]]` 建议。

---

## 何时使用

| 场景 | 动作 |
|------|------|
| **新文档刚写入** | 调用 `on_file_changed` 或 `discover_relations` 获取关联建议 |
| **批量整理孤儿笔记** | 调用 `build_orphan_links` 为全库无 wikilink 的文档自动补关联区块 |
| **用户要求"帮我把这篇笔记和其他内容连起来"** | 调用 `discover_relations` 并展示分组结果 |
| **索引过期/首次使用** | 调用 `init_index` 重建 Embedding 缓存 |

---

## 快速开始

### 1. 初始化索引（首次使用或 vault 有大量变更后）

```bash
cd C:/Hello-World/understory-graphify-engine
python -c "from api import init_index; print(init_index())"
```

### 2. 单篇文档关联发现

```bash
python api.py auto-link "KimiCode/BONDIE.md"
```

Python API：
```python
from api import discover_relations

report = discover_relations(
    doc_path="KimiCode/BONDIE.md",
    top_k=10,
    cross_folder_first=True,   # 优先返回跨文件夹关联
    use_llm_concepts=True,     # 启用 Hybrid 概念分组
)
```

返回示例：
```json
{
  "status": "ok",
  "target": "KimiCode/BONDIE.md",
  "target_title": "BONDIE",
  "relations": [...],
  "grouped": {
    "主动触发": ["通用知识沉淀约束", "0320-AGENTS"],
    "语义相近": ["龙虾大脑认知模型", "跨Agent协作的涌现时刻"]
  }
}
```

### 3. 文件变化时的肌肉反应（推荐集成到沉淀流程）

```python
from api import on_file_changed

# 默认先审后写：只返回建议区块，不自动修改原文
result = on_file_changed("KimiCode/BONDIE.md", auto_write=False)

# 用户确认后，自动追加关联区块
result = on_file_changed("KimiCode/BONDIE.md", auto_write=True)
```

### 4. 批量修复孤儿文档

```bash
# 预览
python build_links.py --dry-run --limit 5

# 正式执行
python build_links.py --top-k 8
```

---

## Agent 调用规范

### 沉淀新文档后的标准流程

```
1. 写完 Markdown 文档并保存
2. 调用 on_file_changed(doc_path, auto_write=False)
3. 如果 status == "ok"：
   - 向用户展示建议的关联分组和理由
   - 询问"是否将这些关联写入文档末尾？"
4. 用户确认后，调用 on_file_changed(doc_path, auto_write=True)
5. 回读文档，确认 wikilink 和中文显示正常
```

### 必须遵守

- **默认 `auto_write=False`**。除非用户明确说"直接写上"，否则先展示建议。
- **写入后必须回读**。确认 `## 关联文件` 区块格式正确、链接可点击、无乱码。
- **给 Obsidian 本地链接**。如需让用户在 Obsidian 中打开，使用 `obsidian://open?vault=AIC-000&file=...`。

### 禁止行为

- ❌ 不经过用户确认就直接修改已有文档
- ❌ 把 AI 生成的关联区块插到文档中间，打断原有结构
- ❌ 索引未初始化就直接调用 discover，导致报错

---

## 输出格式说明

当 `auto_write=True` 或用户要求写入时，系统会在文档末尾追加如下区块：

```markdown



---
## 关联文件

### 主动触发
[[通用知识沉淀约束]]
[[0320-AGENTS]]

### 语义相近
[[龙虾大脑认知模型]]
[[跨Agent协作的涌现时刻]]
```

> 若文档已存在 `## 关联文件` 区块，会先替换旧区块，避免重复。

---

## 常见问题

### 索引未找到
报错：`未找到 Embedding 缓存: ...`
→ 先运行 `init_index()` 建立索引。

### 为什么有些文档被 skipped？
文档中已包含手动 `[[wikilink]]` 时，`on_file_changed` 会跳过，避免覆盖用户已有的链接维护。

### 关联质量不高怎么办？
- 新文档内容过短（<300 字）时，系统会自动利用反向链接补充上下文
- 尝试提高 `top_k` 或在调用前确保文档标题能准确反映主题

---

## 架构速览

```
新文档
  ├── Embedding 向量化
  ├── 与全库缓存做余弦相似度对比
  ├── LLM 提取核心概念
  ├── Hybrid (keyword + embedding) 概念分组
  └── 输出 [[wikilink]] 建议
```

- **跨文件夹优先**：同文件夹的文档树状目录已能体现层级，优先发现跨领域关联
- **短文档增强**：自动收集反向链接上下文，提升短笔记的语义表征
- **优雅降级**：缺少 API Key 或网络异常时，自动回退到纯关键词/文件夹模式
