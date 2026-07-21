/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness stays CommonJS and is not shipped in Obsidian release assets. */

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { STRINGS } = require('../src/i18n');

test('English strings must not contain Han characters', () => {
    const han = /\p{Script=Han}/u;
    const offenders = Object.entries(STRINGS.en)
        .filter(([, value]) => typeof value === 'string' && han.test(value))
        .map(([key, value]) => `${key}=${value}`);

    assert.deepEqual(offenders, []);
});

/* eslint-enable @typescript-eslint/no-require-imports -- End CommonJS audit bridge. */
