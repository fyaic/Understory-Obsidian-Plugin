const { PluginSettingTab, Setting, Notice, TFile } = require('obsidian');
const { getLanguage, t } = require('./i18n');

const ENGINE_DIR_ENV = 'UNDERSTORY_ENGINE_DIR';
const LEGACY_ENGINE_DIR_ENV = 'GRAPHIFY_ENGINE_DIR';
const PYTHON_PATH_ENV = 'UNDERSTORY_PYTHON_PATH';

function envValue(name) {
    try {
        return (process && process.env && process.env[name] || '').trim();
    } catch (error) {
        return '';
    }
}

function getDefaultEngineDir() {
    return envValue(ENGINE_DIR_ENV) || envValue(LEGACY_ENGINE_DIR_ENV);
}

function getDefaultPythonPath() {
    return envValue(PYTHON_PATH_ENV) || 'python';
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
    openSidebarOnLoad: false,
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
        header.createEl('h2', { text: t(this.plugin, 'settings_title') });
        this._renderLanguageToggle(header);

        new Setting(containerEl)
            .setName(t(this.plugin, 'engine_dir_name'))
            .setDesc(t(this.plugin, 'engine_dir_desc'))
            .addText((text) => text
                .setPlaceholder(t(this.plugin, 'engine_dir_placeholder'))
                .setValue(this.plugin.settings.graphifyDir)
                .onChange(async (value) => {
                    this.plugin.settings.graphifyDir = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t(this.plugin, 'python_path_name'))
            .setDesc(t(this.plugin, 'python_path_desc'))
            .addText((text) => text
                .setPlaceholder('python')
                .setValue(this.plugin.settings.pythonPath)
                .onChange(async (value) => {
                    this.plugin.settings.pythonPath = value.trim() || 'python';
                    await this.plugin.saveSettings();
                }));

        this._renderEngineStatus(containerEl);
        this._renderPrivacySettings(containerEl);

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

        containerEl.createEl('h3', { text: t(this.plugin, 'excluded_folders_title') });
        containerEl.createEl('div', {
            text: t(this.plugin, 'excluded_folders_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';
        this._renderFolderTree(containerEl, 'excludedFolders', 'refreshFolders', t(this.plugin, 'excluded_selected'));

        containerEl.createEl('h3', { text: t(this.plugin, 'relation_title') });
        containerEl.createEl('div', {
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
            .setName(t(this.plugin, 'open_sidebar_on_load_name'))
            .setDesc(t(this.plugin, 'open_sidebar_on_load_desc'))
            .addToggle((toggle) => toggle
                .setValue(!!this.plugin.settings.openSidebarOnLoad)
                .onChange(async (value) => {
                    this.plugin.settings.openSidebarOnLoad = value;
                    await this.plugin.saveSettings();
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
            containerEl.createEl('div', {
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

        containerEl.createEl('h4', { text: t(this.plugin, 'relation_logs_title') });
        containerEl.createEl('div', {
            text: t(this.plugin, 'relation_logs_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';
        this._renderLogs(containerEl);

        containerEl.createEl('h3', { text: t(this.plugin, 'refresh_title') });

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

            containerEl.createEl('h4', { text: t(this.plugin, 'refresh_folders_title') });
            containerEl.createEl('div', {
                text: t(this.plugin, 'refresh_folders_desc'),
                cls: 'setting-item-description'
            }).style.marginBottom = '8px';
            this._renderFolderTree(containerEl, 'refreshFolders', 'excludedFolders', t(this.plugin, 'refresh_selected'));

            const lastRefresh = this.plugin.settings.lastRefreshTime;
            containerEl.createEl('h4', { text: t(this.plugin, 'refresh_status_title') });
            containerEl.createEl('div', {
                text: lastRefresh > 0
                    ? t(this.plugin, 'last_refresh', { time: new Date(lastRefresh).toLocaleString() })
                    : t(this.plugin, 'last_refresh_never'),
                cls: 'setting-item-description'
            }).style.marginBottom = '6px';

            if (this.plugin.settings.refreshInProgress) {
                const idx = this.plugin.settings.refreshQueueIndex || 0;
                const total = (this.plugin.settings.refreshQueue || []).length;
                containerEl.createEl('div', {
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

        containerEl.createEl('h3', { text: t(this.plugin, 'advanced_index_title') });
        containerEl.createEl('div', {
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

        containerEl.createEl('div', {
            text: this.plugin.daemonProcess
                ? t(this.plugin, 'daemon_running')
                : (this.plugin.settings.daemonEnabled
                    ? t(this.plugin, 'daemon_enabled_not_running')
                    : t(this.plugin, 'daemon_stopped')),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';
    }

    _renderLanguageToggle(parent) {
        const current = getLanguage(this.plugin);
        const next = current === 'en' ? 'zh' : 'en';
        const button = parent.createEl('button', { cls: `understory-language-toggle understory-language-toggle--${current}` });
        button.type = 'button';
        button.setAttribute('aria-label', current === 'en' ? 'Switch UI to Chinese' : '切换到英文界面');
        button.setAttribute('title', current === 'en' ? 'Switch to Chinese' : 'Switch to English');
        button.createSpan({ cls: 'understory-language-toggle-icon', text: '🌐' });
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
        containerEl.createEl('div', {
            text: t(this.plugin, 'privacy_desc'),
            cls: 'setting-item-description'
        }).style.marginBottom = '8px';

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

        containerEl.createEl('div', {
            text: t(this.plugin, `network_mode_${mode}_summary`),
            cls: 'setting-item-description understory-privacy-summary'
        }).style.marginBottom = '12px';
        containerEl.createEl('div', {
            text: t(this.plugin, 'api_key_overview'),
            cls: 'setting-item-description understory-privacy-summary'
        }).style.marginBottom = '6px';
        containerEl.createEl('div', {
            text: mode === 'local' ? t(this.plugin, 'api_key_local_notice') : t(this.plugin, 'provider_terms_notice'),
            cls: 'setting-item-description understory-privacy-summary'
        }).style.marginBottom = '12px';

        containerEl.createEl('h4', { text: t(this.plugin, 'embedding_section_title') });
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

        if (mode !== 'local' && (this.plugin.settings.embeddingProvider || 'zhipu') !== 'none') {
            const embeddingPreset = providerPreset(this.plugin.settings.embeddingProvider || 'zhipu');
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
            containerEl.createEl('div', {
                text: t(this.plugin, 'api_key_storage_desc'),
                cls: 'setting-item-description understory-privacy-summary'
            }).style.marginBottom = '8px';
        }

        containerEl.createEl('h4', { text: t(this.plugin, 'llm_section_title') });
        new Setting(containerEl)
            .setName(t(this.plugin, 'llm_provider_name'))
            .setDesc(mode === 'full' ? t(this.plugin, 'llm_provider_desc') : t(this.plugin, 'llm_disabled_desc'))
            .addDropdown((dropdown) => dropdown
                .addOption('zhipu', t(this.plugin, 'provider_zhipu'))
                .addOption('openai', t(this.plugin, 'provider_openai'))
                .addOption('custom', t(this.plugin, 'provider_custom'))
                .addOption('none', t(this.plugin, 'provider_none'))
                .setValue(this.plugin.settings.llmProvider || 'zhipu')
                .setDisabled(mode !== 'full')
                .onChange(async (value) => {
                    this._applyProviderPreset('llm', value);
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (mode === 'full' && (this.plugin.settings.llmProvider || 'zhipu') !== 'none') {
            const llmPreset = providerPreset(this.plugin.settings.llmProvider || 'zhipu');
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
            containerEl.createEl('div', {
                text: t(this.plugin, 'api_key_storage_desc'),
                cls: 'setting-item-description understory-privacy-summary'
            }).style.marginBottom = '8px';
        }
    }

    _renderEngineStatus(containerEl) {
        const health = this.plugin.engineHealth;
        const statusText = health
            ? (health.ok
                ? t(this.plugin, 'engine_status_ok', { python: health.pythonVersion || this.plugin.settings.pythonPath || 'python' })
                : t(this.plugin, 'engine_status_problem', { message: health.message || t(this.plugin, 'engine_status_unknown') }))
            : t(this.plugin, 'engine_status_unknown');

        containerEl.createEl('div', {
            text: statusText,
            cls: `setting-item-description understory-engine-status ${health && health.ok ? 'is-ok' : 'is-warning'}`
        }).style.marginBottom = '8px';

        new Setting(containerEl)
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
                .setDisabled(!getDefaultEngineDir())
                .onClick(async () => {
                    this.plugin.settings.graphifyDir = getDefaultEngineDir();
                    this.plugin.settings.pythonPath = getDefaultPythonPath();
                    await this.plugin.saveSettings();
                    await this.plugin.checkEngineHealth?.(true, true);
                    this.display();
                }));
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
    getDefaultEngineDir,
    getDefaultPythonPath,
    providerPreset,
    UnderstorySettingTab
};
