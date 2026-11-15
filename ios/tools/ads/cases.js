// The Cordova iOS app's ads and analytics decisions, run in the macOS JavaScriptCore shell (the engine of the
// Cordova iOS app) by generate.py:
//   jsc cases.js -- <service.monetization.js> <service.admobemi.js> <cases.json>
// It prints one JSON document. Only the services are real: Firebase, the AdMob plugin, the document's events, the
// timers and the console are recorders or fakes that answer at once.
//   remoteConfig: Monetization.loadConfig with Remote Config answering the given pair (activated values and fetch);
//     the policy the listener got last, and whether the pair was rejected (`invalid_values`).
//   track: Monetization.track after an opt-in, with the release or the test-unit configuration: the result and the
//     parameters the SDK received.
//   screens: Monetization.screen in sequence after an opt-in: the screen_view parameters sent.
//   trackingStatus: Monetization.setAdTrackingStatus before and after an opt-in: the att_status values set.
//   requestPolicy: the adapter's ready path on iOS (initialize answered, SDK started) with the plugin's
//     twAdPrivacyState answering the given state: the console line and the status handed to measurement.
(function (args) {
    'use strict';
    var monetizationSource = readFile(args[0]);
    var adapterSource = readFile(args[1]);
    var cases = JSON.parse(readFile(args[2]));
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};

    // angular.module(...).factory(name, fn) of one service file; the factory function is returned.
    function factoryOf(source, globals) {
        var factory;
        var angular = {module: function () { return {factory: function (_, fn) { factory = fn; }}; }};
        var names = ['angular'].concat(Object.keys(globals));
        var values = [angular].concat(names.slice(1).map(function (k) { return globals[k]; }));
        Function.apply(null, names.concat([source])).apply(null, values);
        return factory;
    }

    // Timers that never fire: every answer below is synchronous, and the services' timeouts must not run.
    function timers() {
        return {setTimeout: function () { return 1; }, clearTimeout: function () {}};
    }

    function decode(value) {
        if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '$number')) {
            return Number(value.$number);
        }
        return value;
    }

    function storage() {
        var items = {};
        return {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(items, k) ? items[k] : null; },
            setItem: function (k, v) { items[k] = String(v); },
            removeItem: function (k) { delete items[k]; }
        };
    }

    // An Analytics bridge whose calls succeed at once; events and user properties are recorded.
    function analyticsBridge(record) {
        function ok(fn) { return function (value, success) { success(); }; }
        return {
            setAnalyticsCollectionEnabled: ok(), setAnalyticsConsentMode: ok(),
            isAnalyticsCollectionEnabled: function (success) { success(true); },
            logEvent: function (name, params, success) { record.events.push({name: name, params: params}); success(); },
            setUserProperty: function (name, value, success) { record.properties.push({name: name, value: value}); success(); }
        };
    }

    function monetization(window, clientConfig) {
        var t = timers();
        window.console = quiet;
        window.setTimeout = t.setTimeout;
        window.clearTimeout = t.clearTimeout;
        window.localStorage = window.localStorage || storage();
        return factoryOf(monetizationSource, {clientConfig: clientConfig})(window);
    }

    function optedIn(clientConfig, record) {
        var window = {FirebasexAnalytics: analyticsBridge(record)};
        var m = monetization(window, clientConfig);
        m.init();
        m.storageReady(true);
        var answered;
        m.setCollectionEnabled(true, function (ok) { answered = ok; });
        if (answered !== true) { throw new Error('opt-in did not complete'); }
        return m;
    }

    var out = {remoteConfig: [], track: [], screens: [], trackingStatus: [], requestPolicy: []};

    cases.remoteConfig.forEach(function (values) {
        var logs = [];
        var window = {FirebasexConfig: {
            setDefaults: function (d, success) { success(); },
            setConfigSettings: function (a, b, success) { success(); },
            getAll: function (success) { success(values); },
            fetchAndActivate: function (success) { success(); }
        }};
        var m = monetization(window, {});
        window.console = {info: function (o) { logs.push(o); }, log: function () {}, warn: function () {}};
        var last;
        m.loadConfig(function (policy) { last = policy; });
        out.remoteConfig.push({
            values: values,
            policy: last,
            ready: m.isBannerPolicyReady(),
            rejected: logs.some(function (o) { return o.operation === 'remote_config' && o.result === 'invalid_values'; })
        });
    });

    cases.track.forEach(function (c) {
        var record = {events: [], properties: []};
        var config = c.release ? {debug: false, releaseAds: true} : {debug: false, releaseAds: false};
        var m = optedIn(config, record);
        var params = {};
        Object.keys(c.params).forEach(function (k) { params[k] = decode(c.params[k]); });
        var result = m.track(c.name, params);
        var sent = record.events.filter(function (e) { return e.name === c.name; });
        out.track.push({name: c.name, params: c.params, release: !!c.release, result: result,
            sent: sent.length ? sent[0].params : null});
    });

    cases.screens.forEach(function (sequence) {
        var record = {events: [], properties: []};
        var m = optedIn({debug: false, releaseAds: true}, record);
        record.events.length = 0;
        sequence.forEach(function (name) { m.screen(name); });
        out.screens.push({calls: sequence, sent: record.events.map(function (e) { return e.params; })});
    });

    cases.trackingStatus.forEach(function (c) {
        var record = {events: [], properties: []};
        var window = {FirebasexAnalytics: analyticsBridge(record)};
        var m = monetization(window, {debug: false, releaseAds: true});
        m.init();
        m.storageReady(true);
        c.before.forEach(function (s) { m.setAdTrackingStatus(s); });
        m.setCollectionEnabled(true, function () {});
        c.after.forEach(function (s) { m.setAdTrackingStatus(s); });
        out.trackingStatus.push({before: c.before, after: c.after, set: record.properties});
    });

    cases.requestPolicy.forEach(function (c) {
        var lines = [], statuses = [], listeners = {}, ready = 0;
        var document = {
            addEventListener: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
            removeEventListener: function (name, fn) {
                listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; });
            }
        };
        function fire(name) { (listeners[name] || []).slice().forEach(function (fn) { fn({}); }); }
        var plugin = {initialize: function (options, success) { success(); }};
        var cordova = {
            plugins: {emiAdmobPlugin: plugin},
            exec: function (success, error, service, action) {
                if (service !== 'emiAdmobPlugin' || action !== 'twAdPrivacyState') { throw new Error('unexpected exec'); }
                if (c.state === null) { error('no action'); } else { success(c.state); }
            }
        };
        var t = timers();
        var console = {log: function (text) { lines.push(text); }, info: function () {}, warn: function () {}};
        var Monetization = {track: function () {}, setAdTrackingStatus: function (s) { statuses.push(s); }};
        var window = {cordova: cordova, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout};
        var adapter = factoryOf(adapterSource, {
            window: window, cordova: cordova, document: document, console: console, setTimeout: t.setTimeout,
            ionic: {Platform: {isIOS: function () { return true; }}}, clientConfig: {debug: false, releaseAds: true}
        })({}, Monetization);
        adapter.init({bannerAdUnit: 'unit'}, function () { ready++; }, function () {});
        fire('on.sdkInitialization');
        out.requestPolicy.push({state: c.state, lines: lines.filter(function (l) { return /request_policy/.test(l); }),
            status: statuses, ready: ready});
    });

    print(JSON.stringify(out));
})(arguments);
