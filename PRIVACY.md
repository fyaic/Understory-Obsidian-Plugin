# Privacy

Understory is local-first. Bondie Labs does not operate a hosted analysis service for this plugin and does not receive your vault content, API keys, prompts, embeddings, model responses, local reports, or logs.

## What Stays Local

By default, Understory runs in **Local only** mode.

In Local only mode:

- Notes are read from your local vault.
- Reports and caches are written locally under `.understory`.
- No cloud model request is made.
- Provider API keys are not passed to the local engine process.
- No webhook request is made, even if a webhook URL remains in saved settings.

## Optional Cloud Model Modes

If you choose **Vector model only** or **Full AI analysis**, selected note titles, snippets, prompts, or extracted facts may be sent to the provider you configure.

Supported provider choices include OpenAI, Zhipu, and custom OpenAI-compatible endpoints. You provide your own provider account and API key.

Provider accounts, API keys, pricing, quotas, privacy terms, data retention, and billing are controlled by the selected provider, not by Bondie Labs. Review the provider's privacy policy before enabling cloud model features.

## API Key Storage

You can leave API key fields blank and use environment variables instead. If you enter API keys in the plugin settings page, they are stored in your local Obsidian plugin configuration.

Understory redacts known API keys, bearer tokens, webhook URLs, and similar secrets from plugin logs and short diagnostics. Raw process stdout is not stored in plugin logs by default. Do not share screenshots, logs, or diagnostic output that include secrets.

## Local Files

Understory may write local cache, report, and relationship data under `.understory` in your vault. These files are intended to support relation discovery, graph analysis, status reports, and refresh behavior.

## Local Agent API

The Agent API is local-only by design. It is exposed through a JSON command-line entry point and an MCP stdio server. It does not start an HTTP server, does not open a local network port, and does not send data to Bondie Labs.

The **AI agents** settings page can create a local MCP server file and save an Understory Skill prompt into `.understory/agent` inside your vault. These files are local configuration artifacts. The MCP server file is a local stdio entrypoint, not a cloud server, and it does not open an HTTP port. The Skill prompt is an instruction document for your agent; saving or copying it does not upload vault content.

The Skill can be generated in Query-only mode or Agent memory model mode. Query-only mode is conservative and read-only by instruction. Agent memory model mode tells the agent to retrieve relevant local context proactively and propose durable memory updates, but it does not grant permission to upload vault content or make local writes without user confirmation.

For multi-vault use, Understory identifies only the currently open vault and generates a separate MCP server key for that vault. It does not scan your computer for every Obsidian vault, and it does not write Codex, Claude Desktop, Cursor, OpenClaw, or other agent configuration files automatically.

Agent API calls require an explicit vault path. Note paths are normalized and rejected if they try to leave that vault. Read operations return relationship metadata, graph summary counts, status fields, and file paths. They do not return full note bodies by default. Write operations such as accepting, rejecting, or inserting a relation modify local vault files only.

The Agent API reuses Understory redaction for API keys, bearer tokens, webhook URLs, and similar secrets in JSON error details. As with any local automation, review MCP/Agent client logs before sharing them.

## Webhooks

Webhook features are off by default and are blocked in Local only mode. If enabled in a cloud-capable mode, a summary payload may be sent to the URL you configure. Webhook provider behavior is governed by that provider and the URL owner.

## Data Flow Summary

| Feature | Default | Local Files Written | Data Sent Off Device | User Control |
| :--- | :--- | :--- | :--- | :--- |
| Local analysis | On | `.understory` cache and reports | None | Keep Local only mode or disable features |
| Vector model only | Off unless selected | Vector/cache metadata | Selected titles or snippets to your provider | Choose provider/key or return to Local only |
| Full AI analysis | Off unless selected | Reports/cache metadata | Selected snippets, prompts, or extracted facts to your provider | Enable only with consent and provider key |
| Webhooks | Off | Notification/log metadata | Summary payload to configured URL | Explicit opt-in and URL |
| Diagnostics | Manual | Local report/output | None unless you share it | Review and redact before sharing |
| Agent API CLI/MCP | Off unless launched locally | Relationship metadata, local MCP server/Skill prompt files, and note edits when requested | None | Launch with an explicit vault path, copy Skill intentionally, and review client logs |

## 中文摘要

Understory 默认本地优先。Bondie Labs 不会接收你的 vault 内容、API key、prompt、embedding、模型响应、本地报告或日志。

如果你选择 **只用向量模型** 或 **完整 AI 分析**，插件可能会把被选中的标题、片段、prompt 或提取出的事实发送给你自己配置的模型服务商。模型服务商的账号、价格、额度、隐私条款、数据保留和账单规则由该服务商负责。

如果你在设置页填写 API key，密钥会保存在本机 Obsidian 插件配置中。也可以留空并改用环境变量。

在 **完全本地** 模式下，插件不会把模型服务密钥传给本地引擎进程，也不会发送 Webhook。插件日志和短诊断会尽量脱敏 API key、Bearer token、Webhook URL 等敏感信息，默认不会把 raw stdout 存入插件日志。
