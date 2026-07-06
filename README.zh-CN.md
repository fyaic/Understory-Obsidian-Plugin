# Understory

<p align="center">
  <img src="assets/understory-logo.png" alt="Understory logo" width="220">
</p>

[English README](README.md) · [官网](https://bondie.io/research/understory) · [隐私说明](PRIVACY.md)

Understory 是一个面向 Obsidian 的本地优先知识层。它会在你的 vault 下方构建一个私有维护层，由 Vector、ER 和 Graph analysis 共同驱动，用来长期发现、维护和刷新笔记之间的关系、主张、概念、冲突和孤立页面。

它不是把你的 vault 上传到 Bondie Labs 的服务里分析。本仓库已经内置本地 Understory engine。默认模式是本地优先；只有当你主动选择云模型模式并填写自己的模型服务密钥时，相关片段才会发送给你选择的服务商。

## 它能做什么

- 在右侧栏通过 **Show Understory** 显示关联建议。
- 新安装默认使用 **仅右侧栏** 呈现。除非你主动选择写入正文的呈现模式，或明确点击 **Insert into body**，Understory 不会自动把关联笔记区块写入笔记正文。
- 用混合信号发现笔记关系，包括本地结构、实体事实、图分析和可选的语义模型信号。
- 提醒潜在冲突、过期笔记、孤立页面和断裂的知识路径。
- 在 `.understory` 中维护本地报告和缓存。
- 支持英文和中文界面。
- 先选择隐私模式，再配置模型服务。

## 隐私模式

Understory 默认本地优先。

| 模式 | 行为 |
| :--- | :--- |
| 完全本地 | 不请求云端模型或 Webhook，也不会把模型服务密钥传给本地引擎进程。只使用本地文件、关键词、ER 数据、已有缓存和报告。 |
| 只用向量模型 | 只把用于相似度分析的标题或片段发送给你配置的向量模型服务商。不会调用推理模型。 |
| 完整 AI 分析 | 允许向量模型和推理模型，用于语义索引、概念提取、解释和冲突检查。 |

可选云功能支持 OpenAI、智谱、Kimi/Moonshot 或自定义 OpenAI-compatible endpoint。密钥由你自己提供。Bondie Labs 不会接收或代管你的笔记、prompt、embedding、模型响应、日志或 API key。

**联网与隐私** 设置页可以选择服务商、填写 API key，并修改 Endpoint / Base URL 和模型名称。OpenAI、智谱和 Kimi/Moonshot 会自动预填常见 endpoint，但你仍然可以改成兼容网关、自建服务或其他兼容服务。

插件日志和短诊断会脱敏已知 API key、Bearer token、Webhook URL 等敏感信息。默认不会把 raw process stdout 存入插件日志。

付费状态建议为 **Optional payments**。插件可以免费安装，本地模式不需要 API key。模型服务商账号、密钥、价格、额度、隐私条款和账单由你选择的服务商负责。

## 许可证

Understory 以 [PolyForm Perimeter License 1.0.0](LICENSE) 形式 source-available。你可以使用、审阅、修改和再分发源码，但不能用它向他人提供与 Understory 竞争的产品。

版权 Required Notice 和商业授权主体见 [NOTICE](NOTICE)。如果需要把 Understory 封装进竞品、产品包或其他超出 PolyForm Perimeter 条款的商业用途，请联系 Fuyo AI Tech Co. Limited 获取商业授权。

## 运行要求

- Obsidian 桌面版。
- 本仓库内置的本地 Understory engine。
- 本机可用的 Python。

插件使用本地文件、Node API 和 Python 子进程，因此是 desktop-only。

## 手动安装

插件进入 Obsidian Community directory 之后，官方安装会使用 release assets 中的 `manifest.json`、`main.js` 和 `styles.css`。Understory 会把本地 engine payload 内嵌在 `main.js` 中，并在首次加载插件时释放到插件目录。

在 Community directory 同步到最新 release 之前，可以直接从 GitHub release 下载同一组三个 release assets：

1. 在你的 vault 中创建这个文件夹：

   ```text
   <你的 Vault>/.obsidian/plugins/understory/
   ```

2. 从 GitHub release 下载下面三个文件，并放进这个文件夹：

   ```text
   <你的 Vault>/.obsidian/plugins/understory/manifest.json
   <你的 Vault>/.obsidian/plugins/understory/main.js
   <你的 Vault>/.obsidian/plugins/understory/styles.css
   ```

3. 重启 Obsidian。
4. 在 **设置 -> 社区插件** 中启用 **Understory**。
5. 首次加载后，确认内置 engine 已释放：

   ```text
   <你的 Vault>/.obsidian/plugins/understory/understory-graphify-engine/api.py
   ```

## 本地引擎配置

Obsidian 插件和本地分析 engine 现在在同一个仓库中。engine 位于 `understory-graphify-engine/`。release 构建也会把这份 engine 内嵌进 `main.js`，所以标准 Obsidian 安装可以自动在插件目录中释放 engine。

```powershell
cd understory-graphify-engine
python -m pip install -r requirements.txt
```

Understory 会自动安装并查找内置 engine，搜索范围包括插件目录、仓库目录和常见本地工作区。标准 Obsidian 安装会释放到 `<vault>/.obsidian/plugins/understory/understory-graphify-engine/`。多数用户不需要手动设置引擎路径。

如果你移动过引擎，或想固定使用某一份引擎副本，可以在启动 Obsidian 前设置引擎路径：

```powershell
$env:UNDERSTORY_ENGINE_DIR="<你的 Vault>\.obsidian\plugins\understory\understory-graphify-engine"
$env:UNDERSTORY_PYTHON_PATH="python"
```

也可以在 **设置 -> Understory -> 开始使用** 中覆盖 Understory 引擎文件夹和 Python 路径。当 `python` 不可用时，Understory 会自动寻找 `python3`，包括 macOS Homebrew 常见路径 `/opt/homebrew/bin/python3`。修改系统环境变量后，需要重启 Obsidian，让桌面进程重新读取环境。

设置页已经拆成多个 tab。多数用户只需要看 **开始使用**、**联网与隐私**、**关联发现** 和 **关联维护**。**Agent访问** 放在关联工作流之后，首次配置时不会直接把版本、路径和检查矩阵堆在第一屏。

**检查设置（Check setup）** 会检查本地引擎、Python、脚本、vault `.understory` 部署和权限问题。每个问题都会给出修复建议，必要时附带可复制命令。面板不会自动执行 `pip install`、`git pull` 或其他修复命令。

常见手动修复命令：

```powershell
python -m pip install -r "<你的 Vault>\.obsidian\plugins\understory\understory-graphify-engine\requirements.txt"
$env:UNDERSTORY_ENGINE_DIR="<你的 Vault>\.obsidian\plugins\understory\understory-graphify-engine"
$env:UNDERSTORY_PYTHON_PATH="python"
```

如果需要把配置情况发给维护者，点击 **复制诊断（Copy diagnostics）**。复制出的摘要会避免包含 API key、webhook URL 和 vault 笔记正文。

### Embedding 索引

Understory 现在把本地引擎就绪和语义 Embedding 就绪拆成两个状态。本地引擎可以已经可用，但语义向量召回仍然关闭，或还在等待配置。

- **Local only**：语义向量召回是主动关闭的。Understory 会继续使用本地文件、关键词、ER、链接和图结构；缺少 Embedding 索引不是错误。
- **只用向量模型** 或 **完整 AI 分析** 但还没填写向量 API key：设置页会提示 Embedding API 尚未配置，并引导你回到 **联网与隐私**。
- 已配置向量服务商但还没有索引：设置页会显示 **构建/更新 Embedding 索引**。这会在本机创建或更新 SQLite 缓存，不代表安装了本地 embedding 模型。
- 就绪状态：设置页会展示语义索引状态、可用时显示已索引笔记数，以及本机索引路径。

如果 Embedding 缓存还没构建，Understory 不会只抛出原始 Python 退出码然后停止。它会先降级使用本地关键词结果，给出可操作提示，并在设置页保留清晰的配置路径。你也可以在终端中运行：

```powershell
python "<你的 Vault>\.obsidian\plugins\understory\understory-graphify-engine\api.py" init --vault "<你的 Vault>"
```

## 首次使用

1. 打开 **设置 -> Understory**。
2. 在 **开始使用** 中确认自动识别到的 Understory 引擎文件夹和 Python。
3. 点击 **检查设置（Check setup）**。
4. 在 **联网与隐私** 中保持 **Network mode** 为 **Local only**，或主动选择云模型模式并配置自己的模型服务密钥、Endpoint / Base URL 和模型名称。
5. 如果选择了向量模式，请使用 **开始使用** 或 **联网与隐私** 里的语义索引卡片检查状态，并在服务商配置完成后构建/更新本机 Embedding 索引。
6. 如果要让外部 Agent 把这个 vault 当作本地知识 API 使用，打开 **Agent访问**，先创建本地 MCP server 文件，再把 MCP JSON 复制到 Agent 的 MCP 设置，并复制配套的 Skill prompt。
7. 打开命令面板，运行 **Show Understory**。

## Agent API

Understory 也提供本地 Agent API，方便自动化工具读取和维护关系数据。它不是 HTTP server，不会打开端口；Agent 可以通过 JSON CLI 或 MCP stdio server 调用。

普通 Obsidian 插件用户请打开 **设置 -> Understory -> Agent访问**。这个页面会提供：

- 可复制的、绑定当前 vault 的 MCP JSON 配置，server key 例如 `understory-work-notes`。
- 创建到 `.understory/agent/understory-mcp-server.js` 的本地 MCP server 文件；它不是云端 server，也不会打开 HTTP 端口。
- 用途选择：**Query-only** 或 **Agent memory model**。
- 面向 Generic MCP、Codex、Claude Desktop、Cursor、OpenClaw 的安装说明。
- 可复制的 Skill prompt，用来把 Agent 绑定到当前 vault 和所选用途。
- 包含 MCP config、Skill、vault identity 和安装说明的 setup pack。
- 不含 API key、Webhook URL 和 vault 笔记正文的本地诊断摘要。

Understory 只识别当前打开的 vault。如果你有多个 Obsidian vault，请分别在每个 vault 内重复这个流程，并把每次生成的 MCP server entry 加入 Agent 配置。不要让所有 vault 都复用一个全局 `understory` key。

Skill 有两个版本：

- **Query-only**：只有当你明确要求查询、搜索、引用、总结或检查当前 vault 时，Agent 才调用 Understory。这个模式更保守，默认只读。
- **Agent memory model**：Agent 把 Understory 当作主动上下文和长期记忆层。遇到相关的长期任务或项目工作时，它可以先获取上下文再规划，并在结束时提出值得沉淀的记忆或关系更新；但本地写入仍需要用户确认。

两个版本都会带上业务知识地图工作流：Agent 应该设计多组聚焦查询，通过 MCP 读取 scoped context，按业务意义归类笔记，识别缺口，并给出按角色区分的阅读路径，而不是直接粘贴搜索结果。

开发者仍可在本仓库中直接使用以下命令：

```powershell
node scripts/understory-agent-cli.js status --vault "C:\path\to\vault" --json
node scripts/understory-agent-cli.js get-relations --vault "C:\path\to\vault" --note "Notes/A.md" --json
node scripts/understory-agent-cli.js refresh-relations --vault "C:\path\to\vault" --note "Notes/A.md" --engine-dir "C:\path\to\vault\.obsidian\plugins\understory\understory-graphify-engine" --json
node scripts/understory-agent-cli.js insert-relation --vault "C:\path\to\vault" --note "Notes/A.md" --target "Notes/B.md" --title "B" --json
```

分别在每个 vault 点击 **创建本地 MCP server 文件** 后，多 vault MCP 配置示例：

```json
{
  "mcpServers": {
    "understory-work-notes": {
      "command": "node",
      "args": [
        "C:/path/to/work-vault/.understory/agent/understory-mcp-server.js",
        "--vault",
        "C:/path/to/work-vault",
        "--engine-dir",
        "C:/path/to/work-vault/.obsidian/plugins/understory/understory-graphify-engine"
      ]
    },
    "understory-research-vault": {
      "command": "node",
      "args": [
        "C:/path/to/research-vault/.understory/agent/understory-mcp-server.js",
        "--vault",
        "C:/path/to/research-vault",
        "--engine-dir",
        "C:/path/to/research-vault/.obsidian/plugins/understory/understory-graphify-engine"
      ]
    }
  }
}
```

开发者从本仓库运行时，也可以把 server path 改成 `scripts/understory-mcp-server.js`。

所有 Agent API 响应都使用包含 `ok`、`data`、`error`、`meta` 的 JSON envelope。API 会把路径限制在指定 vault 内，默认不返回完整笔记正文，并复用 Understory 的敏感信息脱敏逻辑。完整工具契约见 [docs/AGENT_API.md](docs/AGENT_API.md)。

当前 MCP 读工具包括 status、capabilities、graph summary、note relations、本地关键词/关系搜索、上下文包和 note brief。写入类工具仍然只作用于本地 vault，并应在用户确认后使用。

关系元数据会在读取时和当前 vault 文件树做校验。如果缓存里的 relation target 已移动，search、note brief、relations 和 context 响应会保留原始 `target`，并新增 `targetStatus`、`targetExists`、`resolvedTarget` 和 diagnostics，避免 Agent 把旧路径当作事实。读工具只报告漂移，不会改写 `.understory/relations.json`。

## 从源码构建

本仓库将可审查源码放在 `src/`，将 Obsidian 安装文件放在仓库根目录。

```powershell
npm run build
npm run check
```

构建脚本会把 `src/*.js` 打包成根目录的 `main.js`。

## Release 文件

每个 GitHub release 都需要附带：

- `manifest.json`
- `main.js`
- `styles.css`

release 中的 `main.js` 会内嵌标准 Obsidian 安装所需的 engine payload。

当前 release：`1.8.11`。

release tag 必须和 `manifest.json` 中的 version 完全一致，例如 `1.8.11`。

## 链接

- 官网：https://bondie.io/research/understory
- 内置 engine 源码：[understory-graphify-engine](understory-graphify-engine)
- 隐私说明：[PRIVACY.md](PRIVACY.md)
