# AGENTS.md —— Understory · AIC-000 知识库 AI 操作契约

> 本文件是 AI 在本 vault 维护知识时的操作契约。人类无需阅读，AI 每次操作前应遵守。
> 本目录 `.understory/` 是 AI 的隐藏工作层，Obsidian 不显示（点前缀），人在 AIC-000 正常读写。

## 一、单 vault 铁律

- **AIC-000 就是真身**，不存在第二个 wiki/ 或 raw/ vault。
- AI 的全部元数据存放在 `.understory/`：SQLite + JSON + Markdown。
- 人看 `.md` 业务文档，AI 看 `.understory/` 元数据。两者互不污染。

## 二、目录契约

```
.understory/
├── principles.sqlite          原则/断言/决策数据库（+ 历史版本）
├── conflicts.json             冲突报告（含生命周期 open/resolved/ignored）
├── community_clusters.json    社区聚类结果
├── god_nodes.json             god node + 意外关联
├── index.md                   AI 知识索引（每次 lint 后重建）
├── notifications/YYYY-MM-DD.md 每日冲突摘要
├── logs/{name}-YYYY-MM-DD.log  分级日志（保留 7 天）
└── scripts/                    AI 模块
    ├── graphify_common.py      公共基础设施（路径/日志/embedding/LLM）
    ├── ingest_principles.py    L2 原则提取（单篇/全库）
    ├── lint.py                 L3 冲突检测（6 类）
    ├── graph_analyzer.py       L4 图分析（社区/god node/意外关联）
    ├── index_generator.py      L5 知识索引生成
    └── notification_manager.py L6 通知管理
```

## 三、能力分层与触发

| 层 | 模块 | 触发 | 输出 |
|----|------|------|------|
| L1 | kg api.py（已有） | 文件修改后 10min | `## 🏷️关联文件` |
| L2 | ingest_principles.py | 文件修改后 10min | principles.sqlite |
| L3 | lint.py | 每周 + 增量 | conflicts.json + `## ⚠️冲突发现` |
| L4 | graph_analyzer.py | 每周 | community_clusters.json / god_nodes.json |
| L5 | index_generator.py | 每次 lint 后 | index.md |
| L6 | notification_manager.py | 发现 high 冲突 | notifications/ + webhook |

## 四、AI 行为准则

1. **只检测，不擅自修改人的正文**：lint 只产出报告与 `## ⚠️冲突发现` 区块；唯一允许的自动写入是死链清理（auto_fix）。
2. **向后兼容**：不改 kg `api.py` 函数签名、不改插件既有事件逻辑。新增能力以独立脚本存在。
3. **Cost control**：graph analysis reads cached vectors only and never recalculates embeddings; model calls must obey the configured network mode.
4. **静默优先**：默认不弹窗，冲突就近呈现在文档 `## ⚠️冲突发现`，high 冲突走 7 天冷却通知。
5. **Graceful fallback**：`Local only` makes no cloud model requests; `Vector model only` allows embeddings only; `Full AI analysis` is required for LLM calls. Missing model config falls back to rule-based extraction and similarity candidates without breaking the pipeline.
6. **幂等**：所有脚本可重复运行；content_hash 未变的文档跳过；冲突按生命周期合并而非覆盖。

## 五、数据契约（principles.sqlite）

- `principles`：id, doc_path, doc_title, type(principle|claim|decision|question), content, confidence, scope(global|local|project|personal), version, superseded_by, deleted_at, extracted_at, updated_at
- `principle_history`：principle_id, version, content, change_type(create|update|supersede|delete), changed_at
- `doc_meta`：doc_path, content_hash, word_count, principle_count, last_ingested_at, ingest_status
- `principles_fts`：FTS5 全文索引（content, doc_path）

## 六、查询入口（供 AI 使用）

```bash
# 提取单篇原则
python .understory/scripts/ingest_principles.py "某文档.md" --vault <VAULT>
# 全库提取
python .understory/scripts/ingest_principles.py --all --vault <VAULT>
# 冲突扫描（--fix 清理死链）
python .understory/scripts/lint.py --vault <VAULT> [--fix]
# 图分析
python .understory/scripts/graph_analyzer.py --vault <VAULT>
# 重建索引
python .understory/scripts/index_generator.py --vault <VAULT>
```

*本文件由 Understory（基于 understory-graphify-engine 引擎）自动部署。*
