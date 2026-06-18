# Privacy

Understory is local-first. Bondie Labs does not operate a hosted analysis service for this plugin and does not receive your vault content, API keys, prompts, embeddings, model responses, local reports, or logs.

## What Stays Local

By default, Understory runs in **Local only** mode.

In Local only mode:

- Notes are read from your local vault.
- Reports and caches are written locally under `.understory`.
- No cloud model request is made.
- No webhook request is made unless you explicitly configure and enable one.

## Optional Cloud Model Modes

If you choose **Vector model only** or **Full AI analysis**, selected note titles, snippets, prompts, or extracted facts may be sent to the provider you configure.

Supported provider choices include OpenAI, Zhipu, and custom OpenAI-compatible endpoints. You provide your own provider account and API key.

Provider accounts, API keys, pricing, quotas, privacy terms, data retention, and billing are controlled by the selected provider, not by Bondie Labs. Review the provider's privacy policy before enabling cloud model features.

## API Key Storage

You can leave API key fields blank and use environment variables instead. If you enter API keys in the plugin settings page, they are stored in your local Obsidian plugin configuration.

Understory should not print API keys in logs or diagnostics. Do not share screenshots, logs, or diagnostic output that include secrets.

## Local Files

Understory may write local cache, report, and relationship data under `.understory` in your vault. These files are intended to support relation discovery, graph analysis, status reports, and refresh behavior.

## Webhooks

Webhook features are off by default. If enabled, a summary payload may be sent to the URL you configure. Webhook provider behavior is governed by that provider and the URL owner.

## Data Flow Summary

| Feature | Default | Local Files Written | Data Sent Off Device | User Control |
| :--- | :--- | :--- | :--- | :--- |
| Local analysis | On | `.understory` cache and reports | None | Keep Local only mode or disable features |
| Vector model only | Off unless selected | Vector/cache metadata | Selected titles or snippets to your provider | Choose provider/key or return to Local only |
| Full AI analysis | Off unless selected | Reports/cache metadata | Selected snippets, prompts, or extracted facts to your provider | Enable only with consent and provider key |
| Webhooks | Off | Notification/log metadata | Summary payload to configured URL | Explicit opt-in and URL |
| Diagnostics | Manual | Local report/output | None unless you share it | Review and redact before sharing |

## 中文摘要

Understory 默认本地优先。Bondie Labs 不会接收你的 vault 内容、API key、prompt、embedding、模型响应、本地报告或日志。

如果你选择 **只用向量模型** 或 **完整 AI 分析**，插件可能会把被选中的标题、片段、prompt 或提取出的事实发送给你自己配置的模型服务商。模型服务商的账号、价格、额度、隐私条款、数据保留和账单规则由该服务商负责。

如果你在设置页填写 API key，密钥会保存在本机 Obsidian 插件配置中。也可以留空并改用环境变量。

