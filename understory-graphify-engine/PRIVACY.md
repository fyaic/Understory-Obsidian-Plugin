# Understory Privacy Notice

Last updated: 2026-06-15

Understory is designed as a local-first Obsidian plugin. By default, new installs run in **Local only** mode and do not request cloud model APIs or send webhook notifications.

## What the Understory Team Does Not Collect

The Understory development team does not receive, collect, store, or access:

- Your notes or vault contents
- Your API keys
- Embeddings
- Prompts
- Model responses
- Local cache files, logs, reports, or `.understory` data

Understory does not operate a hosted service that receives your vault data. When cloud model features are enabled, requests are sent directly from your device to the model provider or endpoint you configure.

## Payment and Third-Party API Costs

Understory's initial Obsidian Community listing should be marked as **Optional payments**.

The Understory development team does not charge users in the initial release. `Local only` mode does not require any model API key. If you enable cloud model features, you provide your own provider account and API key. Provider pricing, billing, quota limits, retention, training, and privacy terms are controlled by the provider or endpoint you choose, not by the Understory team.

## Network Modes

| Mode | What Happens |
| --- | --- |
| Local only | No cloud model or webhook requests. Understory uses local files, keyword search, ER data, existing caches, and local reports. |
| Vector model only | Text snippets needed for similarity analysis may be sent to the configured embedding provider. LLM/chat requests are blocked. |
| Full AI analysis | Text snippets may be sent to the configured embedding provider and reasoning model provider for semantic indexing, claim extraction, concept explanations, and conflict checks. |

Webhook notifications are a separate opt-in. They are off by default and are never sent in Local only mode.

## What May Be Sent When You Enable Cloud Models

### Vector Model

If you enable vector model features, Understory may send note titles and cleaned text snippets to the embedding provider you configure. The returned vectors are stored locally in the Understory cache.

### Reasoning Model

If you enable Full AI analysis, Understory may send selected text snippets, extracted claims, titles, and comparison prompts to the reasoning model provider you configure. These requests are used for features such as claim extraction, concept grouping, and conflict checks.

### Webhook

If you explicitly enable webhook notifications and provide a URL, Understory may send conflict summary text to that URL. Webhooks are intended for short alerts and do not send full note bodies.

## Supported Provider Choices

Understory can be configured for:

- Zhipu
- OpenAI
- Custom OpenAI-compatible endpoints
- No cloud provider

You are responsible for reviewing the privacy policy and data handling terms of whichever provider or endpoint you choose. Understory cannot control how third-party providers process requests sent directly from your device.

## API Key Storage

You can provide API keys through environment variables or through the Obsidian plugin settings.

If you enter API keys in the plugin settings, they are stored in your local Obsidian plugin configuration. Prefer environment variables when you want to avoid saving keys in the plugin data file.

## Local Data

Understory may create local files under `.understory`, including:

- SQLite databases
- JSON reports
- Markdown reports
- Local logs
- Notification summaries
- Embedding caches

These files remain in your vault or local engine directory unless you delete them or move the vault yourself.

## How to Disable Network Use

Set the plugin to **Local only** mode, or set:

```bash
UNDERSTORY_NETWORK_MODE=local
UNDERSTORY_WEBHOOK_ENABLED=0
```

In Local only mode, Understory blocks cloud embedding requests, LLM/chat requests, and webhook delivery.
