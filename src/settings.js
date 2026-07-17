const { PluginSettingTab, Setting, Notice, setIcon } = require('obsidian');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
    USAGE_MODES,
    agentProfilesForLanguage,
    checkAgentAccessStatus,
    createAgentAccessPaths,
    createAgentSetupPack,
    createStandaloneMcpServerSource,
    writeAgentAccessFile,
} = require('./agentAccess');
const { getLanguage, t } = require('./i18n');
const { recordBackgroundError } = require('./safety');

const ENGINE_DIR_ENV = 'UNDERSTORY_ENGINE_DIR';
const LEGACY_ENGINE_DIR_ENV = 'GRAPHIFY_ENGINE_DIR';
const PYTHON_PATH_ENV = 'UNDERSTORY_PYTHON_PATH';
const DEFAULT_PYTHON_COMMAND = 'python';
const WEBHOOK_URL_EXAMPLE = 'https://hooks.slack.com/...';
const ENGINE_DIR_CANDIDATE_NAMES = [
    'understory-graphify-engine',
    'Understory-graphify-engine',
    'Understory-Graphify-Engine',
];

const SETTINGS_PAGES = [
    ['account', 'settings_nav_account', 'user'],
    ['usage', 'settings_nav_usage', 'gauge'],
    ['workflow', 'settings_nav_workflow', 'sliders-horizontal'],
    ['scope', 'settings_nav_scope', 'folder-tree'],
    ['suggestions', 'settings_nav_suggestions', 'sparkles'],
    ['activity', 'settings_nav_activity', 'history'],
    ['agents', 'settings_tab_agents', 'bot'],
    ['advanced', 'settings_nav_advanced', 'wrench'],
];

function envValue(name, env) {
    try {
        const source = env || (typeof process !== 'undefined' && process.env) || {};
        const value = source[name];
        return value == null ? '' : String(value).trim();
    } catch (error) {
        return '';
    }
}

function safeExists(candidate, fileSystem = fs) {
    try {
        return !!candidate && fileSystem.existsSync(candidate);
    } catch (error) {
        return false;
    }
}

function isLikelyEngineDir(candidate, options = {}) {
    const dir = String(candidate || '').trim();
    if (!dir) return false;
    const pathModule = options.path || path;
    const fileSystem = options.fs || fs;
    return safeExists(pathModule.join(dir, 'api.py'), fileSystem)
        && safeExists(pathModule.join(dir, 'scripts', 'deploy_graphify.py'), fileSystem);
}

function addSearchRoot(roots, rootPath, options = {}) {
    const value = String(rootPath || '').trim();
    if (!value) return;
    const pathModule = options.path || path;
    const includeAncestors = options.includeAncestors === true;
    let current;
    try {
        current = pathModule.resolve(value);
    } catch (error) {
        return;
    }
    while (current) {
        roots.push(current);
        if (!includeAncestors) break;
        const parent = pathModule.dirname(current);
        if (!parent || parent === current) break;
        current = parent;
    }
}

function uniquePaths(values, pathModule = path) {
    const seen = new Set();
    const results = [];
    const caseInsensitive = pathModule.sep === '\\';
    for (const value of values) {
        if (!value) continue;
        const key = caseInsensitive ? String(value).toLowerCase() : String(value);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(value);
    }
    return results;
}

function processCwd() {
    try {
        return typeof process !== 'undefined' && typeof process.cwd === 'function'
            ? process.cwd()
            : '';
    } catch (error) {
        return '';
    }
}

function defaultEngineSearchRoots(options = {}) {
    const pathModule = options.path || path;
    const roots = [];
    for (const root of options.searchRoots || []) {
        addSearchRoot(roots, root, { path: pathModule, includeAncestors: true });
    }
    if (options.pluginDir) {
        addSearchRoot(roots, options.pluginDir, { path: pathModule, includeAncestors: true });
    }
    if (options.includeDefaultRoots === false) return uniquePaths(roots, pathModule);

    if (!options.pluginDir) addSearchRoot(roots, __dirname, { path: pathModule, includeAncestors: true });
    addSearchRoot(roots, processCwd(), { path: pathModule, includeAncestors: true });

    const env = options.env;
    const home = envValue('USERPROFILE', env) || envValue('HOME', env);
    if (home) {
        addSearchRoot(roots, home, { path: pathModule });
        addSearchRoot(roots, pathModule.join(home, 'Documents'), { path: pathModule });
        addSearchRoot(roots, pathModule.join(home, 'Downloads'), { path: pathModule });
        addSearchRoot(roots, pathModule.join(home, 'Hello-World'), { path: pathModule });
        const driveRoot = pathModule.parse(home).root;
        if (driveRoot) addSearchRoot(roots, pathModule.join(driveRoot, 'Hello-World'), { path: pathModule });
    }

    return uniquePaths(roots, pathModule);
}

function findDefaultEngineDir(options = {}) {
    const pathModule = options.path || path;
    const candidateNames = options.candidateNames || ENGINE_DIR_CANDIDATE_NAMES;
    const roots = defaultEngineSearchRoots(options);
    for (const root of roots) {
        if (isLikelyEngineDir(root, options)) return root;
        for (const name of candidateNames) {
            const candidate = pathModule.join(root, name);
            if (isLikelyEngineDir(candidate, options)) return candidate;
        }
    }
    return '';
}

function getDefaultEngineDir(options = {}) {
    return envValue(ENGINE_DIR_ENV, options.env)
        || envValue(LEGACY_ENGINE_DIR_ENV, options.env)
        || findDefaultEngineDir(options);
}

function getDefaultPythonPath(options = {}) {
    const platform = options.platform || (typeof process !== 'undefined' ? process.platform : '');
    return findDefaultPythonPath(options) || envValue(PYTHON_PATH_ENV, options.env) || (platform === 'win32' ? 'python' : 'python3');
}

function uniqueValues(values) {
    const seen = new Set();
    const results = [];
    for (const value of values) {
        const text = String(value || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        results.push(text);
    }
    return results;
}

function pythonCandidates(options = {}) {
    const platform = options.platform || (typeof process !== 'undefined' ? process.platform : '');
    const env = options.env;
    const configured = envValue(PYTHON_PATH_ENV, env);
    const candidates = [configured];
    if (platform === 'darwin') {
        candidates.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3', 'python3', 'python');
    } else if (platform === 'win32') {
        candidates.push('python', 'py');
    } else {
        candidates.push('python3', '/usr/bin/python3', '/usr/local/bin/python3', 'python');
    }
    return uniqueValues(candidates);
}

function isLikelyPythonExecutable(candidate, options = {}) {
    const command = String(candidate || '').trim();
    if (!command) return false;
    const runner = options.spawnSync || spawnSync;
    try {
        const result = runner(command, ['--version'], {
            encoding: 'utf8',
            timeout: options.timeoutMs || 1500,
            windowsHide: true,
        });
        return !result.error && result.status === 0;
    } catch (error) {
        return false;
    }
}

function findDefaultPythonPath(options = {}) {
    for (const candidate of pythonCandidates(options)) {
        if (isLikelyPythonExecutable(candidate, options)) return candidate;
    }
    return '';
}

function repairPythonPath(settings, options = {}) {
    if (!settings || typeof settings !== 'object') return { changed: false, pythonPath: '' };
    const current = String(settings.pythonPath || '').trim();
    const discovered = findDefaultPythonPath(options);
    if (!current) {
        settings.pythonPath = discovered || getDefaultPythonPath();
        return { changed: true, pythonPath: settings.pythonPath };
    }
    if (discovered && discovered !== current && !isLikelyPythonExecutable(current, options)) {
        settings.pythonPath = discovered;
        return { changed: true, pythonPath: discovered };
    }
    return { changed: false, pythonPath: current };
}

function bundledEngineDir(plugin) {
    return String(plugin?.bundledEngine?.engineDir || '').trim();
}

function preferredEngineDir(plugin) {
    return bundledEngineDir(plugin) || getDefaultEngineDir();
}

const PROVIDER_PRESETS = {
    zhipu: {
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        embeddingModel: 'embedding-3',
        llmModel: 'glm-4-flash',
        dimensions: 1024,
    },
    openai: {
        baseUrl: 'https://api.openai.com/v1/',
        embeddingModel: 'text-embedding-3-small',
        llmModel: 'gpt-4o-mini',
        dimensions: 1536,
    },
    'kimi-cn': {
        baseUrl: 'https://api.moonshot.cn/v1',
        embeddingModel: '',
        llmModel: 'kimi-k2.5',
        dimensions: 1024,
    },
    'kimi-global': {
        baseUrl: 'https://api.moonshot.ai/v1',
        embeddingModel: '',
        llmModel: 'kimi-k2.5',
        dimensions: 1024,
    },
    custom: {
        baseUrl: '',
        embeddingModel: '',
        llmModel: '',
        dimensions: 1024,
    },
    none: {
        baseUrl: '',
        embeddingModel: '',
        llmModel: '',
        dimensions: 1024,
    },
};

function providerPreset(name) {
    return PROVIDER_PRESETS[name] || PROVIDER_PRESETS.custom;
}

const DEFAULT_SETTINGS = {
    settingsSchemaVersion: 2,
    graphifyDir: getDefaultEngineDir(),
    pythonPath: getDefaultPythonPath(),
    debounceMinutes: 10,
    linkLog: [],
    uiLanguage: 'en',
    agentProfileId: 'generic',
    agentUsageModeId: 'memory',
    networkMode: 'hosted',
    hostedServerUrl: 'https://understory.bondie.io',
    hostedAccountCenterUrl: 'https://account.bondie.io/account',
    hostedAccessToken: '',
    hostedClientInstanceId: '',
    hostedBillingIdempotency: {},
    hostedLoginState: '',
    hostedLoginStartedAt: 0,
    hostedLoginExpiresAt: 0,
    hostedUser: null,
    hostedSubscription: null,
    hostedRuntimeConfig: null,
    hostedConsentAccepted: false,
    hostedLastSync: 0,
    embeddingProvider: 'hosted',
    embeddingBaseUrl: '',
    embeddingModel: '',
    embeddingDimensions: 1024,
    embeddingApiKey: '',
    llmProvider: 'hosted',
    llmBaseUrl: '',
    llmModel: '',
    llmApiKey: '',
    presentationMode: 'sidebar',
    sidebarRefreshOnEdit: true,
    sidebarShowScores: true,
    sidebarShowConflicts: true,
    sidebarGroupBy: 'concept',
    // AIC-2104: 持续自动更新开关
    autoRefreshEnabled: false,
    // AIC-2105: 文件夹白名单（空数组表示全部）
    refreshFolders: [],
    // 黑名单：这些文件夹中的文件不参与建联（与白名单互斥）
    excludedFolders: [],
    // AIC-2106: 更新频率 'weekly' | 'monthly'
    refreshFrequency: 'weekly',
    // 上次全量更新时间戳
    lastRefreshTime: 0,
    // 刷新进度（内部状态）
    refreshInProgress: false,
    refreshQueue: [],
    refreshQueueIndex: 0,
    // 后台本地语义索引更新设置
    daemonEnabled: false,
    daemonInterval: 1800,

    // ═══ Graphify AI 层（L2-L6）配置 ═══
    // L2 原则提取：文件修改后与关联发现并行触发
    ingestEnabled: true,
    // L3/L4/L5 定时全库检查 + 知识网络分析 + 索引
    lintEnabled: true,
    lintFrequency: 'weekly',        // 'weekly' | 'monthly'
    lastLintTime: 0,
    lintInProgress: false,
    // 冲突就近呈现（## ⚠️冲突发现）。优化后误报已大幅下降（medium 仅个位数真实冲突），
    // 默认提升到 medium+high，让真实冲突就近可见；仍可在设置中调回 high 或关闭。
    conflictBlockEnabled: true,
    conflictBlockMinSeverity: 'medium', // 'high' | 'medium'
    // 通知（默认静默 + 文件内）
    notificationLevel: 'file_only', // 'silent' | 'file_only' | 'high_only' | 'all'
    notifyHighConflict: true,
    notificationCooldown: {},       // { 'high_conflict': ts, 'daily_digest': dateStr }
    // 日志
    logRetentionDays: 7,
    // Webhook（默认关闭）
    webhookEnabled: false,
    webhookUrl: '',
    webhookType: 'slack',           // 'slack' | 'feishu' | 'wecom' | 'custom'
    // 首次 AI 层初始化标记
    graphifyInitialized: false,
};

class UnderstorySettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this._activeScopeTab = 'whitelist';
        this._activeSettingsPage = 'account';
        this._advancedDiagnosticsOpen = false;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('understory-settings-tab');

        this._renderSettingsHeader(containerEl);

        const account = this.plugin.hostedAccountSummary ? this.plugin.hostedAccountSummary() : { status: 'disconnected' };
        const connected = account.status === 'connected';
        const hostedMode = (this.plugin.settings.networkMode || 'hosted') === 'hosted';
        const navigationEnabled = connected || !hostedMode;
        if (!connected && hostedMode) this._activeSettingsPage = 'account';
        if (!hostedMode && ['account', 'usage'].includes(this._activeSettingsPage)) {
            this._activeSettingsPage = 'advanced';
        }

        const shell = containerEl.createDiv({
            cls: `understory-settings-shell${navigationEnabled ? '' : ' is-onboarding'}`,
        });
        if (navigationEnabled) this._renderSettingsNavigation(shell, { hostedMode });
        const body = shell.createDiv({ cls: 'understory-settings-body' });

        if (this._activeSettingsPage === 'workflow') {
            this._renderWorkflowPage(body);
        } else if (this._activeSettingsPage === 'usage') {
            this._renderUsagePage(body);
        } else if (this._activeSettingsPage === 'scope') {
            this._renderScopePage(body);
        } else if (this._activeSettingsPage === 'suggestions') {
            this._renderSuggestionsPage(body);
        } else if (this._activeSettingsPage === 'activity') {
            this._renderActivityPage(body);
        } else if (this._activeSettingsPage === 'agents') {
            this._renderAgentAccessTab(body);
        } else if (this._activeSettingsPage === 'advanced') {
            this._renderAdvancedPage(body);
        } else {
            this._activeSettingsPage = 'account';
            this._renderAccountPage(body);
        }
    }

    _renderSettingsHeader(containerEl) {
        const header = containerEl.createDiv({ cls: 'understory-settings-header' });
        const copy = header.createDiv({ cls: 'understory-settings-header-copy' });
        copy.createDiv({ text: t(this.plugin, 'settings_title'), cls: 'understory-settings-title' });
        copy.createEl('p', { text: t(this.plugin, 'settings_subtitle') });
        this._renderLanguageToggle(header);
    }

    _renderSettingsNavigation(containerEl, { hostedMode = true } = {}) {
        const nav = containerEl.createDiv({ cls: 'understory-settings-nav', attr: { role: 'tablist' } });
        const pages = hostedMode
            ? SETTINGS_PAGES
            : SETTINGS_PAGES.filter(([id]) => !['account', 'usage'].includes(id));
        for (const [id, labelKey, iconName] of pages) {
            const button = nav.createEl('button', {
                cls: 'understory-settings-nav-button',
                attr: {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': String(this._activeSettingsPage === id),
                },
            });
            const icon = button.createSpan({ cls: 'understory-settings-nav-icon', attr: { 'aria-hidden': 'true' } });
            setIcon(icon, iconName);
            button.createSpan({ text: t(this.plugin, labelKey), cls: 'understory-settings-nav-label' });
            if (this._activeSettingsPage === id) button.addClass('is-active');
            button.addEventListener('click', () => {
                this._activeSettingsPage = id;
                this.display();
            });
        }
    }

    _renderPageIntro(containerEl, titleKey, descKey) {
        const intro = containerEl.createDiv({ cls: 'understory-settings-page-intro' });
        intro.createDiv({ text: t(this.plugin, titleKey), cls: 'understory-settings-page-title' });
        intro.createEl('p', { text: t(this.plugin, descKey) });
        return intro;
    }

    _renderTabIntro(containerEl, titleKey, descKey) {
        return this._renderPageIntro(containerEl, titleKey, descKey);
    }

    _renderAccountPage(containerEl) {
        this._renderPageIntro(containerEl, 'account_home_title', 'account_home_desc');
        this._renderAccountHome(containerEl);
    }

    _renderUsagePage(containerEl) {
        this._renderPageIntro(containerEl, 'usage_page_title', 'usage_page_desc');
        const account = this.plugin.hostedAccountSummary ? this.plugin.hostedAccountSummary() : { status: 'disconnected' };
        if (account.status !== 'connected') {
            const empty = containerEl.createDiv({ cls: 'understory-settings-panel understory-usage-empty' });
            const icon = empty.createDiv({ cls: 'understory-state-icon', attr: { 'aria-hidden': 'true' } });
            setIcon(icon, 'log-in');
            empty.createDiv({ text: t(this.plugin, 'usage_login_title'), cls: 'understory-settings-panel-title' });
            empty.createEl('p', { text: t(this.plugin, 'usage_login_desc') });
            const actions = empty.createDiv({ cls: 'understory-account-actions' });
            this._accountActionButton(actions, t(this.plugin, 'hosted_login_button'), () => this.plugin.hostedLogin(true), { cta: true, icon: 'log-in' });
            return;
        }

        const usage = this.plugin.hostedUsageSummary;
        if (!usage) {
            const loading = containerEl.createDiv({ cls: 'understory-settings-panel understory-usage-loading', attr: { 'aria-live': 'polite' } });
            loading.createDiv({ cls: 'understory-skeleton-line is-title' });
            loading.createDiv({ cls: 'understory-skeleton-line' });
            loading.createDiv({ cls: 'understory-skeleton-line is-short' });
            if (this._usageError) {
                loading.createDiv({ cls: 'understory-inline-error', text: t(this.plugin, 'usage_load_failed') });
                const retry = loading.createDiv({ cls: 'understory-account-actions' });
                this._accountActionButton(retry, t(this.plugin, 'usage_refresh_button'), async () => {
                    this._usageError = '';
                    this._usageAutoLoadAttempted = false;
                    this.display();
                }, { icon: 'refresh-cw' });
                return;
            }
            if (!this._usageLoadInFlight && !this._usageAutoLoadAttempted && typeof this.plugin.refreshHostedUsage === 'function') {
                this._usageLoadInFlight = true;
                this._usageAutoLoadAttempted = true;
                this._usageError = '';
                this.plugin.refreshHostedUsage(false)
                    .catch((error) => { this._usageError = String(error.message || error); })
                    .finally(() => {
                        this._usageLoadInFlight = false;
                        if (this._activeSettingsPage === 'usage') this.display();
                    });
            }
            return;
        }

        const access = usage.provider_access || {};
        const service = containerEl.createDiv({ cls: `understory-service-row is-${access.status || 'not_ready'}` });
        const serviceIcon = service.createDiv({ cls: 'understory-service-row-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(serviceIcon, access.status === 'ready' ? 'check-circle-2' : 'circle-alert');
        const serviceCopy = service.createDiv({ cls: 'understory-service-row-copy' });
        serviceCopy.createEl('strong', { text: t(this.plugin, `provider_status_${access.status || 'not_ready'}`) });
        serviceCopy.createEl('span', { text: t(this.plugin, 'usage_managed_service_desc') });
        this._accountActionButton(service, t(this.plugin, 'usage_refresh_button'), async () => {
            await this.plugin.refreshHostedUsage(true);
            this.display();
        }, { icon: 'refresh-cw' });

        const metrics = containerEl.createDiv({ cls: 'understory-usage-metrics' });
        this._renderUsageMetric(metrics, t(this.plugin, 'usage_requests_label'), String(usage.requests || 0));
        this._renderUsageMetric(metrics, t(this.plugin, 'usage_input_label'), Number(usage.input_units || 0).toLocaleString());
        this._renderUsageMetric(metrics, t(this.plugin, 'usage_output_label'), Number(usage.output_units || 0).toLocaleString());
        if (this.plugin.settings?.hostedRuntimeConfig?.billing?.enabled === true) {
            this._renderUsageMetric(metrics, t(this.plugin, 'usage_cost_label'), `$${Number(usage.estimated_cost_usd || 0).toFixed(4)}`);
        }

        const breakdown = containerEl.createDiv({ cls: 'understory-settings-panel understory-usage-breakdown' });
        this._renderPanelHeader(breakdown, 'usage_breakdown_title', 'usage_breakdown_desc');
        const rows = breakdown.createDiv({ cls: 'understory-usage-rows' });
        for (const feature of ['relation_discovery', 'risk_analysis', 'principle_extraction', 'vault_analysis', 'reasoning', 'embedding']) {
            const item = usage.by_feature?.[feature] || {};
            const row = rows.createDiv({ cls: 'understory-usage-row' });
            const rowIcon = row.createSpan({ cls: 'understory-usage-row-icon', attr: { 'aria-hidden': 'true' } });
            setIcon(rowIcon, ({
                relation_discovery: 'network',
                risk_analysis: 'shield-alert',
                principle_extraction: 'list-checks',
                vault_analysis: 'scan-line',
                reasoning: 'brain-circuit',
                embedding: 'scan-search',
            })[feature]);
            const copy = row.createDiv({ cls: 'understory-usage-row-copy' });
            copy.createEl('strong', { text: t(this.plugin, `usage_feature_${feature}`) });
            copy.createEl('span', { text: t(this.plugin, 'usage_feature_summary', {
                requests: String(item.requests || 0),
                units: Number((item.input_units || 0) + (item.output_units || 0)).toLocaleString(),
            }) });
        }
        breakdown.createDiv({
            cls: 'understory-usage-last-used',
            text: usage.last_used_at
                ? t(this.plugin, 'usage_last_used', { time: new Date(usage.last_used_at).toLocaleString() })
                : t(this.plugin, 'usage_never_used'),
        });
    }

    _renderUsageMetric(parent, label, value) {
        const item = parent.createDiv({ cls: 'understory-usage-metric' });
        item.createEl('strong', { text: value });
        item.createSpan({ text: label });
    }

    _renderWorkflowPage(containerEl) {
        this._renderPageIntro(containerEl, 'workflow_page_title', 'workflow_page_desc');

        const timingPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(timingPanel, 'workflow_timing_title', 'workflow_timing_desc');

        new Setting(timingPanel)
            .setName(t(this.plugin, 'background_refresh_name'))
            .setDesc(t(this.plugin, 'background_refresh_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.sidebarRefreshOnEdit !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sidebarRefreshOnEdit = value;
                    if (!value) this.plugin._clearHostedScheduledWork?.();
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.sidebarRefreshOnEdit !== false) {
            new Setting(timingPanel)
                .setName(t(this.plugin, 'debounce_name'))
                .setDesc(t(this.plugin, 'debounce_desc'))
                .addSlider((slider) => slider
                    .setLimits(1, 30, 1)
                    .setValue(this.plugin.settings.debounceMinutes)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.debounceMinutes = value;
                        await this.plugin.saveSettings();
                    }));
        }

        const consentPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(consentPanel, 'workflow_consent_title', 'workflow_consent_desc');
        new Setting(consentPanel)
            .setName(t(this.plugin, 'hosted_consent_name'))
            .setDesc(t(this.plugin, 'hosted_consent_desc'))
            .addToggle((toggle) => toggle
                .setValue(!!this.plugin.settings.hostedConsentAccepted)
                .onChange(async (value) => {
                    this.plugin.settings.hostedConsentAccepted = value;
                    if (!value) this.plugin._clearHostedScheduledWork?.();
                    await this.plugin.saveSettings();
                }));

        const placementPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(placementPanel, 'workflow_placement_title', 'workflow_placement_desc');

        new Setting(placementPanel)
            .setName(t(this.plugin, 'presentation_mode_name'))
            .setDesc(t(this.plugin, 'presentation_mode_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('sidebar', t(this.plugin, 'presentation_sidebar'))
                .addOption('body', t(this.plugin, 'presentation_body'))
                .addOption('both', t(this.plugin, 'presentation_both'))
                .setValue(this.plugin.settings.presentationMode || DEFAULT_SETTINGS.presentationMode)
                .onChange(async (value) => {
                    this.plugin.settings.presentationMode = value;
                    await this.plugin.saveSettings();
                    if (value === 'sidebar' || value === 'both') {
                        await this.plugin.openSidebar();
                    }
                }));

        new Setting(placementPanel)
            .setName(t(this.plugin, 'open_sidebar_on_load_name'))
            .setDesc(t(this.plugin, 'open_sidebar_on_load_desc'))
            .addToggle((toggle) => toggle
                .setValue(!!this.plugin.settings.openSidebarOnLoad)
                .onChange(async (value) => {
                    this.plugin.settings.openSidebarOnLoad = value;
                    await this.plugin.saveSettings();
                }));
    }

    _renderScopePage(containerEl) {
        this._renderPageIntro(containerEl, 'scope_page_title', 'scope_page_desc');

        const folders = this._getAllFolders();
        const excluded = this._sortFolders(this.plugin.settings.excludedFolders || []);
        const included = this._sortFolders(this.plugin.settings.refreshFolders || []);
        const stats = containerEl.createDiv({ cls: 'understory-settings-summary-grid' });
        this._renderSummaryStat(stats, t(this.plugin, 'scope_total_folders_label'), String(folders.length));
        this._renderSummaryStat(stats, t(this.plugin, 'scope_excluded_folders_label'), String(excluded.length));
        this._renderSummaryStat(stats, t(this.plugin, 'scope_included_folders_label'), included.length ? String(included.length) : t(this.plugin, 'scope_all_folders_value'));

        const excludePanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(excludePanel, 'excluded_folders_title', 'excluded_folders_desc');
        this._renderFolderTree(excludePanel, 'excludedFolders', 'refreshFolders', t(this.plugin, 'excluded_selected'));

        const includePanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(includePanel, 'refresh_folders_title', 'refresh_folders_desc');
        this._renderFolderTree(includePanel, 'refreshFolders', 'excludedFolders', t(this.plugin, 'refresh_selected'));

        const refreshPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(refreshPanel, 'scope_refresh_title', 'scope_refresh_desc');

        new Setting(refreshPanel)
            .setName(t(this.plugin, 'auto_refresh_name'))
            .setDesc(t(this.plugin, 'auto_refresh_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.autoRefreshEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.autoRefreshEnabled = value;
                    await this.plugin.saveSettings();
                    if (value) await this.plugin.checkAndStartRefresh();
                    this.display();
                }));

        if (this.plugin.settings.autoRefreshEnabled) {
            new Setting(refreshPanel)
                .setName(t(this.plugin, 'refresh_frequency_name'))
                .setDesc(t(this.plugin, 'refresh_frequency_desc'))
                .addDropdown((dropdown) => dropdown
                    .addOption('weekly', t(this.plugin, 'weekly'))
                    .addOption('monthly', t(this.plugin, 'monthly'))
                    .setValue(this.plugin.settings.refreshFrequency)
                    .onChange(async (value) => {
                        this.plugin.settings.refreshFrequency = value;
                        await this.plugin.saveSettings();
                    }));

            const lastRefresh = this.plugin.settings.lastRefreshTime;
            refreshPanel.createDiv({
                text: lastRefresh > 0
                    ? t(this.plugin, 'last_refresh', { time: new Date(lastRefresh).toLocaleString() })
                    : t(this.plugin, 'last_refresh_never'),
                cls: 'setting-item-description understory-settings-inline-note'
            });

            if (this.plugin.settings.refreshInProgress) {
                const idx = this.plugin.settings.refreshQueueIndex || 0;
                const total = (this.plugin.settings.refreshQueue || []).length;
                refreshPanel.createDiv({
                    text: t(this.plugin, 'refresh_progress', { current: idx, total }),
                    cls: 'setting-item-description understory-settings-inline-note'
                });
            }

            new Setting(refreshPanel)
                .addButton((button) => {
                    if (this.plugin.settings.refreshInProgress) {
                        button.setButtonText(t(this.plugin, 'cancel_refresh_button'))
                            .setWarning()
                            .onClick(async () => {
                                await this.plugin.cancelRefresh();
                                this.display();
                            });
                    } else {
                        button.setButtonText(t(this.plugin, 'run_refresh_button'))
                            .setCta()
                            .onClick(async () => {
                                await this.plugin.startRefreshQueue();
                                this.display();
                            });
                    }
                });
        }
    }

    _renderSuggestionsPage(containerEl) {
        this._renderPageIntro(containerEl, 'suggestions_page_title', 'suggestions_page_desc');

        const sidebarPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(sidebarPanel, 'suggestions_sidebar_title', 'suggestions_sidebar_desc');

        new Setting(sidebarPanel)
            .setName(t(this.plugin, 'sidebar_group_name'))
            .setDesc(t(this.plugin, 'sidebar_group_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('concept', t(this.plugin, 'sidebar_group_concept'))
                .addOption('type', t(this.plugin, 'sidebar_group_type'))
                .setValue(this.plugin.settings.sidebarGroupBy || 'concept')
                .onChange(async (value) => {
                    this.plugin.settings.sidebarGroupBy = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(sidebarPanel)
            .setName(t(this.plugin, 'sidebar_scores_name'))
            .setDesc(t(this.plugin, 'sidebar_scores_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.sidebarShowScores !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sidebarShowScores = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(sidebarPanel)
            .setName(t(this.plugin, 'sidebar_conflicts_name'))
            .setDesc(t(this.plugin, 'sidebar_conflicts_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.sidebarShowConflicts !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sidebarShowConflicts = value;
                    await this.plugin.saveSettings();
                }));

        if ((this.plugin.settings.networkMode || 'hosted') === 'hosted') {
            const analysisPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
            this._renderPanelHeader(analysisPanel, 'hosted_analysis_panel_title', 'hosted_analysis_panel_desc');
            new Setting(analysisPanel)
                .setName(t(this.plugin, 'hosted_analysis_schedule_name'))
                .setDesc(t(this.plugin, 'hosted_analysis_schedule_desc'))
                .addToggle((toggle) => toggle
                    .setValue(!!this.plugin.settings.lintEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.lintEnabled = value;
                        if (!value && this.plugin.periodicTimer) {
                            window.clearInterval(this.plugin.periodicTimer);
                            this.plugin.periodicTimer = null;
                        }
                        await this.plugin.saveSettings();
                        if (value) this.plugin.initHostedAnalysis?.();
                    }))
                .addDropdown((dropdown) => dropdown
                    .addOption('weekly', t(this.plugin, 'weekly'))
                    .addOption('monthly', t(this.plugin, 'monthly'))
                    .setValue(this.plugin.settings.lintFrequency || 'weekly')
                    .onChange(async (value) => {
                        this.plugin.settings.lintFrequency = value;
                        await this.plugin.saveSettings();
                    }));

            const lastLint = Number(this.plugin.settings.lastLintTime || 0);
            const openHigh = this.plugin._countOpenConflicts ? this.plugin._countOpenConflicts('high') : 0;
            const openAll = this.plugin._countOpenConflicts ? this.plugin._countOpenConflicts() : 0;
            analysisPanel.createEl('div', {
                text: lastLint > 0
                    ? t(this.plugin, 'last_lint', { time: new Date(lastLint).toLocaleString(), all: openAll, high: openHigh })
                    : t(this.plugin, 'last_lint_never'),
                cls: 'setting-item-description understory-settings-inline-note'
            });

            const actions = new Setting(analysisPanel);
            actions.addButton((button) => button
                .setButtonText(t(this.plugin, 'hosted_extract_principles_button'))
                .onClick(async () => {
                    try {
                        await this.plugin.hostedExtractPrinciplesForFile();
                    } catch (error) {
                        recordBackgroundError(this.plugin, 'extract-hosted-principles', error);
                        new Notice(t(this.plugin, 'hosted_action_failed', { message: String(error.message || error).slice(0, 100) }), 8000);
                    }
                }));
            actions.addButton((button) => button
                .setButtonText(this.plugin.settings.lintInProgress ? t(this.plugin, 'lint_running_button') : t(this.plugin, 'hosted_analyze_vault_button'))
                .setCta()
                .setDisabled(!!this.plugin.settings.lintInProgress)
                .onClick(async () => {
                    try {
                        await this.plugin.runHostedVaultAnalysis(true);
                        this.display();
                    } catch (error) {
                        recordBackgroundError(this.plugin, 'analyze-hosted-vault', error);
                        new Notice(t(this.plugin, 'hosted_action_failed', { message: String(error.message || error).slice(0, 100) }), 8000);
                    }
                }));

            const reportsPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
            this._renderPanelHeader(reportsPanel, 'suggestions_reports_title', 'suggestions_reports_desc');
            new Setting(reportsPanel)
                .addButton((button) => button.setButtonText(t(this.plugin, 'open_conflicts_button')).onClick(() => this.plugin._openConflictsView()))
                .addButton((button) => button.setButtonText(t(this.plugin, 'open_orphans_button')).onClick(() => this.plugin._openOrphansView()))
                .addButton((button) => button.setButtonText(t(this.plugin, 'open_index_button')).onClick(() => this.plugin._openGraphifyIndex()));
            return;
        }

        const analysisPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(analysisPanel, 'suggestions_analysis_title', 'suggestions_analysis_desc');

        new Setting(analysisPanel)
            .setName(t(this.plugin, 'ingest_name'))
            .setDesc(t(this.plugin, 'ingest_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.ingestEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.ingestEnabled = value;
                    await this.plugin.saveSettings();
                }));
    }

    _renderMaintenanceTab(containerEl) {
        this._renderTabIntro(containerEl, 'maintenance_page_title', 'maintenance_page_desc');
        const analysisPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });

        new Setting(analysisPanel)
            .setName(t(this.plugin, 'lint_name'))
            .setDesc(t(this.plugin, 'lint_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.lintEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.lintEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.lintEnabled) {
            new Setting(analysisPanel)
                .setName(t(this.plugin, 'lint_frequency_name'))
                .setDesc(t(this.plugin, 'lint_frequency_desc'))
                .addDropdown((dropdown) => dropdown
                    .addOption('weekly', t(this.plugin, 'weekly'))
                    .addOption('monthly', t(this.plugin, 'monthly'))
                    .setValue(this.plugin.settings.lintFrequency)
                    .onChange(async (value) => {
                        this.plugin.settings.lintFrequency = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(analysisPanel)
                .setName(t(this.plugin, 'conflict_block_name'))
                .setDesc(t(this.plugin, 'conflict_block_desc'))
                .addDropdown((dropdown) => dropdown
                    .addOption('off', t(this.plugin, 'conflict_off'))
                    .addOption('high', t(this.plugin, 'conflict_high'))
                    .addOption('medium', t(this.plugin, 'conflict_medium'))
                    .setValue(this.plugin.settings.conflictBlockEnabled
                        ? (this.plugin.settings.conflictBlockMinSeverity || 'high') : 'off')
                    .onChange(async (value) => {
                        if (value === 'off') {
                            this.plugin.settings.conflictBlockEnabled = false;
                        } else {
                            this.plugin.settings.conflictBlockEnabled = true;
                            this.plugin.settings.conflictBlockMinSeverity = value;
                        }
                        await this.plugin.saveSettings();
                    }));

            new Setting(analysisPanel)
                .setName(t(this.plugin, 'notify_high_name'))
                .setDesc(t(this.plugin, 'notify_high_desc'))
                .addToggle((toggle) => toggle
                    .setValue(this.plugin.settings.notifyHighConflict)
                    .onChange(async (value) => {
                        this.plugin.settings.notifyHighConflict = value;
                        await this.plugin.saveSettings();
                    }));

            const webhookAvailable = (this.plugin.settings.networkMode || 'local') !== 'local';
            new Setting(analysisPanel)
                .setName(t(this.plugin, 'webhook_enabled_name'))
                .setDesc(webhookAvailable ? t(this.plugin, 'webhook_enabled_desc') : t(this.plugin, 'webhook_local_desc'))
                .addToggle((toggle) => toggle
                    .setValue(!!this.plugin.settings.webhookEnabled && webhookAvailable)
                    .setDisabled(!webhookAvailable)
                    .onChange(async (value) => {
                        this.plugin.settings.webhookEnabled = !!value && webhookAvailable;
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            if (this.plugin.settings.webhookEnabled && webhookAvailable) {
                new Setting(analysisPanel)
                    .setName(t(this.plugin, 'webhook_name'))
                    .setDesc(t(this.plugin, 'webhook_desc'))
                    .addText((text) => text
                        .setPlaceholder(WEBHOOK_URL_EXAMPLE)
                        .setValue(this.plugin.settings.webhookUrl)
                        .onChange(async (value) => {
                            this.plugin.settings.webhookUrl = value.trim();
                            await this.plugin.saveSettings();
                        }))
                    .addDropdown((dropdown) => dropdown
                        .addOption('slack', 'Slack')
                        .addOption('feishu', '\u98de\u4e66')
                        .addOption('wecom', '\u4f01\u4e1a\u5fae\u4fe1')
                        .addOption('custom', t(this.plugin, 'webhook_custom'))
                        .setValue(this.plugin.settings.webhookType)
                        .onChange(async (value) => {
                            this.plugin.settings.webhookType = value;
                            await this.plugin.saveSettings();
                        }));
            }

            const lastLint = this.plugin.settings.lastLintTime;
            const openHigh = this.plugin._countOpenConflicts ? this.plugin._countOpenConflicts('high') : 0;
            const openAll = this.plugin._countOpenConflicts ? this.plugin._countOpenConflicts() : 0;
            analysisPanel.createEl('div', {
                text: lastLint > 0
                    ? t(this.plugin, 'last_lint', { time: new Date(lastLint).toLocaleString(), all: openAll, high: openHigh })
                    : t(this.plugin, 'last_lint_never'),
                cls: 'setting-item-description understory-settings-inline-note'
            });

            const reportsPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
            this._renderPanelHeader(reportsPanel, 'suggestions_reports_title', 'suggestions_reports_desc');
            new Setting(reportsPanel)
                .addButton((button) => button
                    .setButtonText(this.plugin.settings.lintInProgress ? t(this.plugin, 'lint_running_button') : t(this.plugin, 'lint_run_button'))
                    .setCta()
                    .setDisabled(!!this.plugin.settings.lintInProgress)
                    .onClick(() => {
                        if (this.plugin.settings.lintInProgress) {
                            new Notice(t(this.plugin, 'lint_running_notice'), 4000);
                            return;
                        }
                        new Notice(t(this.plugin, 'lint_started_notice'), 6000);
                        this.plugin.runLintAndGraph(true).then(() => this.display());
                        this.display();
                    }))
                .addButton((button) => button
                    .setButtonText(t(this.plugin, 'open_conflicts_button'))
                    .onClick(() => this.plugin._openConflictsView()))
                .addButton((button) => button
                    .setButtonText(t(this.plugin, 'open_orphans_button'))
                    .onClick(() => this.plugin._openOrphansView()))
                .addButton((button) => button
                    .setButtonText(t(this.plugin, 'open_index_button'))
                    .onClick(() => this.plugin._openGraphifyIndex()));
        } else {
            const reportsPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
            this._renderPanelHeader(reportsPanel, 'suggestions_reports_title', 'suggestions_reports_desc');
            new Setting(reportsPanel)
                .addButton((button) => button
                    .setButtonText(this.plugin.settings.lintInProgress ? t(this.plugin, 'lint_running_button') : t(this.plugin, 'lint_run_button'))
                    .setCta()
                    .setDisabled(!!this.plugin.settings.lintInProgress)
                    .onClick(() => {
                        if (this.plugin.settings.lintInProgress) {
                            new Notice(t(this.plugin, 'lint_running_notice'), 4000);
                            return;
                        }
                        new Notice(t(this.plugin, 'lint_started_notice'), 6000);
                        this.plugin.runLintAndGraph(true).then(() => this.display());
                        this.display();
                    }))
                .addButton((button) => button
                    .setButtonText(t(this.plugin, 'open_conflicts_button'))
                    .onClick(() => this.plugin._openConflictsView()))
                .addButton((button) => button
                    .setButtonText(t(this.plugin, 'open_orphans_button'))
                    .onClick(() => this.plugin._openOrphansView()))
                .addButton((button) => button
                    .setButtonText(t(this.plugin, 'open_index_button'))
                    .onClick(() => this.plugin._openGraphifyIndex()));
        }
    }

    _renderActivityPage(containerEl) {
        this._renderPageIntro(containerEl, 'activity_page_title', 'activity_page_desc');

        const summary = containerEl.createDiv({ cls: 'understory-settings-summary-grid' });
        const hostedMode = (this.plugin.settings.networkMode || 'hosted') === 'hosted';
        if (hostedMode) {
            const logs = Array.isArray(this.plugin.settings.linkLog) ? this.plugin.settings.linkLog : [];
            const suggestions = logs.reduce((total, item) => total + Number(item.count || 0), 0);
            const failures = logs.filter((item) => item.status === 'error' || item.status === 'parse_error').length;
            this._renderSummaryStat(summary, t(this.plugin, 'activity_last_run_label'), logs[0]?.time || t(this.plugin, 'activity_never_value'));
            this._renderSummaryStat(summary, t(this.plugin, 'activity_recent_runs_label'), String(logs.length));
            this._renderSummaryStat(summary, t(this.plugin, 'activity_suggestions_label'), String(suggestions));
            this._renderSummaryStat(summary, t(this.plugin, 'activity_failures_label'), String(failures));
        } else {
            const lastLint = this.plugin.settings.lastLintTime;
            const lastRefresh = this.plugin.settings.lastRefreshTime;
            const openHigh = this.plugin._countOpenConflicts ? this.plugin._countOpenConflicts('high') : 0;
            const openAll = this.plugin._countOpenConflicts ? this.plugin._countOpenConflicts() : 0;
            this._renderSummaryStat(summary, t(this.plugin, 'activity_last_check_label'), lastLint > 0 ? new Date(lastLint).toLocaleString() : t(this.plugin, 'activity_never_value'));
            this._renderSummaryStat(summary, t(this.plugin, 'activity_last_update_label'), lastRefresh > 0 ? new Date(lastRefresh).toLocaleString() : t(this.plugin, 'activity_never_value'));
            this._renderSummaryStat(summary, t(this.plugin, 'activity_open_items_label'), String(openAll));
            this._renderSummaryStat(summary, t(this.plugin, 'activity_serious_items_label'), String(openHigh));
        }

        if (this.plugin.settings.refreshInProgress) {
            const idx = this.plugin.settings.refreshQueueIndex || 0;
            const total = (this.plugin.settings.refreshQueue || []).length;
            containerEl.createDiv({
                text: t(this.plugin, 'refresh_progress', { current: idx, total }),
                cls: 'setting-item-description understory-settings-inline-note'
            });
        }

        const logsPanel = containerEl.createDiv({ cls: 'understory-settings-panel' });
        this._renderPanelHeader(logsPanel, 'relation_logs_title', 'relation_logs_desc');
        this._renderLogs(logsPanel);
    }

    _renderAdvancedPage(containerEl) {
        this._renderPageIntro(containerEl, 'advanced_index_title', 'advanced_index_desc');
        this._renderAdvancedSettings(containerEl);
        this._renderHostedDiagnostics(containerEl);
    }

    _renderHostedDiagnostics(containerEl) {
        const summary = this.plugin.hostedAccountSummary ? this.plugin.hostedAccountSummary() : { status: 'disconnected' };
        const panel = containerEl.createEl('details', { cls: 'understory-settings-panel understory-advanced-disclosure' });
        panel.createEl('summary', { text: t(this.plugin, 'advanced_diagnostics_title') });
        const body = panel.createDiv({ cls: 'understory-advanced-disclosure-body' });
        body.createEl('p', { text: t(this.plugin, 'advanced_diagnostics_desc') });
        const actions = body.createDiv({ cls: 'understory-account-actions' });
        this._accountActionButton(actions, t(this.plugin, 'hosted_smoke_run_button'), async () => {
            await this.plugin.runHostedAccountSmoke(true);
            this.display();
        }, { icon: 'stethoscope', disabled: summary.status !== 'connected' });
        this._accountActionButton(actions, t(this.plugin, 'hosted_smoke_copy_button'), async () => {
            await this.plugin.copyHostedAccountSmokeSummary(true);
        }, { icon: 'clipboard-copy', disabled: summary.status !== 'connected' });
        this._renderAccountSmokeSummary(body, summary.status === 'connected', summary.status === 'pending');
    }

    _renderPanelHeader(containerEl, titleKey, descKey) {
        const header = containerEl.createDiv({ cls: 'understory-settings-panel-header' });
        const copy = header.createDiv();
        copy.createDiv({ text: t(this.plugin, titleKey), cls: 'understory-settings-panel-title' });
        copy.createEl('p', { text: t(this.plugin, descKey) });
        return header;
    }

    _renderSummaryStat(containerEl, label, value) {
        const item = containerEl.createDiv({ cls: 'understory-settings-summary-stat' });
        item.createSpan({ text: label });
        item.createEl('strong', { text: value });
    }

    _renderAdvancedSettings(containerEl) {
        const connectionPanel = containerEl.createEl('details', { cls: 'understory-settings-panel understory-advanced-disclosure' });
        connectionPanel.createEl('summary', { text: t(this.plugin, 'advanced_connection_title') });
        const connectionBody = connectionPanel.createDiv({ cls: 'understory-advanced-disclosure-body' });
        connectionBody.createEl('p', { text: t(this.plugin, 'advanced_connection_desc') });
        this._renderPrivacySettings(connectionBody);

        const advancedEl = containerEl.createEl('details', { cls: 'understory-settings-panel understory-advanced-disclosure' });
        advancedEl.createEl('summary', { text: t(this.plugin, 'local_engine_title') });
        const advancedBody = advancedEl.createDiv({ cls: 'understory-advanced-disclosure-body understory-advanced-body' });
        advancedBody.createEl('p', { text: t(this.plugin, 'advanced_local_engine_desc') });

        new Setting(advancedBody)
            .setName(t(this.plugin, 'engine_dir_name'))
            .setDesc(t(this.plugin, 'engine_dir_desc'))
            .addText((text) => text
                .setPlaceholder(t(this.plugin, 'engine_dir_placeholder'))
                .setValue(this.plugin.settings.graphifyDir)
                .onChange(async (value) => {
                    this.plugin.settings.graphifyDir = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(advancedBody)
            .setName(t(this.plugin, 'python_path_name'))
            .setDesc(t(this.plugin, 'python_path_desc'))
            .addText((text) => text
                .setPlaceholder(DEFAULT_PYTHON_COMMAND)
                .setValue(this.plugin.settings.pythonPath)
                .onChange(async (value) => {
                    this.plugin.settings.pythonPath = value.trim() || 'python';
                    await this.plugin.saveSettings();
                }));

        new Setting(advancedBody)
            .setName(t(this.plugin, 'daemon_name'))
            .setDesc(t(this.plugin, 'daemon_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.daemonEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.daemonEnabled = value;
                    if (value) {
                        await this.plugin.startDaemon();
                        if (!this.plugin.daemonProcess) this.plugin.settings.daemonEnabled = false;
                    } else {
                        this.plugin.stopDaemon();
                    }
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(advancedBody)
            .setName(t(this.plugin, 'daemon_interval_name'))
            .setDesc(t(this.plugin, 'daemon_interval_desc'))
            .addSlider((slider) => slider
                .setLimits(60, 3600, 60)
                .setValue(this.plugin.settings.daemonInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.daemonInterval = value;
                    await this.plugin.saveSettings();
                }));

        advancedBody.createEl('div', {
            text: this.plugin.daemonProcess
                ? t(this.plugin, 'daemon_running')
                : (this.plugin.settings.daemonEnabled
                    ? t(this.plugin, 'daemon_enabled_not_running')
                    : t(this.plugin, 'daemon_stopped')),
            cls: 'setting-item-description understory-spacing-after-sm'
        });

        const diagnosticsPanel = containerEl.createEl('details', {
            cls: 'understory-settings-panel understory-advanced-disclosure',
        });
        diagnosticsPanel.open = this._advancedDiagnosticsOpen;
        diagnosticsPanel.addEventListener('toggle', () => {
            this._advancedDiagnosticsOpen = diagnosticsPanel.open;
        });
        diagnosticsPanel.createEl('summary', { text: t(this.plugin, 'maintenance_diagnostics_title') });
        const diagnosticsBody = diagnosticsPanel.createDiv({ cls: 'understory-advanced-disclosure-body' });
        diagnosticsBody.createEl('p', { text: t(this.plugin, 'maintenance_diagnostics_desc') });
        this._renderEngineStatus(diagnosticsBody);
    }

    _renderNumberedSteps(containerEl, steps) {
        const list = containerEl.createDiv({ cls: 'understory-setup-steps' });
        for (let index = 0; index < steps.length; index += 1) {
            const [title, desc] = steps[index];
            const row = list.createDiv({ cls: 'understory-setup-step' });
            row.createDiv({ text: String(index + 1), cls: 'understory-setup-step-number' });
            const body = row.createDiv({ cls: 'understory-setup-step-body' });
            body.createDiv({ text: title, cls: 'understory-setup-step-title' });
            body.createDiv({ text: desc, cls: 'understory-setup-step-desc' });
        }
    }

    _renderAgentMultiVaultSteps(containerEl) {
        this._renderNumberedSteps(containerEl, [
            [t(this.plugin, 'agent_multi_vault_step_open_title'), t(this.plugin, 'agent_multi_vault_step_open_desc')],
            [t(this.plugin, 'agent_multi_vault_step_prepare_title'), t(this.plugin, 'agent_multi_vault_step_prepare_desc')],
            [t(this.plugin, 'agent_multi_vault_step_copy_title'), t(this.plugin, 'agent_multi_vault_step_copy_desc')],
        ]);
    }

    _agentAccessContext() {
        const paths = createAgentAccessPaths(this.app || this.plugin.app);
        return {
            ...paths,
            agentProfileId: this.plugin.settings.agentProfileId || 'generic',
            usageModeId: this.plugin.settings.agentUsageModeId || 'memory',
            engineDir: this.plugin.settings.graphifyDir || preferredEngineDir(this.plugin),
            networkMode: this.plugin.settings.networkMode || 'local',
            pluginVersion: this.plugin.manifest && this.plugin.manifest.version,
            pythonPath: this.plugin.settings.pythonPath || getDefaultPythonPath(),
        };
    }

    _renderAgentPreview(containerEl, text, language) {
        const preview = containerEl.createEl('pre', { cls: 'understory-agent-preview' });
        preview.setAttribute('data-language', language || 'text');
        const code = preview.createEl('code');
        code.setText(text);
        return preview;
    }

    _renderAgentInstallNotes(containerEl, text) {
        const notes = containerEl.createDiv({ cls: 'understory-agent-quote-block understory-agent-install-notes' });
        for (const line of String(text || '').split(/\r?\n/).filter(Boolean)) {
            notes.createDiv({ text: line, cls: 'understory-agent-install-note-line' });
        }
        return notes;
    }

    _renderAgentStep(containerEl, step, titleKey, descKey) {
        const section = containerEl.createDiv({ cls: 'understory-agent-step' });
        section.createDiv({
            text: t(this.plugin, 'agent_step_label', { step }),
            cls: 'understory-agent-step-label',
        });
        section.createDiv({ text: t(this.plugin, titleKey), cls: 'understory-section-title-text' });
        section.createDiv({
            text: t(this.plugin, descKey),
            cls: 'setting-item-description understory-spacing-after-sm',
        });
        return section;
    }

    _renderAgentIdentityGrid(containerEl, context, vaultIdentity) {
        const status = checkAgentAccessStatus(context);
        const serverCheck = status.checks.find((check) => check.key === 'mcpServerPath');
        const items = [
            {
                label: t(this.plugin, 'agent_identity_vault_name_label'),
                value: vaultIdentity.vaultName,
                ok: !!vaultIdentity.vaultName,
            },
            {
                label: t(this.plugin, 'agent_identity_server_key_label'),
                value: vaultIdentity.serverKey,
                ok: !!vaultIdentity.serverKey,
            },
            {
                label: t(this.plugin, 'agent_identity_vault_path_label'),
                value: vaultIdentity.vaultPath || t(this.plugin, 'agent_status_not_available'),
                ok: !!vaultIdentity.vaultPath,
            },
            {
                label: t(this.plugin, 'agent_identity_export_status_label'),
                value: context.mcpServerPath,
                ok: !!(serverCheck && serverCheck.ok),
            },
        ];

        const list = containerEl.createDiv({ cls: 'understory-agent-quote-block understory-agent-identity-list' });
        for (const item of items) {
            const row = list.createDiv({ cls: `understory-agent-identity-row${item.ok ? ' is-ok' : ' is-warning'}` });
            row.createDiv({ text: item.label, cls: 'understory-agent-identity-label' });
            row.createDiv({ text: item.value, cls: 'understory-agent-identity-value' });
        }
    }

    _renderAgentCheckList(containerEl, context) {
        const status = checkAgentAccessStatus(context);
        const list = containerEl.createDiv({ cls: 'understory-agent-check-list' });
        for (const check of status.checks) {
            const row = list.createDiv({ cls: `understory-agent-check-row${check.ok ? ' is-ok' : ' is-warning'}` });
            row.createDiv({
                text: check.ok ? t(this.plugin, 'agent_check_ok_label') : t(this.plugin, 'agent_check_attention_label'),
                cls: 'understory-agent-check-state',
            });
            row.createDiv({ text: check.label, cls: 'understory-agent-check-label' });
        }
    }

    _renderAgentAccessTab(containerEl) {
        this._renderTabIntro(containerEl, 'agents_page_title', 'agents_page_desc');

        const context = this._agentAccessContext();
        const setupPack = createAgentSetupPack(context, this.plugin.settings);
        const { agentProfile, diagnosticsText, installNotesText, mcpConfigText, setupPackText, skillText, usageMode, vaultIdentity } = setupPack;
        const agentProfiles = agentProfilesForLanguage(getLanguage(this.plugin));

        const identityStep = this._renderAgentStep(containerEl, 1, 'agent_current_vault_title', 'agent_current_vault_desc');
        this._renderAgentIdentityGrid(identityStep, context, vaultIdentity);

        const usageStep = this._renderAgentStep(containerEl, 2, 'agent_choose_use_case_title', 'agent_choose_use_case_desc');
        new Setting(usageStep)
            .setName(t(this.plugin, 'agent_usage_mode_select_name'))
            .setDesc(t(this.plugin, 'agent_usage_mode_select_desc'))
            .addDropdown((dropdown) => {
                for (const mode of Object.values(USAGE_MODES)) dropdown.addOption(mode.id, mode.label);
                dropdown
                    .setValue(usageMode.id)
                    .onChange(async (value) => {
                        this.plugin.settings.agentUsageModeId = value;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });
        usageStep.createDiv({
            text: t(this.plugin, 'agent_usage_mode_selected_label', { mode: usageMode.label }),
            cls: 'setting-item-description',
        });
        usageStep.createDiv({
            text: usageMode.installHint,
            cls: 'setting-item-description',
        });

        const profileStep = this._renderAgentStep(containerEl, 3, 'agent_choose_agent_title', 'agent_choose_agent_desc');
        new Setting(profileStep)
            .setName(t(this.plugin, 'agent_profile_select_name'))
            .setDesc(t(this.plugin, 'agent_profile_select_desc'))
            .addDropdown((dropdown) => {
                for (const profile of Object.values(agentProfiles)) dropdown.addOption(profile.id, profile.label);
                dropdown
                    .setValue(agentProfile.id)
                    .onChange(async (value) => {
                        this.plugin.settings.agentProfileId = value;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            });
        profileStep.createDiv({
            text: t(this.plugin, 'agent_profile_selected_label', { profile: agentProfile.label }),
            cls: 'setting-item-description',
        });
        this._renderAgentInstallNotes(profileStep, installNotesText);

        const exportStep = this._renderAgentStep(containerEl, 4, 'agent_export_local_title', 'agent_export_local_desc');
        this._renderAgentCheckList(exportStep, context);
        new Setting(exportStep)
            .setName(t(this.plugin, 'agent_export_actions_name'))
            .setDesc(t(this.plugin, 'agent_export_actions_desc'))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_export_mcp_button'))
                .onClick(async () => this._exportAgentMcpServer(context)))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_check_mcp_button'))
                .onClick(() => this._checkAgentAccessStatus(context)))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_copy_diagnostics_button'))
                .onClick(() => this._copyText(diagnosticsText, t(this.plugin, 'agent_copy_diagnostics_notice'))));

        const copyStep = this._renderAgentStep(containerEl, 5, 'agent_copy_config_title', 'agent_copy_config_desc');
        new Setting(copyStep)
            .setName(t(this.plugin, 'agent_copy_setup_pack_name'))
            .setDesc(t(this.plugin, 'agent_copy_setup_pack_desc'))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_copy_setup_pack_button'))
                .onClick(() => this._copyText(setupPackText, t(this.plugin, 'agent_copy_setup_pack_notice'))));

        copyStep.createDiv({ text: t(this.plugin, 'agent_mcp_title'), cls: 'understory-section-title-text' });
        copyStep.createDiv({ text: t(this.plugin, 'agent_mcp_desc'), cls: 'setting-item-description' });
        this._renderAgentPreview(copyStep, mcpConfigText, 'json');
        new Setting(copyStep)
            .setName(t(this.plugin, 'agent_copy_mcp_action_name'))
            .setDesc(t(this.plugin, 'agent_copy_mcp_action_desc'))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_copy_mcp_button'))
                .onClick(() => this._copyText(mcpConfigText, t(this.plugin, 'agent_copy_mcp_notice'))));

        copyStep.createDiv({ text: t(this.plugin, 'agent_skill_title'), cls: 'understory-section-title-text' });
        copyStep.createDiv({ text: t(this.plugin, 'agent_skill_desc'), cls: 'setting-item-description' });
        this._renderAgentPreview(copyStep, skillText, 'markdown');
        new Setting(copyStep)
            .setName(t(this.plugin, 'agent_copy_skill_action_name'))
            .setDesc(t(this.plugin, 'agent_copy_skill_action_desc'))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_copy_skill_button'))
                .onClick(() => this._copyText(skillText, t(this.plugin, 'agent_copy_skill_notice'))))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'agent_export_skill_button'))
                .onClick(async () => this._exportAgentSkill(context, skillText)));

        containerEl.createDiv({ text: t(this.plugin, 'agent_multi_vault_title'), cls: 'understory-section-title-text' });
        containerEl.createDiv({
            text: t(this.plugin, 'agent_multi_vault_desc'),
            cls: 'setting-item-description',
        });
        this._renderAgentMultiVaultSteps(containerEl);

        containerEl.createDiv({ text: t(this.plugin, 'agent_safety_title'), cls: 'understory-section-title-text' });
        const safetyList = containerEl.createDiv({ cls: 'understory-agent-safety-list' });
        for (const key of ['agent_safety_local', 'agent_safety_private', 'agent_safety_confirm']) {
            safetyList.createDiv({ text: t(this.plugin, key), cls: 'understory-agent-safety-item' });
        }
    }

    async _exportAgentMcpServer(context) {
        try {
            await writeAgentAccessFile(context.mcpServerPath, createStandaloneMcpServerSource());
            new Notice(t(this.plugin, 'agent_export_mcp_notice', { path: context.mcpServerPath }));
            this.display();
        } catch (error) {
            new Notice(t(this.plugin, 'agent_export_failed_notice', { message: error && error.message ? error.message : String(error || '') }));
        }
    }

    async _exportAgentSkill(context, skillText) {
        try {
            await writeAgentAccessFile(context.skillPath, skillText);
            new Notice(t(this.plugin, 'agent_export_skill_notice', { path: context.skillPath }));
        } catch (error) {
            new Notice(t(this.plugin, 'agent_export_failed_notice', { message: error && error.message ? error.message : String(error || '') }));
        }
    }

    _checkAgentAccessStatus(context) {
        const status = checkAgentAccessStatus(context);
        if (status.ok) {
            new Notice(t(this.plugin, 'agent_check_ready_notice'));
            return;
        }
        const missing = status.checks
            .filter((check) => !check.ok)
            .map((check) => check.label)
            .join(', ');
        new Notice(t(this.plugin, 'agent_check_attention_notice', { items: missing }));
    }

    _renderLanguageToggle(parent) {
        const current = getLanguage(this.plugin);
        const next = current === 'en' ? 'zh' : 'en';
        const button = parent.createEl('button', { cls: `understory-language-toggle understory-language-toggle--${current}` });
        button.type = 'button';
        button.setAttribute('aria-label', current === 'en' ? 'Switch UI to Chinese' : '切换到英文界面');
        button.setAttribute('title', current === 'en' ? 'Switch to Chinese' : 'Switch to English');
        const icon = button.createSpan({ cls: 'understory-language-toggle-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(icon, 'languages');
        button.createSpan({ cls: 'understory-language-toggle-label', text: current === 'en' ? 'EN' : '中文' });
        button.addEventListener('click', async () => {
            this.plugin.settings.uiLanguage = next;
            await this.plugin.saveSettings();
            this.app.workspace.trigger && this.app.workspace.trigger('understory:language-updated');
            this.display();
        });
    }

    _applyProviderPreset(kind, provider) {
        const preset = providerPreset(provider);
        if (kind === 'embedding') {
            this.plugin.settings.embeddingProvider = provider;
            this.plugin.settings.embeddingBaseUrl = preset.baseUrl;
            this.plugin.settings.embeddingModel = preset.embeddingModel;
            this.plugin.settings.embeddingDimensions = preset.dimensions;
        } else {
            this.plugin.settings.llmProvider = provider;
            this.plugin.settings.llmBaseUrl = preset.baseUrl;
            this.plugin.settings.llmModel = preset.llmModel;
        }
    }

    _renderPasswordText(setting, value, placeholder, onChange) {
        setting.addText((text) => {
            text.setPlaceholder(placeholder)
                .setValue(value || '')
                .onChange(onChange);
            if (text.inputEl) {
                text.inputEl.type = 'password';
                text.inputEl.autocomplete = 'off';
                text.inputEl.spellcheck = false;
            }
        });
    }

    _domainFromUrl(value) {
        try {
            return new URL(String(value || '')).host || '-';
        } catch (error) {
            return String(value || '-').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '-';
        }
    }

    _renderAccountHome(containerEl) {
        const summary = this.plugin.hostedAccountSummary
            ? this.plugin.hostedAccountSummary()
            : {
                status: 'disconnected',
                serverUrl: 'https://understory.bondie.io',
                accountCenterUrl: 'https://account.bondie.io/account',
                plan: '-',
                subscriptionStatus: '-',
                entitlementCount: 0,
                capabilityCount: 0,
                lastSync: 0,
            };
        const hasSession = summary.status === 'connected';
        const pending = summary.status === 'pending';
        const displayUser = summary.displayUser || {};
        const displayName = String(displayUser.name || '').trim();
        const displayEmail = String(displayUser.email || '').trim();
        const hasDistinctDisplayName = !!displayName && displayName.toLowerCase() !== displayEmail.toLowerCase();
        const panel = containerEl.createDiv({ cls: `understory-account-panel understory-account-panel--settings is-${summary.status}` });
        const header = panel.createDiv({ cls: 'understory-account-hero' });
        const avatar = header.createDiv({ cls: 'understory-account-avatar', attr: { 'aria-hidden': 'true' } });
        if (hasSession && displayUser.picture) {
            const image = avatar.createEl('img', { attr: { src: displayUser.picture, alt: '' } });
            image.addEventListener('error', () => {
                avatar.empty();
                avatar.createSpan({ cls: 'understory-account-avatar-initials', text: this._accountInitials(displayUser) });
            });
        } else if (hasSession) {
            avatar.createSpan({ cls: 'understory-account-avatar-initials', text: this._accountInitials(displayUser) });
        } else {
            setIcon(avatar, pending ? 'loader-circle' : 'log-in');
        }
        const copy = header.createDiv({ cls: 'understory-account-hero-copy' });
        copy.createDiv({ cls: 'understory-account-kicker', text: t(this.plugin, 'hosted_account_kicker') });
        const titleRow = copy.createDiv({ cls: 'understory-account-title-row' });
        titleRow.createDiv({
            cls: 'understory-account-title',
            text: hasSession && (displayName || displayEmail)
                ? ((hasDistinctDisplayName ? displayName : displayEmail) || displayName)
                : t(this.plugin, hasSession
                ? 'account_connected_title'
                : (pending ? 'account_pending_title' : 'account_disconnected_title')),
        });
        titleRow.createSpan({
            cls: `understory-account-status understory-account-status--${summary.status}`,
            text: t(this.plugin, `hosted_status_${summary.status}_compact`),
        });
        copy.createEl('p', {
            text: hasSession && hasDistinctDisplayName && displayEmail
                ? displayEmail
                : t(this.plugin, hasSession
                ? 'account_connected_desc'
                : (pending ? 'account_pending_desc' : 'account_disconnected_desc')),
        });

        if (hasSession) {
            const details = panel.createDiv({ cls: 'understory-account-details' });
            this._renderAccountDetail(details, t(this.plugin, 'account_summary_plan'), this._friendlyPlan(summary.plan));
            this._renderAccountDetail(details, t(this.plugin, 'account_summary_membership'), this._friendlyMembership(summary.subscriptionStatus));
            this._renderAccountDetail(
                details,
                t(this.plugin, 'account_summary_ai_service'),
                t(this.plugin, `provider_status_${summary.providerAccessStatus || 'not_ready'}`)
            );
            this._renderAccountDetail(
                details,
                t(this.plugin, 'account_summary_last_refresh'),
                summary.lastSync ? new Date(summary.lastSync).toLocaleString() : t(this.plugin, 'activity_never_value')
            );
        }

        const actions = panel.createDiv({ cls: 'understory-account-actions' });
        if (hasSession) {
            this._accountActionButton(actions, t(this.plugin, 'account_open_understory_button'), async () => {
                await this._openUnderstoryWorkspace();
            }, { cta: true, icon: 'leaf' });
            this._accountActionButton(actions, t(this.plugin, 'hosted_refresh_button'), async () => {
                await this.plugin.hostedRefreshStatus(true);
                await this.plugin.refreshHostedUsage(false);
                this.display();
            }, { icon: 'refresh-cw' });

            const billing = this.plugin.settings?.hostedRuntimeConfig?.billing || {};
            if (billing.checkout_enabled && !['active', 'trialing', 'grace'].includes(summary.subscriptionStatus)) {
                this._accountActionButton(actions, t(this.plugin, 'hosted_checkout_button'), async () => {
                    await this.plugin.hostedStartCheckout(true);
                }, { icon: 'credit-card' });
            }

            const options = panel.createEl('details', { cls: 'understory-account-options' });
            options.createEl('summary', { text: t(this.plugin, 'account_options_title') });
            const optionActions = options.createDiv({ cls: 'understory-account-actions' });
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_profile_button'), () => {
                this.plugin.openHostedProfile(true);
            }, { icon: 'user-round-pen' });
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_account_security_button'), () => {
                this.plugin.openHostedAccountSecurity(true);
            }, { icon: 'shield-check' });
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_devices_button'), () => {
                this.plugin.openHostedDevices(true);
            }, { icon: 'monitor-smartphone' });
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_account_center_button'), () => {
                this.plugin.openHostedAccountCenter(true);
            }, { icon: 'external-link' });
            if (billing.enabled) {
                this._accountActionButton(optionActions, t(this.plugin, 'hosted_billing_portal_button'), async () => {
                    await this.plugin.hostedOpenBillingPortal(true);
                }, { icon: 'wallet-cards' });
            }
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_switch_account_button'), async () => {
                await this.plugin.hostedSwitchAccount(true);
                this.display();
            }, { icon: 'users' });
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_logout_button'), async () => {
                await this.plugin.hostedLogout(true);
                this.display();
            }, { icon: 'log-out' });
            this._accountActionButton(optionActions, t(this.plugin, 'hosted_global_logout_button'), async () => {
                await this.plugin.hostedGlobalLogout(true);
                this.display();
            }, { icon: 'shield-off' });
        } else if (pending) {
            this._accountActionButton(actions, t(this.plugin, 'hosted_open_login_again'), async () => {
                await this.plugin.hostedLogin(true);
                this.display();
            }, { cta: true, icon: 'external-link' });
            this._accountActionButton(actions, t(this.plugin, 'hosted_switch_account_button'), async () => {
                await this.plugin.hostedSwitchAccount(true);
                this.display();
            }, { icon: 'users' });
            this._accountActionButton(actions, t(this.plugin, 'hosted_cancel_login_button'), async () => {
                await this.plugin.hostedCancelLogin(true);
                this.display();
            }, { icon: 'x' });
        } else {
            this._accountActionButton(actions, t(this.plugin, 'hosted_login_button'), async () => {
                await this.plugin.hostedLogin(true);
                this.display();
            }, { cta: true, icon: 'log-in' });
        }

        if (hasSession) this._renderQuickStart(containerEl);
    }

    _friendlyPlan(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'free') return t(this.plugin, 'plan_free');
        if (normalized === 'pro') return t(this.plugin, 'plan_pro');
        if (normalized === 'plus') return t(this.plugin, 'plan_plus');
        return value || '-';
    }

    _friendlyMembership(value) {
        const normalized = String(value || '').trim().toLowerCase();
        const key = `membership_${normalized}`;
        const translated = t(this.plugin, key);
        return translated === key ? (value || '-') : translated;
    }

    _renderQuickStart(containerEl) {
        const panel = containerEl.createDiv({ cls: 'understory-settings-panel understory-quick-start' });
        this._renderPanelHeader(panel, 'quick_start_title', 'quick_start_desc');
        const steps = panel.createDiv({ cls: 'understory-quick-start-steps' });
        for (const [iconName, titleKey, descKey] of [
            ['file-text', 'quick_start_note_title', 'quick_start_note_desc'],
            ['sparkles', 'quick_start_generate_title', 'quick_start_generate_desc'],
            ['check-check', 'quick_start_review_title', 'quick_start_review_desc'],
        ]) {
            const row = steps.createDiv({ cls: 'understory-quick-start-step' });
            const icon = row.createSpan({ cls: 'understory-quick-start-icon', attr: { 'aria-hidden': 'true' } });
            setIcon(icon, iconName);
            const copy = row.createDiv({ cls: 'understory-quick-start-copy' });
            copy.createEl('strong', { text: t(this.plugin, titleKey) });
            copy.createSpan({ text: t(this.plugin, descKey) });
        }
        const actions = panel.createDiv({ cls: 'understory-account-actions' });
        this._accountActionButton(actions, t(this.plugin, 'account_open_understory_button'), async () => {
            await this._openUnderstoryWorkspace();
        }, { cta: true, icon: 'leaf' });
        this._accountActionButton(actions, t(this.plugin, 'quick_start_scope_button'), async () => {
            this._activeSettingsPage = 'scope';
            this.display();
        }, { icon: 'folder-tree' });
    }

    async _openUnderstoryWorkspace() {
        await this.plugin.openSidebar();
        if (this.app.setting && typeof this.app.setting.close === 'function') this.app.setting.close();
    }

    _accountInitials(displayUser) {
        const source = String(displayUser?.name || displayUser?.email || 'U').trim();
        const words = source.split(/\s+/).filter(Boolean);
        if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
        return source.slice(0, 1).toUpperCase() || 'U';
    }

    _renderAccountDetail(parent, label, value) {
        const item = parent.createDiv({ cls: 'understory-account-detail' });
        item.createSpan({ text: label });
        item.createEl('strong', { text: value });
    }

    _renderAccountSmokeSummary(parent, hasSession, pending) {
        const box = parent.createDiv({ cls: 'understory-account-smoke' });
        const header = box.createDiv({ cls: 'understory-account-smoke-header' });
        header.createEl('strong', { text: t(this.plugin, 'hosted_smoke_summary_title') });
        const smoke = this.plugin.hostedAccountSmokeLastSummary;

        if (!hasSession) {
            box.createDiv({
                cls: 'understory-account-smoke-hint',
                text: pending ? t(this.plugin, 'hosted_smoke_pending_hint') : t(this.plugin, 'hosted_smoke_disconnected_hint'),
            });
            return;
        }

        if (!smoke || smoke.status !== 'connected') {
            box.createDiv({
                cls: 'understory-account-smoke-hint',
                text: t(this.plugin, 'hosted_smoke_empty_hint'),
            });
            return;
        }

        const grid = box.createDiv({ cls: 'understory-settings-summary-grid understory-account-smoke-grid' });
        this._renderSummaryStat(grid, t(this.plugin, 'hosted_smoke_status_label'), t(this.plugin, 'hosted_status_connected_compact'));
        this._renderSummaryStat(
            grid,
            t(this.plugin, 'hosted_smoke_provider_keys_label'),
            smoke.safety?.provider_keys_exposed === false ? 'false' : t(this.plugin, 'hosted_smoke_review_value')
        );
        this._renderSummaryStat(grid, t(this.plugin, 'hosted_smoke_usage_requests_label'), String(smoke.usage?.request_count || 0));
        this._renderSummaryStat(grid, t(this.plugin, 'hosted_smoke_usage_features_label'), String(smoke.usage?.feature_count || 0));
    }

    _accountActionButton(parent, text, handler, options = {}) {
        const button = parent.createEl('button');
        button.type = 'button';
        if (options.cta) button.addClass('mod-cta');
        if (options.disabled) button.disabled = true;
        if (options.icon) {
            const icon = button.createSpan({ cls: 'understory-button-icon', attr: { 'aria-hidden': 'true' } });
            setIcon(icon, options.icon);
        }
        button.createSpan({ text, cls: 'understory-button-label' });
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            button.disabled = true;
            try {
                await handler();
            } catch (error) {
                new Notice(t(this.plugin, 'hosted_action_failed', { message: String(error.message || error).slice(0, 100) }), 8000);
            } finally {
                if (!options.disabled) button.disabled = false;
            }
        });
        return button;
    }

    _renderPrivacySettings(containerEl) {
        containerEl.createDiv({ text: t(this.plugin, 'privacy_title'), cls: 'understory-settings-section-title' });
        containerEl.createEl('div', {
            text: t(this.plugin, 'privacy_desc'),
            cls: 'setting-item-description understory-privacy-intro'
        });

        new Setting(containerEl)
            .setName(t(this.plugin, 'hosted_server_url_name'))
            .setDesc(t(this.plugin, 'hosted_server_url_desc'))
            .addText((text) => text
                .setPlaceholder('https://understory.bondie.io')
                .setValue(this.plugin.settings.hostedServerUrl || '')
                .onChange(async (value) => {
                    this.plugin.settings.hostedServerUrl = value.trim() || 'https://understory.bondie.io';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t(this.plugin, 'hosted_account_center_url_name'))
            .setDesc(t(this.plugin, 'hosted_account_center_url_desc'))
            .addText((text) => text
                .setPlaceholder(DEFAULT_SETTINGS.hostedAccountCenterUrl)
                .setValue(this.plugin.settings.hostedAccountCenterUrl || '')
                .onChange(async (value) => {
                    this.plugin.settings.hostedAccountCenterUrl = value.trim() || 'https://account.bondie.io/account';
                    await this.plugin.saveSettings();
                }));

        const mode = this.plugin.settings.networkMode || 'hosted';
        new Setting(containerEl)
            .setName(t(this.plugin, 'network_mode_name'))
            .setDesc(t(this.plugin, 'network_mode_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('local', t(this.plugin, 'network_mode_local'))
                .addOption('hosted', t(this.plugin, 'network_mode_hosted'))
                .addOption('embedding', t(this.plugin, 'network_mode_embedding'))
                .addOption('full', t(this.plugin, 'network_mode_full'))
                .setValue(mode)
                .onChange(async (value) => {
                    this.plugin.settings.networkMode = value;
                    if (value === 'local') {
                        this.plugin.settings.webhookEnabled = false;
                    }
                    if (value === 'hosted') {
                        this.plugin.settings.embeddingProvider = 'hosted';
                        this.plugin.settings.llmProvider = 'hosted';
                    } else {
                        if (this.plugin.settings.embeddingProvider === 'hosted') {
                            this._applyProviderPreset('embedding', value === 'local' ? 'none' : 'zhipu');
                        }
                        if (this.plugin.settings.llmProvider === 'hosted') {
                            this._applyProviderPreset('llm', value === 'full' ? 'zhipu' : 'none');
                        }
                    }
                    await this.plugin.saveSettings();
                    this.display();
                }));

        containerEl.createDiv({
            text: t(this.plugin, `network_mode_${mode}_summary`),
            cls: 'setting-item-description understory-privacy-summary understory-spacing-after-md'
        });
        if (mode === 'hosted') {
            containerEl.createEl('div', {
                text: t(this.plugin, 'hosted_no_key_notice'),
                cls: 'setting-item-description understory-privacy-summary understory-spacing-after-md'
            });
            return;
        }

        containerEl.createEl('div', {
            text: t(this.plugin, 'api_key_overview'),
            cls: 'setting-item-description understory-privacy-summary understory-spacing-after-xs'
        });
        containerEl.createEl('div', {
            text: mode === 'local' ? t(this.plugin, 'api_key_local_notice') : t(this.plugin, 'provider_terms_notice'),
            cls: 'setting-item-description understory-privacy-summary understory-spacing-after-md'
        });

        containerEl.createDiv({ text: t(this.plugin, 'embedding_section_title'), cls: 'understory-settings-section-title' });
        containerEl.createDiv({
            text: t(this.plugin, 'embedding_setup_notice'),
            cls: 'setting-item-description understory-privacy-note'
        });
        new Setting(containerEl)
            .setName(t(this.plugin, 'embedding_provider_name'))
            .setDesc(t(this.plugin, 'embedding_provider_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('zhipu', t(this.plugin, 'provider_zhipu'))
                .addOption('openai', t(this.plugin, 'provider_openai'))
                .addOption('custom', t(this.plugin, 'provider_custom'))
                .addOption('none', t(this.plugin, 'provider_none'))
                .setValue(this.plugin.settings.embeddingProvider || 'zhipu')
                .onChange(async (value) => {
                    this._applyProviderPreset('embedding', value);
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if ((this.plugin.settings.embeddingProvider || 'zhipu') !== 'none') {
            const embeddingPreset = providerPreset(this.plugin.settings.embeddingProvider || 'zhipu');
            const keySetting = new Setting(containerEl)
                .setName(t(this.plugin, 'embedding_api_key_name'))
                .setDesc(t(this.plugin, 'embedding_api_key_desc'));
            this._renderPasswordText(
                keySetting,
                this.plugin.settings.embeddingApiKey,
                t(this.plugin, 'api_key_placeholder'),
                async (value) => {
                    this.plugin.settings.embeddingApiKey = value.trim();
                    await this.plugin.saveSettings();
                }
            );
            new Setting(containerEl)
                .setName(t(this.plugin, 'embedding_base_url_name'))
                .setDesc(t(this.plugin, 'embedding_base_url_desc'))
                .addText((text) => text
                    .setPlaceholder(embeddingPreset.baseUrl || 'https://...')
                    .setValue(this.plugin.settings.embeddingBaseUrl || '')
                    .onChange(async (value) => {
                        this.plugin.settings.embeddingBaseUrl = value.trim();
                        await this.plugin.saveSettings();
                    }));
            new Setting(containerEl)
                .setName(t(this.plugin, 'embedding_model_name'))
                .setDesc(t(this.plugin, 'embedding_model_desc'))
                .addText((text) => text
                    .setPlaceholder(embeddingPreset.embeddingModel || t(this.plugin, 'model_placeholder'))
                    .setValue(this.plugin.settings.embeddingModel || '')
                    .onChange(async (value) => {
                        this.plugin.settings.embeddingModel = value.trim();
                        await this.plugin.saveSettings();
                    }));
            new Setting(containerEl)
                .setName(t(this.plugin, 'embedding_dimensions_name'))
                .setDesc(t(this.plugin, 'embedding_dimensions_desc'))
                .addText((text) => text
                    .setPlaceholder(String(embeddingPreset.dimensions || 1024))
                    .setValue(String(this.plugin.settings.embeddingDimensions || ''))
                    .onChange(async (value) => {
                        const parsed = parseInt(value, 10);
                        this.plugin.settings.embeddingDimensions = Number.isFinite(parsed) ? parsed : '';
                        await this.plugin.saveSettings();
                    }));
            containerEl.createDiv({
                text: t(this.plugin, 'api_key_storage_desc'),
                cls: 'setting-item-description understory-privacy-footnote'
            });
        } else {
            containerEl.createDiv({
                text: t(this.plugin, 'embedding_none_notice'),
                cls: 'setting-item-description understory-privacy-inline-note'
            });
        }

        if (mode !== 'full') {
            containerEl.createDiv({ text: t(this.plugin, 'llm_section_title'), cls: 'understory-settings-section-title' });
            containerEl.createDiv({
                text: t(this.plugin, 'llm_disabled_desc'),
                cls: 'setting-item-description understory-privacy-inline-note'
            });
            return;
        }

        containerEl.createDiv({ text: t(this.plugin, 'llm_section_title'), cls: 'understory-settings-section-title' });
        containerEl.createDiv({
            text: t(this.plugin, 'llm_setup_notice'),
            cls: 'setting-item-description understory-privacy-note'
        });
        new Setting(containerEl)
            .setName(t(this.plugin, 'llm_provider_name'))
            .setDesc(t(this.plugin, 'llm_provider_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('zhipu', t(this.plugin, 'provider_zhipu'))
                .addOption('openai', t(this.plugin, 'provider_openai'))
                .addOption('kimi-cn', t(this.plugin, 'provider_kimi_cn'))
                .addOption('kimi-global', t(this.plugin, 'provider_kimi_global'))
                .addOption('custom', t(this.plugin, 'provider_custom'))
                .addOption('none', t(this.plugin, 'provider_none'))
                .setValue(this.plugin.settings.llmProvider || 'zhipu')
                .onChange(async (value) => {
                    this._applyProviderPreset('llm', value);
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if ((this.plugin.settings.llmProvider || 'zhipu') !== 'none') {
            const llmPreset = providerPreset(this.plugin.settings.llmProvider || 'zhipu');
            const keySetting = new Setting(containerEl)
                .setName(t(this.plugin, 'llm_api_key_name'))
                .setDesc(t(this.plugin, 'llm_api_key_desc'));
            this._renderPasswordText(
                keySetting,
                this.plugin.settings.llmApiKey,
                t(this.plugin, 'api_key_placeholder'),
                async (value) => {
                    this.plugin.settings.llmApiKey = value.trim();
                    await this.plugin.saveSettings();
                }
            );
            new Setting(containerEl)
                .setName(t(this.plugin, 'llm_base_url_name'))
                .setDesc(t(this.plugin, 'llm_base_url_desc'))
                .addText((text) => text
                    .setPlaceholder(llmPreset.baseUrl || 'https://...')
                    .setValue(this.plugin.settings.llmBaseUrl || '')
                    .onChange(async (value) => {
                        this.plugin.settings.llmBaseUrl = value.trim();
                        await this.plugin.saveSettings();
                    }));
            new Setting(containerEl)
                .setName(t(this.plugin, 'llm_model_name'))
                .setDesc(t(this.plugin, 'llm_model_desc'))
                .addText((text) => text
                    .setPlaceholder(llmPreset.llmModel || t(this.plugin, 'model_placeholder'))
                    .setValue(this.plugin.settings.llmModel || '')
                    .onChange(async (value) => {
                        this.plugin.settings.llmModel = value.trim();
                        await this.plugin.saveSettings();
                    }));
            containerEl.createDiv({
                text: t(this.plugin, 'api_key_storage_desc'),
                cls: 'setting-item-description understory-privacy-footnote'
            });
        } else {
            containerEl.createDiv({
                text: t(this.plugin, 'llm_none_notice'),
                cls: 'setting-item-description understory-privacy-inline-note'
            });
        }
    }

    _embeddingStatusInfo() {
        const settings = this.plugin.settings || {};
        const health = this.plugin.embeddingHealth;
        const mode = settings.networkMode || 'local';
        const provider = settings.embeddingProvider || 'zhipu';
        const providerHasKey = provider === 'mock' || !!String(settings.embeddingApiKey || '').trim();
        let state;
        if (mode === 'local') {
            state = 'local_only';
        } else if (provider === 'none') {
            state = 'provider_disabled';
        } else {
            const healthMode = health?.network_mode;
            const staleForMode = healthMode && healthMode !== mode;
            state = staleForMode
                ? null
                : health?.semantic_state;
            state = state || (providerHasKey ? 'unchecked' : 'provider_unavailable');
        }
        const base = {
            state,
            status: health?.status || 'unchecked',
            provider,
            mode,
            health,
            primaryAction: 'build',
        };
        if (this.plugin.embeddingIndexInProgress) {
            return {
                ...base,
                status: 'info',
                titleKey: 'embedding_status_indexing_title',
                descKey: 'embedding_status_indexing_desc',
                badgeKey: 'embedding_status_badge_indexing',
                actionDescKey: 'embedding_status_indexing_action_desc',
                primaryAction: 'build',
                disablePrimaryAction: true,
            };
        }
        if (state === 'local_only') {
            return {
                ...base,
                status: 'info',
                titleKey: 'embedding_status_local_title',
                descKey: 'embedding_status_local_desc',
                badgeKey: 'embedding_status_badge_info',
                actionDescKey: 'embedding_status_local_action_desc',
                primaryAction: 'configure',
            };
        }
        if (state === 'provider_disabled') {
            return {
                ...base,
                status: 'warning',
                titleKey: 'embedding_status_provider_disabled_title',
                descKey: 'embedding_status_provider_disabled_desc',
                badgeKey: 'embedding_status_badge_warning',
                actionDescKey: 'embedding_status_configure_action_desc',
                primaryAction: 'configure',
            };
        }
        if (state === 'provider_unavailable') {
            return {
                ...base,
                status: 'warning',
                titleKey: 'embedding_status_provider_unavailable_title',
                descKey: 'embedding_status_provider_unavailable_desc',
                badgeKey: 'embedding_status_badge_warning',
                actionDescKey: 'embedding_status_configure_action_desc',
                primaryAction: 'configure',
            };
        }
        if (state === 'index_missing') {
            return {
                ...base,
                status: 'warning',
                titleKey: 'embedding_status_index_missing_title',
                descKey: 'embedding_status_index_missing_desc',
                badgeKey: 'embedding_status_badge_warning',
                actionDescKey: 'embedding_status_build_action_desc',
                primaryAction: 'build',
            };
        }
        if (state === 'ready') {
            return {
                ...base,
                status: 'ready',
                titleKey: 'embedding_status_ready_title',
                descKey: 'embedding_status_ready_desc',
                badgeKey: 'embedding_status_badge_ready',
                actionDescKey: 'embedding_status_rebuild_action_desc',
                primaryAction: 'build',
            };
        }
        if (state === 'engine_not_ready') {
            return {
                ...base,
                status: 'error',
                titleKey: 'embedding_status_engine_not_ready_title',
                descKey: 'embedding_status_engine_not_ready_desc',
                badgeKey: 'embedding_status_badge_error',
                actionDescKey: 'embedding_status_engine_action_desc',
                primaryAction: 'setup',
            };
        }
        if (state === 'status_failed') {
            return {
                ...base,
                status: 'error',
                titleKey: 'embedding_status_failed_title',
                descKey: 'embedding_status_failed_desc',
                badgeKey: 'embedding_status_badge_error',
                actionDescKey: 'embedding_status_engine_action_desc',
                primaryAction: 'setup',
            };
        }
        return {
            ...base,
            status: 'unchecked',
            titleKey: 'embedding_status_unchecked_title',
            descKey: 'embedding_status_unchecked_desc',
            badgeKey: 'embedding_status_badge_unchecked',
            actionDescKey: providerHasKey ? 'embedding_status_check_action_desc' : 'embedding_status_configure_action_desc',
            primaryAction: providerHasKey ? 'build' : 'configure',
        };
    }

    _embeddingPrimaryAction(info) {
        if (info.primaryAction === 'configure') {
            return {
                labelKey: 'embedding_status_configure_button',
                cta: info.state !== 'local_only',
                onClick: async () => {
                    this._activeSettingsPage = 'advanced';
                    if ((this.plugin.settings.networkMode || 'local') === 'local') {
                        this.plugin.settings.networkMode = 'embedding';
                        this.plugin.embeddingHealth = null;
                        await this.plugin.saveSettings();
                    }
                    new Notice(t(this.plugin, 'embedding_configure_notice'), 7000);
                    this.display();
                },
            };
        }
        if (info.primaryAction === 'setup') {
            return {
                labelKey: 'engine_check_button',
                disabled: !this.plugin.checkEngineHealth,
                onClick: async () => {
                    if (!this.plugin.checkEngineHealth) {
                        new Notice(t(this.plugin, 'engine_check_unavailable'));
                        return;
                    }
                    await this.plugin.checkEngineHealth(true, true);
                    await this.plugin.checkEmbeddingHealth?.(false, true);
                    this.display();
                },
            };
        }
        if (info.primaryAction === 'build') {
            return {
                labelKey: this.plugin.embeddingIndexInProgress
                    ? 'embedding_status_indexing_button'
                    : 'embedding_status_build_button',
                disabled: info.disablePrimaryAction || this.plugin.embeddingIndexInProgress || !this.plugin.initIndex,
                onClick: async () => {
                    if (!this.plugin.initIndex) return;
                    if (this.plugin.embeddingIndexInProgress) {
                        new Notice(t(this.plugin, 'index_init_already_running'), 7000);
                        return;
                    }
                    this.plugin.embeddingIndexInProgress = true;
                    new Notice(t(this.plugin, 'index_init_progress_notice'), 10000);
                    this.display();
                    try {
                        await this.plugin.initIndex();
                        await this.plugin.checkEmbeddingHealth?.(false, true);
                    } finally {
                        this.plugin.embeddingIndexInProgress = false;
                        this.display();
                    }
                },
            };
        }
        return null;
    }

    _renderEmbeddingStatusCard(containerEl) {
        const info = this._embeddingStatusInfo();
        const health = info.health || {};
        const panel = containerEl.createDiv({ cls: `understory-embedding-panel is-${info.status}` });
        const header = panel.createDiv({ cls: 'understory-embedding-head' });
        header.createDiv({ text: t(this.plugin, info.titleKey), cls: 'understory-embedding-title' });
        header.createEl('span', {
            text: t(this.plugin, info.badgeKey),
            cls: `understory-embedding-chip is-${info.status}`,
        });
        panel.createDiv({ text: t(this.plugin, info.descKey), cls: 'understory-embedding-desc' });
        if (this.plugin.embeddingIndexInProgress) {
            const progress = panel.createDiv({ cls: 'understory-embedding-progress' });
            progress.createDiv({ cls: 'understory-embedding-progress-bar' });
        }

        const meta = [
            t(this.plugin, `network_mode_${info.mode}`),
            info.provider || t(this.plugin, 'engine_value_unknown'),
        ];
        if (Object.hasOwn(health, 'indexed_count')) {
            meta.push(t(this.plugin, 'embedding_status_count_value', { count: health.indexed_count || 0 }));
        }
        if (health.index_mtime) {
            const timestamp = new Date(Number(health.index_mtime) * 1000);
            meta.push(timestamp.toLocaleString());
        }
        panel.createDiv({ text: meta.join(' / '), cls: 'understory-embedding-meta' });

        const action = this._embeddingPrimaryAction(info);
        if (!action) return;
        new Setting(panel)
            .setName(t(this.plugin, 'embedding_status_action_name'))
            .setDesc(t(this.plugin, info.actionDescKey))
            .addButton((button) => {
                const control = button
                    .setButtonText(t(this.plugin, action.labelKey))
                    .setDisabled(!!action.disabled)
                    .onClick(action.onClick);
                if (!action.disabled && action.cta !== false) control.setCta();
                return control;
            });
    }

    _renderEngineStatus(containerEl) {
        const health = this.plugin.engineHealth;
        const status = health ? (health.status || (health.ok ? 'ready' : 'error')) : 'unchecked';
        const panel = containerEl.createDiv({ cls: 'understory-engine-panel' });

        const summary = panel.createDiv({ cls: 'understory-engine-summary' });
        summary.createEl('span', {
            text: t(this.plugin, `engine_status_badge_${status}`),
            cls: `understory-engine-badge is-${status}`,
        });
        summary.createDiv({
            text: health
                ? (health.message || t(this.plugin, 'engine_status_message_ready'))
                : t(this.plugin, 'engine_status_message_unchecked'),
            cls: 'understory-engine-summary-text',
        });

        this._appendEngineKeyValueGrid(panel, t(this.plugin, 'engine_versions_title'), [
            [t(this.plugin, 'engine_value_plugin'), health?.pluginVersion || this.plugin.manifest?.version || t(this.plugin, 'engine_value_unknown')],
            [t(this.plugin, 'engine_value_engine'), health?.engineVersion || t(this.plugin, 'engine_value_unknown')],
            [t(this.plugin, 'engine_value_engine_commit'), health?.engineCommit || t(this.plugin, 'engine_value_unknown')],
            [t(this.plugin, 'engine_value_python'), health?.pythonVersion || t(this.plugin, 'engine_value_unknown')],
        ]);

        this._appendEngineKeyValueGrid(panel, t(this.plugin, 'engine_paths_title'), [
            [t(this.plugin, 'engine_value_engine_dir'), health?.engineDir || this.plugin.settings.graphifyDir || t(this.plugin, 'engine_value_not_set')],
            [t(this.plugin, 'engine_value_python_path'), health?.pythonPath || this.plugin.settings.pythonPath || 'python'],
            [t(this.plugin, 'engine_value_vault'), health?.vaultUnderstoryPath || t(this.plugin, 'engine_value_not_checked')],
        ]);

        this._appendEngineChecks(panel, health?.checks);
        this._appendEngineFixes(panel, health?.fixes || health?.issues || []);

        new Setting(panel)
            .setName(t(this.plugin, 'engine_check_name'))
            .setDesc(t(this.plugin, 'engine_check_desc'))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'engine_check_button'))
                .onClick(async () => {
                    if (!this.plugin.checkEngineHealth) {
                        new Notice(t(this.plugin, 'engine_check_unavailable'));
                        return;
                    }
                    await this.plugin.checkEngineHealth(true, true);
                    this.display();
                }))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'engine_use_env_button'))
                .setDisabled(!preferredEngineDir(this.plugin))
                .onClick(async () => {
                    this.plugin.settings.graphifyDir = preferredEngineDir(this.plugin);
                    this.plugin.settings.pythonPath = getDefaultPythonPath();
                    await this.plugin.saveSettings();
                    await this.plugin.checkEngineHealth?.(true, true);
                    this.display();
                }))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'engine_copy_diagnostics_button'))
                .setDisabled(!health?.diagnosticText)
                .onClick(async () => {
                    await this._copyText(health?.diagnosticText || '', t(this.plugin, 'engine_copy_diagnostics_notice'));
                }));
    }

    _appendEngineKeyValueGrid(containerEl, title, rows) {
        const section = containerEl.createDiv({ cls: 'understory-engine-section' });
        section.createEl('div', { text: title, cls: 'understory-engine-section-title' });
        const grid = section.createDiv({ cls: 'understory-engine-kv-grid' });
        for (const [label, value] of rows) {
            const row = grid.createDiv({ cls: 'understory-engine-kv' });
            row.createDiv({ text: label, cls: 'understory-engine-kv-label' });
            row.createDiv({ text: value || t(this.plugin, 'engine_value_unknown'), cls: 'understory-engine-kv-value' });
        }
    }

    _appendEngineChecks(containerEl, checks = {}) {
        const groups = ['paths', 'scripts', 'dependencies', 'permissions', 'vault'];
        const section = containerEl.createDiv({ cls: 'understory-engine-section' });
        section.createEl('div', { text: t(this.plugin, 'engine_checks_title'), cls: 'understory-engine-section-title' });
        const matrix = section.createDiv({ cls: 'understory-engine-checks' });

        for (const group of groups) {
            const items = Array.isArray(checks[group]) ? checks[group] : [];
            const state = this._engineGroupState(items);
            const groupEl = matrix.createDiv({ cls: `understory-engine-check-group is-${state}` });
            const head = groupEl.createDiv({ cls: 'understory-engine-check-group-head' });
            head.createEl('span', { text: t(this.plugin, `engine_group_${group}`) });
            head.createEl('span', {
                text: t(this.plugin, `engine_check_status_${state}`),
                cls: `understory-engine-check-pill is-${state}`,
            });
            if (!items.length) {
                groupEl.createDiv({
                    text: t(this.plugin, 'engine_check_not_run'),
                    cls: 'understory-engine-check-empty',
                });
                continue;
            }
            for (const item of items) {
                const row = groupEl.createDiv({ cls: 'understory-engine-check-row' });
                row.createEl('span', {
                    text: t(this.plugin, `engine_check_status_${item.status || 'unknown'}`),
                    cls: `understory-engine-check-pill is-${item.status || 'unknown'}`,
                });
                const body = row.createDiv({ cls: 'understory-engine-check-body' });
                body.createDiv({ text: item.label || item.id, cls: 'understory-engine-check-label' });
                if (item.detail) body.createDiv({ text: item.detail, cls: 'understory-engine-check-detail' });
                if (item.path) body.createEl('code', { text: item.path, cls: 'understory-engine-path' });
            }
        }
    }

    _appendEngineFixes(containerEl, fixes = []) {
        const section = containerEl.createDiv({ cls: 'understory-engine-section' });
        section.createEl('div', { text: t(this.plugin, 'engine_fixes_title'), cls: 'understory-engine-section-title' });
        if (!fixes.length) {
            section.createDiv({ text: t(this.plugin, 'engine_fixes_empty'), cls: 'setting-item-description' });
            return;
        }
        const list = section.createDiv({ cls: 'understory-engine-fixes' });
        for (const issue of fixes) {
            const item = list.createDiv({ cls: `understory-engine-fix is-${issue.severity || 'info'}` });
            item.createDiv({ text: issue.title || issue.id, cls: 'understory-engine-fix-title' });
            if (issue.detail) item.createDiv({ text: issue.detail, cls: 'understory-engine-fix-detail' });
            if (issue.fix) item.createDiv({ text: issue.fix, cls: 'understory-engine-fix-detail' });
            if (issue.command) {
                const commandRow = item.createDiv({ cls: 'understory-engine-command-row' });
                commandRow.createEl('code', { text: issue.command, cls: 'understory-engine-command' });
                commandRow.createEl('button', {
                    text: t(this.plugin, 'engine_copy_command_button'),
                    cls: 'mod-cta',
                }).addEventListener('click', () => {
                    this._copyText(issue.command, t(this.plugin, 'engine_copy_command_notice'));
                });
            }
        }
    }

    _engineGroupState(items) {
        if (!items || !items.length) return 'unknown';
        if (items.some((item) => item.status === 'error')) return 'error';
        if (items.some((item) => item.status === 'warning')) return 'warning';
        if (items.every((item) => item.status === 'skipped')) return 'skipped';
        return 'ok';
    }

    async _copyText(text, successMessage) {
        try {
            if (!text) return;
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const { clipboard } = require('electron');
                clipboard.writeText(text);
            }
            new Notice(successMessage);
        } catch (error) {
            new Notice(t(this.plugin, 'engine_copy_failed_notice'));
        }
    }
}

function mixinPrototype(target, source) {
    for (const name of Object.getOwnPropertyNames(source)) {
        if (name === 'constructor') continue;
        Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name));
    }
}

mixinPrototype(UnderstorySettingTab.prototype, require('./settingsLogs'));
mixinPrototype(UnderstorySettingTab.prototype, require('./settingsFolders'));

module.exports = {
    DEFAULT_SETTINGS,
    ENGINE_DIR_ENV,
    LEGACY_ENGINE_DIR_ENV,
    PYTHON_PATH_ENV,
    PROVIDER_PRESETS,
    findDefaultEngineDir,
    findDefaultPythonPath,
    getDefaultEngineDir,
    getDefaultPythonPath,
    preferredEngineDir,
    repairPythonPath,
    isLikelyPythonExecutable,
    isLikelyEngineDir,
    providerPreset,
    UnderstorySettingTab
};
