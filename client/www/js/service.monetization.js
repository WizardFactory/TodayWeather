angular.module('service.monetization', [])
    .factory('Monetization', function($window) {
        var obj = {}, enabled = false, initialized = false, lastScreen, pendingScreen, collectionRevision = 0;
        var policy = {enabled: true, delaySeconds: 0}, configStarted = false, configReady = false, configRun;
        var listeners = [];
        var screens = ['start', 'guide', 'units', 'setting-radio', 'setting-push', 'kma-special',
            'nation', 'nation-air', 'tab', 'tab.search', 'tab.air', 'tab.forecast', 'tab.dailyforecast', 'tab.weather'];
        var schema = {
            weather_fetch: {outcome: ['success', 'network_error', 'invalid_input'], duration_ms: 'duration'},
            weather_load: {outcome: ['success', 'network_error', 'invalid_response'], duration_ms: 'duration'},
            favorite_change: {action: ['add', 'remove']},
            location_permission: {outcome: ['granted', 'denied', 'unknown']},
            ad_lifecycle: {action: ['request', 'loaded', 'failed', 'impression', 'show', 'hide', 'consent_failed'], ad_format: ['banner']},
            ad_policy_exposure: {delay_seconds: 'delay'}
        };

        // No raw error strings, URLs, identifiers or provider payloads in telemetry/logs.
        function log(operation, result) {
            $window.console.info({component: 'monetization', operation: operation,
                run_id: operation === 'remote_config' ? configRun : operation === 'collection' ? 'consent-' + collectionRevision : undefined,
                action: result === 'applied' ? 'use_validated_policy' : 'retain_current_state', result: result});
        }
        function emit(name, params) {
            var sdk = $window.FirebasexAnalytics;
            if (!enabled || !sdk) { return false; }
            params.measurement_version = 1;
            params.traffic_type = clientConfig.debug || !clientConfig.releaseAds ? 'development' : 'production';
            try {
                sdk.logEvent(name, params, function() {}, function() { log('analytics', 'bridge_error'); });
                return true;
            } catch (e) { log('analytics', 'bridge_error'); return false; }
        }
        var consentKey = 'twAnalyticsConsentV1', choice = false;
        try { choice = $window.localStorage.getItem(consentKey) === 'true'; }
        catch (e) { log('collection', 'storage_unavailable'); }
        obj.getCollectionChoice = function() { return choice; };
        function applyCollection(value, callback) {
            // Close the JS gate synchronously, including while native callbacks are pending.
            enabled = false;
            var revision = ++collectionRevision;
            lastScreen = undefined;
            var sdk = $window.FirebasexAnalytics;
            function failed() {
                if (revision !== collectionRevision) { return; }
                choice = false;
                try { $window.localStorage.setItem(consentKey, 'false'); } catch (e) {}
                log('collection', 'write_failed');
                // A partially successful grant must not leave automatic native collection on.
                try { sdk.setAnalyticsCollectionEnabled(false, function() {}, function() {}); } catch (e) {}
                if (callback) { callback(false); }
            }
            if (!sdk || !sdk.setAnalyticsConsentMode) { failed(); return; }
            try {
                sdk.setAnalyticsCollectionEnabled(false, function() {
                    if (revision !== collectionRevision) { return; }
                    sdk.setAnalyticsConsentMode({
                        ANALYTICS_STORAGE: value ? 'GRANTED' : 'DENIED',
                        AD_STORAGE: 'DENIED', AD_USER_DATA: 'DENIED', AD_PERSONALIZATION: 'DENIED'
                    }, function() {
                        if (revision !== collectionRevision) { return; }
                        if (!value) { log('collection', 'disabled'); if (callback) { callback(true); } return; }
                        sdk.setAnalyticsCollectionEnabled(true, function() {
                            if (revision !== collectionRevision) {
                                // A delayed grant acknowledgement must not undo a later withdrawal.
                                if (!choice) { sdk.setAnalyticsCollectionEnabled(false, function() {}, function() {}); }
                                return;
                            }
                            enabled = true; log('collection', 'enabled');
                            if (pendingScreen) { obj.screen(pendingScreen); }
                            if (callback) { callback(true); }
                        }, failed);
                    }, failed);
                }, failed);
            } catch (e) { failed(); }
        }
        obj.init = function() {
            if (initialized || !$window.FirebasexAnalytics) { return; }
            initialized = true;
            if (!choice) { pendingScreen = undefined; }
            applyCollection(choice);
        };
        obj.setCollectionEnabled = function(value, callback) {
            if (typeof value !== 'boolean') { return; }
            enabled = false; pendingScreen = undefined;
            choice = value;
            try { $window.localStorage.setItem(consentKey, String(value)); }
            catch (e) {
                choice = false; applyCollection(false);
                log('collection', 'storage_write_failed'); if (callback) { callback(false); } return;
            }
            applyCollection(value, callback);
        };
        obj.track = function(name, params) {
            if (!Object.prototype.hasOwnProperty.call(schema, name)) { return false; }
            var fields = schema[name], safe = {}, valid = true;
            if (!fields || !params) { return false; }
            Object.keys(fields).forEach(function(key) {
                var value = params[key], rule = fields[key];
                if (Array.isArray(rule)) {
                    if (rule.indexOf(value) === -1) { valid = false; } else { safe[key] = value; }
                } else if (typeof value !== 'number' || !isFinite(value) || value < 0 ||
                    value > (rule === 'delay' ? 120 : 600000) || Math.floor(value) !== value) {
                    valid = false;
                } else { safe[key] = value; }
            });
            return valid && emit(name, safe);
        };
        obj.screen = function(name) {
            // Keep only the latest fixed route after an explicit choice; never backfill pre-consent use.
            if (!choice) { pendingScreen = undefined; return; }
            if (screens.indexOf(name) === -1 || name === lastScreen) { return; }
            pendingScreen = name; // Only a fixed route name, never event payloads, survives deviceready.
            if (emit('screen_view', {screen_name: name, screen_class: 'Cordova'})) { lastScreen = name; pendingScreen = undefined; }
        };
        obj.bannerPolicy = function() { return {enabled: policy.enabled, delaySeconds: policy.delaySeconds}; };
        obj.isBannerPolicyReady = function() { return configReady; };
        function notifyPolicy() { listeners.forEach(function(fn) { fn(obj.bannerPolicy()); }); }
        obj.loadConfig = function(onChange) {
            listeners.push(onChange);
            if (configStarted) { onChange(obj.bannerPolicy()); return; }
            configReady = !$window.FirebasexConfig;
            onChange(obj.bannerPolicy());
            if (configReady) { return; }
            configStarted = true;
            configRun = 'rc-' + Date.now(); // Operation correlation, never an installation/user identifier.
            var sdk = $window.FirebasexConfig, closed = false;
            var timeout = $window.setTimeout(function() { finish('timeout'); }, 12000);
            function finish(result) {
                if (closed) { return; }
                closed = true; configReady = true;
                $window.clearTimeout(timeout); log('remote_config', result);
                notifyPolicy(); // Release first-show/exposure gate even on bounded fallback.
            }
            function apply(values) {
                if (closed) { return; }
                if (!values || typeof values !== 'object') { log('remote_config', 'invalid_values'); return; }
                var flag = values.tw_banner_enabled, delay = values.tw_banner_delay_seconds;
                // Reject the entire pair rather than applying a partially valid experiment.
                if ((flag !== 'true' && flag !== 'false') || !/^\d+$/.test(delay) || Number(delay) > 120) {
                    log('remote_config', 'invalid_values'); return;
                }
                policy = {enabled: flag === 'true', delaySeconds: Number(delay)};
                notifyPolicy();
            }
            function fail() { finish('bridge_or_fetch_failed'); }
            try {
                sdk.setDefaults({tw_banner_enabled: true, tw_banner_delay_seconds: 0}, function() {
                    if (closed) { return; }
                    sdk.setConfigSettings(10, 3600, function() {
                        if (closed) { return; }
                        // Read activated cache first so an offline restart keeps the kill switch.
                        sdk.getAll(function(values) {
                            if (closed) { return; }
                            apply(values);
                            sdk.fetchAndActivate(function() {
                                if (closed) { return; }
                                sdk.getAll(function(fresh) { apply(fresh); finish('applied'); }, fail);
                            }, fail);
                        }, fail);
                    }, fail);
                }, fail);
            } catch (e) { fail(); }
        };
        return obj;
    });
