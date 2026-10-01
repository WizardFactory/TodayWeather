angular.module('service.monetization', [])
    .factory('Monetization', function($window) {
        var obj = {}, enabled = false, initialized = false, lastScreen, pendingScreen, collectionRevision = 0, requestedCollection;
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
                run_id: operation === 'remote_config' ? configRun : undefined,
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
        obj.init = function() {
            if (initialized) { return; }
            var sdk = $window.FirebasexAnalytics;
            if (!sdk) { return; } // Can be called again at deviceready.
            initialized = true;
            // Firebase SDK enforces persisted collection/consent itself. FirebaseX 2.0.2's
            // query reads an unset wrapper preference as false even when SDK defaults are on.
            // Never force collection on to work around it: an existing opt-out must survive.
            enabled = requestedCollection === undefined;
            if (requestedCollection !== undefined) { writeCollection(requestedCollection, collectionRevision); }
            else if (pendingScreen) { obj.screen(pendingScreen); }
        };
        function writeCollection(value, revision) {
            var sdk = $window.FirebasexAnalytics;
            if (!sdk) { return; }
            try {
                sdk.setAnalyticsCollectionEnabled(value, function() {
                    if (revision !== collectionRevision) { return; }
                    enabled = value;
                    if (enabled && pendingScreen) { obj.screen(pendingScreen); }
                }, function() { log('collection', 'write_failed'); });
            } catch (e) { log('collection', 'write_failed'); }
        }
        obj.setCollectionEnabled = function(value) {
            if (typeof value !== 'boolean') { return; }
            requestedCollection = value;
            enabled = false; // Close immediately while a native write is pending or unavailable.
            var revision = ++collectionRevision;
            lastScreen = undefined;
            pendingScreen = undefined;
            writeCollection(value, revision);
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
