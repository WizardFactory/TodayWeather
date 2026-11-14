// Push registration requests of the Cordova Push service (client/www/js/service.push.js) with the platform
// reporting iOS, run in the macOS JavaScriptCore shell (the engine of the Cordova iOS app) by generate.py:
//   TZ=<zone> jsc cases.js -- <service.push.js> <service.weatherutil.js> <zone>
// It prints one JSON document with the cases of <zone>, and for Asia/Seoul the timed cases (`runTimed`: Push.init on a
// virtual clock with tokens at given times; IN-04 review). The cases follow android/tools/corpus/generate.mjs
// (pushCases): the same places, records, device values and fixed clock, so the two corpora differ only in `type`.
// Only the services are real; $http, TwStorage, Firebase, the timers and the clock are recorders or fixed values.
(function (args) {
    'use strict';
    var pushSource = readFile(args[0]);
    var utilSource = readFile(args[1]);
    var zone = args[2];
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var NOW = Date.UTC(2026, 10, 7, 3, 0, 0);
    class FixedDate extends Date {
        constructor(...a) { super(...(a.length ? a : [NOW])); }
        static now() { return NOW; }
    }
    var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };

    // angular.module(...).factory(name, fn) of one service file; the factory function is returned.
    function load(source, globals) {
        var factory;
        var angular = {module: function () { return {factory: function (_, fn) { factory = fn; }}; }};
        var names = ['angular'].concat(Object.keys(globals));
        var values = [angular].concat(names.slice(1).map(function (k) { return globals[k]; }));
        Function.apply(null, names.concat([source])).apply(null, values);
        return factory;
    }

    var DEVICE = {deviceId: '0F0B1C9E-5B4A-4C1D-9E2F-3A4B5C6D7E8F', language: 'ko-KR', appVersion: '1.1.1'};
    var CITIES = [
        {currentPosition: true, disable: false, name: '회현동', address: '대한민국 서울특별시 중구 회현동', source: 'KMA',
            location: {lat: 37.56, long: 126.98}},
        {currentPosition: false, disable: false, name: '명동', address: '대한민국 서울특별시 중구 명동', source: 'KMA',
            location: {lat: 37.56, long: 126.98}},
        {currentPosition: false, disable: false, name: 'London', address: 'United Kingdom London', country: 'GB', source: 'VC',
            location: {lat: 51.51, long: -0.13}},
    ];
    // The current position's record carries a stale name (loadPushInfo repairs records of index 0), London's alert
    // has a broken location (repaired too: TW-365) and equal start and end times.
    var LIST = [
        {cityIndex: 0, id: 1, startTime: '2026-11-07T22:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', enable: true, category: 'alert', name: 'stale'},
        {cityIndex: 1, id: 1, startTime: '2026-11-07T22:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', enable: true, category: 'alert',
            name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: {first: '서울특별시', second: '중구', third: '명동'}},
        {cityIndex: 1, id: 2, time: '2026-11-07T22:40:00.000Z', dayOfWeek: [false, true, true, true, true, true, false], enable: true,
            category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: {first: '서울특별시', second: '중구', third: '명동'}},
        {cityIndex: 2, id: 1, startTime: '2026-11-08T03:00:00.000Z', endTime: '2026-11-08T03:00:00.000Z', enable: false, category: 'alert',
            name: 'London', source: 'VC', location: {long: -0.13}},
        {cityIndex: 2, id: 2, time: '2026-11-07T21:00:00.000Z', dayOfWeek: [true, true, true, true, true, true, true], enable: false,
            category: 'alarm', name: 'London', source: 'VC', location: {lat: 51.51, long: -0.13}},
    ];
    // Alerts whose start equals their end: the end moves one minute back in local time (setMinutes), which differs
    // from 60 seconds across New York's daylight-saving changes (as in the Android corpus).
    var DST_LIST = ['2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z', '2026-11-01T05:00:00.000Z',
        '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z'].map(function (t, i) {
        return {cityIndex: 2, id: i + 1, startTime: t, endTime: t, enable: true, category: 'alert', name: 'London', source: 'VC',
            location: {lat: 51.51, long: -0.13}};
    });

    // Push.init with pushData2 {fcmToken: storedToken, pushList: list} on an iOS device. `startToken`: the token the
    // plugin's onTokenRefresh delivers before the 3 s repost (null: none). `laterToken`: a token delivered after
    // the repost, while the app runs; only the requests after the repost are returned then.
    function run(storedToken, startToken, laterToken, airUnit, list) {
        var timers = [];
        var calls = [];
        var $http = function (cfg) {
            calls.push(clone({method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data}));
            return {success: function () { return this; }, error: function () { return this; }};
        };
        var units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm',
            airUnit: airUnit};
        var Util = {ga: {trackEvent: function () {}, trackException: function () {}}, uuid: DEVICE.deviceId,
            language: DEVICE.language, version: DEVICE.appVersion};
        var utilFactory = load(utilSource, {console: quiet, clientConfig: {debug: false}, window: {}, alert: function () {},
            setTimeout: function () {}, Date: FixedDate});
        var weatherUtil = utilFactory({}, function () { throw new Error('no network'); }, Util,
            {getUnit: function (n) { return units[n]; }}, {track: function () {}});
        var pushFactory = load(pushSource, {console: quiet, window: {},
            clientConfig: {package: 'todayWeather', serverUrl: 'https://server'},
            ionic: {Platform: {isIOS: function () { return true; }, isAndroid: function () { return false; }}},
            setTimeout: function (fn) { timers.push(fn); }, Date: FixedDate});
        // pushData2 as the Cordova iOS app stores it: type 'ios' (Push.init sets it on every start).
        var stored = {pushData2: {registrationId: null, type: 'ios', category: '', fcmToken: storedToken, pushList: list}};
        var TwStorage = {get: function (k) { return clone(stored[k] === undefined ? null : stored[k]); }, set: function () {}};
        var Units = {getAllUnits: function () { return clone(units); }};
        var WeatherInfo = {getCityOfIndex: function (i) { return clone(CITIES[i]); }};
        var tokenCallback;
        var Firebase = {init: function (t) { tokenCallback = t; }, inited: true};
        var push = pushFactory($http, TwStorage, Util, weatherUtil, WeatherInfo, Units, {$broadcast: function () {}}, Firebase);
        push.init();
        if (push.pushData.type !== 'ios') { throw new Error('platform is not iOS: ' + push.pushData.type); }
        if (startToken !== null) { tokenCallback(undefined, startToken); }
        timers.splice(0).forEach(function (fn) { fn(); });
        if (laterToken === null) { return calls; }
        calls.length = 0;
        tokenCallback(undefined, laterToken);
        timers.splice(0).forEach(function (fn) { fn(); });
        return calls;
    }

    // Push.init on a virtual clock (IN-04 review, CODEX-IN04-1): the service's own setTimeout calls run when the clock
    // reaches them (loadPushInfo's list post at 3000 ms), and each token of `events` ({at: ms, token}) is delivered
    // through the plugin's onTokenRefresh callback at its time (before a timer due at the same time). `fail` lists
    // the methods whose $http calls fail (the error callback runs; the Cordova code stores the token anyway), `delays`
    // the time in ms after which each method's response arrives (its callback runs then, as an event of the clock).
    // Every request is returned with the time it was sent.
    function runTimed(storedToken, events, airUnit, list, fail, delays) {
        var now = 0;
        var timers = [];
        var calls = [];
        var $http = function (cfg) {
            var failed = fail.indexOf(cfg.method) >= 0;
            calls.push(clone({at: now, method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data,
                failed: failed}));
            var delay = delays[cfg.method] || 0;
            var answer = function (fn, args) {
                if (delay > 0) {
                    timers.push({at: now + delay, fn: function () { fn.apply(null, args); }});
                } else {
                    fn.apply(null, args);
                }
            };
            return {
                success: function (fn) { if (!failed) { answer(fn, [{}]); } return this; },
                error: function (fn) { if (failed) { answer(fn, [null, 0]); } return this; },
            };
        };
        var units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm',
            airUnit: airUnit};
        var Util = {ga: {trackEvent: function () {}, trackException: function () {}}, uuid: DEVICE.deviceId,
            language: DEVICE.language, version: DEVICE.appVersion};
        var utilFactory = load(utilSource, {console: quiet, clientConfig: {debug: false}, window: {}, alert: function () {},
            setTimeout: function () {}, Date: FixedDate});
        var weatherUtil = utilFactory({}, function () { throw new Error('no network'); }, Util,
            {getUnit: function (n) { return units[n]; }}, {track: function () {}});
        var pushFactory = load(pushSource, {console: quiet, window: {},
            clientConfig: {package: 'todayWeather', serverUrl: 'https://server'},
            ionic: {Platform: {isIOS: function () { return true; }, isAndroid: function () { return false; }}},
            setTimeout: function (fn, ms) { timers.push({at: now + (ms || 0), fn: fn}); }, Date: FixedDate});
        var stored = {pushData2: {registrationId: null, type: 'ios', category: '', fcmToken: storedToken, pushList: list}};
        var TwStorage = {get: function (k) { return clone(stored[k] === undefined ? null : stored[k]); }, set: function () {}};
        var Units = {getAllUnits: function () { return clone(units); }};
        var WeatherInfo = {getCityOfIndex: function (i) { return clone(CITIES[i]); }};
        var tokenCallback;
        var Firebase = {init: function (t) { tokenCallback = t; }, inited: true};
        var push = pushFactory($http, TwStorage, Util, weatherUtil, WeatherInfo, Units, {$broadcast: function () {}}, Firebase);
        push.init();
        if (push.pushData.type !== 'ios') { throw new Error('platform is not iOS: ' + push.pushData.type); }
        var pending = events.slice().sort(function (a, b) { return a.at - b.at; });
        for (;;) {
            var timer = timers.reduce(function (m, t) { return m === null || t.at < m.at ? t : m; }, null);
            var event = pending.length ? pending[0] : null;
            if (event !== null && (timer === null || event.at <= timer.at)) {
                pending.shift();
                now = event.at;
                tokenCallback(undefined, event.token);
            } else if (timer !== null) {
                timers.splice(timers.indexOf(timer), 1);
                now = timer.at;
                timer.fn();
            } else {
                break;
            }
        }
        return calls;
    }

    var cases = [];
    var timed = [];
    if (zone === 'Asia/Seoul') {
        // [name, stored token, token events, methods that fail, response delays in ms]
        [['token-at-start', 'token-a', [{at: 0, token: 'token-b'}], []],
            ['token-before-post', 'token-a', [{at: 1000, token: 'token-b'}], []],
            ['token-after-post', 'token-a', [{at: 4000, token: 'token-b'}], []],
            ['first-token-before-post', null, [{at: 1000, token: 'token-b'}], []],
            ['first-token-after-post', null, [{at: 4000, token: 'token-b'}], []],
            ['two-tokens-before-post', 'token-a', [{at: 500, token: 'token-b'}, {at: 2000, token: 'token-c'}], []],
            ['tokens-around-post', 'token-a', [{at: 1000, token: 'token-b'}, {at: 5000, token: 'token-c'}], []],
            ['failed-put-before-post', 'token-a', [{at: 1000, token: 'token-b'}], ['PUT']],
            ['failed-requests', 'token-a', [{at: 1000, token: 'token-b'}], ['PUT', 'POST']],
            ['no-token-events', 'token-a', [], []],
            // Slow replies hold nothing back: the post is due 3 s after Push.init whatever is in flight.
            ['slow-put-token-after-post', 'token-a', [{at: 0, token: 'token-b'}, {at: 4000, token: 'token-c'}], [],
                {PUT: 2000}],
            ['slow-put-tokens-before-post', 'token-a', [{at: 500, token: 'token-b'}, {at: 1500, token: 'token-c'}], [],
                {PUT: 4000}],
            ['slow-post-token-after-post', 'token-a', [{at: 4000, token: 'token-b'}], [], {POST: 5000}],
            ['slow-first-token', null, [{at: 1000, token: 'token-b'}], [], {PUT: 3000, POST: 3000}],
            ['slow-failed-put', 'token-a', [{at: 1000, token: 'token-b'}], ['PUT'], {PUT: 6000}],
        ].forEach(function (c) {
            var delays = c[4] || {};
            timed.push({name: c[0], zone: zone, storedToken: c[1], events: c[2], fail: c[3], delays: delays,
                airUnit: 'airkorea', requests: runTimed(c[1], c[2], 'airkorea', LIST, c[3], delays)});
        });
        // [name, stored token, token at the start, token while running, air unit]
        [['first-token', null, 'token-b', null, 'airkorea'],
            ['unchanged-token', 'token-a', 'token-a', null, 'airkorea'],
            ['changed-token', 'token-a', 'token-b', null, 'airkorea'],
            ['changed-token-airnow', 'token-a', 'token-b', null, 'airnow'],
            ['no-token', null, null, null, 'airkorea'],
            ['stored-token-only', 'token-a', null, null, 'airkorea'],
            ['refresh-changed', 'token-a', null, 'token-c', 'airkorea'],
            ['refresh-first', null, null, 'token-b', 'airkorea'],
            ['refresh-unchanged', 'token-a', null, 'token-a', 'airkorea'],
        ].forEach(function (c) {
            cases.push({name: c[0], zone: zone, storedToken: c[1], startToken: c[2], refreshToken: c[3], airUnit: c[4],
                requests: run(c[1], c[2], c[3], c[4], LIST)});
        });
    } else if (zone === 'America/New_York') {
        cases.push({name: 'dst-new-york', zone: zone, storedToken: 'token-a', startToken: 'token-a', refreshToken: null,
            airUnit: 'airnow', pushList: DST_LIST, requests: run('token-a', 'token-a', null, 'airnow', DST_LIST)});
    } else {
        throw new Error('no cases for ' + zone);
    }
    print(JSON.stringify({cities: CITIES, pushList: LIST, deviceId: DEVICE.deviceId, language: DEVICE.language,
        appVersion: DEVICE.appVersion, now: NOW, cases: cases, timed: timed}));
})(typeof scriptArgs !== 'undefined' ? scriptArgs : arguments);
