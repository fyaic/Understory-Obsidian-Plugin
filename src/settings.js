const { PluginSettingTab, Setting, Notice, TFile, setIcon } = require('obsidian');
const fs = require('fs');
const path = require('path');
const { UNDERSTORY_SETTINGS_LOGO_DATA_URI } = require('./brandAssets');
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

const ENGINE_DIR_ENV = 'UNDERSTORY_ENGINE_DIR';
const LEGACY_ENGINE_DIR_ENV = 'GRAPHIFY_ENGINE_DIR';
const PYTHON_PATH_ENV = 'UNDERSTORY_PYTHON_PATH';
const ENGINE_DIR_CANDIDATE_NAMES = [
    'understory-graphify-engine',
    'Understory-graphify-engine',
    'Understory-Graphify-Engine',
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

function getDefaultPythonPath() {
    return envValue(PYTHON_PATH_ENV) || 'python';
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
    graphifyDir: getDefaultEngineDir(),
    pythonPath: getDefaultPythonPath(),
    debounceMinutes: 10,
    linkLog: [],
    uiLanguage: 'en',
    networkMode: 'local',
    agentProfileId: 'generic',
    agentUsageModeId: 'memory',
    embeddingProvider: 'zhipu',
    embeddingBaseUrl: PROVIDER_PRESETS.zhipu.baseUrl,
    embeddingModel: PROVIDER_PRESETS.zhipu.embeddingModel,
    embeddingDimensions: 1024,
    embeddingApiKey: '',
    llmProvider: 'zhipu',
    llmBaseUrl: PROVIDER_PRESETS.zhipu.baseUrl,
    llmModel: PROVIDER_PRESETS.zhipu.llmModel,
    llmApiKey: '',
    presentationMode: 'body',
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
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        this._injectStyles(containerEl);

        const header = containerEl.createDiv({ cls: 'understory-settings-header' });
        const brand = header.createDiv({ cls: 'understory-settings-brand' });
        const logo = brand.createEl('img', { cls: 'understory-settings-logo' });
        logo.setAttribute('src', UNDERSTORY_SETTINGS_LOGO_DATA_URI);
        logo.setAttribute('alt', 'Understory logo');
        brand.createDiv({ text: t(this.plugin, 'settings_title'), cls: 'understory-settings-title' });
        this._renderLanguageToggle(header);

        const tabIds = this._settingsTabs().map((tab) => tab.id);
        const activeTab = tabIds.includes(this._activeSettingsTab) ? this._activeSettingsTab : 'setup';
        this._activeSettingsTab = activeTab;
        this._renderSettingsTabs(containerEl, activeTab);
        const pageEl = containerEl.createDiv({ cls: 'understory-settings-page' });

        if (activeTab === 'models') {
            this._renderModelsTab(pageEl);
        } else if (activeTab === 'suggestions') {
            this._renderSuggestionsTab(pageEl);
        } else if (activeTab === 'agents') {
            this._renderAgentAccessTab(pageEl);
        } else if (activeTab === 'maintenance') {
            this._renderMaintenanceTab(pageEl);
        } else {
            this._activeSettingsTab = 'setup';
            this._renderSetupTab(pageEl);
        }
    }

    _settingsTabs() {
        return [
            { id: 'setup', label: t(this.plugin, 'settings_tab_setup') },
            { id: 'models', label: t(this.plugin, 'settings_tab_models') },
            { id: 'suggestions', label: t(this.plugin, 'settings_tab_suggestions') },
            { id: 'maintenance', label: t(this.plugin, 'settings_tab_maintenance') },
            { id: 'agents', label: t(this.plugin, 'settings_tab_agents') },
        ];
    }

    _renderSettingsTabs(containerEl, activeTab) {
        const toggle = containerEl.createDiv({ cls: 'understory-settings-toggle' });
        toggle.createDiv({
            cls: 'understory-settings-toggle-label',
            text: t(this.plugin, 'settings_page_toggle_label'),
        });

        const tabs = this._settingsTabs();
        const tablist = toggle.createDiv({ cls: 'understory-settings-tablist' });
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', t(this.plugin, 'settings_page_toggle_label'));

        for (const tab of tabs) {
            const isActive = tab.id === activeTab;
            const button = tablist.createEl('button', {
                text: tab.label,
                cls: `understory-settings-toggle-button${isActive ? ' is-active' : ''}`,
            });
            button.type = 'button';
            button.tabIndex = isActive ? 0 : -1;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.setAttribute('data-settings-page', tab.id);
            button.addEventListener('click', () => {
                this._activeSettingsTab = tab.id;
                this.display();
            });
            button.addEventListener('keydown', (event) => {
                const currentIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
                const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                        ? -1
                        : 0;
                if (!delta) return;
                event.preventDefault?.();
                const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
                this._activeSettingsTab = tabs[nextIndex].id;
                this.display();
            });
        }
    }

    _renderTabIntro(containerEl, titleKey, descKey) {
        const intro = containerEl.createDiv({ cls: 'understory-tab-intro' });
        intro.createDiv({ text: t(this.plugin, titleKey), cls: 'understory-tab-intro-title' });
        intro.createDiv({ text: t(this.plugin, descKey), cls: 'understory-tab-intro-desc' });
    }

    _setupStatusInfo() {
        const health = this.plugin.engineHealth;
        const engineDir = String(this.plugin.settings.graphifyDir || '').trim();
        if (!engineDir) {
            return {
                status: 'needed',
                title: t(this.plugin, 'setup_needed_title'),
                desc: t(this.plugin, 'setup_needed_desc'),
            };
        }
        if (!health) {
            return {
                status: 'unchecked',
                title: t(this.plugin, 'setup_unchecked_title'),
                desc: t(this.plugin, 'setup_unchecked_desc'),
            };
        }
        if (health.status === 'ready') {
            return {
                status: 'ready',
                title: t(this.plugin, 'setup_ready_title'),
                desc: t(this.plugin, 'setup_ready_desc'),
            };
        }
        if (health.status === 'warning') {
            return {
                status: 'warning',
                title: t(this.plugin, 'setup_warning_title'),
                desc: health.message || t(this.plugin, 'setup_warning_desc'),
            };
        }
        return {
            status: 'error',
            title: t(this.plugin, 'setup_error_title'),
            desc: health.message || t(this.plugin, 'setup_error_desc'),
        };
    }

    _renderSetupSteps(containerEl) {
        const steps = [
            [t(this.plugin, 'setup_step_engine_title'), t(this.plugin, 'setup_step_engine_desc')],
            [t(this.plugin, 'setup_step_python_title'), t(this.plugin, 'setup_step_python_desc')],
            [t(this.plugin, 'setup_step_check_title'), t(this.plugin, 'setup_step_check_desc')],
        ];
        this._renderNumberedSteps(containerEl, steps);
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
        const steps = [
            [t(this.plugin, 'agent_multi_vault_step_open_title'), t(this.plugin, 'agent_multi_vault_step_open_desc')],
            [t(this.plugin, 'agent_multi_vault_step_prepare_title'), t(this.plugin, 'agent_multi_vault_step_prepare_desc')],
            [t(this.plugin, 'agent_multi_vault_step_copy_title'), t(this.plugin, 'agent_multi_vault_step_copy_desc')],
        ];
        this._renderNumberedSteps(containerEl, steps);
    }

    _renderSetupTab(containerEl) {
        this._renderTabIntro(containerEl, 'setup_page_title', 'setup_page_desc');

        const info = this._setupStatusInfo();
        const card = containerEl.createDiv({ cls: `understory-setup-card is-${info.status}` });
        card.createDiv({ text: info.title, cls: 'understory-setup-card-title' });
        card.createDiv({ text: info.desc, cls: 'understory-setup-card-desc' });

        this._renderSetupSteps(containerEl);

        new Setting(containerEl)
            .setName(t(this.plugin, 'engine_dir_name'))
            .setDesc(t(this.plugin, 'engine_dir_user_desc'))
            .addText((text) => text
                .setPlaceholder(t(this.plugin, 'engine_dir_placeholder'))
                .setValue(this.plugin.settings.graphifyDir)
                .onChange(async (value) => {
                    this.plugin.settings.graphifyDir = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t(this.plugin, 'python_path_name'))
            .setDesc(t(this.plugin, 'python_path_user_desc'))
            .addText((text) => text
                .setPlaceholder('python')
                .setValue(this.plugin.settings.pythonPath)
                .onChange(async (value) => {
                    this.plugin.settings.pythonPath = value.trim() || 'python';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t(this.plugin, 'setup_check_name'))
            .setDesc(t(this.plugin, 'setup_check_desc'))
            .addButton((button) => button
                .setButtonText(t(this.plugin, 'engine_check_button'))
                .setCta()
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
                .setButtonText(t(this.plugin, 'setup_open_diagnostics_button'))
                .onClick(() => {
                    this._activeSettingsTab = 'maintenance';
                    this.display();
                }));
    }

    _renderModelsTab(containerEl) {
        this._renderTabIntro(containerEl, 'models_page_title', 'models_page_desc');
        this._renderPrivacySettings(containerEl);
    }

    _renderSuggestionsTab(containerEl) {
        this._renderTabIntro(containerEl, 'suggestions_page_title', 'suggestions_page_desc');

        new Setting(containerEl)
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

        containerEl.createDiv({ text: t(this.plugin, 'excluded_folders_title'), cls: 'understory-section-title-text' });
        containerEl.createDiv({
            text: t(this.plugin, 'excluded_folders_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';
        this._renderFolderTree(containerEl, 'excludedFolders', 'refreshFolders', t(this.plugin, 'excluded_selected'));

        containerEl.createDiv({ text: t(this.plugin, 'relation_title'), cls: 'understory-section-title-text' });
        containerEl.createDiv({
            text: t(this.plugin, 'relation_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';

        new Setting(containerEl)
            .setName(t(this.plugin, 'presentation_mode_name'))
            .setDesc(t(this.plugin, 'presentation_mode_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('sidebar', t(this.plugin, 'presentation_sidebar'))
                .addOption('body', t(this.plugin, 'presentation_body'))
                .addOption('both', t(this.plugin, 'presentation_both'))
                .setValue(this.plugin.settings.presentationMode || 'body')
                .onChange(async (value) => {
                    this.plugin.settings.presentationMode = value;
                    await this.plugin.saveSettings();
                    if (value === 'sidebar' || value === 'both') {
                        await this.plugin.openSidebar();
                    }
                }));

        new Setting(containerEl)
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

        new Setting(containerEl)
            .setName(t(this.plugin, 'sidebar_scores_name'))
            .setDesc(t(this.plugin, 'sidebar_scores_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.sidebarShowScores !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sidebarShowScores = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t(this.plugin, 'sidebar_conflicts_name'))
            .setDesc(t(this.plugin, 'sidebar_conflicts_desc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.sidebarShowConflicts !== false)
                .onChange(async (value) => {
                    this.plugin.settings.sidebarShowConflicts = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
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

        new Setting(containerEl)
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
            new Setting(containerEl)
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

            new Setting(containerEl)
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

            new Setting(containerEl)
                .setName(t(this.plugin, 'notify_high_name'))
                .setDesc(t(this.plugin, 'notify_high_desc'))
                .addToggle((toggle) => toggle
                    .setValue(this.plugin.settings.notifyHighConflict)
                    .onChange(async (value) => {
                        this.plugin.settings.notifyHighConflict = value;
                        await this.plugin.saveSettings();
                    }));

            const webhookAvailable = (this.plugin.settings.networkMode || 'local') !== 'local';
            new Setting(containerEl)
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
                new Setting(containerEl)
                    .setName(t(this.plugin, 'webhook_name'))
                    .setDesc(t(this.plugin, 'webhook_desc'))
                    .addText((text) => text
                        .setPlaceholder('https://hooks.slack.com/...')
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
            containerEl.createDiv({
                text: lastLint > 0
                    ? t(this.plugin, 'last_lint', { time: new Date(lastLint).toLocaleString(), all: openAll, high: openHigh })
                    : t(this.plugin, 'last_lint_never'),
                cls: 'setting-item-description'
            }).style.marginBottom = '8px';

            new Setting(containerEl)
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

        containerEl.createDiv({ text: t(this.plugin, 'relation_logs_title'), cls: 'understory-section-title-text' });
        containerEl.createDiv({
            text: t(this.plugin, 'relation_logs_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';
        this._renderLogs(containerEl);

        containerEl.createDiv({ text: t(this.plugin, 'refresh_title'), cls: 'understory-section-title-text' });

        new Setting(containerEl)
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
            new Setting(containerEl)
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

            containerEl.createDiv({ text: t(this.plugin, 'refresh_folders_title'), cls: 'understory-section-subtitle-text' });
            containerEl.createDiv({
                text: t(this.plugin, 'refresh_folders_desc'),
                cls: 'setting-item-description'
            }).style.marginBottom = '8px';
            this._renderFolderTree(containerEl, 'refreshFolders', 'excludedFolders', t(this.plugin, 'refresh_selected'));

            const lastRefresh = this.plugin.settings.lastRefreshTime;
            containerEl.createDiv({ text: t(this.plugin, 'refresh_status_title'), cls: 'understory-section-subtitle-text' });
            containerEl.createDiv({
                text: lastRefresh > 0
                    ? t(this.plugin, 'last_refresh', { time: new Date(lastRefresh).toLocaleString() })
                    : t(this.plugin, 'last_refresh_never'),
                cls: 'setting-item-description'
            }).style.marginBottom = '6px';

            if (this.plugin.settings.refreshInProgress) {
                const idx = this.plugin.settings.refreshQueueIndex || 0;
                const total = (this.plugin.settings.refreshQueue || []).length;
                containerEl.createDiv({
                    text: t(this.plugin, 'refresh_progress', { current: idx, total }),
                    cls: 'setting-item-description'
                }).style.marginBottom = '6px';
            }

            new Setting(containerEl)
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

        containerEl.createDiv({ text: t(this.plugin, 'advanced_index_title'), cls: 'understory-section-title-text' });
        containerEl.createDiv({
            text: t(this.plugin, 'advanced_index_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        containerEl.createDiv({
            text: this.plugin.daemonProcess
                ? t(this.plugin, 'daemon_running')
                : (this.plugin.settings.daemonEnabled
                    ? t(this.plugin, 'daemon_enabled_not_running')
                    : t(this.plugin, 'daemon_stopped')),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';

        containerEl.createDiv({ text: t(this.plugin, 'maintenance_diagnostics_title'), cls: 'understory-section-title-text' });
        containerEl.createDiv({
            text: t(this.plugin, 'maintenance_diagnostics_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';
        this._renderEngineStatus(containerEl);
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
            cls: 'setting-item-description',
        }).style.marginBottom = '8px';
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
        const icon = button.createSpan({ cls: 'understory-language-toggle-icon' });
        setIcon(icon, 'globe-2');
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

    _renderPrivacySettings(containerEl) {
        containerEl.createEl('h3', { text: t(this.plugin, 'privacy_title') });
        containerEl.createDiv({
            text: t(this.plugin, 'privacy_desc'),
            cls: 'setting-item-description understory-privacy-intro'
        });

        const mode = this.plugin.settings.networkMode || 'local';
        new Setting(containerEl)
            .setName(t(this.plugin, 'network_mode_name'))
            .setDesc(t(this.plugin, 'network_mode_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('local', t(this.plugin, 'network_mode_local'))
                .addOption('embedding', t(this.plugin, 'network_mode_embedding'))
                .addOption('full', t(this.plugin, 'network_mode_full'))
                .setValue(mode)
                .onChange(async (value) => {
                    this.plugin.settings.networkMode = value;
                    if (value === 'local') {
                        this.plugin.settings.webhookEnabled = false;
                    }
                    await this.plugin.saveSettings();
                    this.display();
                }));

        containerEl.createDiv({
            text: t(this.plugin, `network_mode_${mode}_summary`),
            cls: 'setting-item-description understory-privacy-note'
        });

        if (mode === 'local') {
            containerEl.createDiv({
                text: t(this.plugin, 'model_config_local_notice'),
                cls: 'setting-item-description understory-privacy-inline-note'
            });
            return;
        }

        containerEl.createDiv({
            text: t(this.plugin, 'provider_terms_notice'),
            cls: 'setting-item-description understory-privacy-note'
        });

        containerEl.createEl('h4', { text: t(this.plugin, 'embedding_section_title') });
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
            containerEl.createEl('h4', { text: t(this.plugin, 'llm_section_title') });
            containerEl.createDiv({
                text: t(this.plugin, 'llm_disabled_desc'),
                cls: 'setting-item-description understory-privacy-inline-note'
            });
            return;
        }

        containerEl.createEl('h4', { text: t(this.plugin, 'llm_section_title') });
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

mixinPrototype(UnderstorySettingTab.prototype, require('./settingsStyles'));
mixinPrototype(UnderstorySettingTab.prototype, require('./settingsLogs'));
mixinPrototype(UnderstorySettingTab.prototype, require('./settingsFolders'));

module.exports = {
    DEFAULT_SETTINGS,
    ENGINE_DIR_ENV,
    LEGACY_ENGINE_DIR_ENV,
    PYTHON_PATH_ENV,
    PROVIDER_PRESETS,
    findDefaultEngineDir,
    getDefaultEngineDir,
    getDefaultPythonPath,
    preferredEngineDir,
    isLikelyEngineDir,
    providerPreset,
    UnderstorySettingTab
};
