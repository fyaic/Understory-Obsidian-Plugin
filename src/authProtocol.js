/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const UNDERSTORY_AUTH_PROTOCOL = 'understory-auth';

function registerUnderstoryAuthProtocol(plugin) {
    plugin.registerObsidianProtocolHandler(UNDERSTORY_AUTH_PROTOCOL, async (data) => {
        await plugin.hostedHandleProtocolCallback(data || {});
    });
}

module.exports = {
    UNDERSTORY_AUTH_PROTOCOL,
    registerUnderstoryAuthProtocol,
};

/* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- End CommonJS audit bridge. */
