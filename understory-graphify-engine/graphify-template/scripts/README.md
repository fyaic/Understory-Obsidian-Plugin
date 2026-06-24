# Understory Graphify Engine — Scripts

> Understory 的 AI 知识层核心脚本。在 Obsidian Vault 的 `.understory/` 隐藏目录内运行，**零 LLM 成本**的离线图分析 + **低成本**的原则提取与冲突检测。

## 文件一览

| 脚本 | 职责 | LLM 依赖 | 典型耗时 |
|------|------|---------|---------|
| `graphify_common.py` | 公共层：路径/日志/embedding 缓存/LLM 封装/原子写/时间标记 | — | — |
| `api.py` | 关联发现（L1）+ 7 个桥接函数（向后兼容） | 有（embedding + LLM 分组）| ~3s/篇 |
| `link_merge.py` | 关联融合（L1+）：哨兵区 + 删除记忆 | 无 | ~100ms |
| `ingest_principles.py` | 原则提取（L2）+ 智能合并 + 时序记忆 | 有（glm-4-flash）| ~1s/篇 |
| `supersede_gap_detector.py` | **P1：Supersede 链断裂检测** | **无** | ~2s |
| `lint.py` | 冲突检测（L3）：6 类问题 + 生命周期 + 死链 `--fix` | 少量（矛盾精判）| ~1–2s/全库 |
| `graph_analyzer.py` | **P2：知识网络分析**——多类型边 + 社区检测 + God Node | **无** | ~10s |
| `index_generator.py` | 知识索引（L5）：9 板块 `index.md` + 冲突看板 `conflicts.md` | **无** | ~1s |
| `notification_manager.py` | 通知（L6）：每日摘要 + Webhook 分级推送 | 无 | ~100ms |
| `deploy_graphify.py` | 幂等部署 `.understory/` 骨架与脚本同步 | 无 | ~1s |

## 数据流

```text
文件保存 ──► 10min 防抖 ──┬─► L1 关联发现 ──► ## 🏷️关联文件
                          ├─► L2 原则提取 ──► principles.sqlite
                          │
每周定时 ──► L3 lint ──► L4 图分析 ──► L5 索引 ──► L6 通知
              │            │              │
              ▼            ▼              ▼
        conflicts.json  knowledge_graph.json  index.md (9板块)
        + .md 看板       + edge_stats.json
```

## 关键设计原则

- **单 vault，隐藏层**：所有 AI 元数据写在 `.understory/`，不污染用户笔记
- **向后兼容**：api.py 纯增量（0 删除），既有签名零改动
- **Graceful fallback**：`Local only` makes no outbound requests; `Vector model only` allows embeddings only; `Full AI analysis` is required for LLM calls. Missing model config falls back to rules and similarity candidates.
- **零 LLM 离线分析**：图分析、索引、通知完全离线，复用 embedding 缓存
- **成本克制**：全库（~500 篇/月）< ¥5/月

## 运行方式

```bash
# 单次全量维护（lint → 图分析 → 索引 → 通知）
python api.py run_full_maintenance <vault_path>

# 独立模块
python ingest_principles.py --vault <vault_path> --all
python lint.py --vault <vault_path> --fix
python graph_analyzer.py --vault <vault_path>
python index_generator.py --vault <vault_path>
```

## P1/P2 新增能力（2026-06-03）

### P1：Supersede 链断裂检测
- 检测 supersede 事件后引用旧文档却未更新过的新文档
- 三级 mentions 降级：FTS MATCH → LIKE → 文件系统正则
- 196 条知识漂移记录，0 重复

### P2：知识网络多类型边
- 4 种边类型：similar(5000) + mentions(185) + supersedes(14) + contradicts(0)
- 社区检测升级：greedy_modularity + contradicts 二染色拆分
- God Node 评分公式：`0.4×similar中心性 + 0.4×mentions入度 + 0.2×跨社区数`
- 知识地图新增「知识网络统计」「知识漂移」板块（9 板块）

## 无限增长防护（v1.6.1 · 2026-06-04）

长期运行下，以下数据曾存在只增不减风险，现已全部加限：

| 组件 | 风险 | 防护策略 | 触发时机 |
|------|------|---------|---------|
| `conflicts.json` 的 `llm_judgment_cache` | 每次新 LLM 判定追加，无上限 | 容量≤5000 + 保留≤90天 | 每次 lint 写入前 |
| `conflicts.json` 的 resolved issues | resolved 冲突永久保留 | 保留≤30天 | 每次 lint 写入前 |
| `principles.sqlite` 的 `principle_history` | 每次编辑 INSERT，无上限 | delete 类型保留≤90天 | 每次 `ingest_all` 末尾 |
| `principles.sqlite` 的软删 principles | `deleted_at` 标记但不物理删除 | 物理 DELETE 保留≤90天 | 每次 `ingest_all` 末尾 |
| `notifications/*.md` | 每天生成一个文件 | 保留≤30天 | 每次生成摘要后 |
| `logs/*.log` | 每天一个日志文件 | 保留≤7天 | 已有，各模块运行后 |
| `TODAY` 硬编码 | 写死 `date(2026, 6, 1)` | 改为 `datetime.now().date()` | 代码修复 |
| 开发临时文件 | 8 个 `_*.py` 滞留生产目录 | 已清理 | 一次性 |
