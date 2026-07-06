# Understory Agent API

Understory exposes local automation surfaces for Agents:

- JSON CLI: `scripts/understory-agent-cli.js`
- MCP stdio server: `scripts/understory-mcp-server.js`
- Plugin service: `this.agentApi` inside the Obsidian plugin instance
- Obsidian settings: **Settings -> Understory -> AI agents**

The API is local-only. It does not start an HTTP server or open a port.

For regular plugin users, the **AI agents** settings page is the recommended entry point. It provides a vault-specific MCP JSON configuration, a local MCP server file at `.understory/agent/understory-mcp-server.js`, a Query-only or Agent memory model Skill prompt, and agent-specific setup notes. The local MCP server file is not a cloud server and does not open an HTTP port. Understory identifies the currently open vault only; it does not scan all Obsidian vaults on the computer.

The Skill mode controls agent behavior:

- **Query-only**: use Understory only when the user explicitly asks to query, search, cite, summarize, or inspect the current vault. Treat this mode as read-only.
- **Agent memory model**: use Understory as active local context and a long-term memory layer. The agent may retrieve relevant context before planning and propose durable memory, relation, decision, or project-state updates after substantial work, but write operations still require user confirmation.

Both modes include a knowledge-map workflow for broad research tasks: agents should run several focused searches, read scoped context through MCP, group notes by business meaning, call out gaps, and provide role-based reading paths rather than returning raw search hits.

## Response Envelope

All CLI responses and MCP tool `structuredContent` values use the same envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "apiVersion": "1",
    "vaultPath": "C:/path/to/vault",
    "timestamp": "2026-06-18T03:27:00.000Z"
  }
}
```

Failures use:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "NOTE_NOT_FOUND",
    "message": "Note was not found in vault.",
    "detail": ""
  },
  "meta": {
    "apiVersion": "1",
    "timestamp": "2026-06-18T03:27:00.000Z"
  }
}
```

## Error Codes

| Code | Meaning |
| :--- | :--- |
| `VAULT_NOT_FOUND` | The vault path does not exist or is not a directory. |
| `UNSAFE_PATH` | A note or target path tries to leave the vault. |
| `NOTE_NOT_FOUND` | The requested note does not exist. |
| `RELATION_NOT_FOUND` | The requested relation title or target was not found. |
| `STORE_NOT_FOUND` | `.understory/relations.json` is required for the operation but missing. |
| `ENGINE_NOT_READY` | The local engine is unavailable for a non-dry-run refresh. |
| `ENGINE_FAILED` | The local engine failed. |
| `PARSE_FAILED` | A local Understory JSON file could not be parsed. |
| `INVALID_ARGUMENT` | A required argument is missing or invalid. |
| `INTERNAL_ERROR` | Any other internal failure. Details are redacted. |

## CLI

Every command writes exactly one JSON envelope to stdout. Failed commands exit with a non-zero status while keeping stdout parseable JSON.

```powershell
node scripts/understory-agent-cli.js status --vault "C:\path\to\vault" --json
node scripts/understory-agent-cli.js capabilities --vault "C:\path\to\vault" --json
node scripts/understory-agent-cli.js search --vault "C:\path\to\vault" --query "memory graph" --json
node scripts/understory-agent-cli.js get-context --vault "C:\path\to\vault" --note "Notes/A.md" --json
node scripts/understory-agent-cli.js get-note-brief --vault "C:\path\to\vault" --note "Notes/A.md" --json
node scripts/understory-agent-cli.js get-relations --vault "C:\path\to\vault" --note "Notes/A.md" --json
node scripts/understory-agent-cli.js refresh-relations --vault "C:\path\to\vault" --note "Notes/A.md" --engine-dir "C:\path\to\Understory-graphify-engine" --json
node scripts/understory-agent-cli.js refresh-relations --vault "C:\path\to\vault" --note "Notes/A.md" --dry-run --json
node scripts/understory-agent-cli.js accept-relation --vault "C:\path\to\vault" --note "Notes/A.md" --target "B" --json
node scripts/understory-agent-cli.js reject-relation --vault "C:\path\to\vault" --note "Notes/A.md" --target "Notes/B.md" --json
node scripts/understory-agent-cli.js insert-relation --vault "C:\path\to\vault" --note "Notes/A.md" --target "Notes/B.md" --title "B" --json
node scripts/understory-agent-cli.js graph-summary --vault "C:\path\to\vault" --json
```

Supported flags:

| Flag | Meaning |
| :--- | :--- |
| `--vault <path>` | Required vault path for CLI calls. |
| `--note <path>` | Vault-relative note path. |
| `--query <text>` | Query text for `search` or query-based `get-context`. |
| `--limit <number>` | Result or context item limit. |
| `--target <title-or-path>` | Relation title or target path. |
| `--title <title>` | Link title for `insert-relation`. |
| `--dry-run` | Validate refresh inputs without running the local engine. |
| `--engine-dir <path>` | Local Understory engine directory. Defaults to `UNDERSTORY_ENGINE_DIR`. |
| `--python <path>` | Python executable. Defaults to `UNDERSTORY_PYTHON_PATH` or `python`. |
| `--timeout-ms <number>` | Refresh engine timeout in milliseconds. |
| `--pretty` | Pretty-print the JSON envelope. |
| `--json` | Compatibility flag. Output is JSON with or without this flag. |

## MCP Stdio

Regular plugin users should copy the config from **Settings -> Understory -> AI agents** after exporting the standalone MCP server. The generated key is vault-specific, so one agent config can contain multiple Understory vaults:

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
        "C:/path/to/Understory-graphify-engine"
      ]
    },
    "understory-research-vault": {
      "command": "node",
      "args": [
        "C:/path/to/research-vault/.understory/agent/understory-mcp-server.js",
        "--vault",
        "C:/path/to/research-vault",
        "--engine-dir",
        "C:/path/to/Understory-graphify-engine"
      ]
    }
  }
}
```

For ordinary onboarding, bind each MCP server entry with `--vault` and use the matching Understory Skill for that vault. Do not ask an agent to switch vaults by passing another `vaultPath` to the same server unless the user explicitly asks for advanced troubleshooting.

Developer builds can launch `scripts/understory-mcp-server.js` from the repository instead of the exported server path.

The server speaks newline-delimited JSON-RPC over stdin/stdout and does not write logs to stdout.

### Tools

| Tool | Arguments | Effect |
| :--- | :--- | :--- |
| `understory_status` | `{ vaultPath? }` | Read API, vault, relation-store, and basic engine status. |
| `understory_get_capabilities` | `{ vaultPath? }` | Read available tools, privacy defaults, and write-safety boundaries. |
| `understory_get_relations` | `{ notePath, vaultPath? }` | Read relations for one note. |
| `understory_search` | `{ query, limit?, vaultPath? }` | Search notes with local keyword and relations-graph signals. Returns paths, titles, snippets, and why each result matched. |
| `understory_get_context` | `{ query?, notePath?, limit?, vaultPath? }` | Build a scoped context package from a query or known note path without returning full note bodies. |
| `understory_get_note_brief` | `{ notePath, vaultPath? }` | Return a note title, snippet, relation count, and top relations. |
| `understory_refresh_relations` | `{ notePath, dryRun?, engineDir?, pythonPath?, vaultPath? }` | Refresh relations through local engine `api.py refresh-link --no-auto-write`. Use `dryRun: true` when no engine should run. |
| `understory_accept_relation` | `{ notePath, target, vaultPath? }` | Modifies local vault metadata by accepting a relation. |
| `understory_reject_relation` | `{ notePath, target, vaultPath? }` | Modifies local vault metadata and writes a tombstone. |
| `understory_insert_relation` | `{ notePath, target, title?, vaultPath? }` | Modifies local note content by inserting an Obsidian link. |
| `understory_graph_summary` | `{ vaultPath? }` | Read relation, conflict, and index summary counts. |

Tool responses return:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":true,\"data\":{},\"error\":null,\"meta\":{}}"
    }
  ],
  "structuredContent": {
    "ok": true,
    "data": {},
    "error": null,
    "meta": {}
  },
  "isError": false
}
```

If the Understory operation fails, `isError` is `true` and `structuredContent.error.code` contains the stable Agent API code.

`understory_search`, `understory_get_context`, and `understory_get_note_brief` are read-only. They return snippets and relationship metadata, not full note bodies. The current implementation uses local keyword plus relations graph signals; vector/hybrid retrieval can be added later without changing the tool names.

## Data Models

Relation objects are stored under `.understory/relations.json`:

```json
{
  "target": "Notes/Target.md",
  "title": "Target",
  "type": "semantic",
  "score": 0.91,
  "group": "concept",
  "status": "suggested",
  "source": "embedding",
  "createdAt": "2026-06-18T03:27:00.000Z",
  "updatedAt": "2026-06-18T03:27:00.000Z"
}
```

Read APIs keep the cached `target` value for compatibility, but annotate each relation target at read time so agents can tell whether a cached path is still trustworthy:

```json
{
  "target": "Old/Target.md",
  "title": "Target",
  "targetStatus": "resolved",
  "targetExists": false,
  "resolvedTarget": "New/Target.md",
  "resolutionReason": "unique_basename",
  "candidates": []
}
```

`targetStatus` can be:

| Status | Meaning |
| --- | --- |
| `ok` | The cached `target` currently exists and can be read. |
| `resolved` | The cached `target` is missing, but Understory found one safe replacement path. Read context uses `resolvedTarget`. |
| `missing` | No safe current target could be found. |
| `ambiguous` | Multiple candidate notes matched; Understory reports candidates and does not choose one. |
| `unsafe` | The target is unsafe or internal, such as path traversal or `.understory/`. |

`understory_search` includes these fields in `matchedRelations`, `understory_get_note_brief` includes them in `relations`, and `understory_get_context` reports `resolvedRelations` and `unresolvedRelations` under `diagnostics`. These read tools do not write `.understory/relations.json`; cache repair must happen through an explicit refresh or repair flow.

`get-relations` returns:

```json
{
  "notePath": "Notes/Source.md",
  "status": "ok",
  "stale": false,
  "relations": [],
  "diagnostics": {
    "relationTargets": {
      "ok": 3,
      "resolved": 1,
      "missing": 0,
      "ambiguous": 0,
      "unsafe": 0
    },
    "resolvedRelations": [],
    "unresolvedRelations": []
  },
  "entry": {
    "hash": "abcdef1234567890",
    "mtime": 1710000000000,
    "indexedAt": "2026-06-18T03:27:00.000Z"
  }
}
```

`graph-summary` returns:

```json
{
  "vaultPath": "C:/Vault",
  "relationsStore": {
    "exists": true,
    "fileCount": 12,
    "relationCount": 88,
    "updatedAt": "2026-06-18T03:27:00.000Z"
  },
  "conflicts": {
    "exists": true,
    "openCount": 4,
    "highCount": 1
  },
  "index": {
    "exists": true,
    "path": ".understory/index.md"
  }
}
```

## Security And Privacy

- The API requires an explicit vault path for external calls.
- Note and target paths are normalized and must remain inside the vault.
- The API does not return full note bodies by default.
- CLI and MCP do not start an HTTP server or open a port.
- Error details reuse Understory redaction for API keys, bearer tokens, webhook URLs, and long token-like strings.
- Tests use fake vaults and do not call provider, webhook, or external network services.
