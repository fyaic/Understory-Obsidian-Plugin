/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { t } = require('./i18n');

function registerCoreCommands(plugin) {
    const accountStatus = () => plugin.hostedAccountSummary?.().status || 'disconnected';
    const whenAccount = (expected, action) => (checking) => {
        const available = accountStatus() === expected;
        if (!checking && available) action();
        return available;
    };

    plugin.addCommand({
        id: 'auto-link-now',
        name: t(plugin, 'command_auto_link'),
        checkCallback: whenAccount('connected', () => plugin.linkNow()),
    });

    const hostedMode = (plugin.settings?.networkMode || 'hosted') === 'hosted';
    if (!hostedMode) {
        plugin.addCommand({
            id: 'init-embedding-index',
            name: t(plugin, 'command_init_index'),
            callback: () => plugin.initIndex(),
        });
    } else {
        plugin.addCommand({
            id: 'graphify-ingest-now',
            name: t(plugin, 'command_ingest_now'),
            checkCallback: whenAccount('connected', () => plugin.hostedExtractPrinciplesForFile()),
        });
        plugin.addCommand({
            id: 'graphify-lint-now',
            name: t(plugin, 'command_lint_now'),
            checkCallback: whenAccount('connected', () => plugin.runHostedVaultAnalysis(true)),
        });
        plugin.addCommand({
            id: 'graphify-open-index',
            name: t(plugin, 'command_open_index'),
            callback: () => plugin._openGraphifyIndex(),
        });
        plugin.addCommand({
            id: 'graphify-view-conflicts',
            name: t(plugin, 'command_view_conflicts'),
            callback: () => plugin._openConflictsView(),
        });
        plugin.addCommand({
            id: 'graphify-view-orphans',
            name: t(plugin, 'command_view_orphans'),
            callback: () => plugin._openOrphansView(),
        });
    }

    plugin.addCommand({
        id: 'open-sidebar',
        name: t(plugin, 'command_show_understory'),
        callback: () => plugin.openSidebar(),
    });

    if (!hostedMode) {
        plugin.addCommand({
            id: 'toggle-index-daemon',
            name: t(plugin, 'command_toggle_daemon'),
            callback: () => plugin.toggleDaemon(),
        });
    }

    plugin.addCommand({
        id: 'refresh-hosted-config',
        name: t(plugin, 'command_refresh_hosted_config'),
        checkCallback: whenAccount('connected', () => plugin.hostedRefreshStatus(true)),
    });

    plugin.addCommand({
        id: 'login-register',
        name: t(plugin, 'command_login_register'),
        checkCallback: whenAccount('disconnected', () => plugin.hostedLogin(true)),
    });

    plugin.addCommand({
        id: 'switch-bondie-account',
        name: t(plugin, 'command_switch_account'),
        checkCallback: whenAccount('connected', () => plugin.hostedSwitchAccount(true)),
    });

    plugin.addCommand({
        id: 'open-account-center',
        name: t(plugin, 'command_account_center'),
        checkCallback: whenAccount('connected', () => plugin.openHostedAccountCenter(true)),
    });

    plugin.addCommand({
        id: 'hosted-logout',
        name: t(plugin, 'command_hosted_logout'),
        checkCallback: whenAccount('connected', () => plugin.hostedLogout(true)),
    });

    plugin.addCommand({
        id: 'bondie-global-logout',
        name: t(plugin, 'command_global_logout'),
        checkCallback: whenAccount('connected', () => plugin.hostedGlobalLogout(true)),
    });
}

module.exports = { registerCoreCommands };

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
