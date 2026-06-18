const { t } = require('./i18n');

function registerCoreCommands(plugin) {
    plugin.addCommand({
        id: 'auto-link-now',
        name: t(plugin, 'command_auto_link'),
        callback: () => plugin.linkNow(),
    });

    plugin.addCommand({
        id: 'init-embedding-index',
        name: t(plugin, 'command_init_index'),
        callback: () => plugin.initIndex(),
    });

    plugin.addCommand({
        id: 'understory-open-sidebar',
        name: t(plugin, 'command_show_understory'),
        callback: () => plugin.openSidebar(),
    });

    plugin.addCommand({
        id: 'understory-open-sidebar-alias',
        name: t(plugin, 'command_show_understory_sidebar'),
        callback: () => plugin.openSidebar(),
    });

    plugin.addCommand({
        id: 'toggle-index-daemon',
        name: t(plugin, 'command_toggle_daemon'),
        callback: () => plugin.toggleDaemon(),
    });
}

module.exports = { registerCoreCommands };
