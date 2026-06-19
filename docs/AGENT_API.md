# Understory Agent API

Understory exposes local automation surfaces for Agents:

- JSON CLI: `scripts/understory-agent-cli.js`
- MCP stdio server: `scripts/understory-mcp-server.js`
- Plugin service: `this.agentApi` inside the Obsidian plugin instance

The API is local-only. It does not start an HTTP server or open a port.

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
| `--target <title-or-path>` | Relation title or target path. |
| `--title <title>` | Link title for `insert-relation`. |
| `--dry-run` | Validate refresh inputs without running the local engine. |
| `--engine-dir <path>` | Local Understory engine directory. Defaults to `UNDERSTORY_ENGINE_DIR`. |
| `--python <path>` | Python executable. Defaults to `UNDERSTORY_PYTHON_PATH` or `python`. |
| `--timeout-ms <number>` | Refresh engine timeout in milliseconds. |
| `--pretty` | Pretty-print the JSON envelope. |
| `--json` | Compatibility flag. Output is JSON with or without this flag. |

## MCP Stdio

Configure an MCP client to launch the stdio server:

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

The server speaks newline-delimited JSON-RPC over stdin/stdout and does not write logs to stdout.

### Tools

| Tool | Arguments | Effect |
| :--- | :--- | :--- |
| `understory_status` | `{ vaultPath? }` | Read API, vault, relation-store, and basic engine status. |
| `understory_get_relations` | `{ notePath, vaultPath? }` | Read relations for one note. |
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

`get-relations` returns:

```json
{
  "notePath": "Notes/Source.md",
  "status": "ok",
  "stale": false,
  "relations": [],
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
