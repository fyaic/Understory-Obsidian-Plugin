#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument -- Node release verification script is intentionally CommonJS so it can validate the npm build entrypoint. */

const cryptoModule = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUNDLER = path.join(ROOT, 'scripts', 'bundle_obsidian_plugin.js');
const GENERATED_BUNDLE = path.join(ROOT, 'main.js');

function buildBundle(output) {
    const result = spawnSync(
        process.execPath,
        [
            BUNDLER,
            '--plugin-dir',
            path.join(ROOT, 'src'),
            '--out',
            output,
        ],
        { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] }
    );
    if (result.status !== 0) {
        throw new Error(`Bundle build failed with status ${result.status}`);
    }
    return fs.readFileSync(output);
}

function main() {
    if (!fs.existsSync(GENERATED_BUNDLE)) {
        throw new Error('main.js has not been generated; run npm run build first');
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'understory-bundle-check-'));
    try {
        const first = buildBundle(path.join(tmpDir, 'first.js'));
        const second = buildBundle(path.join(tmpDir, 'second.js'));

        if (!first.equals(second)) {
            throw new Error('Two clean bundle builds produced different bytes');
        }
        if (!fs.readFileSync(GENERATED_BUNDLE).equals(first)) {
            throw new Error('Generated main.js does not match a clean source build');
        }

        const digest = cryptoModule.createHash('sha256').update(first).digest('hex');
        process.stdout.write(`Deterministic bundle OK: sha256=${digest}\n`);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main();
}

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument -- End Node release verification script bridge. */
