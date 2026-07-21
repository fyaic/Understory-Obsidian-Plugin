/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');

test('npm build uses the Node bundler for clean review environments', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    assert.equal(packageJson.scripts.build, 'node scripts/bundle_obsidian_plugin.js --plugin-dir src --out main.js');
    assert.doesNotMatch(packageJson.scripts.build, /\bpython(?:3)?\b/i);
    assert.equal(packageJson.scripts['check:bundle'], 'node scripts/check_deterministic_bundle.js');
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'bundle_obsidian_plugin.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'check_deterministic_bundle.js')));
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- End CommonJS audit bridge. */
