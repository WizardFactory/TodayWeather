// The fallback Cordova build's start (TwStorage.init with _handBack, client/www/js/service.storage.js) over every prefix of
// the native hand-back's suite writes (IN-17, #2966), run in the macOS JavaScriptCore shell by generate.py:
//   jsc reader.js -- <service.storage.js> <apppreferences.js>
// It prints one JSON document. The suite is cordova-plugin-app-preferences on iOS: its JavaScript (apppreferences.js) over a
// model of AppPreferences.m (`fetch` answers an NSString as "\"" + the text with \ and " escaped + "\"", which the
// JavaScript parses back; an NSNumber as its text; NSData as its UTF-8 text; nothing for a missing key; `store` parses
// the JSON the JavaScript sends and keeps a string as an NSString, a number as an NSNumber, a boolean as a boolean, and
// anything else as UTF-8 NSData; the callbacks come later, as over the Cordova bridge). Only TwStorage and the plugin's
// JavaScript are real; Monetization, Util, $q and the timers are recorders.
//
// The write order is the contract of HandBackWriter (ios/Core/Sources/TWStorage/HandBackWriter.swift): the next
// generation's marker incomplete, each owned key whose stored value is not its text (set as a string, or removed), the
// marker complete; nothing when the suite holds every text under a complete native marker; the marker alone when no key
// differs. For each case the start runs over the suite before the writes and after each of them, and again for a write
// interrupted after each step and done again by the next process. Each start is classified:
//   S  the WebView state as it was (stale), W  the new hand-back whole, P  the previous native hand-back whole,
//   H  the start waits (retries), M  anything else (a mix); by the state keys (all owned keys but the consent), with
// whether the stored choice is trusted (storageReady), the claim's generation and the consent in WebView storage.
(function (args) {
    'use strict';
    var storageSource = readFile(args[0]);
    var pluginSource = readFile(args[1]);
    var KEYS = ['cities', 'cityIndex', 'cityList', 'units', 'settingsInfo', 'pushData2', 'pushData', 'expandShortChart',
        'startVersion', 'appVersion', 'disableUpdateInfo', 'twAnalyticsConsentV1'];
    var MARKER = '_twHandBack';
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var clone = function (v) { return JSON.parse(JSON.stringify(v)); };

    function marker(generation, writer, complete) {
        return JSON.stringify({schema: 1, generation: generation, writer: writer, complete: complete, keys: KEYS});
    }

    // The suite values as AppPreferences.m keeps them: {string: text} (NSString), {number: text}, {bool: b}, {data: text}.
    function str(text) { return {string: text}; }

    // ---- The states ----
    var city = function (o) { return JSON.stringify(o); };
    var cache = {currentWeather: {t1h: 3, sky: 1}, timeTable: [], timeChart: [], dayTable: [], dayChart: []};
    // A 1.1.1 user's WebView storage (stale after the update): three places, London selected with an alarm.
    var STALE = {
        cities: JSON.stringify([
            Object.assign({currentPosition: true, address: null, location: null}, cache, {disable: true, photo: null, loadTime: null}),
            Object.assign({name: '명동', address: '대한민국 서울특별시 중구 명동', country: 'KR', location: {lat: 37.56, long: 126.98},
                currentPosition: false, source: 'KMA'}, cache, {disable: false, photo: null, loadTime: '2026-11-07T16:09:45.810Z'}),
            Object.assign({name: 'London', address: 'United Kingdom London', country: 'GB', location: {lat: 51.51, long: -0.13},
                currentPosition: false}, cache, {disable: false, photo: null, loadTime: null})]),
        cityIndex: '2',
        cityList: JSON.stringify({cityList: [{name: '명동', currentPosition: false, address: '대한민국 서울특별시 중구 명동',
            location: {lat: 37.56, long: 126.98}, country: 'KR', index: 1}, {name: 'London', currentPosition: false,
            address: 'United Kingdom London', location: {lat: 51.51, long: -0.13}, country: 'GB', index: 2}]}),
        units: '{"temperatureUnit":"F","windSpeedUnit":"km/h","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airnow"}',
        settingsInfo: '{"startupPage":"1","refreshInterval":"30","theme":"dark"}',
        pushData2: JSON.stringify({registrationId: null, type: 'ios', category: '', fcmToken: 'token-a', pushList: [
            {cityIndex: 2, id: 2, time: '2026-11-07T21:00:00.000Z', dayOfWeek: [true, true, true, true, true, true, true],
                enable: true, category: 'alarm', name: 'London'}]}),
        pushData: '{"alarmList":[{"cityIndex":2}]}',
        expandShortChart: 'true', startVersion: '"1.1.0"', appVersion: '"1.1.1"', disableUpdateInfo: 'true',
        twAnalyticsConsentV1: 'true'
    };
    // What 1.1.1 mirrored into the suite: every TwStorage.set key (the consent stayed in WebView storage).
    var MIRROR = {};
    KEYS.forEach(function (k) { if (k !== 'twAnalyticsConsentV1' && STALE[k] !== undefined) { MIRROR[k] = str(STALE[k]); } });

    function nativeTexts(o) {
        var t = {};
        KEYS.forEach(function (k) { t[k] = o[k] === undefined ? null : o[k]; });
        return t;
    }
    var placeholder = Object.assign({currentPosition: true, address: null, location: null, disable: true, photo: null},
        {currentWeather: null, timeTable: null, timeChart: null, dayTable: null, dayChart: null});
    var myeongdong = {name: '명동', address: '대한민국 서울특별시 중구 명동', country: 'KR', location: {lat: 37.56, long: 126.98},
        currentPosition: false, source: 'KMA', disable: false, photo: null, currentWeather: null, timeTable: null,
        timeChart: null, dayTable: null, dayChart: null};
    // An earlier hand-back: London deleted in the native app with its alarm; analytics withdrawn.
    var NATIVE_1 = nativeTexts({
        cities: JSON.stringify([placeholder, myeongdong]), cityIndex: '1',
        cityList: JSON.stringify({cityList: [{name: '명동', currentPosition: false, address: '대한민국 서울특별시 중구 명동',
            location: {lat: 37.56, long: 126.98}, country: 'KR', index: 1}]}),
        units: STALE.units, settingsInfo: STALE.settingsInfo,
        pushData2: JSON.stringify({registrationId: null, type: 'ios', category: '', fcmToken: 'token-a', pushList: []}),
        expandShortChart: 'true', startVersion: '"1.1.0"', appVersion: '"1.1.1"', twAnalyticsConsentV1: 'false'
    });
    // The new state: a place whose name needs the plugin's escaping added and selected, with an alarm; °C, light;
    // analytics granted.
    var odd = {name: 'Q"uote\\d 부산 ☂  ', address: '대한민국 부산광역시', country: 'KR', location: {lat: 35.18, long: 129.08},
        currentPosition: false, source: 'KMA', disable: false, photo: null, currentWeather: null, timeTable: null,
        timeChart: null, dayTable: null, dayChart: null};
    var NATIVE_2 = nativeTexts({
        cities: JSON.stringify([placeholder, myeongdong, odd]), cityIndex: '2',
        cityList: JSON.stringify({cityList: [{name: '명동', currentPosition: false, address: '대한민국 서울특별시 중구 명동',
            location: {lat: 37.56, long: 126.98}, country: 'KR', index: 1}, {name: odd.name, currentPosition: false,
            address: odd.address, location: odd.location, country: 'KR', index: 2}]}),
        units: '{"temperatureUnit":"C","windSpeedUnit":"km/h","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airnow"}',
        settingsInfo: '{"startupPage":"1","refreshInterval":"30","theme":"light"}',
        pushData2: JSON.stringify({registrationId: null, type: 'ios', category: '', fcmToken: 'token-a', pushList: [
            {cityIndex: 2, id: 2, time: '2026-11-08T00:10:00.000Z', dayOfWeek: [false, true, true, true, true, true, false],
                enable: true, category: 'alarm', name: odd.name}]}),
        expandShortChart: 'true', startVersion: '"1.1.0"', appVersion: '"1.1.1"', twAnalyticsConsentV1: 'true'
    });
    function suiteOf(texts, markerText) {
        var s = {};
        KEYS.forEach(function (k) { if (texts[k] !== null) { s[k] = str(texts[k]); } });
        if (markerText) { s[MARKER] = str(markerText); }
        return s;
    }
    var themeOnly = clone(NATIVE_2);
    themeOnly.settingsInfo = '{"startupPage":"1","refreshInterval":"30","theme":"dark"}';
    var applied1 = {};
    KEYS.forEach(function (k) { if (NATIVE_1[k] !== null) { applied1[k] = NATIVE_1[k]; } });
    applied1.twHandBackApplied = '3';
    var typed = suiteOf(NATIVE_2, marker(9, 'native', true));
    typed.cityIndex = {number: '2'};
    typed.expandShortChart = {bool: true};
    typed.units = {data: NATIVE_2.units};

    var CASES = [
        // The first native start after the update from 1.1.1 (no marker; the suite holds 1.1.1's mirror).
        {name: 'first hand-back over the 1.1.1 suite', local: STALE, suite: MIRROR, texts: NATIVE_2},
        // A later hand-back while an earlier one waits in the suite (the fallback build not installed yet).
        {name: 'over an earlier hand-back', local: STALE, suite: suiteOf(NATIVE_1, marker(3, 'native', true)), texts: NATIVE_2},
        // After a fallback build applied hand-back 3, claimed the state (4) and the native app adopted it.
        {name: 'over a claim the native app adopted', local: applied1, suite: suiteOf(NATIVE_1, marker(4, 'cordova', true)),
            texts: NATIVE_2},
        // A change of one key (the theme).
        {name: 'one key changed', local: STALE, suite: suiteOf(themeOnly, marker(6, 'native', true)), texts: NATIVE_2},
        // The suite holds the state already.
        {name: 'unchanged', local: STALE, suite: suiteOf(NATIVE_2, marker(7, 'native', true)), texts: NATIVE_2},
        // A claim over the same texts: only the marker.
        {name: 'a claim over the same texts', local: STALE, suite: suiteOf(NATIVE_2, marker(8, 'cordova', true)), texts: NATIVE_2},
        // Values the plugin stored with other types (NSNumber, boolean, NSData) are written again as strings.
        {name: 'values of other types', local: STALE, suite: typed, texts: NATIVE_2},
        // An empty WebView storage (an update from 1.0.10, whose state was only in the suite): the existing restore
        // (`_appPref2localStorage`) copies the suite under any marker the build cannot use, so a write interrupted
        // between two keys can be restored half (M). Recorded, not prevented: see ios/README.md.
        {name: 'empty WebView storage', local: {}, suite: suiteOf(NATIVE_1, marker(3, 'native', true)), texts: NATIVE_2,
            emptyWebView: true}
    ];

    // ---- The hand-back writer's contract ----
    function parseMarker(v) {
        if (!v || v.string === undefined) { return null; }
        try {
            var m = JSON.parse(v.string);
            if (m && typeof m.schema === 'number' && typeof m.generation === 'number' && typeof m.writer === 'string' &&
                typeof m.complete === 'boolean' && Array.isArray(m.keys)) { return m; }
        } catch (e) { }
        return null;
    }
    function writes(suite, texts) {
        var current = parseMarker(suite[MARKER]);
        var changed = KEYS.filter(function (k) {
            var v = suite[k];
            return texts[k] === null ? v !== undefined : !(v && v.string === texts[k]);
        }).map(function (k) { return [k, texts[k]]; });
        if (!changed.length && current && current.schema === 1 && current.complete && current.writer === 'native') { return []; }
        var generation = (current ? current.generation : 0) + 1;
        var done = [MARKER, marker(generation, 'native', true)];
        if (!changed.length) { return [done]; }
        return [[MARKER, marker(generation, 'native', false)]].concat(changed, [done]);
    }
    function apply(suite, ops) {
        var s = clone(suite);
        ops.forEach(function (op) { if (op[1] === null) { delete s[op[0]]; } else { s[op[0]] = str(op[1]); } });
        return s;
    }

    // ---- The plugin and the start ----
    function plugin(values) {
        var later = [];
        function nativeExec(ok, fail, service, action, argv) {
            var a = argv[0];
            later.push(function () {
                if (action === 'fetch') {
                    var v = values[a.key], out = null;
                    if (v && v.string !== undefined) {
                        out = '"' + v.string.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
                    } else if (v && v.number !== undefined) {
                        out = v.number;
                    } else if (v && v.bool !== undefined) {
                        out = v.bool ? 'true' : 'false';
                    } else if (v && v.data !== undefined) {
                        out = v.data;
                    }
                    ok(out);
                } else if (action === 'store') {
                    var parsed = JSON.parse(a.value);
                    if (a.type === 'string' && typeof parsed === 'string') { values[a.key] = {string: parsed}; }
                    else if (a.type === 'number' && typeof parsed === 'number') { values[a.key] = {number: String(parsed)}; }
                    else if (a.type === 'boolean') { values[a.key] = {bool: parsed}; }
                    else { values[a.key] = {data: a.value}; }
                    if (ok) { ok(); }
                } else if (action === 'remove') {
                    delete values[a.key];
                    if (ok) { ok(); }
                }
            });
        }
        var module = {};
        Function('module', 'cordova', 'require', 'console', pluginSource)(module, {exec: nativeExec},
            function () { throw new Error('no platform'); }, quiet);
        return {prefs: module.exports, later: later};
    }

    function start(local, suite) {
        var values = clone(suite);
        var p = plugin(values);
        var map = clone(local);
        var localStorage = {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
            setItem: function (k, v) { map[k] = String(v); },
            removeItem: function (k) { delete map[k]; }
        };
        var timers = [], ready = [], factory;
        var angular = {module: function () { return {factory: function (_, fn) { factory = fn; }}; }};
        Function('angular', 'clientConfig', 'console', 'window', 'plugins', 'localStorage', 'ionic', 'setTimeout', storageSource)(
            angular, {package: 'todayWeather'}, quiet, {plugins: {appPreferences: p.prefs}}, {appPreferences: p.prefs},
            localStorage, {Platform: {isAndroid: function () { return false; }}}, function (fn, ms) { timers.push(ms); });
        var $q = {defer: function () { var d = {}; d.promise = new Promise(function (a, b) { d.resolve = a; d.reject = b; }); return d; }};
        var Util = {ga: {trackEvent: function () {}, trackException: function () {}}};
        var Monetization = {storageReady: function (trusted) { ready.push(trusted); }};
        var settled = false;
        factory({}, $q, Util, Monetization).init().then(function () { settled = true; });
        for (var i = 0; i < 200 && !settled; i++) {
            drainMicrotasks();
            if (p.later.length) { p.later.shift()(); } else if (!settled) { drainMicrotasks(); if (!p.later.length) { break; } }
        }
        drainMicrotasks();
        while (p.later.length) { p.later.shift()(); drainMicrotasks(); }
        var claim = parseMarker(values[MARKER]);
        return {settled: settled, local: map, trusted: ready.length ? ready[0] : null, retries: timers.length,
            claim: claim && claim.writer === 'cordova' ? claim.generation : null};
    }

    // The state keys: the classification leaves the consent out, which the restore of an empty WebView storage never
    // copies (`_appPref2localStorage`); each outcome reports it separately.
    var STATE_KEYS = KEYS.filter(function (k) { return k !== 'twAnalyticsConsentV1'; });
    function owned(map) {
        var o = {};
        STATE_KEYS.forEach(function (k) { o[k] = Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; });
        return o;
    }
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

    function classify(c, result) {
        if (!result.settled) { return 'H'; }
        var got = owned(result.local);
        if (same(got, owned(c.local))) { return 'S'; }
        if (same(got, owned(c.texts))) { return 'W'; }
        var before = parseMarker(c.suite[MARKER]);
        if (before && before.writer === 'native' && before.complete) {
            var previous = {};
            STATE_KEYS.forEach(function (k) { previous[k] = c.suite[k] ? c.suite[k].string : null; });
            if (same(got, previous)) { return 'P'; }
        }
        return 'M';
    }
    function run(c, suite, ops) {
        var outcomes = [];
        for (var k = 0; k <= ops.length; k++) {
            var r = start(c.local, apply(suite, ops.slice(0, k)));
            var consent = r.local.twAnalyticsConsentV1;
            outcomes.push([classify(c, r), r.trusted, r.claim, consent === undefined ? null : consent]);
        }
        return outcomes;
    }

    var out = {keys: KEYS, cases: CASES.map(function (c) {
        var ops = writes(c.suite, c.texts);
        var resumed = [];
        for (var k = 1; k < ops.length; k++) {
            var interrupted = apply(c.suite, ops.slice(0, k));
            var again = writes(interrupted, c.texts);
            resumed.push({after: k, writes: again, outcomes: run(c, interrupted, again)});
        }
        return {name: c.name, emptyWebView: !!c.emptyWebView, local: c.local, suite: c.suite, texts: c.texts, writes: ops,
            outcomes: run(c, c.suite, ops), resumed: resumed};
    })};
    print(JSON.stringify(out));
})(arguments);
