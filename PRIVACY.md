# Understory Privacy And Data Flow

Last updated: 2026-07-15

Understory supports two distinct operating paths:

1. **Hosted mode**, the default for new users, uses a Bondie account and the Understory service.
2. **Advanced local/self-hosted modes** are retained for existing users and operators who intentionally configure them.

This document describes both paths. Hosted mode is not local-only.

## Hosted Mode

### Account data

Browser sign-in is handled through Bondie/SynapseHub. After sign-in, the plugin can receive and display:

- Email address.
- Display name.
- Profile picture URL.
- Membership and entitlement state.
- Product service readiness.
- Account-linked usage totals.

The plugin stores a product access token and sanitized runtime configuration in the local plugin configuration at `.obsidian/plugins/understory/data.json`. It does not store a Bondie password. Profile editing, account recovery, security, and device management remain on Bondie account pages.

### Note content sent for analysis

Before the first hosted analysis, Understory asks for consent to upload selected snippets. Consent is stored locally and can be disabled from plugin settings.

Relation discovery may send:

- The active note path and title.
- Up to 4,000 characters from the active note after frontmatter, fenced code blocks, and repeated whitespace are removed.
- Up to 40 locally ranked candidate notes.
- Each candidate path, title, and up to 2,000 characters of normalized text.
- A request to include or skip risk analysis.

Principle extraction may send the active note path, title, and up to 4,000 characters of normalized text.

Vault semantic review may locally inspect eligible Markdown notes, then send title plus a snippet of up to 1,200 characters for embedding. It can send a bounded set of candidate snippet pairs for risk review. Structural checks such as resolved links, broken links, and orphan status are computed locally.

Users control the analysis scope through included and excluded folders. Hidden folders, the vault configuration folder, `.understory`, and trash paths are excluded from hosted note collection.

### Service processing and retention

Hosted requests go to `https://understory.bondie.io`. The service routes model work through server-managed provider credentials. Upstream provider keys are not returned to the plugin.

The current hosted runtime contract reports that submitted note content is processed without server-side content retention. The plugin therefore stores the returned relation and analysis results locally under `.understory`. This content-retention statement does not mean the service keeps no operational records: account identity, session state, request counts, processing units, timestamps, error categories, quota state, and security records may be retained as needed to operate, protect, and observe the service.

The service operator can observe usage by registered account and feature. The plugin shows the signed-in user an aggregate view of the same request and processing-unit categories.

### Upstream model providers

In hosted mode, users do not choose or receive upstream provider keys. The Understory service may route requests to managed model providers. Provider pools can change without a client update. The service is responsible for selecting providers and enforcing its provider agreements; users remain responsible for deciding whether the hosted data flow is appropriate for their notes.

## Local Files

Understory can write:

| Path | Purpose |
| :--- | :--- |
| `.obsidian/plugins/understory/data.json` | Plugin settings, hosted product token, consent state, sanitized runtime configuration, and advanced provider settings if entered. |
| `.understory/relations.json` | Related-note cache, scores, states, and risk results. |
| `.understory/link_overrides.json` | Accepted and ignored relation decisions. |
| `.understory/conflicts.json` | Local or hosted analysis report. |
| `.understory/principles.hosted.json` | Locally stored principle-extraction results. |
| `.understory/index.md` | Locally generated analysis summary. |
| `.understory/agent/` | User-created MCP server, Skill prompt, and setup artifacts. |
| `.obsidian/plugins/understory/understory-graphify-engine/` | Bundled engine extracted for advanced local workflows. |

Inserting a confirmed relation changes the selected Markdown note by adding a normal wiki link. Understory does not write suggestion blocks into note bodies by default.

## Advanced Local, Self-Hosted, And BYOK Modes

Existing installations that selected local mode remain local after upgrading. In local mode:

- Hosted relation discovery is disabled.
- A Bondie session is not required.
- Managed hosted provider credentials are not used.
- Webhooks are blocked.
- Analysis uses local files, the bundled Python engine, local caches, and configured local behavior.

Advanced vector or full-analysis modes can send titles, snippets, prompts, embeddings, or extracted facts directly to the endpoint configured by the user. Advanced users can store provider keys in local plugin configuration or supply them through environment variables. Provider pricing, quotas, retention, training, and privacy terms are controlled by that provider or endpoint owner.

Self-hosted endpoints and optional webhooks are operator-controlled data destinations. Webhooks are off by default, require a separate opt-in, and send only the configured summary payload.

## Local Agent API

The Agent API uses a local JSON CLI or MCP stdio process. It does not open an HTTP port. It requires an explicit vault path and rejects note paths that leave that vault.

Read tools return scoped snippets and relation metadata rather than full note bodies by default. Write tools can accept, ignore, refresh, or insert relations in local vault files. Understory does not automatically edit external Agent configuration files.

The privacy of an Agent session also depends on the Agent client and any model provider used by that client. Review those products separately before giving them access to an Understory MCP server.

## Logs, Diagnostics, And Clipboard

Plugin logs and diagnostics redact configured API keys, bearer tokens, webhook URLs, and common environment-style secret values. Background failures are kept as a bounded, redacted status rather than repeated notification content. Raw process stdout is not persisted by default.

Understory can write generated MCP configuration, Skill prompts, setup packs, and diagnostics to the clipboard only after an explicit copy action. It does not read clipboard contents.

No support bundle is uploaded automatically. Information leaves the device for support only when the user intentionally shares it.

## Network Destinations

| Destination | When used | Data categories |
| :--- | :--- | :--- |
| `account.bondie.io` and SynapseHub-managed login pages | Browser sign-in and account management | Account identity, authentication, membership, and account operations. |
| `understory.bondie.io` | Hosted product session, runtime config, relation analysis, principle extraction, vault semantic review, billing readiness, and usage | Product token, selected note paths/titles/snippets, analysis requests, returned results, usage and operational metadata. |
| User-configured provider endpoint | Advanced BYOK modes only | Selected titles/snippets, prompts, embeddings, or extracted facts. |
| User-configured webhook URL | Advanced mode with separate opt-in | Configured alert summary. |

## User Controls

Users can:

- Decline or disable selected-snippet upload consent.
- Exclude folders from analysis.
- Use **Sign out of Understory** to revoke only the product session.
- Use the separately confirmed Bondie global sign-out flow.
- Remove local plugin data or `.understory` files through normal vault management.
- Keep an existing installation in advanced local mode.

Removing local files does not automatically delete a Bondie account or server-side operational records. Use the Bondie account center for account requests.

## Payment Status

Understory is currently free to install and hosted membership defaults to Free. The Community listing should use **Optional payments** because the plugin connects to a managed service and advanced modes can connect to paid APIs. Future Pro or Plus plans require updated pricing, billing, support, and privacy disclosures before public launch.

## 中文摘要

Understory 新安装默认使用 Bondie 账号和托管服务，不是纯本地插件。第一次托管分析前，插件会请求上传选中笔记片段的许可。关联分析可能发送当前笔记和候选笔记的路径、标题与有限长度片段；服务器返回关系、风险和用量信息。模型 key 由服务端管理，不会下发到客户端。

插件会在本地保存产品 token、设置、关系缓存和分析报告。服务端当前声明不保留提交的笔记正文，但会按运行需要保留账号、会话、用量、额度、安全和错误元数据。运营侧可以按注册账号和功能观察用量。

已有本地模式用户升级后仍保持本地模式。高级 BYOK、自托管和 Webhook 由用户自行选择目标和承担对应服务商条款。完整路径、字段和控制项以本文件英文正文为准。
