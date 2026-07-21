/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SCRIPTS = path.join(ROOT, 'understory-graphify-engine', 'scripts');

test('engine markdown listing ignores Obsidian plugin internals', async (t) => {
    const vaultPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'understory-vault-'));
    t.after(async () => {
        await fs.promises.rm(vaultPath, { recursive: true, force: true });
    });
    await fs.promises.mkdir(path.join(vaultPath, 'Notes'), { recursive: true });
    await fs.promises.mkdir(path.join(vaultPath, '.obsidian', 'plugins', 'understory', 'understory-graphify-engine'), { recursive: true });
    await fs.promises.mkdir(path.join(vaultPath, '.understory'), { recursive: true });
    await fs.promises.writeFile(path.join(vaultPath, 'Notes', 'Keep.md'), '# Keep\n', 'utf8');
    await fs.promises.writeFile(path.join(vaultPath, '.obsidian', 'plugins', 'understory', 'understory-graphify-engine', 'SKILL.md'), '# Internal\n', 'utf8');
    await fs.promises.writeFile(path.join(vaultPath, '.understory', 'report.md'), '# Report\n', 'utf8');

    const code = [
        'import json, sys',
        'from pathlib import Path',
        `sys.path.insert(0, ${JSON.stringify(ENGINE_SCRIPTS)})`,
        'from vault_ops import list_markdown_files',
        'vault = Path(sys.argv[1]).resolve()',
        'print(json.dumps([p.relative_to(vault).as_posix() for p in list_markdown_files(vault)]))',
    ].join('\n');
    const result = spawnSync(process.env.PYTHON || 'python', ['-c', code, vaultPath], {
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), ['Notes/Keep.md']);
});

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- End CommonJS audit bridge. */
