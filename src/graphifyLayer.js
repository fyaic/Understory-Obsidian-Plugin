/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

module.exports = {
    core: require('./graphifyCore'),
    views: require('./graphifyViews'),
    runtime: require('./graphifyRuntime'),
};

/* eslint-enable @typescript-eslint/no-require-imports -- End CommonJS audit bridge. */
