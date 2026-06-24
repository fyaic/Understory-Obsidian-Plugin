# Understory 🌿

> **林下层** —— 森林冠层之下那层肉眼不太看见、却生机勃勃的植被。
> 你的笔记是冠层（canopy，明面），Understory 是其下默默生长、连接彼此的 AI 知识层。

Understory 是一个 Obsidian 自生长知识库系统：基于 understory-graphify-engine 关联发现引擎，在单 vault 内新增 `.understory/` AI 隐藏层，**自动提取原则、检测冲突、做图分析、生成知识索引，并维护实体-关系（ER）权威结构层**——人在 vault 正常读写笔记，AI 在底层维护知识的完整性与一致性，默认静默无打扰。

> **ER 桥接层（v1.7.0）**：将传统的"向量语义相似"扩展为"向量 + 实体关系"双轨召回。实体页（带 `er_type` frontmatter 的 Markdown）作为权威数据源，同步到独立的 `er.sqlite`，在关联发现、变更传播、质量检测三大工作流中深度激活。

底层关联发现能力（L1）继续提供：**持续自动更新**、**文件夹白名单/黑名单**、**水流式渐进处理**，让关联维护从"一次性"变为"可持续"。

---

## 知识库自生长 AI 层（v1.3.0 新增）

借鉴 Karpathy LLM Wiki 的 `ingest`/`lint` 与 Graphify 的图分析能力，在 **不破坏现有关联发现、不创建第二个 vault** 的前提下，新增六层能力，并在 v1.7.0 起加入独立 ER 权威结构层。AI 的全部元数据放在 vault 内 `.understory/`（Obsidian 不显示的点前缀目录），与人看的 `.md` 业务文档互不污染。

| 层 | 能力 | 触发 | 输出 |
|----|------|------|------|
| **ER** | **权威实体-关系桥接层**——实体页同步、ER 扩展召回、变更传播、schema 质量检测 | 文件保存 / CLI / 实体页 frontmatter 变更 | `.understory/er.sqlite` + `doc_entities` 桥接表 |
| L1 | 关联发现（已有，**重打保留用户手动链接**） | 文件修改后 10min | `## 🏷️关联文件`（哨兵区 + 删除记忆） |
| **L2** | **原则提取** | 文件修改后 10min（与 L1 并行） | `.understory/principles.sqlite` |
| **L3** | **冲突检测**（矛盾/过期/孤儿/死链/重复/术语 6 类，**已质量优化，误报 ~0**） | 每周 + 增量 | `conflicts.json` + 看板 `conflicts.md` + `## ⚠️冲突发现` |
| **L4** | **图分析**（社区聚类 / god node / 意外关联） | 每周 | `community_clusters.json` / `god_nodes.json` |
| **L5** | **知识索引** | 每次 lint 后 | `.understory/index.md` |
| **L6** | **通知**（每日摘要 / webhook / 7 天冷却） | 发现 high 冲突 | `.understory/notifications/` |

### 设计原则

- **单 vault 铁律**：绝不创建第二个 wiki/raw vault，AIC-000 就是真身。
- **隐藏层**：AI 元数据全在 `.understory/`（SQLite + JSON + Markdown）。
- **向后兼容**：不改 `api.py` 既有函数签名，不改插件既有事件逻辑，全部以独立模块/新增方法存在。
- **Cost control**：Graph analysis reuses the existing embedding cache and never recalculates vectors; model calls are controlled by the privacy mode.
- **Graceful fallback**：New installs default to `Local only`; `Vector model only` allows embedding calls only; `Full AI analysis` is required for LLM use. Missing model config falls back to keyword/rule paths without breaking the pipeline.
- **静默优先**：默认不弹窗，冲突就近呈现在文档 `## ⚠️冲突发现`（默认仅 high 级别，避免大规模改写笔记）。

### 目录结构

```
<Vault>/.understory/
├── er.sqlite                  ER 权威结构库（实体/关系/候选关系/文档实体桥接）
├── principles.sqlite          原则/断言/决策（+ FTS trigram 中文检索 + 历史版本）
├── conflicts.json             冲突报告（生命周期 open/resolved/ignored + LLM 判定缓存）
├── conflicts.md               冲突看板（人类可读，按严重度/类型分组）
├── community_clusters.json    社区聚类
├── god_nodes.json             god node + 意外关联
├── index.md                   AI 知识索引（7 板块）
├── notifications/YYYY-MM-DD.md 每日冲突摘要
├── logs/                       分级日志（保留 7 天）
├── link_overrides.json        删除记忆（tombstone，30 天 TTL）
├── AGENTS.md                   AI 操作契约
└── scripts/                    9 个 AI 模块（由 graphify-template/ 部署）
    ├── er_vault_ops.py         实体页扫描与 ER 数据库同步
    ├── er_bridge_search.py     ER 扩展召回（1 跳邻居 + 评分融合）
    ├── er_change_propagator.py 变更影响分析（4 层 UNION 受影响文档）
    ├── er_lint_checks.py       ER schema 校验与冲突检测
    ├── ner_simple.py           轻量级实体提及提取（字符串匹配）
    ├── hybrid_search.py        Hybrid 检索（向量/关键词/ER 三通道）
    ├── ...（原有 6 个模块）
```

### 命令与部署

插件新增命令（`Ctrl+P`）：**提取当前笔记原则**、**立即运行冲突检测 + 图分析**、**打开 AI 知识索引**。

首次启用时插件自动部署 `.understory/` 骨架（懒加载，延迟 5s，不阻塞冷启动）。也可手动部署：

```bash
# 部署
python scripts/deploy_graphify.py --vault "<你的 Vault>"

# 全库原则提取（建议配置 .env 后运行，获得 LLM 级质量）
python <Vault>/.understory/scripts/ingest_principles.py --all --vault "<你的 Vault>"

# 全库冲突检测（--fix 清理死链）+ 图分析 + 索引
python <Vault>/.understory/scripts/lint.py --vault "<你的 Vault>"
python <Vault>/.understory/scripts/graph_analyzer.py --vault "<你的 Vault>"
python <Vault>/.understory/scripts/index_generator.py --vault "<你的 Vault>"

# ER 权威结构层（独立 er.sqlite，不与原则/向量库混用）
python api.py er-init --vault "<你的 Vault>"
python api.py er-sync --vault "<你的 Vault>"          # 全库实体页扫描 + 同步
python api.py er-lint --vault "<你的 Vault>"          # ER schema 质量检测
python api.py er-query --vault "<你的 Vault>" "张三" --depth 2

# 实体页创建示例（Obsidian 中新建 .md 文件，frontmatter 声明即可）
# ---
# er_type: Person
# er_id: person-zhangsan
# name: 张三
# aliases: [三哥, San Zhang]
# attributes:
#   role: 产品总监
#   department: 产品部
# ---
```

也可通过 `api.py` 桥接函数调用：`init_graphify` / `ingest_principles_for_doc` / `lint_vault_for_conflicts` / `analyze_graph` / `generate_ai_index` / `run_full_maintenance`，以及 ER 相关的 `init_er_index` / `sync_entities_from_vault` / `query_entity_paths` / `add_entity` / `add_relation` / `refresh_doc_entities_for_content` / `er_extend_relations` / `get_docs_affected_by_entity_change`。

---

## 与 Skill 方案的区别

| 维度 | Skill 调用 relate-note | Understory 插件 |
|------|----------------------|-------------------|
| 触发主体 | 依赖 LLM 主动调用 | Obsidian 事件监听，不依赖 LLM |
| 覆盖率 | 仅 Skill 创建的笔记 | 所有 Markdown 笔记（Agent + 手动）|
| 可靠性 | LLM 可能遗忘 | 100% 覆盖，防抖触发 |
| 使用方式 | Agent 内部调用 | 用户无感知，后台自动运行 |
| 关联维护 | 一次性建联 | **持续自动刷新，保持关联新鲜** |

---

## 安装方式（开发/内测手动安装，v1.7.0）

本插件**没有发布到 Obsidian 社区插件市场**，只能通过手动复制安装。

### 步骤

1. 生成并复制单文件插件入口到 Vault 的插件目录：

```
目标路径: <你的 Vault>/.obsidian/plugins/understory/
python scripts/bundle_obsidian_plugin.py --plugin-dir obsidian-plugin --out "<你的 Vault>/.obsidian/plugins/understory/main.js"
复制: obsidian-plugin/manifest.json 和 obsidian-plugin/styles.css
```

2. 配置本地引擎路径。

插件默认读取系统环境变量；也可以在 Understory 设置页手动填写。

```powershell
setx UNDERSTORY_ENGINE_DIR "C:\Hello-World\understory-graphify-engine"
setx UNDERSTORY_PYTHON_PATH "python"
setx UNDERSTORY_NETWORK_MODE "local"
```

配置后重启 Obsidian，让桌面进程读取新的环境变量。

3. 在 Obsidian 中启用：
   - 设置 → 社区插件 → 关闭安全模式
   - 找到 **Understory** → 启用

4. 首次使用：
   - 打开 Understory 设置页 → 点击「检查设置」
   - 按 `Ctrl+P` → 输入"准备本地搜索索引" → 回车
   - 等待索引完成（首次需要几分钟，取决于笔记数量）

---

## Privacy and Model Configuration

Understory is local-first. The development team does not receive, collect, store, or access user notes, API keys, embeddings, prompts, model responses, or local logs. When cloud models are enabled, requests are sent directly from the user's device to the model provider or custom endpoint they choose.

## Payment Status

Understory's initial Obsidian Community listing should be marked as **Optional payments**.

Understory is free to install and use in `Local only` mode. The Understory development team does not charge users in the initial release. Optional cloud model features can use a provider configured by the user, such as Zhipu, OpenAI, or a custom OpenAI-compatible endpoint. Provider accounts, API keys, pricing, privacy terms, and billing are controlled by the selected provider, not by the Understory team.

Do not describe the Community listing as plain Free while cloud model integrations are advertised. If Understory later adds developer-operated paid features, update the listing, README, privacy notice, release notes, support policy, and any license/account flow together.

| Mode | Behavior |
| --- | --- |
| Local only | Default mode. No cloud model requests and no webhook delivery. Uses local files, keywords, ER data, existing caches, and basic reports. |
| Vector model only | Sends only text snippets needed for similarity analysis to the configured vector model. LLM/chat APIs are blocked. |
| Full AI analysis | Allows both vector and reasoning models for semantic indexing, claim extraction, concept explanations, and conflict checks. |

Supported provider options:

- `zhipu`: Zhipu preset, default `https://open.bigmodel.cn/api/paas/v4/`
- `openai`: OpenAI preset, default `https://api.openai.com/v1/`
- `custom`: custom OpenAI-compatible service
- `none`: no cloud model

Embedding and LLM providers can be configured separately. Webhook delivery is a separate opt-in, is off by default, and is blocked in `Local only` mode. See [PRIVACY.md](./PRIVACY.md) for the full notice.

---

## 使用方法

### 自动模式（默认）

启用插件后无需任何操作：
- 新建或修改任意 Markdown 笔记
- 停止编辑 10 分钟后，自动触发关联发现
- 右下角弹通知提示结果
- **点击通知可直接跳转到该笔记**

### 持续自动更新（新增）

在插件 Setting 中开启「**启用持续自动更新关联**」后：

- 插件会按设定频率（每周/每月）自动重打所有关联区块
- 只更新你勾选的文件夹（白名单），排除黑名单中的文件夹，避免浪费 API 调用
- 采用**水流式渐进处理**：逐篇处理，每篇间隔 5 秒，不卡顿
- 可随时手动触发「立即全量刷新」或取消

> 适合 vault 笔记量大、需要长期维护关联新鲜度的场景。

### 文件夹白名单（新增）

在 Setting 的「文件夹白名单」中：

- 树形结构展示所有文件夹，支持**折叠/展开**
- 勾选需要参与自动更新的文件夹
- 未勾选的文件夹永远不会被自动重打关联
- 支持「全选」「全不选」「全部展开」「全部折叠」

> 建议排除：Daily Notes、剪藏、归档旧项目等噪音文件夹。

### 关联日志

在插件设置面板底部查看所有历史建联记录：

| 信息 | 说明 |
|------|------|
| 时间 | 建联完成的精确时间 |
| 状态 | 成功（绿色 `+N`）/ 失败（红色）/ 跳过（灰色）|
| 文件名 | 被处理的笔记名称 |
| 关联列表 | 该笔记被关联到的其他笔记标题 |
| 失败归因 | 失败时显示分类（如「网络超时」「索引错误」）|

**点击任意日志条目即可跳转到对应笔记。** 日志上限 200 条，超出后自动淘汰最早记录。

### 手动命令

按 `Ctrl+P`：
- **立即为当前笔记发现关联** — 立即对当前打开的笔记运行关联发现
- **初始化 Embedding 索引** — 重建全库索引（笔记大量变更后使用）

### ER 权威结构层（v1.7.0 全面集成）

ER 层管理**硬关系**——组织架构、人员职责、项目归属、概念依赖——这些关系是**用户/系统明确声明的**，与向量检索的"语义相似"形成互补。

#### 三层并存，互不混淆

| 数据层 | 文件 | 负责什么 | 典型查询 |
| :--- | :--- | :--- | :--- |
| **ER 权威结构层** | `.understory/er.sqlite` | 实体、权威关系、文档实体桥接、变更传播队列 | "张三负责哪些项目？" |
| **原则/冲突时序层** | `.understory/principles.sqlite` | 原则、断言、决策、版本演进、冲突 | "我们对 B 端定价有哪些说法？" |
| **向量语义层** | `.cache/embedding_index.sqlite` | 文档 embedding、柔性语义召回 | "找和'复杂系统'相关的文档" |

ER 数据库与原则/向量库**物理隔离**——三个 SQLite 各自独立，职责清晰，避免单库 schema 膨胀。

#### 实体页即 Markdown

实体是 Obsidian 中的普通 `.md` 文件，通过 YAML frontmatter 声明：

```markdown
---
er_type: Person
er_id: person-zhangsan
name: 张三
aliases: [三哥, San Zhang]
attributes:
  role: 产品总监
  department: 产品部
---
```

放到 `Entities/`、`People/`、`Projects/`、`Concepts/` 等目录下，保存时**自动同步**到 `er.sqlite`。

#### 三大工作流已深度植入

| 工作流 | 触发时机 | ER 做什么 |
|--------|---------|----------|
| **关联发现（L1）** | 文件保存后 10min | 先 `sync_single_entity_page()` 同步实体页；再 `refresh_doc_entities_for_content()` 提取文档中的实体提及；最后 `er_extend_relations()` 做 1 跳 ER 权威关系扩展，融合到向量/关键词结果中 |
| **变更传播** | 实体页内容变更 | `get_docs_affected_by_entity_change()` 四层 UNION 找出受影响文档（直接提及 + 邻居提及 + source_doc），重新触发关联发现 |
| **质量检测（L3）** | lint 时 | `check_er_conflicts()` 检测 schema 违反、实体页与数据库不同步、关系类型违反 schema |

#### ER 扩展召回 vs 向量召回

| 维度 | 向量召回 | ER 扩展召回 |
|------|---------|------------|
| 依据 | 语义相似度（embedding 余弦） | 权威关系（`manages`/`belongs_to`/`depends_on` 等） |
| 典型场景 | "找和'复杂系统'相关的文档" | "张三负责的项目有哪些文档？" |
| 评分封顶 | 无（纯余弦） | 0.99（含 confidence + mention 密度加权） |
| 融合方式 | Hybrid 三路合并 | 作为独立 channel 混入 Hybrid 结果 |

ER 扩展**不是替代向量**，而是填补"我知道有关系，但语义上可能不像"的空白。比如「项目周报」和「项目技术方案」语义差异大，但通过 `participates_in` 关系可以准确链到同一个项目。

---

## 设置面板

设置 → 社区插件 → Understory → 选项：

### 基础设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| Understory 目录 | `C:/.../understory-graphify-engine` | 技能包绝对路径 |
| Python 路径 | `python` | Python 可执行文件 |
| 防抖时长 | 10 分钟 | 停止编辑后多久触发 |

### 持续自动更新（新增）

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 启用持续自动更新 | 关闭 | 总开关，控制是否启用定时刷新 |
| 更新频率 | 每周 | 每周/每月自动全量刷新一次 |
| 文件夹白名单 | 全部 | 勾选参与自动更新的文件夹 |
| 排除文件夹（黑名单） | 无 | 勾选不参与任何建联的文件夹，与白名单互斥 |
| 上次更新时间 | — | 显示上次全量刷新的时间 |
| 立即全量刷新 | — | 手动触发一轮水流式刷新 |
| 取消刷新 | — | 中断当前进行中的刷新 |

### 关联日志

查看历史建联记录，支持点击跳转和一键清空。

---

## 依赖

- Obsidian 桌面版（需要 Node.js `child_process`）
- Python 3.10+
- PyYAML（解析 `er_schema.yaml` 和实体页 frontmatter）
- `UNDERSTORY_ENGINE_DIR` 指向本地 understory-graphify-engine 仓库；也可在插件设置页覆盖。
- `UNDERSTORY_PYTHON_PATH` 可选，默认 `python`。
- understory-graphify-engine 技能包已配置（`.env` 中可选配置智谱 API Key；缺 key 时降级为关键词/规则路径）

设置页的「检查设置」会检查 engine 目录、`api.py`、`scripts`、Python 和 `requirements.txt` 对应依赖是否可用。

---

## 完整流程

### 新笔记自动建联

```
用户在 Obsidian 中创建/编辑笔记
        ↓
插件监听到 vault.on('create') / vault.on('modify')
        ↓
启动 10 分钟防抖计时器（期间继续编辑则重置）
        ↓
10 分钟无编辑 → 触发
        ↓
检查本地引擎：UNDERSTORY_ENGINE_DIR / api.py / scripts / Python
        ↓
child_process.spawn(UNDERSTORY_PYTHON_PATH || 'python', ['api.py', 'auto-link', <文件路径>])
        ↓
Understory 执行：
  1. 检查是否已有 wikilink → 有则跳过
  2. 计算 Embedding（智谱 API）
  3. 与 SQLite 索引做余弦相似度比对
  4. LLM 提取核心概念 + Hybrid 分组
  5. 生成 ## 🏷️关联文件 区块写入笔记末尾
        ↓
插件解析返回的 JSON
        ↓
右下角通知："已为 [[xxx]] 发现 N 条关联"
        ↓
（点击通知 → 跳转到该笔记）
        ↓
记录写入关联日志（Setting 面板可查看）
```

### 持续自动更新（新增）

```
插件启动 / 设置变更
        ↓
checkAndStartRefresh()
        ↓
距离上次全量更新是否超过设定周期？
        ↓
是 → startRefreshQueue()
        ↓
获取白名单文件夹下的所有 Markdown 文件
        ↓
构建刷新队列 refreshQueue
        ↓
processNextInQueue() ──→ runGraphifyAsync(file)
        ↑                      ↓
    5秒后递归 ←────────── 处理完成
        ↓
队列全部处理完毕
        ↓
更新 lastRefreshTime = Date.now()
        ↓
通知："全量更新完成，共处理 N 篇"
```

---

## 故障排查

### 日志中出现「Python 崩溃」或空输出

- If cloud model features are needed, check the `Privacy and models` settings or the Provider/API Key values in `.env`.
- If `Local only` is selected, cloud model features being unavailable is expected; Understory uses local/keyword/rule paths.
- 打开 Understory 设置页，点击「检查设置」
- 检查 `UNDERSTORY_ENGINE_DIR` 是否指向 understory-graphify-engine 仓库
- 首次使用需要先运行「准备本地搜索索引」

### 关联刷新卡住或不进行

- 检查「持续自动更新」Toggle 是否开启
- 检查白名单中是否有文件夹被勾选
- 检查文件是否在黑名单中（黑名单全局生效，实时触发也会跳过）
- 点击「立即全量刷新」手动触发一次

### API 调用成本

- `Local only`: no cloud model calls, so cloud model cost is 0.
- `Vector model only`: vector model cost only.
- `Full AI analysis`: vector model and reasoning model costs apply, depending on the provider and model selected.
- 建议只勾选必要的文件夹，其余排除

---

## 更新日志

### v1.7.0（2026-06-06）—— ER 桥接层：硬关系深度激活

ER 层从"独立基础层"升级为"深度桥接层"——不再是孤立的实体/关系存储，而是**在关联发现、变更传播、质量检测三大工作流中全面激活**。

- **数据库物理隔离**：`.understory/er.sqlite` 独立存在，与 `principles.sqlite`（原则/冲突）和 `.cache/embedding_index.sqlite`（向量）零耦合。6 张表：`entities`、`relations`、`relation_candidates`、`doc_entities`、`entity_aliases`、`er_sync_log`。
- **Schema 类型系统**：`er_schema.yaml` 定义 4 实体类型（`Person`/`Department`/`Project`/`Concept`）× 6 关系类型（`reports_to`/`belongs_to`/`manages`/`participates_in`/`depends_on`/`contains`）。
- **三大工作流植入**：
  - `discover_relations()`：`_merge_recalls()` 后插入 ER 扩展——先 `refresh_doc_entities_for_content()` 提取实体提及，再 `er_extend_relations()` 做 1 跳邻居扩展，最后 `_merge_er_relation_results()` 融合到 Hybrid 结果。
  - `on_file_changed()`：文件读取后调用 `_sync_er_bridge_for_change()`——同步实体页 → 刷新文档实体提及 → 传播变更（`get_docs_affected_by_entity_change()` + `_queue_doc_for_relation_refresh()`）。
  - `lint.py`：新增 `_append_er_issues()`，检测 `er_entity_schema_violation`、`er_entity_missing_in_db`、`er_entity_out_of_sync`、`er_relation_schema_violation`。
- **实体页自动同步**：保存带 `er_type` frontmatter 的 `.md` 文件时自动 upsert 到 `er.sqlite`；支持别名、属性、多目录扫描（`Entities/`/`People/`/`Projects/`/`Concepts/`）。
- **ER 扩展召回**：1 跳权威关系扩展，评分 `0.62 + confidence×0.18 + min(source_mentions,3)×0.03`，封顶 0.99，与向量/关键词三路融合。
- **变更传播**：实体变更后 4 层 UNION 找出受影响文档（直接提及 + 邻居提及 + source_doc），重新触发关联发现，避免全库重算。
- **轻量级 NER**：`ner_simple.py` 基于字符串匹配（非 LLM），支持中英文混合、别名匹配、span 级去重。
- **产品化运行时**：插件默认从 `UNDERSTORY_ENGINE_DIR` 读取本地引擎路径，`UNDERSTORY_PYTHON_PATH` 读取 Python 路径；设置页新增本地引擎检查，提前发现 engine 路径、`api.py`、`scripts` 或 Python 不可用的问题。
- **Privacy hardening**：added `Local only` / `Vector model only` / `Full AI analysis` network modes, separate Embedding and LLM provider settings, and explicit opt-in for Webhook delivery.
- **版本同步**：manifest、根 README 和插件 README 统一到 v1.7.0。
- **CLI 扩展**：新增 `er-sync`（全库实体页扫描）、`er-lint`（ER 质量检测），保留原有 `er-init`/`er-query`。
- **向后兼容**：`api.py` 既有函数签名零改动；`principles.sqlite`/`embedding_index.sqlite`  untouched；实体页仍是普通 `.md`。
- **测试**：`test_er_bridge.py`、`test_er_layer.py`、`test_api_core.py` 全量通过（含 `refresh_relations()` ER 同步验证）。

### v1.6.0（2026-06-02）—— 时序记忆：分清"矛盾"与"版本演进"

让冲突检测知道文档新旧，把"旧策略被新策略取代"从伪矛盾里摘出来。

- **content_date**：给每篇文档算"内容时间"（YAML frontmatter `date` → 标题日期 → 文件 mtime 三层回退，带可靠性标记），存入 `doc_meta`。
- **LLM 顺手分型**：复用现有矛盾判定的同一次 LLM 调用（同一份缓存、零新增成本），判定从 `{contradiction|no_contradiction|uncertain}` 扩成含 **`evolution`**。
- **演进降噪**：LLM 判为版本演进 → `subtype=evolution, severity=low` + "建议标记 superseded"，冲突仍 open；真矛盾仍 high。content_date 只用来判新旧方向（仅在日期可靠时采信）。
- **不自动改库**：`superseded_by`/`version`/resolved 只由用户显式 `api.accept_supersede(older, newer)` 落库。
- 设计取舍：用语义分型替代"盲目 90 天阈值"——实测全库仅 12% 文档有可靠日期，纯时间判断会大面积误判。

### v1.5.0（2026-06-02）—— 关联融合：重打不再覆盖用户手动链接（AIC-2108）

解决"重打 `## 🏷️关联文件` 会冲掉用户手动维护"的痛点。新增 `link_merge.py`，接入 `api.py` 写入路径（`build_orphan_links` / `refresh_relations` / `on_file_changed`，既有签名零改动）。

- **哨兵区**：系统只重写 `<!-- auto-links -->…<!-- /auto-links -->` 之间的内容；区外用户加的链接永远保留。顺带区分"用户手动 vs AI 链接"，收口 AIC-1871（消除"已有 wikilink 则冻结"）。
- **删除记忆（tombstone）**：用户删掉的自动链接记入隐藏层 `.understory/link_overrides.json`，重打时排除，避免复活。带 **TTL 30 天**自动解禁、**target_hash** 目标变化即失效、**手动重写自动解封**。
- **旧区块迁移**：已有但无哨兵的区块首次重打时自动并入哨兵区，避免更新停摆。

### v1.4.0（2026-06-01）—— 冲突检测质量优化

把 lint 误报率从 >90% 降到约 0，**活跃冲突 1196 → 47**（剩余 90%+ 为真实问题）。

- **expired_claim 三层过滤**（18→1）：ingest 层 `SKIP_PATTERNS` 跳过记录性日期（生成时间/周报/纯日期）；lint 层 `_is_commitment` 仅对承诺性内容（计划/截止/目标）查过期；按子类型 plan/deadline 分层建议。
- **principle_contradiction LLM 精判**（8→0）：difflib 阈值 0.55→0.70 + 共同 2-gram 比例≥0.30 预筛；**LLM 判定缓存** `llm_judgment_cache`（持久化于 conflicts.json）；**关键变更：LLM 未确认 / 预算耗尽时不生成冲突**（宁可漏报，不可误报）；对立词降级为仅做候选排序。
- **orphan_page 语义反转**（488→3）：从"任何无连接文件"改为"**有原则却被孤立**"才报告（无原则的剪藏/群聊/周报不报）。
- **子类型体系 `CONFLICT_SUBTYPES`**：所有冲突带 `subtype`，severity 按 `type+subtype` 动态计算（`None` 的子类型不生成）。
- **报告体验**：新增人类可读看板 `.understory/conflicts.md`（按严重度/类型分组）；`index.md` 第六节升级为类型聚合 + 子类型分布 + 优先处理清单；文档内冲突区块默认放宽到 medium+high。

### v1.3.0（2026-06-01）—— 知识库自生长升级

- **新增 L2 原则提取** `ingest_principles.py`：从单篇文档提取原则/断言/决策/问题存入 `principles.sqlite`；LLM（glm-4-flash）+ 规则式降级；基于 embedding 相似度的智能合并（更新/取代/新增/软删 + 历史版本）；content hash 去重；FTS5 `trigram` 中文子串检索；噪声黑名单（日报/剪藏/聊天记录…）追溯生效。
- **新增 L3 冲突检测** `lint.py`：6 类冲突（原则矛盾/过期断言/孤儿页/死链/重复原则/术语不一致）；冲突生命周期（open→resolved/ignored，severity 自动升级）；scope-aware 增量 lint（不误判全量结果）；死链 `--fix` 自动清理（大小写修复 + 路径/锚点归一化）。
- **新增 L4 图分析** `graph_analyzer.py`：完全离线复用 embedding 缓存；kNN 稀疏相似度图 + networkx greedy_modularity 社区聚类（纯 Python 连通分量保底）；god node（近似介数中心性）+ 跨社区意外关联。
- **新增 L5/L6** `index_generator.py` / `notification_manager.py`：7 板块 AI 知识索引；每日摘要 + Slack/飞书/企微 webhook + 7 天冷却。
- **插件集成**：`scheduleIngest` / `checkAndStartLint` 定时编排 / 冲突区块就近插入 / 懒加载冷启动（onload <100ms）/ AI 层设置页；全部为新增方法，既有事件逻辑零改动。
- **API 桥接**：`api.py` 新增 6 个高层函数（纯增量，既有签名零改动）；`deploy_graphify.py` 幂等部署；`graphify-template/` 权威脚本副本。

### v1.2.0（2026-05-11）

- **新增**：`refresh-link` 命令（AIC-2189）—— 全量刷新时不再跳过已有 wikilink/关联区块的文档，已有关联的笔记也能获得更新
- **新增**：增量索引守护进程 `scripts/index_daemon.py`（AIC-2190）—— 独立后台管道，定时扫描 vault，只处理 mtime 变更的文件，保持 Embedding 索引近实时新鲜
- **新增**：全量刷新 content hash 检测（AIC-2191）—— 文档内容未变时直接跳过，零 API 调用，大幅降低周期性刷新的费用
- **优化**：解耦索引更新与关联发现（AIC-2194）—— `refresh_relations` 批量场景不再顺带触发 `_ensure_index_fresh`，消除冗余全库扫描
- **修复**：补充缺失的 `hashlib` 导入、清理 `---` 分隔线残留、捕获 SQLite 缺失异常

### v1.1.0（2026-04-28）

- **新增**：持续自动更新（Toggle + 频率配置）
- **新增**：文件夹白名单与黑名单（树形折叠结构，互斥灰显）
- **修复**：勾选后数量文本实时更新，增加 `✓ 已保存` 状态提示
- **新增**：水流式渐进重打（逐篇处理，5 秒间隔）
- **新增**：失败归因分类（配置错误/网络超时/索引错误等）
- **修复**：Python 异常导致的 EOF 报错（两端加保护）
- **优化**：skipped 日志显示灰色而非红色
