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
