#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { createAgentApi } = require('../src/agentApi');
const { safeErrorDetail } = require('../src/safety');

const PROTOCOL_VERSION = '2025-11-25';

const TOOL_DEFINITIONS = [
    {
        name: 'understory_status',
        title: 'Understory status',
        description: 'Read local Understory Agent API status for a vault.',
        inputSchema: schema({
            vaultPath: optionalString('Vault path override. Defaults to the server --vault argument.'),
        }),
        call: (api) => api.status(),
    },
    {
        name: 'understory_get_capabilities',
        title: 'Get Understory Agent API capabilities',
        description: 'Describe available local MCP tools, privacy defaults, and write-safety boundaries.',
        inputSchema: schema({
            vaultPath: optionalString('Vault path override. Defaults to the server --vault argument.'),
        }),
        call: (api) => api.getCapabilities(),
    },
    {
        name: 'understory_get_relations',
        title: 'Get Understory relations',
        description: 'Read suggested/accepted/rejected relations for one note without returning note body text.',
        inputSchema: schema({
            notePath: requiredString('Vault-relative note path.'),
            vaultPath: optionalString('Vault path override.'),
        }, ['notePath']),
        call: (api, args) => api.getRelations({ notePath: args.notePath }),
    },
    {
        name: 'understory_search',
        title: 'Search Understory vault context',
        description: 'Search vault notes with local keyword and relations-graph signals. Returns snippets, not full note bodies.',
        inputSchema: schema({
            query: requiredString('Search query.'),
            limit: { type: 'number', description: 'Maximum results. Defaults to 8, maximum 25.' },
            vaultPath: optionalString('Vault path override.'),
        }, ['query']),
        call: (api, args) => api.search({ query: args.query, limit: args.limit }),
    },
    {
        name: 'understory_get_context',
        title: 'Get Understory context package',
        description: 'Build a scoped context package from a query or known note path without returning full note bodies.',
        inputSchema: schema({
            query: optionalString('Optional search query. Required when notePath is not supplied.'),
            notePath: optionalString('Vault-relative note path for relation-centered context.'),
            limit: { type: 'number', description: 'Maximum context items. Defaults to 6, maximum 12.' },
            vaultPath: optionalString('Vault path override.'),
        }),
        call: (api, args) => api.getContext({ query: args.query, notePath: args.notePath, limit: args.limit }),
    },
    {
        name: 'understory_get_note_brief',
        title: 'Get Understory note brief',
        description: 'Read a note brief with title, snippet, and top relations without returning the full body.',
        inputSchema: schema({
            notePath: requiredString('Vault-relative note path.'),
            vaultPath: optionalString('Vault path override.'),
        }, ['notePath']),
        call: (api, args) => api.getNoteBrief({ notePath: args.notePath }),
    },
    {
        name: 'understory_refresh_relations',
        title: 'Refresh Understory relations',
        description: 'Refresh relations for one note. Use dryRun to avoid running the local engine.',
        inputSchema: schema({
            notePath: requiredString('Vault-relative note path.'),
            dryRun: { type: 'boolean', description: 'When true, validate inputs without running the engine.' },
            engineDir: optionalString('Local Understory engine directory override.'),
            pythonPath: optionalString('Python executable override.'),
            vaultPath: optionalString('Vault path override.'),
        }, ['notePath']),
        call: (api, args) => api.refreshRelations({ notePath: args.notePath, dryRun: !!args.dryRun }),
    },
    {
        name: 'understory_accept_relation',
        title: 'Accept Understory relation',
        description: 'Modifies local vault metadata by marking a relation accepted.',
        inputSchema: schema({
            notePath: requiredString('Vault-relative note path.'),
            target: requiredString('Relation title or target path.'),
            vaultPath: optionalString('Vault path override.'),
        }, ['notePath', 'target']),
        call: (api, args) => api.acceptRelation({ notePath: args.notePath, target: args.target }),
    },
    {
        name: 'understory_reject_relation',
        title: 'Reject Understory relation',
        description: 'Modifies local vault metadata by marking a relation rejected and writing a tombstone.',
        inputSchema: schema({
            notePath: requiredString('Vault-relative note path.'),
            target: requiredString('Relation title or target path.'),
            vaultPath: optionalString('Vault path override.'),
        }, ['notePath', 'target']),
        call: (api, args) => api.rejectRelation({ notePath: args.notePath, target: args.target }),
    },
    {
        name: 'understory_insert_relation',
        title: 'Insert Understory relation link',
        description: 'Modifies local vault note content by inserting an Obsidian link and accepting the relation when present.',
        inputSchema: schema({
            notePath: requiredString('Vault-relative note path to modify.'),
            target: requiredString('Vault-relative target note path or relation target.'),
            title: optionalString('Link title. Defaults to the target basename.'),
            vaultPath: optionalString('Vault path override.'),
        }, ['notePath', 'target']),
        call: (api, args) => api.insertRelation({
            notePath: args.notePath,
            target: args.target,
            title: args.title,
        }),
    },
    {
        name: 'understory_graph_summary',
        title: 'Get Understory graph summary',
        description: 'Read local graph summary counts from .understory files.',
        inputSchema: schema({
            vaultPath: optionalString('Vault path override.'),
        }),
        call: (api) => api.getGraphSummary(),
    },
];

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

function requiredString(description) {
    return { type: 'string', description };
}

function optionalString(description) {
    return { type: 'string', description };
}

function schema(properties, required = []) {
    return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
    };
}

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) continue;
        const eqIndex = arg.indexOf('=');
        const key = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
        const value = eqIndex === -1 ? argv[index + 1] : arg.slice(eqIndex + 1);
        if (eqIndex === -1) index += 1;
        options[key] = value;
    }
    return options;
}

function response(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id === undefined ? null : id, error };
}

function toolResult(envelope) {
    const text = JSON.stringify(envelope);
    return {
        content: [{ type: 'text', text }],
        structuredContent: envelope,
        isError: !envelope.ok,
    };
}

async function handleRequest(message, serverOptions) {
    if (!message || message.jsonrpc !== '2.0' || !message.method) {
        return rpcError(message && message.id, -32600, 'Invalid JSON-RPC request.');
    }

    const id = message.id;
    const params = message.params || {};

    if (message.method === 'notifications/initialized') {
        return null;
    }

    if (id === undefined || id === null) {
        return null;
    }

    if (message.method === 'initialize') {
        return response(id, {
            protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
            capabilities: {
                tools: {},
            },
            serverInfo: {
                name: 'understory-agent-api',
                version: '1.0.0',
            },
        });
    }

    if (message.method === 'ping') {
        return response(id, {});
    }

    if (message.method === 'tools/list') {
        return response(id, {
            tools: TOOL_DEFINITIONS.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            })),
        });
    }

    if (message.method === 'tools/call') {
        const name = params.name;
        const args = params.arguments || {};
        const tool = TOOL_MAP.get(name);
        if (!tool) {
            return rpcError(id, -32602, `Unknown tool: ${name || ''}`);
        }
        const vaultPath = args.vaultPath || serverOptions.vault;
        const api = createAgentApi({
            vaultPath,
            engineDir: args.engineDir || serverOptions['engine-dir'] || serverOptions.engineDir,
            pythonPath: args.pythonPath || serverOptions.python || serverOptions['python-path'] || serverOptions.pythonPath,
        });
        const envelope = await tool.call(api, args);
        return response(id, toolResult(envelope));
    }

    return rpcError(id, -32601, `Method not found: ${message.method}`);
}

function writeMessage(message, stdout = process.stdout) {
    stdout.write(`${JSON.stringify(message)}\n`);
}

function startServer(argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout, stderr = process.stderr) {
    const serverOptions = parseArgs(argv);
    let buffer = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim()) continue;
            let message;
            try {
                message = JSON.parse(line);
            } catch (error) {
                writeMessage(rpcError(null, -32700, 'Parse error.'), stdout);
                continue;
            }
            handleRequest(message, serverOptions)
                .then((reply) => {
                    if (reply) writeMessage(reply, stdout);
                })
                .catch((error) => {
                    const detail = safeErrorDetail({
                        message: error && error.message ? error.message : String(error || ''),
                    });
                    stderr.write(`Understory MCP error: ${detail}\n`);
                    writeMessage(rpcError(message.id, -32603, 'Internal error.'), stdout);
                });
        }
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    TOOL_DEFINITIONS,
    handleRequest,
    parseArgs,
    startServer,
};

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
