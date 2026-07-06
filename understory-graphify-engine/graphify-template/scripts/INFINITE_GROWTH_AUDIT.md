# Understory Graphify Engine — 无限增长风险系统审查报告

> 审查范围：`understory-graphify-engine/graphify-template/scripts`
> 审查日期：2026-06-03
> 审查原则：只读审查，不做任何修改

---

## 一、总体结论

| 维度 | 评估 |
|------|------|
| **高危项** | 0 项 |
| **中危项** | 3 项（数据库历史表、冲突缓存、原则软删堆积） |
| **低危项** | 6 项（通知文件、冷却状态、FTS 膨胀、覆盖配置孤儿项、embedding 缓存、日志依赖） |
| **安全项** | 8 项（覆盖式 JSON/Markdown 输出、有界元数据表） |

**核心问题**：系统大量使用"软删除 + 追加历史"策略保证可追溯性，但**缺少任何物理清理机制**。长期运行后，`principles.sqlite` 和 `conflicts.json` 会随文档编辑频次线性膨胀。

---

## 二、逐模块审查详情

### 1. graphify_common.py — 公共基础设施

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **日志文件 `.understory/logs/{name}-YYYY-MM-DD.log`** | `rotate_logs(vault_path, retention_days=7)` 按文件名日期解析并删除超期日志 | 🟢 低 | 机制存在，但依赖每个调用者（ingest/lint/notify/graph/index）在流程结束时手动调用。若某入口忘记调用，该模块日志会无限累积。 |
| **Embedding 缓存 `kg/.cache/embedding_index.sqlite`** | 只读访问；`load_cached_embeddings()` 仅在读取时过滤不存在的文件，**不从 DB 删除** | 🟡 低 | SQLite 中 `path TEXT PRIMARY KEY`，理论上受限于 Vault 文件数。但文件被删除/重命名后，旧 embedding 记录永久残留。对 graphify 只读，但 kg 侧无清理逻辑。 |
| **原子写 `atomic_write_text()`** | `.tmp` + `os.replace()` | 🟢 安全 | 无增长风险，不产生历史碎片。 |

**补充说明**：`rotate_logs()` 的日期解析依赖正则 `r"(\d{4}-\d{2}-\d{2})"`，若日志文件名格式不标准（如手动拷贝的文件），则无法识别清理。

---

### 2. ingest_principles.py — 原则提取与合并

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`principles` 表** | **仅软删除** (`deleted_at IS NOT NULL`)；superseded 原则标记 `superseded_by` + `deleted_at`，**物理记录永久保留** | 🟡 **中** | 文档每次编辑都会触发智能合并：相似度>0.92 更新、0.80~0.92 supersede、<0.80 新增、旧原则无匹配则软删。旧记录永不删除，随文档迭代次数累积。 |
| **`principle_history` 表** | **纯追加** (`INSERT` only)：记录 create / update / supersede / delete 事件 | 🟡 **中** | 每条原则的每次变更都产生一行历史。无任何 retention / prune 机制。**这是整个系统增长最快的表之一**。 |
| **`principles_fts` 虚拟表** | FTS5 `content=principles`，通过触发器手动维护 | 🟡 低 | `principles_au` 触发器在 UPDATE 时做"delete old + insert new"。由于软删除也是 UPDATE，`principles_fts` 中软删原则的内容仍被索引（因为触发器插入了新状态）。FTS 膨胀速度与 `principles` 表行数成正比。 |
| **`doc_meta` 表** | `doc_path TEXT PRIMARY KEY` + `ON CONFLICT DO UPDATE` | 🟢 安全 | 行数受限于 Vault 中 .md 文件数，不会无限增长。 |
| **`content_hash` 去重** | 对比 `doc_meta.content_hash`，hash 一致且非 force 则跳过 | 🟢 安全 | 有效防止重复提取。 |
| **`_cleanup_blacklisted_doc()`** | 对黑名单文档执行 `UPDATE principles SET deleted_at=?` + `INSERT principle_history(..., 'delete')` + `UPDATE doc_meta` | 🟡 低 | **仅软删除**，不物理清理。黑名单文档的原则记录和历史记录永久留在数据库中。 |

**关键发现**：
- `principles` 表的 `deleted_at` 机制保证了审计可追溯，但缺少"物理清理已软删超过 N 天的记录"的归档/压缩策略。
- `principle_history` 完全没有上限。对于一个频繁编辑的 Vault，该表可能在数月内膨胀到数十万行。

---

### 3. lint.py — 冲突检测

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`conflicts.json` 整体** | **非覆盖式合并** (`_merge_conflicts`)：新 issue 与旧 issue 合并，保留历史 | 🟡 **中** | 每次 lint 都读取旧 `conflicts.json`，合并后写回。旧数据永不丢弃。 |
| **resolved 冲突生命周期** | 涉及的原则消失 → 自动标记 `status="resolved"`；`resolved_at` 记录时间；**但记录仍保留在 JSON 中** | 🟡 **中** | `resolved` 和 `ignored` 的冲突条目永久累积。长期运行后，`conflicts.json` 中绝大多数是已解决的历史条目。 |
| **`llm_judgment_cache`** | 以 `{"pair_hash": {"judgment": ..., "reason": ..., "confidence": ..., "at": ...}}` 形式持久化在 `conflicts.json` 顶层 | 🟡 **中** | 每次 LLM 判定新原则对都追加缓存。**缓存永不清除**。即使原则对被 supersede 或文档被删除，对应的缓存条目仍永久存在。 |
| **冲突合并逻辑** | `_merge_conflicts` 中：旧 open 冲突若本轮未检测到 → 改为 resolved；旧 resolved/ignored → 原样保留 | 🟡 **中** | 确认：`resolved` 和 `ignored` 冲突不会被清理，而是永久追加到 JSON 数组中。 |

**关键发现**：
- `conflicts.json` 的大小 ≈ `(活跃冲突数) + (历史 resolved 数) + (历史 ignored 数) + (LLM 缓存条目数)`。
- LLM 缓存的 key 是 `_pair_hash(a_content, b_content)` 的前 12 位 MD5。不同文档中相似内容的 pair hash 可能碰撞，但即便如此，唯一 pair 的数量随文档数平方增长（受 `lint.max_pairwise` 等护栏限制后约为 O(N) 到 O(N²) 之间）。
- 当前无缓存上限、无 LRU、无按时间淘汰。

---

### 4. link_merge.py — 关联融合与 tombstone

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`link_overrides.json` 内 tombstone TTL** | `link_merge.ttl_days = 30`；每次 `compose_related_section` 时清理超期 tombstone | 🟢 安全（局部） | 单个文档内的 tombstone 在 30 天后或目标文档内容变化后自动失效删除。 |
| **`link_overrides.json` 外层结构** | `overrides` 以 `doc_rel`（文档相对路径）为 key。若文档被**删除或重命名**，其 key 无人清理 | 🟡 低 | 文档删除后，对应的 `{"last_auto": [...], "tombstones": {...}}` 结构永久留在 `link_overrides.json` 中。 |
| **tombstone 过期清理实现** | `for t in list(tombs.keys()): ... if (today - at).days > ttl: del tombs[t]` | 🟢 安全 | TTL 逻辑确实生效，会物理删除 tombstone 条目。 |

**关键发现**：
- tombstone 级别的 TTL 是有效的。
- 但**文档级别的孤儿项**无清理。长期运营后，`link_overrides.json` 会积累大量已不存在的文档 key。

---

### 5. notification_manager.py — 通知管理

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`notifications/YYYY-MM-DD.md` 每日摘要** | 每天生成一个 markdown 文件，按日期命名 | 🟡 低 | **无保留期限、无清理逻辑**。每天运行一次就产生一个文件，永久累积。 |
| **`.cooldown.json` 冷却状态** | 以 issue ID 为 key，记录 `{"last_notified": "...", "severity": "..."}` | 🟡 低 | `should_notify_issue()` 每次遇到 issue 就更新状态，**但 resolved/消失的 issue ID 永不删除**。随时间推移，cooldown 文件会积累大量已不存在的 issue ID。 |

**关键发现**：
- 通知文件虽单个很小（通常 <5KB），但按天累积，1 年约 1.8MB。
- `.cooldown.json` 中的 issue ID 垃圾条目是更隐蔽的泄漏点。

---

### 6. graph_analyzer.py — 图分析

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`knowledge_graph.json`** | `atomic_write_text()` 覆盖写入 | 🟢 安全 | 每次运行完全重写，无历史堆积。 |
| **`edge_stats.json`** | `atomic_write_text()` 覆盖写入 | 🟢 安全 | 同上。 |
| **`community_clusters.json`** | `atomic_write_text()` 覆盖写入 | 🟢 安全 | 同上。 |
| **`god_nodes.json`** | `atomic_write_text()` 覆盖写入 | 🟢 安全 | 同上。 |

---

### 7. supersede_gap_detector.py — 链断裂检测

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`supersede_gaps.json`** | `atomic_write_text()` 覆盖写入 | 🟢 安全 | 每次运行完全重写。无历史堆积。 |

---

### 8. logs/ 目录 — 全局日志

| 审查项 | 当前策略 | 风险等级 | 说明 |
|--------|----------|----------|------|
| **`.understory/logs/*.log`** | `rotate_logs(retention_days=7)` 删除 7 天前日志 | 🟡 低 | 机制有效，但**调用点分散**（ingest/lint/notify/graph/index 各管各的）。若新增模块忘记调用，其日志会无限增长。另外日志按模块名+日期分文件，模块增多时文件数也线性增加。 |

---

## 三、风险汇总表

| # | 文件/数据结构 | 所在模块 | 增长模式 | 当前限制 | 风险等级 | 建议 |
|---|---------------|----------|----------|----------|----------|------|
| 1 | `principles` 表（已软删记录） | `ingest_principles.py` | 文档每次编辑产生新原则 + 软删旧原则 | 无物理清理 | 🟡 **中** | 增加定时硬删除任务：删除 `deleted_at` 超过 90 天且已被 supersede 的原则，或迁移到归档表。 |
| 2 | `principle_history` 表 | `ingest_principles.py` | 每条原则每次变更追加一行 | 无 retention | 🟡 **中** | 增加历史表 retention：删除超过 180 天的 `delete`/`supersede` 历史，或按文档聚合压缩。 |
| 3 | `principles_fts` 虚拟表 | `ingest_principles.py` | 随 principles 表行数同步膨胀 | 与 principles 表绑定 | 🟡 低 | 若 principles 表做物理清理，FTS 会自动通过触发器同步；或定期 `REBUILD`。 |
| 4 | `conflicts.json` 中 `resolved`/`ignored` 冲突 | `lint.py` | 每次 lint 保留旧冲突，resolved 条目永不删除 | 无清理 | 🟡 **中** | 增加保留期：resolved/ignored 超过 30 天或数量超过阈值时从 JSON 中物理移除。 |
| 5 | `conflicts.json` 中 `llm_judgment_cache` | `lint.py` | 每对新原则做 LLM 判定后追加缓存 | 无上限 / 无淘汰 | 🟡 **中** | 增加 LRU 或按时间淘汰：仅保留最近 N 条（如 500 条）或 30 天内的缓存。 |
| 6 | `link_overrides.json` 孤儿 doc key | `link_merge.py` | 文档删除/重名后旧 key 残留 | tombstone 有 TTL，doc key 无 TTL | 🟡 低 | 增加启动扫描：若 `doc_rel` 对应的文件已不存在，删除该 key。 |
| 7 | `notifications/*.md` | `notification_manager.py` | 每天生成一个文件 | 无保留期 | 🟡 低 | 增加 `rotate_notifications(retention_days=30)`，与 `rotate_logs` 类似。 |
| 8 | `.cooldown.json` 中已消失 issue ID | `notification_manager.py` | 每次通知追加新 issue ID，旧 ID 不删除 | 无清理 | 🟡 低 | 定期清理：仅保留在 `conflicts.json` 中仍存在的 open/resolved issue ID。 |
| 9 | `kg/.cache/embedding_index.sqlite` | `graphify_common.py` | 只读；kg 写入但不清理 | 无清理（kg 侧） | 🟡 低 | 在 kg 侧增加 `VACUUM` 或清理已不存在文件的 embedding。graphify 侧只读，影响有限。 |
| 10 | `logs/*.log` | `graphify_common.py` | 按模块+日期分文件 | 7 天 retention，但依赖调用方 | 🟡 低 | 将 `rotate_logs()` 封装为统一的 pipeline 收尾钩子，确保所有入口必经此步骤。 |
| 11 | `doc_meta` 表 | `ingest_principles.py` | `PRIMARY KEY(doc_path)` + upsert | 有主键约束 | 🟢 安全 | — |
| 12 | `knowledge_graph.json` | `graph_analyzer.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |
| 13 | `edge_stats.json` | `graph_analyzer.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |
| 14 | `community_clusters.json` | `graph_analyzer.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |
| 15 | `god_nodes.json` | `graph_analyzer.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |
| 16 | `supersede_gaps.json` | `supersede_gap_detector.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |
| 17 | `index.md` | `index_generator.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |
| 18 | `conflicts.md` | `lint.py` | 每次覆盖写入 | 无历史 | 🟢 安全 | — |

---

## 四、按风险等级排序的优先修复建议

### 🟡 中优先级（建议 1~2 个月内处理）

1. **`principle_history` 表追加 retention 策略**
   - 建议：增加 `prune_history(db_path, retention_days=180)` 函数，定期删除超过 180 天的 `change_type='delete'` 和 `'supersede'` 记录。
   - 理由：这是目前唯一没有任何约束的纯追加表，增长斜率最陡。

2. **`conflicts.json` 增加 resolved/ignored 冲突的物理清理**
   - 建议：在 `_merge_conflicts` 或 lint 流程末尾，将 `status='resolved'` 且 `resolved_at` 超过 30 天的条目从 `issues` 数组中移除。
   - 理由：conflicts.json 被频繁读写，文件膨胀直接影响 I/O 性能。

3. **`llm_judgment_cache` 增加容量上限**
   - 建议：改为 LRU 结构，仅保留最近 500 条或最近 30 天的缓存；超出部分在写入前丢弃。
   - 理由：LLM 缓存虽然加速了重复判定，但缓存 key 与具体原则内容绑定，旧缓存对已被 supersede 的原则对无价值。

4. **`principles` 表增加归档/硬删除机制**
   - 建议：对 `deleted_at IS NOT NULL` 且 `superseded_by IS NOT NULL` 且超过 90 天的记录，提供可选的 `prune_deleted_principles()` 函数进行物理删除（连带清理 principle_history 和触发 FTS delete）。
   - 注意：需评估是否需要保留审计追踪；若需要，可先导出到独立归档文件再删除。

### 🟡 低优先级（建议 3~6 个月内处理）

5. **`link_overrides.json` 清理孤儿 doc key**
   - 在读取/写入 `link_overrides.json` 时，扫描并删除 Vault 中已不存在的 `doc_rel` key。

6. **`notifications/` 增加日志式轮转**
   - 仿照 `rotate_logs()` 实现 `rotate_notifications(retention_days=30)`。

7. **`.cooldown.json` 同步清理**
   - 在 `generate_daily_digest()` 中，对比 `conflicts.json` 的现有 issue ID，清理已不存在的冷却记录。

8. **`logs/` 统一收尾钩子**
   - 在所有 pipeline 入口（或一个统一的 `run_pipeline()` 包装器）中统一调用 `rotate_logs()`，避免遗漏。

9. **Embedding 缓存（kg 侧）**
   - 建议在 kg skill 中增加定期 `DELETE FROM embeddings WHERE path NOT IN (现有文件)` 的清理逻辑。

---

## 五、综合结论

Understory 各模块的输出文件（JSON/Markdown）普遍采用**覆盖式写入**，这部分设计良好，无无限增长风险。

真正的风险集中在两个**"只增不删"的数据仓库**中：

1. **`principles.sqlite`**：`principles` 表软删堆积 + `principle_history` 表纯追加，是**最大的磁盘空间泄漏点**。
2. **`conflicts.json`**：`resolved`/`ignored` 冲突永久保留 + `llm_judgment_cache` 无限缓存，是**次大的 I/O 与内存泄漏点**。

其余问题（通知文件、冷却状态、link_overrides 孤儿项、日志依赖）属于**慢泄漏**，短期内不会构成问题，但长期运行（>6 个月）后需要关注。

**建议下一步行动**：为 `principles.sqlite` 和 `conflicts.json` 设计并实施物理清理/归档策略，其余低危项可排期逐步优化。
