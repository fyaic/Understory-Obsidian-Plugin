# Understory

![Understory hero](assets/understory-hero.png)

[English README](README.md) · [官网](https://bondie.io/research/understory) · [隐私说明](PRIVACY.md)

Understory 是一个面向 Obsidian 的本地优先知识层。它会在你的 vault 下方构建一个私有维护层，由 Vector、ER 和 Graph analysis 共同驱动，用来长期发现、维护和刷新笔记之间的关系、主张、概念、冲突和孤立页面。

它不是把你的 vault 上传到 Bondie Labs 的服务里分析。默认模式是本地优先；只有当你主动选择云模型模式并填写自己的模型服务密钥时，相关片段才会发送给你选择的服务商。

## 它能做什么

- 在右侧栏通过 **Show Understory** 显示关联建议。
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

可选云功能支持 OpenAI、智谱或自定义 OpenAI-compatible endpoint。密钥由你自己提供。Bondie Labs 不会接收或代管你的笔记、prompt、embedding、模型响应、日志或 API key。

插件日志和短诊断会脱敏已知 API key、Bearer token、Webhook URL 等敏感信息。默认不会把 raw process stdout 存入插件日志。

付费状态建议为 **Optional payments**。插件可以免费安装，本地模式不需要 API key。模型服务商账号、密钥、价格、额度、隐私条款和账单由你选择的服务商负责。

## 运行要求

- Obsidian 桌面版。
- 本地 Understory engine。
- 本机可用的 Python。

插件使用本地文件、Node API 和 Python 子进程，因此是 desktop-only。

## 手动安装

在插件进入 Obsidian Community directory 之前，可以从 GitHub release 手动安装。

1. 下载 release 中的三个文件：
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. 在你的 vault 中创建目录：

   ```text
   <你的 Vault>/.obsidian/plugins/understory/
   ```

3. 把三个文件放进去。
4. 重启 Obsidian。
5. 在 **设置 -> 社区插件** 中启用 **Understory**。

## 本地引擎配置

Obsidian 插件是入口。本地分析引擎维护在独立仓库：

```powershell
git clone https://github.com/fyaic/Understory-graphify-engine.git
cd Understory-graphify-engine
python -m pip install -r requirements.txt
```

启动 Obsidian 前设置引擎路径：

```powershell
$env:UNDERSTORY_ENGINE_DIR="C:\path\to\Understory-graphify-engine"
$env:UNDERSTORY_PYTHON_PATH="python"
```

也可以在 Understory 设置页里填写 Understory 文件夹和 Python 路径。修改系统环境变量后，需要重启 Obsidian，让桌面进程重新读取环境。

**检查设置（Check setup）** 按钮现在会打开本地诊断面板。它会显示插件版本、engine 版本或 git commit、Python 版本、已选择路径、必要 engine 脚本、Python 依赖、vault `.understory` 部署状态和权限问题。每个问题都会给出修复建议，必要时附带可复制命令。面板不会自动执行 `pip install`、`git pull` 或其他修复命令。

常见手动修复命令：

```powershell
python -m pip install -r "C:\path\to\Understory-graphify-engine\requirements.txt"
$env:UNDERSTORY_ENGINE_DIR="C:\path\to\Understory-graphify-engine"
$env:UNDERSTORY_PYTHON_PATH="python"
```

如果需要把配置情况发给维护者，点击 **复制诊断（Copy diagnostics）**。复制出的摘要会避免包含 API key、webhook URL 和 vault 笔记正文。

## 首次使用

1. 打开 **设置 -> Understory**。
2. 点击 **检查设置（Check setup）**，确认本地引擎、Python、脚本、依赖、vault 部署和权限可用。
3. 保持 **Network mode** 为 **Local only**，或主动选择云模型模式并配置自己的模型服务密钥。
4. 打开命令面板，运行 **Show Understory**。

## Agent API

Understory 也提供本地 Agent API，方便自动化工具读取和维护关系数据。它不是 HTTP server，不会打开端口；agent 可以通过 JSON CLI 或 MCP stdio server 调用。

```powershell
node scripts/understory-agent-cli.js status --vault "C:\path\to\vault" --json
node scripts/understory-agent-cli.js get-relations --vault "C:\path\to\vault" --note "Notes/A.md" --json
node scripts/understory-agent-cli.js refresh-relations --vault "C:\path\to\vault" --note "Notes/A.md" --engine-dir "C:\path\to\Understory-graphify-engine" --json
node scripts/understory-agent-cli.js insert-relation --vault "C:\path\to\vault" --note "Notes/A.md" --target "Notes/B.md" --title "B" --json
```

MCP 配置示例：

```json
{
  "mcpServers": {
    "understory": {
      "command": "node",
      "args": [
        "<path-to-repo>/scripts/understory-mcp-server.js",
        "--vault",
        "C:/path/to/vault",
        "--engine-dir",
        "C:/path/to/Understory-graphify-engine"
      ]
    }
  }
}
```

所有 Agent API 响应都使用包含 `ok`、`data`、`error`、`meta` 的 JSON envelope。API 会把路径限制在指定 vault 内，默认不返回完整笔记正文，并复用 Understory 的敏感信息脱敏逻辑。完整工具契约见 [docs/AGENT_API.md](docs/AGENT_API.md)。

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

release tag 必须和 `manifest.json` 中的 version 完全一致，例如 `1.7.1`。

## 链接

- 官网：https://bondie.io/research/understory
- 核心引擎：https://github.com/fyaic/Understory-graphify-engine
- 隐私说明：[PRIVACY.md](PRIVACY.md)
