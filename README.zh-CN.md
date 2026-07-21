# Understory

<p align="center">
  <img src="assets/understory-logo.png" alt="Understory 叶片标志" width="150">
</p>

<p align="center">
  找到关联笔记、发现潜在冲突，让不断增长的知识库更容易维护。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="PRIVACY.md">隐私说明</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

Understory 是桌面端的知识维护助手。打开一篇笔记，让 Understory 分析它，然后在清晰的右侧栏中查看关联建议和风险。

标准体验以托管服务为先。登录 Bondie 账号后，Understory 会自动准备由服务端管理的 AI 能力。普通用户不需要选择模型服务商、填写模型 key、安装 Python 或配置 endpoint。

## 三步开始使用

1. 启用 Understory，点击左侧功能区的叶片图标。
2. 点击 **使用 Bondie 继续**，在浏览器中完成登录。
3. 回到笔记，点击 **生成建议**。

第一次分析前，插件会明确询问是否允许发送选中的笔记片段。分析结果只显示在右侧栏，不会自动修改正文。你可以逐条采纳、忽略，或把已经确认的关联插入笔记。

## 主要功能

- 右侧栏分为 **建议** 和 **风险** 两个页面。
- 按主题或来源整理关联笔记，并显示易懂的匹配百分比。
- 检查潜在冲突、过期内容、孤立笔记和断裂链接。
- 账号页展示头像或默认头像、邮箱、会员状态和服务就绪状态。
- 用量页展示当前账号总调用量和各功能活动。
- 通过文件夹范围控制哪些笔记可以参与分析。
- 支持中文、英文、浅色和深色主题。
- 为高级用户提供本地 Agent API、JSON CLI 和 MCP stdio。

## 账号与会员

Bondie 负责登录、资料修改、账号安全、设备管理和账号恢复。插件只提供清晰入口，不重复实现身份信息管理。

目前所有账号默认是 **Free**。客户端已经识别 Free、Pro 和 Plus，方便未来增加收费方案，但当前不会向用户展示尚未开放的结账入口。

在插件中退出登录只会撤销 Understory 这个产品的会话。退出整个 Bondie 账号是单独的操作，并且必须再次确认。

## 用户不用管理模型 key

在标准托管模式下：

- 模型凭据只由 Understory 服务端管理，不会返回到插件。
- 每个已登录账号由服务端分配可用的 provider access。
- 服务端按账号记录调用量和处理单元，用于额度、稳定性和运营观测。
- 插件只展示当前账号的聚合用量，不展示 provider key 或内部路由。

服务端可以调整上游服务商和 origin pool，用户不需要重新配置客户端。

## 隐私概览

Understory 会读取当前 vault 中的 Markdown 笔记。只有在用户同意后，托管分析才会向 `https://understory.bondie.io` 发送笔记路径、标题和有限长度的文本片段。关联发现当前最多发送当前笔记 4,000 个字符，以及每篇候选笔记 2,000 个字符。

服务端返回关联、匹配分数、风险摘要和用量信息。客户端在本地保存产品会话、设置、关系缓存和分析报告。托管响应声明不会保留笔记正文；账号和用量记录会按服务运行需要保留。

你可以排除文件夹、关闭选中片段上传、退出账号，或让已有高级安装继续使用本地/自托管模式。完整数据流见 [PRIVACY.md](PRIVACY.md)。

## 高级本地与自托管模式

升级前已经选择本地模式的用户，升级后仍保持本地模式。**设置 -> Understory -> 高级** 中也保留本地、自托管和 BYOK 能力，供确实需要的高级用户使用。

这些模式可能需要：

- Obsidian 桌面版。
- Python 和内置本地引擎。
- 可选的模型服务账号和 key。
- 手动配置 endpoint、模型和隐私模式。

这些内容不会出现在新用户第一屏。完全本地模式不需要 Bondie 登录，也不会调用托管关联服务。

## AI Agent

Understory 可以通过本地 MCP stdio 把当前 vault 暴露给 Agent，不会打开 HTTP 端口。在 **设置 -> Understory -> Agent访问** 中可以：

- 在 `.understory/agent` 创建当前 vault 专用的 MCP server 文件。
- 复制当前 vault 专用的 MCP 配置。
- 选择保守的 Query-only 或 Agent memory workflow。
- 导出本地 setup pack 和脱敏诊断。

读取工具默认返回有限片段和关系元数据，不返回完整笔记正文。写入工具只修改本地 vault，并应在用户确认后使用。完整契约见 [docs/AGENT_API.md](docs/AGENT_API.md)。

## 本地文件

Understory 可能写入以下本地文件：

```text
<vault>/.understory/                         关系缓存、报告、日志、Agent 文件
<vault>/.obsidian/plugins/understory/data.json
                                             插件设置和产品会话
<vault>/.obsidian/plugins/understory/understory-graphify-engine/
                                             高级本地模式使用的内置引擎
```

普通托管模式不会启动 Python 引擎。

## 安装

### Community Directory

社区审核通过后：

1. 打开 **设置 -> 第三方插件 -> 浏览**。
2. 搜索 **Understory**。
3. 安装并启用。

### 手动安装 Release

从同一个 GitHub release 下载 `manifest.json`、`main.js` 和 `styles.css`，放入：

```text
<vault>/.obsidian/plugins/understory/
```

重启 Obsidian，再到第三方插件设置中启用 Understory。不要混用不同版本的三个文件。

## 常见问题

### 网页提示登录成功，插件仍显示未连接

回到发起登录的同一个 vault，打开 Understory，点击 **刷新状态**。如果回调被另一个 vault 或 profile 接收，请从目标 vault 重新发起登录。

### 无法生成建议

请确认：

- 账号页显示 **已连接** 和 **服务已就绪**。
- 当前打开的是 Markdown 笔记。
- 已允许上传选中的笔记片段。
- 当前笔记不在排除文件夹中。

### 会话已过期

服务端返回未授权状态时，Understory 会清除无效的本地会话。重新登录即可，`.understory` 中的本地关系缓存不会被删除。

### 本地模式不可用

打开 **高级**，运行本地设置检查，按提示检查 Python、引擎路径、依赖和权限。托管用户不需要处理这些配置。

## 付费状态

Community listing：**Optional payments**。

Understory 可以免费安装，目前托管会员也是 Free。因为插件连接由开发者运营的服务，并保留可连接付费 API 的高级能力，按照 Obsidian 当前规则，即使结账尚未开放，也必须标记为 Optional payments。

## 开发与发布

可审查源码位于 `src/`。`main.js` 不提交到源码仓库；经过验证的 release
工作流会从源码构建它，再与已提交的 `manifest.json`、`styles.css` 一起发布。
内置本地引擎快照由 `engine-provenance.json` 锁定。补丁 release 可以继承
与 `1.13.0` 字节完全一致且已证明来源的快照；任何引擎目录变更都必须记录
`fyaic/Understory-graphify-engine` 的准确上游 commit。

```bash
npm ci
npm run verify
```

`npm run verify` 会运行 Obsidian 官方 lint、103 项自动化测试、两次独立的确定性 bundle 构建、发布元数据检查、bundle 语法检查和本地引擎 smoke test。

每个 release 必须只提供同一版本的三个安装文件：

- `manifest.json`
- `main.js`
- `styles.css`

Git tag 必须与 manifest 版本完全一致。当前版本：`1.13.7`。

## 许可证

Understory 采用 [PolyForm Perimeter License 1.0.0](LICENSE) source-available 许可证。Required Notice 和商业授权联系方式见 [NOTICE](NOTICE)。
