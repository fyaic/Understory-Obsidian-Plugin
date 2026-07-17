const { Modal, Notice, openExternal, requestUrl } = require('obsidian');
const nodeCrypto = require('crypto');
const { t } = require('./i18n');
const { recordBackgroundError } = require('./safety');

const DEFAULT_HOSTED_SERVER_URL = 'https://understory.bondie.io';
const DEFAULT_ACCOUNT_CENTER_URL = 'https://account.bondie.io/account';

function _jsonHeaders(extra = {}) {
    return {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...extra,
    };
}

function _cleanUrl(value, fallback) {
    const text = String(value || fallback || '').trim();
    return text.replace(/\/+$/, '');
}

function _safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function _safeCount(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

class HostedGlobalLogoutModal extends Modal {
    constructor(app, plugin, resolve) {
        super(app);
        this.plugin = plugin;
        this.resolveChoice = resolve;
        this.settled = false;
    }

    _finish(value) {
        if (this.settled) return;
        this.settled = true;
        this.resolveChoice(value);
        this.close();
    }

    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass?.('understory-global-logout-modal');
        titleEl.setText(t(this.plugin, 'hosted_global_logout_confirm_title'));
        contentEl.createEl('p', { text: t(this.plugin, 'hosted_global_logout_confirm_desc') });
        const actions = contentEl.createDiv({ cls: 'understory-consent-actions' });
        const cancel = actions.createEl('button', { text: t(this.plugin, 'hosted_global_logout_confirm_cancel') });
        cancel.type = 'button';
        cancel.addEventListener('click', () => this._finish(false));
        const confirm = actions.createEl('button', {
            text: t(this.plugin, 'hosted_global_logout_confirm_action'),
            cls: 'mod-warning',
        });
        confirm.type = 'button';
        confirm.addEventListener('click', () => this._finish(true));
    }

    onClose() {
        if (!this.settled) {
            this.settled = true;
            this.resolveChoice(false);
        }
        this.contentEl.empty();
    }
}

class HostedClientMethods {
    _hostedBaseUrl() {
        return _cleanUrl(this.settings?.hostedServerUrl, DEFAULT_HOSTED_SERVER_URL);
    }

    _isHostedMode() {
        return (this.settings?.networkMode || 'hosted') === 'hosted';
    }

    _hostedAccessToken() {
        return String(this.settings?.hostedAccessToken || '').trim();
    }

    _hostedLoginState() {
        return String(this.settings?.hostedLoginState || '').trim();
    }

    _ensureHostedClientInstanceId() {
        const existing = String(this.settings?.hostedClientInstanceId || '').trim();
        if (existing) return existing;
        const generated = `uci_${nodeCrypto.randomBytes(18).toString('hex')}`;
        this.settings.hostedClientInstanceId = generated;
        return generated;
    }

    _hostedAccountCenterUrl() {
        const auth = this.settings?.hostedRuntimeConfig?.auth || {};
        return _cleanUrl(auth.account_center_url || this.settings?.hostedAccountCenterUrl, DEFAULT_ACCOUNT_CENTER_URL);
    }

    _hostedAuthUrl(key, fallbackPath) {
        const auth = this.settings?.hostedRuntimeConfig?.auth || {};
        const configured = String(auth[key] || '').trim();
        if (configured) return configured;
        return this._hostedUrl(fallbackPath);
    }

    _hostedUrl(path) {
        return `${this._hostedBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
    }

    _parseHostedJson(text) {
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch (error) {
            return {};
        }
    }

    _assertHostedResponse(ok, status, statusText, body) {
        if (ok) return;
        const detail = body.detail || body.error || body.message || statusText || `HTTP ${status}`;
        const code = detail && typeof detail === 'object'
            ? String(detail.error || detail.code || '')
            : String(body.error || '');
        const messages = {
            provider_access_provisioning_failed: t(this, 'hosted_service_provision_failed'),
        };
        const message = (status === 401 ? t(this, 'hosted_session_expired') : '')
            || (status === 402 ? t(this, 'hosted_membership_required') : '')
            || messages[code]
            || (typeof detail === 'string' ? detail : statusText || `HTTP ${status}`);
        const error = new Error(String(message));
        error.code = code;
        error.status = status;
        error.retryable = !!(detail && typeof detail === 'object' && detail.retryable);
        throw error;
    }

    async _hostedRequestUrl(url, options) {
        const method = options.method || 'GET';
        const headers = {
            ..._jsonHeaders(),
            ...(options.headers || {}),
            'User-Agent': 'Mozilla/5.0 Understory Obsidian Plugin',
        };
        const response = await requestUrl({
            url,
            method,
            headers,
            body: options.body,
            throw: false,
        });
        const status = Number(response.status || 0);
        const text = typeof response.text === 'string' ? response.text : '';
        const body = this._parseHostedJson(text);
        this._assertHostedResponse(status >= 200 && status < 300, status, `HTTP ${status}`, body);
        return body;
    }

    async _hostedFetch(path, options = {}) {
        const url = this._hostedUrl(path);
        const hadSession = !!this._hostedAccessToken();
        try {
            return await this._hostedRequestUrl(url, options);
        } catch (error) {
            if (hadSession && Number(error?.status || 0) === 401) {
                this._clearHostedLocalSession();
                await this.saveSettings();
                this.refreshHostedAccountSurfaces?.();
            }
            throw error;
        }
    }

    _openExternalUrl(url) {
        if (!url) throw new Error('URL is not available');
        if (typeof openExternal === 'function') {
            openExternal(url);
            return;
        }
        if (typeof window !== 'undefined' && window.open) {
            window.open(url, '_blank', 'noopener');
            return;
        }
        throw new Error('External browser open is not available in this Obsidian runtime');
    }

    _setHostedMode() {
        this.settings.networkMode = 'hosted';
        this.settings.embeddingProvider = 'hosted';
        this.settings.llmProvider = 'hosted';
        this.settings.embeddingApiKey = '';
        this.settings.llmApiKey = '';
    }

    _clearHostedLocalSession() {
        this._clearHostedScheduledWork?.();
        this.settings.hostedAccessToken = '';
        this.settings.hostedRuntimeConfig = null;
        this.settings.hostedUser = null;
        this.settings.hostedSubscription = null;
        this.settings.hostedLoginState = '';
        this.settings.hostedLoginStartedAt = 0;
        this.settings.hostedLoginExpiresAt = 0;
        this.settings.hostedBillingIdempotency = {};
        this.settings.hostedLastSync = 0;
        this.hostedUsageSummary = null;
        this.hostedDisplayUser = null;
        this.hostedAccountSmokeLastSummary = null;
    }

    _sanitizeHostedUser(user) {
        if (!user || typeof user !== 'object') return null;
        return {
            identity_provider: user.identity_provider || 'synapsehub',
            created_at: user.created_at || null,
        };
    }

    _sanitizeDisplayUser(user) {
        if (!user || typeof user !== 'object') return null;
        const clean = (value, maxLength) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength) || null;
        const email = clean(user.email, 254);
        const name = clean(user.name, 120);
        let picture = clean(user.picture, 2048);
        if (picture) {
            try {
                const parsed = new URL(picture);
                if (parsed.protocol !== 'https:' || parsed.username || parsed.password) picture = null;
            } catch (error) {
                picture = null;
            }
        }
        const profile = {
            email: email && email.includes('@') ? email : null,
            name,
            picture,
        };
        return Object.values(profile).some(Boolean) ? profile : null;
    }

    _sanitizeHostedSubscription(subscription) {
        if (!subscription || typeof subscription !== 'object') return null;
        const entitlements = _safeArray(subscription.entitlements);
        const capabilities = _safeArray(subscription.product_owned_capabilities);
        return {
            plan: subscription.plan || '',
            status: subscription.status || '',
            source: subscription.source || '',
            entitlement_count: entitlements.length,
            active_entitlement_count: entitlements.filter((item) => item && item.status === 'active').length,
            capability_count: capabilities.length,
        };
    }

    _sanitizeEndpoint(endpoint) {
        if (!endpoint || typeof endpoint !== 'object') return null;
        return {
            method: endpoint.method || '',
            path: endpoint.path || '',
            url: endpoint.url || '',
        };
    }

    _sanitizeHostedFeatures(features) {
        const safe = {};
        for (const key of ['embedding', 'reasoning', 'relation_discovery', 'principle_extraction', 'vault_analysis', 'usage']) {
            const feature = features && features[key];
            if (!feature || typeof feature !== 'object') continue;
            safe[key] = {
                enabled: !!feature.enabled,
                model: feature.model || null,
                endpoint: this._sanitizeEndpoint(feature.endpoint),
            };
        }
        return safe;
    }

    _sanitizeHostedSecrets(secrets) {
        if (!secrets || typeof secrets !== 'object') {
            return {
                provider_keys_exposed: false,
                openrouter_plaintext_key_exposed: false,
                server_manages_upstream_keys: true,
            };
        }
        return {
            provider_keys_exposed: secrets.provider_keys_exposed === true,
            openrouter_plaintext_key_exposed: secrets.openrouter_plaintext_key_exposed === true,
            server_manages_upstream_keys: secrets.server_manages_upstream_keys !== false,
        };
    }

    _sanitizeProviderAccess(access) {
        if (!access || typeof access !== 'object') {
            return {
                status: 'not_ready',
                managed_by_server: true,
                credential_mode: 'per_user_child_key',
                access_assigned: false,
                usage_usd: 0,
                limit_usd: null,
                remaining_usd: null,
                limit_reset: null,
            };
        }
        const allowedStatuses = new Set(['ready', 'not_ready', 'disabled', 'unavailable']);
        const allowedModes = new Set(['per_user_child_key', 'operator_profile_pool']);
        const numberOrNull = (value) => {
            const parsed = Number(value);
            return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
        };
        return {
            status: allowedStatuses.has(access.status) ? access.status : 'not_ready',
            managed_by_server: access.managed_by_server !== false,
            credential_mode: allowedModes.has(access.credential_mode) ? access.credential_mode : 'per_user_child_key',
            access_assigned: access.access_assigned === true,
            usage_usd: numberOrNull(access.usage_usd) || 0,
            limit_usd: numberOrNull(access.limit_usd),
            remaining_usd: numberOrNull(access.remaining_usd),
            limit_reset: typeof access.limit_reset === 'string' ? access.limit_reset : null,
        };
    }

    _sanitizeReadiness(readiness) {
        if (!readiness || typeof readiness !== 'object') return {};
        const controlPlane = readiness.request_bound_control_plane || {};
        return {
            standard_commit: readiness.standard_commit || '',
            product_key: readiness.product_key || 'understory',
            states: { ...(readiness.states || {}) },
            runtime_login_evidence: { ...(readiness.runtime_login_evidence || {}) },
            runtime_login_requirements: { ...(readiness.runtime_login_requirements || {}) },
            same_email_identity_policy: { ...(readiness.same_email_identity_policy || {}) },
            session_switching_contract: { ...(readiness.session_switching_contract || {}) },
            session_epoch_contract: { ...(readiness.session_epoch_contract || {}) },
            product_instance_contract: { ...(readiness.product_instance_contract || {}) },
            request_bound_control_plane: {
                request_bound_distribution_bundle_verified: !!controlPlane.request_bound_distribution_bundle_verified,
                runtime_secret_readiness_verified: !!controlPlane.runtime_secret_readiness_verified,
                runtime_login_ready_from_control_plane: !!controlPlane.runtime_login_ready_from_control_plane,
                billing_ready_from_control_plane: !!controlPlane.billing_ready_from_control_plane,
                final_launch_ready_from_control_plane: !!controlPlane.final_launch_ready_from_control_plane,
                status: controlPlane.status || '',
            },
            billing_entitlement_evidence: { ...(readiness.billing_entitlement_evidence || {}) },
            sensitive_output_boundaries: { ...(readiness.sensitive_output_boundaries || {}) },
        };
    }

    _sanitizeRuntimeConfig(config) {
        if (!config || typeof config !== 'object') return null;
        const auth = config.auth || {};
        return {
            mode: config.mode || 'hosted',
            provider_gateway: config.provider_gateway || '',
            identity_provider: config.identity_provider || '',
            billing_provider: config.billing_provider || '',
            billing: {
                provider: config.billing?.provider || '',
                enabled: config.billing?.enabled === true,
                membership_mode: config.billing?.membership_mode || 'free',
                membership_tiers: _safeArray(config.billing?.membership_tiers)
                    .filter((tier) => ['free', 'pro', 'plus'].includes(tier)),
                current_membership: ['free', 'pro', 'plus'].includes(config.billing?.current_membership)
                    ? config.billing.current_membership
                    : 'free',
                plan_key: config.billing?.plan_key || 'pro_monthly',
                checkout_enabled: config.billing?.checkout_enabled === true,
                checkout_preflight_endpoint: config.billing?.checkout_preflight_endpoint || '',
                checkout_endpoint: config.billing?.checkout_endpoint || '',
                customer_portal_endpoint: config.billing?.customer_portal_endpoint || '',
                entitlements_endpoint: config.billing?.entitlements_endpoint || '',
                activating_poll_seconds: Number(config.billing?.activating_poll_seconds || 45),
                requires_idempotency_key: config.billing?.requires_idempotency_key !== false,
                active_membership_uses_customer_portal: config.billing?.active_membership_uses_customer_portal !== false,
            },
            auth: {
                type: auth.type || '',
                start_endpoint: auth.start_endpoint || '',
                login_endpoint: auth.login_endpoint || '',
                signup_endpoint: auth.signup_endpoint || '',
                switch_account_endpoint: auth.switch_account_endpoint || '',
                callback_endpoint: auth.callback_endpoint || '',
                completion_endpoint: auth.completion_endpoint || '',
                product_logout_endpoint: auth.product_logout_endpoint || '',
                bondie_global_logout_endpoint: auth.bondie_global_logout_endpoint || '',
                bondie_global_logout_url: auth.bondie_global_logout_url || '',
                bondie_global_logout_method: auth.bondie_global_logout_method || 'POST',
                synapsehub_auth_config_url: auth.synapsehub_auth_config_url || '',
                account_center_url: auth.account_center_url || '',
                account_security_url: auth.account_security_url || '',
                devices_url: auth.devices_url || '',
                profile_settings_url: auth.profile_settings_url || '',
                privacy_url: auth.privacy_url || '',
                connected_products_url: auth.connected_products_url || '',
                support_url: auth.support_url || '',
                session_refresh_endpoint: auth.session_refresh_endpoint || null,
                default_login_preserves_bondie_sso: auth.default_login_preserves_bondie_sso !== false,
                signup_uses_screen_hint_signup: auth.signup_uses_screen_hint_signup === true,
                switch_account_clears_product_session_before_prompt_login: auth.switch_account_clears_product_session_before_prompt_login === true,
                product_local_logout_separate_from_bondie_global_logout: auth.product_local_logout_separate_from_bondie_global_logout === true,
                product_context_session_epoch_persisted: auth.product_context_session_epoch_persisted === true,
                session_state_checked_server_side: auth.session_state_checked_server_side === true,
                global_logout_calls_synapsehub_global_revoke_first: auth.global_logout_calls_synapsehub_global_revoke_first === true,
                product_instance_registration_required: auth.product_instance_registration_required === true,
                completion_page_has_switch_account_action: auth.completion_page_has_switch_account_action === true,
                hosted_login_page_smoke_counts_as_runtime_login_ready: !!auth.hosted_login_page_smoke_counts_as_runtime_login_ready,
                credential_callback_smoke_required_for_runtime_login_ready: !!auth.credential_callback_smoke_required_for_runtime_login_ready,
                product_context_public_gateway_smoke_required_for_runtime_login_ready: !!auth.product_context_public_gateway_smoke_required_for_runtime_login_ready,
            },
            features: this._sanitizeHostedFeatures(config.features || {}),
            provider_access: this._sanitizeProviderAccess(config.provider_access || {}),
            client_settings: {
                network_mode: config.client_settings?.network_mode || 'hosted',
                provider_key_setup_required: !!config.client_settings?.provider_key_setup_required,
                local_provider_settings_hidden: config.client_settings?.local_provider_settings_hidden !== false,
                skill_and_mcp_should_reuse_session: config.client_settings?.skill_and_mcp_should_reuse_session !== false,
            },
            secrets: this._sanitizeHostedSecrets(config.secrets || {}),
            consent: {
                vault_upload_notice_required: !!config.consent?.vault_upload_notice_required,
                notice: config.consent?.notice || '',
            },
            synapsehub_readiness: this._sanitizeReadiness(config.synapsehub_readiness || {}),
        };
    }

    _applyHostedSession(body) {
        this.settings.hostedAccessToken = body.access_token || '';
        this.settings.hostedUser = this._sanitizeHostedUser(body.user);
        this.settings.hostedSubscription = this._sanitizeHostedSubscription(body.subscription);
        this.settings.hostedLoginState = '';
        this.settings.hostedLoginStartedAt = 0;
        this.settings.hostedLoginExpiresAt = 0;
        this.hostedAccountSmokeLastSummary = null;
        this.hostedUsageSummary = null;
        this._setHostedMode();
    }

    hostedAccountSummary() {
        const token = this._hostedAccessToken();
        const pending = !!this._hostedLoginState();
        const subscription = this.settings?.hostedSubscription || {};
        const config = this.settings?.hostedRuntimeConfig || {};
        const readiness = config.synapsehub_readiness || {};
        const states = readiness.states || {};
        const providerAccess = this._sanitizeProviderAccess(config.provider_access || {});
        return {
            status: token ? 'connected' : (pending ? 'pending' : 'disconnected'),
            displayUser: token ? (this.hostedDisplayUser || null) : null,
            serverUrl: this._hostedBaseUrl(),
            accountCenterUrl: this._hostedAccountCenterUrl(),
            plan: subscription.plan || '-',
            subscriptionStatus: subscription.status || '-',
            entitlementCount: Number(subscription.active_entitlement_count || subscription.entitlement_count || 0),
            capabilityCount: Number(subscription.capability_count || 0),
            runtimeLoginReady: states.runtime_login_ready === true,
            billingCheckoutReady: states.billing_checkout_ready === true,
            providerAccessStatus: providerAccess.status,
            providerAccessAssigned: providerAccess.access_assigned,
            credentialMode: providerAccess.credential_mode,
            lastSync: Number(this.settings?.hostedLastSync || 0),
        };
    }

    _hostedSmokeNoSessionSummary(status) {
        const normalized = status === 'pending' ? 'pending' : 'disconnected';
        return {
            schema: 'understory-plugin-account-smoke/v1',
            generated_at: new Date().toISOString(),
            status: normalized,
            account: {
                connected: false,
                pending: normalized === 'pending',
            },
            safety: {
                redacted: true,
                provider_keys_exposed: false,
                openrouter_plaintext_key_exposed: false,
                raw_payload_included: false,
            },
            next_step: 'complete_browser_login_for_automatic_return',
        };
    }

    _sanitizeHostedUsageSummary(usage) {
        const byFeature = usage && typeof usage.by_feature === 'object' && usage.by_feature
            ? usage.by_feature
            : {};
        const featureLabels = Object.keys(byFeature)
            .filter((key) => /^[a-z0-9_-]{1,32}$/i.test(key))
            .sort();
        return {
            request_count: _safeCount(usage?.requests),
            feature_count: featureLabels.length,
        };
    }

    _sanitizeHostedUsage(usage) {
        const byFeature = {};
        for (const key of ['relation_discovery', 'risk_analysis', 'principle_extraction', 'vault_analysis', 'embedding', 'reasoning']) {
            const row = usage?.by_feature?.[key];
            if (!row || typeof row !== 'object') continue;
            byFeature[key] = {
                requests: _safeCount(row.requests),
                input_units: _safeCount(row.input_units),
                output_units: _safeCount(row.output_units),
                estimated_cost_usd: Number(row.estimated_cost_usd || 0) || 0,
            };
        }
        return {
            requests: _safeCount(usage?.requests),
            input_units: _safeCount(usage?.input_units),
            output_units: _safeCount(usage?.output_units),
            estimated_cost_usd: Number(usage?.estimated_cost_usd || 0) || 0,
            first_used_at: typeof usage?.first_used_at === 'string' ? usage.first_used_at : null,
            last_used_at: typeof usage?.last_used_at === 'string' ? usage.last_used_at : null,
            by_feature: byFeature,
            provider_access: this._sanitizeProviderAccess(usage?.provider_access || {}),
        };
    }

    _hostedFeatureSmokeSummary(config) {
        const features = config && typeof config.features === 'object' ? config.features : {};
        let enabledCount = 0;
        for (const key of ['embedding', 'reasoning', 'relation_discovery', 'principle_extraction', 'vault_analysis', 'usage']) {
            const feature = features[key];
            if (!feature || feature.enabled === false) continue;
            enabledCount += 1;
        }
        return {
            enabled_count: enabledCount,
        };
    }

    _buildHostedAccountSmokeSummary(config, usage) {
        const account = this.hostedAccountSummary();
        const runtime = config && typeof config === 'object' ? config : {};
        const secrets = this._sanitizeHostedSecrets(runtime.secrets || {});
        const states = runtime.synapsehub_readiness?.states || {};
        return {
            schema: 'understory-plugin-account-smoke/v1',
            generated_at: new Date().toISOString(),
            status: 'connected',
            account: {
                connected: true,
                pending: false,
                subscription_status: account.subscriptionStatus || '-',
                entitlement_count: _safeCount(account.entitlementCount),
                capability_count: _safeCount(account.capabilityCount),
            },
            hosted: {
                hosted_mode: (runtime.mode || runtime.client_settings?.network_mode || 'hosted') === 'hosted',
                managed_gateway: runtime.provider_gateway === 'managed',
            },
            safety: {
                redacted: true,
                provider_keys_exposed: secrets.provider_keys_exposed === true,
                openrouter_plaintext_key_exposed: secrets.openrouter_plaintext_key_exposed === true,
                server_manages_upstream_keys: secrets.server_manages_upstream_keys !== false,
                raw_payload_included: false,
            },
            features: this._hostedFeatureSmokeSummary(runtime),
            usage: this._sanitizeHostedUsageSummary(usage || {}),
            readiness: {
                runtime_login_ready: states.runtime_login_ready === true,
                billing_checkout_ready: states.billing_checkout_ready === true,
            },
        };
    }

    formatHostedAccountSmokeSummary(summary) {
        return JSON.stringify(summary || this.hostedAccountSmokeLastSummary || {}, null, 2);
    }

    async _copyHostedSmokeText(text) {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const electron = require('electron');
        if (electron?.clipboard?.writeText) {
            electron.clipboard.writeText(text);
            return;
        }
        throw new Error(t(this, 'hosted_smoke_copy_unavailable'));
    }

    async runHostedAccountSmoke(showNotice = true) {
        const account = this.hostedAccountSummary();
        if (account.status !== 'connected') {
            const summary = this._hostedSmokeNoSessionSummary(account.status);
            this.hostedAccountSmokeLastSummary = summary;
            if (showNotice) new Notice(t(this, 'hosted_smoke_pending_notice'), 7000);
            return summary;
        }

        const token = this._hostedAccessToken();
        if (!token) throw new Error(t(this, 'hosted_login_required'));

        if (!this.settings.hostedRuntimeConfig?.features) {
            await this.refreshHostedConfig(false);
        }

        const usage = await this._hostedFetch('/v1/usage', {
            method: 'GET',
            headers: _jsonHeaders({ Authorization: `Bearer ${token}` }),
        });
        const summary = this._buildHostedAccountSmokeSummary(this.settings.hostedRuntimeConfig || {}, usage);
        this.hostedAccountSmokeLastSummary = summary;
        if (showNotice) new Notice(t(this, 'hosted_smoke_ready_notice'), 7000);
        return summary;
    }

    async copyHostedAccountSmokeSummary(showNotice = true) {
        const summary = await this.runHostedAccountSmoke(false);
        await this._copyHostedSmokeText(this.formatHostedAccountSmokeSummary(summary));
        if (showNotice) new Notice(t(this, 'hosted_smoke_copied_notice'), 7000);
        return summary;
    }

    async hostedLogin(showNotice = true, options = {}) {
        const token = this._hostedAccessToken();
        const payload = {
            client_instance_id: this._ensureHostedClientInstanceId(),
            instance_type: 'obsidian_plugin',
        };
        if (options.prompt === 'login') payload.prompt = 'login';
        if (options.screen_hint === 'signup') payload.screen_hint = 'signup';
        const freshChallenge = payload.prompt === 'login' || payload.screen_hint === 'signup';
        const headers = token
            ? _jsonHeaders({ Authorization: `Bearer ${token}` })
            : _jsonHeaders();
        const body = await this._hostedFetch('/auth/synapsehub/start', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!body.login_url || !body.state) throw new Error(t(this, 'hosted_login_start_failed'));
        this._setHostedMode();
        if (freshChallenge) this._clearHostedLocalSession();
        this.settings.hostedLoginState = body.state;
        this.settings.hostedLoginStartedAt = Date.now();
        this.settings.hostedLoginExpiresAt = Date.now() + Number(body.expires_in || 0) * 1000;
        this.hostedAccountSmokeLastSummary = null;
        await this.saveSettings();
        this._openExternalUrl(body.login_url);
        if (showNotice) {
            const noticeKey = payload.screen_hint === 'signup'
                ? 'hosted_signup_started'
                : (payload.prompt === 'login' ? 'hosted_switch_started' : 'hosted_login_started');
            new Notice(t(this, noticeKey), 9000);
        }
        return body;
    }

    async hostedSignup(showNotice = true) {
        return this.hostedLogin(showNotice, { screen_hint: 'signup' });
    }

    async hostedSwitchAccount(showNotice = true) {
        return this.hostedLogin(showNotice, { prompt: 'login' });
    }

    async hostedCancelLogin(showNotice = true) {
        this.settings.hostedLoginState = '';
        this.settings.hostedLoginStartedAt = 0;
        this.settings.hostedLoginExpiresAt = 0;
        await this.saveSettings();
        if (typeof this.refreshHostedAccountSurfaces === 'function') {
            await this.refreshHostedAccountSurfaces();
        }
        if (showNotice) new Notice(t(this, 'hosted_login_cancelled'));
    }

    async hostedHandleProtocolCallback(data = {}) {
        const action = String(data.action || '').trim();
        if (action === 'billing-refresh') {
            try {
                const summary = await this._hostedPollBillingActivation();
                await this.refreshHostedConfig(false);
                if (typeof this.refreshHostedAccountSurfaces === 'function') await this.refreshHostedAccountSurfaces();
                const active = summary?.active === true;
                new Notice(t(this, active ? 'hosted_membership_active' : 'hosted_membership_pending'));
                return { status: active ? 'billing_refreshed' : 'billing_pending' };
            } catch (error) {
                new Notice(t(this, 'hosted_membership_refresh_failed'), 8000);
                return { status: 'billing_refresh_failed' };
            }
        }
        if (action === 'retry') {
            try {
                await this.hostedLogin(true);
                return { status: 'retry_started' };
            } catch (error) {
                new Notice(t(this, 'hosted_callback_retry_failed'), 8000);
                return { status: 'retry_failed' };
            }
        }

        const callbackState = String(data.state || '').trim();
        const pendingState = this._hostedLoginState();
        const pendingExpiresAt = Number(this.settings?.hostedLoginExpiresAt);
        if (!callbackState) {
            new Notice(t(this, 'hosted_callback_invalid'), 8000);
            return { status: 'invalid' };
        }
        if (this._hostedAccessToken()) {
            return { status: 'connected' };
        }
        if (!pendingState) {
            new Notice(t(this, 'hosted_callback_expired'), 8000);
            return { status: 'expired' };
        }
        if (!Number.isFinite(pendingExpiresAt) || pendingExpiresAt <= 0 || pendingExpiresAt <= Date.now()) {
            new Notice(t(this, 'hosted_callback_expired'), 8000);
            return { status: 'expired' };
        }
        if (callbackState !== pendingState) {
            new Notice(t(this, 'hosted_callback_mismatch'), 8000);
            return { status: 'state_mismatch' };
        }
        if (this._hostedAuthCallbackInFlight) {
            new Notice(t(this, 'hosted_callback_in_progress'));
            return { status: 'in_progress' };
        }

        return this._hostedCompletePendingLogin(true);
    }

    async _hostedCompletePendingLogin(showFailureNotice = false) {
        if (this._hostedAuthCallbackInFlight) return { status: 'in_progress' };
        this._hostedAuthCallbackInFlight = true;
        try {
            await this.hostedExchangeLogin(false);
            if (typeof this.refreshHostedAccountSurfaces === 'function') {
                await this.refreshHostedAccountSurfaces();
            }
            if (typeof this.openSidebar === 'function') await this.openSidebar();
            new Notice(t(this, 'hosted_login_ok'));
            return { status: 'connected' };
        } catch (error) {
            if (Number(error?.status || 0) === 409) return { status: 'pending' };
            if (showFailureNotice) new Notice(t(this, 'hosted_callback_exchange_failed'), 8000);
            return { status: 'exchange_failed' };
        } finally {
            this._hostedAuthCallbackInFlight = false;
        }
    }

    async hostedResumePendingLogin() {
        if (this._hostedAccessToken()) return { status: 'connected' };
        if (!this._hostedLoginState()) return { status: 'idle' };
        const expiresAt = Number(this.settings?.hostedLoginExpiresAt || 0);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { status: 'expired' };
        const now = Date.now();
        if (now - Number(this._hostedAuthResumeAttemptAt || 0) < 1200) return { status: 'throttled' };
        this._hostedAuthResumeAttemptAt = now;
        return this._hostedCompletePendingLogin(false);
    }

    async hostedExchangeLogin(showNotice = true) {
        const state = this._hostedLoginState();
        if (!state) throw new Error(t(this, 'hosted_login_start_required'));
        const body = await this._hostedFetch('/auth/synapsehub/exchange', {
            method: 'POST',
            headers: _jsonHeaders(),
            body: JSON.stringify({ state }),
        });
        this._applyHostedSession(body);
        await this.saveSettings();
        await this.refreshHostedConfig(false);
        await this.refreshHostedUsage(false);
        if (showNotice) new Notice(t(this, 'hosted_login_ok'));
        return body;
    }

    async hostedRefreshStatus(showNotice = true) {
        if (this._hostedAccessToken()) return this.refreshHostedConfig(showNotice);
        if (this._hostedLoginState()) return this.hostedExchangeLogin(showNotice);
        throw new Error(t(this, 'hosted_login_start_required'));
    }

    async refreshHostedConfig(showNotice = true) {
        const token = this._hostedAccessToken();
        if (!token) throw new Error(t(this, 'hosted_login_required'));
        const config = await this._hostedFetch('/v1/client-config', {
            method: 'GET',
            headers: _jsonHeaders({ Authorization: `Bearer ${token}` }),
        });
        this.settings.hostedRuntimeConfig = this._sanitizeRuntimeConfig(config);
        this.hostedDisplayUser = this._sanitizeDisplayUser(config.display_user);
        this.settings.hostedUser = this._sanitizeHostedUser(config.user) || this.settings.hostedUser || null;
        this.settings.hostedSubscription = this._sanitizeHostedSubscription(config.subscription) || this.settings.hostedSubscription || null;
        if (this.settings.hostedRuntimeConfig?.auth?.account_center_url) {
            this.settings.hostedAccountCenterUrl = this.settings.hostedRuntimeConfig.auth.account_center_url;
        }
        this.settings.hostedLastSync = Date.now();
        this._setHostedMode();
        const safeConfig = this.settings.hostedRuntimeConfig || {};
        const embedding = safeConfig.features && safeConfig.features.embedding;
        const reasoning = safeConfig.features && safeConfig.features.reasoning;
        if (embedding && embedding.model) this.settings.embeddingModel = embedding.model;
        if (reasoning && reasoning.model) this.settings.llmModel = reasoning.model;
        await this.saveSettings();
        if (showNotice) new Notice(t(this, 'hosted_config_refreshed'));
        return config;
    }

    async refreshHostedUsage(showNotice = false) {
        const token = this._hostedAccessToken();
        if (!token) throw new Error(t(this, 'hosted_login_required'));
        const usage = await this._hostedFetch('/v1/usage', {
            method: 'GET',
            headers: _jsonHeaders({ Authorization: `Bearer ${token}` }),
        });
        this.hostedUsageSummary = this._sanitizeHostedUsage(usage);
        if (showNotice) new Notice(t(this, 'hosted_usage_refreshed'));
        return this.hostedUsageSummary;
    }

    async hostedRefreshEntitlements(showNotice = true) {
        const token = this._hostedAccessToken();
        if (!token) throw new Error(t(this, 'hosted_login_required'));
        const summary = await this._hostedFetch('/v1/billing/entitlements', {
            method: 'GET',
            headers: _jsonHeaders({ Authorization: `Bearer ${token}` }),
        });
        if (showNotice) new Notice(t(this, summary.active ? 'hosted_membership_active' : 'hosted_membership_refreshed'));
        return summary;
    }

    async _hostedPollBillingActivation() {
        const configuredSeconds = Number(this.settings?.hostedRuntimeConfig?.billing?.activating_poll_seconds || 45);
        const boundedSeconds = Math.min(120, Math.max(1, Number.isFinite(configuredSeconds) ? configuredSeconds : 45));
        const attempts = Math.max(1, Math.ceil((boundedSeconds * 1000) / 2500));
        let summary = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            summary = await this.hostedRefreshEntitlements(false);
            if (summary?.active === true) return summary;
            if (attempt + 1 < attempts) await this._hostedSleep(2500);
        }
        return summary || { active: false };
    }

    async _hostedSleep(milliseconds) {
        await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    async _hostedBillingRedirect(action, path, body = null) {
        const token = this._hostedAccessToken();
        if (!token) throw new Error(t(this, 'hosted_login_required'));
        const pending = this.settings.hostedBillingIdempotency || {};
        const idempotencyKey = String(pending[action] || `ust_${action}_${nodeCrypto.randomBytes(18).toString('hex')}`);
        this.settings.hostedBillingIdempotency = { ...pending, [action]: idempotencyKey };
        await this.saveSettings();
        const result = await this._hostedFetch(path, {
            method: 'POST',
            headers: _jsonHeaders({
                Authorization: `Bearer ${token}`,
                'Idempotency-Key': idempotencyKey,
            }),
            body: body ? JSON.stringify(body) : undefined,
        });
        const redirectUrl = String(result.redirect_url || '');
        if (!redirectUrl.startsWith('https://')) throw new Error(t(this, 'hosted_billing_redirect_invalid'));
        delete this.settings.hostedBillingIdempotency[action];
        await this.saveSettings();
        this._openExternalUrl(redirectUrl);
        return result;
    }

    async hostedStartCheckout(showNotice = true) {
        const billing = this.settings?.hostedRuntimeConfig?.billing || {};
        if (!billing.checkout_enabled) throw new Error(t(this, 'hosted_checkout_disabled'));
        const result = await this._hostedBillingRedirect('checkout', '/v1/billing/checkout-sessions', {
            plan_key: billing.plan_key || 'pro_monthly',
        });
        if (showNotice) new Notice(t(this, 'hosted_checkout_started'), 7000);
        return result;
    }

    async hostedOpenBillingPortal(showNotice = true) {
        const result = await this._hostedBillingRedirect('portal', '/v1/billing/customer-portal-sessions');
        if (showNotice) new Notice(t(this, 'hosted_portal_started'), 7000);
        return result;
    }

    openHostedAccountCenter(showNotice = true) {
        this._openExternalUrl(this._hostedAccountCenterUrl());
        if (showNotice) new Notice(t(this, 'hosted_account_center_notice'), 6000);
    }

    openHostedProfile(showNotice = true) {
        const url = this.settings?.hostedRuntimeConfig?.auth?.profile_settings_url || this._hostedAccountCenterUrl();
        this._openExternalUrl(url);
        if (showNotice) new Notice(t(this, 'hosted_profile_notice'), 6000);
    }

    openHostedAccountSecurity(showNotice = true) {
        const url = this.settings?.hostedRuntimeConfig?.auth?.account_security_url || this._hostedAccountCenterUrl();
        this._openExternalUrl(url);
        if (showNotice) new Notice(t(this, 'hosted_account_security_notice'), 6000);
    }

    openHostedDevices(showNotice = true) {
        const url = this.settings?.hostedRuntimeConfig?.auth?.devices_url || this._hostedAccountCenterUrl();
        this._openExternalUrl(url);
        if (showNotice) new Notice(t(this, 'hosted_devices_notice'), 6000);
    }

    async _revokeHostedServerSession() {
        const token = this._hostedAccessToken();
        if (!token) return;
        try {
            await this._hostedFetch('/auth/logout', {
                method: 'POST',
                headers: _jsonHeaders({ Authorization: `Bearer ${token}` }),
            });
        } catch (error) {
            recordBackgroundError(this, 'logout-hosted-session', error);
        }
    }

    async hostedGlobalLogout(showNotice = true, confirmed = false) {
        if (!confirmed) {
            const accepted = await new Promise((resolve) => {
                new HostedGlobalLogoutModal(this.app, this, resolve).open();
            });
            if (!accepted) return false;
        }
        const token = this._hostedAccessToken();
        let continueUrl = this._hostedAuthUrl('bondie_global_logout_endpoint', '/auth/global-logout');
        if (token) {
            const result = await this._hostedFetch('/auth/global-logout', {
                method: 'POST',
                headers: _jsonHeaders({ Authorization: `Bearer ${token}` }),
            });
            continueUrl = String(result.continue_logout_url || continueUrl);
        }
        this._clearHostedLocalSession();
        await this.saveSettings();
        this._openExternalUrl(continueUrl);
        if (showNotice) new Notice(t(this, 'hosted_global_logout_started'), 7000);
        return true;
    }

    async hostedLogout(showNotice = true) {
        await this._revokeHostedServerSession();
        this._clearHostedLocalSession();
        await this.saveSettings();
        if (showNotice) new Notice(t(this, 'hosted_logged_out'));
    }
}

module.exports = HostedClientMethods.prototype;
