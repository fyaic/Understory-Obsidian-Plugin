#!/usr/bin/env node

const { createAgentApi } = require('../src/agentApi');
const { safeErrorDetail } = require('../src/safety');

const COMMANDS = new Set([
    'status',
    'get-relations',
    'refresh-relations',
    'accept-relation',
    'reject-relation',
    'insert-relation',
    'graph-summary',
]);

function parseArgs(argv) {
    const args = [...argv];
    const command = args.shift() || '';
    const options = {};

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg.startsWith('--')) {
            if (!options._) options._ = [];
            options._.push(arg);
            continue;
        }

        const eqIndex = arg.indexOf('=');
        const key = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
        if (['json', 'pretty', 'dry-run'].includes(key)) {
            options[key] = true;
            continue;
        }

        const value = eqIndex === -1 ? args[index + 1] : arg.slice(eqIndex + 1);
        if (eqIndex === -1) index += 1;
        options[key] = value;
    }

    return { command, options };
}

function envelopeError(code, message, detail = '') {
    return {
        ok: false,
        data: null,
        error: { code, message, detail },
        meta: {
            apiVersion: '1',
            timestamp: new Date().toISOString(),
        },
    };
}

async function dispatch(command, options) {
    if (!COMMANDS.has(command)) {
        return envelopeError('INVALID_ARGUMENT', command
            ? `Unknown command: ${command}`
            : 'Command is required.');
    }

    const api = createAgentApi({
        vaultPath: options.vault,
        engineDir: options['engine-dir'] || options.engineDir,
        pythonPath: options.python || options['python-path'] || options.pythonPath,
        refreshTimeoutMs: options['timeout-ms'],
    });
    switch (command) {
        case 'status':
            return api.status();
        case 'get-relations':
            return api.getRelations({ notePath: options.note });
        case 'refresh-relations':
            return api.refreshRelations({ notePath: options.note, dryRun: !!options['dry-run'] });
        case 'accept-relation':
            return api.acceptRelation({ notePath: options.note, target: options.target });
        case 'reject-relation':
            return api.rejectRelation({ notePath: options.note, target: options.target });
        case 'insert-relation':
            return api.insertRelation({
                notePath: options.note,
                target: options.target,
                title: options.title,
            });
        case 'graph-summary':
            return api.getGraphSummary();
        default:
            return envelopeError('INVALID_ARGUMENT', `Unknown command: ${command}`);
    }
}

async function runCli(argv = process.argv.slice(2), io = process) {
    const { command, options } = parseArgs(argv);
    const envelope = await dispatch(command, options);
    const json = JSON.stringify(envelope, null, options.pretty ? 2 : 0);
    io.stdout.write(`${json}\n`);
    io.exitCode = envelope.ok ? 0 : 1;
    return envelope;
}

if (require.main === module) {
    runCli().catch((error) => {
        const envelope = envelopeError(
            'INTERNAL_ERROR',
            'Unexpected CLI failure.',
            safeErrorDetail({ message: error && error.message ? error.message : String(error || '') })
        );
        process.stdout.write(`${JSON.stringify(envelope)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    dispatch,
    parseArgs,
    runCli,
};
