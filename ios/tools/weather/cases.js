// The weather request timing of the Cordova app (IN-08, #2957), run in the macOS JavaScriptCore shell (the engine of the
// Cordova iOS app) by generate.py:
//   TZ=Asia/Seoul jsc cases.js -- <service.weatherutil.js> <service.weatherinfo.js>
// It prints one JSON document:
// - `retry`: WeatherUtil.getWeatherByGeoInfo (`_getHttp`, `_retryGetHttp`) on a virtual clock. Each attempt's $http
//   call answers, fails with a status, or hangs until its 10 s timeout, after the given time; the record lists every
//   attempt with the time it was sent and the time and outcome of the promise.
// - `gate`: WeatherInfo.canLoadCity, reloadCity and updateCity (the ten-minute memory gate) at given times.
// Only the services are real; $http, $q (native promises with drained microtasks), the timers, the clock, TwStorage
// and the analytics calls are recorders or fixed values.
(function (args) {
    'use strict';
    var utilSource = readFile(args[0]);
    var infoSource = readFile(args[1]);
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
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

    // A virtual clock: `now` in ms; timers run in time order (ties in the order they were set), each followed by the
    // promise callbacks it caused.
    function Clock() {
        var self = this;
        var seq = 0;
        self.now = 0;
        self.timers = [];
        self.setTimeout = function (fn, ms) {
            seq += 1;
            self.timers.push({id: seq, at: self.now + (ms || 0), seq: seq, fn: fn});
            return seq;
        };
        self.clearTimeout = function (id) {
            self.timers = self.timers.filter(function (t) { return t.id !== id; });
        };
        self.run = function (until) {
            drainMicrotasks();
            for (;;) {
                var next = self.timers.reduce(function (m, t) {
                    return m === null || t.at < m.at || (t.at === m.at && t.seq < m.seq) ? t : m;
                }, null);
                if (next === null || next.at > until) { break; }
                self.timers.splice(self.timers.indexOf(next), 1);
                self.now = next.at;
                next.fn();
                drainMicrotasks();
            }
        };
        var Base = Date;
        self.Date = class extends Base {
            constructor(...a) { super(...(a.length ? a : [Date.UTC(2026, 10, 14, 0, 0, 0) + self.now])); }
            static now() { return Date.UTC(2026, 10, 14, 0, 0, 0) + self.now; }
        };
    }

    // $q over native promises (Angular's run in a digest; the order of the callbacks is the same).
    var $q = {
        defer: function () {
            var d = {};
            d.promise = new Promise(function (resolve, reject) { d.resolve = resolve; d.reject = reject; });
            return d;
        },
        all: function (list) { return Promise.all(list); },
        reject: function (e) { return Promise.reject(e); },
    };

    var UNITS = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm',
        airUnit: 'airkorea'};
    var Util = {ga: {trackEvent: function () {}, trackException: function () {}, trackTiming: function () {}}};
    var Monetization = {track: function () {}};

    // getWeatherByGeoInfo for Seoul's coordinates. `behaviors[i]` is attempt i's: {answer: ms}, {fail: ms, status} or
    // {hang: true} (no answer: $http's timeout ends it with status -1 after `timeout` ms).
    function runRetry(behaviors) {
        var clock = new Clock();
        var attempts = [];
        var $http = function (options) {
            var behavior = behaviors[attempts.length] || {hang: true};
            var index = attempts.length;
            attempts.push({index: index + 1, at: clock.now, url: options.url, method: options.method, timeout: options.timeout});
            var onSuccess = null, onError = null;
            if (behavior.answer !== undefined) {
                clock.setTimeout(function () { if (onSuccess) { onSuccess({}, 200); } }, behavior.answer);
            } else if (behavior.fail !== undefined) {
                clock.setTimeout(function () { if (onError) { onError('', behavior.status); } }, behavior.fail);
            } else {
                clock.setTimeout(function () { if (onError) { onError(null, -1); } }, options.timeout);
            }
            return {
                success: function (fn) { onSuccess = fn; return this; },
                error: function (fn) { onError = fn; return this; },
            };
        };
        var utilFactory = load(utilSource, {console: quiet, clientConfig: {serverUrl: 'https://server.test.invalid', debug: false},
            window: {}, alert: function () {}, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Date: clock.Date});
        var util = utilFactory($q, $http, Util, {getAllUnits: function () { return clone(UNITS); }}, Monetization);
        var settled = null;
        util.getWeatherByGeoInfo({location: {lat: 37.5665, long: 126.978}}).then(function () {
            settled = {at: clock.now, outcome: 'resolved'};
        }, function (err) {
            settled = {at: clock.now, outcome: 'rejected', code: err && err.code};
        });
        clock.run(60000);
        return {attempts: attempts, settled: settled};
    }

    // WeatherInfo with the stored cities [current position (disabled), Seoul, London] and cityIndex 1. `steps` run in
    // order: {at, op: 'canLoad'|'update'|'reload', index}; the canLoad answers are recorded.
    function runGate(steps) {
        var clock = new Clock();
        var stored = {
            cities: [{currentPosition: true, address: null, location: null, disable: true},
                {currentPosition: false, name: '회현동', address: '대한민국 서울특별시 중구 회현동', location: {lat: 37.56, long: 126.98}},
                {currentPosition: false, name: 'London', address: 'United Kingdom London', location: {lat: 51.51, long: -0.13}}],
            cityIndex: 1,
        };
        var TwStorage = {get: function (k) { return clone(stored[k] === undefined ? null : stored[k]); }, set: function () {}};
        var infoFactory = load(infoSource, {console: quiet, clientConfig: {debug: true}, window: {}, Date: clock.Date,
            setTimeout: clock.setTimeout});
        var WeatherUtil = {findWeatherPhoto: function () { return null; }, loadWeatherPhotos: function () { return $q.defer().promise; }};
        var info = infoFactory({$broadcast: function () {}}, WeatherUtil, TwStorage, Util, Monetization);
        info._loadCitiesPreference = function () {};
        info._saveCitiesPreference = function () {};
        info.saveCities = function () {};
        info.loadCities();
        var results = [];
        steps.forEach(function (step) {
            clock.now = step.at;
            if (step.op === 'canLoad') {
                results.push({at: step.at, index: step.index, canLoad: info.canLoadCity(step.index)});
            } else if (step.op === 'update') {
                info.updateCity(step.index, {currentWeather: {t1h: 1}});
            } else if (step.op === 'reload') {
                info.reloadCity(step.index);
            }
        });
        return {steps: steps, results: results};
    }

    var retry = [
        // [name, behaviors]: the cases of V08 (docs/rewrite/verification-matrix.md) and more.
        ['answer-fast', [{answer: 300}]],
        ['error-fast-501', [{fail: 120, status: 501}]],
        ['error-fast-404', [{fail: 500, status: 404}]],
        ['answer-after-first-gap', [{answer: 2500}]],
        ['second-answers-first', [{hang: true}, {answer: 400}]],
        ['third-answers', [{hang: true}, {hang: true}, {answer: 300}]],
        ['slow-error-after-second-started', [{fail: 3000, status: 503}]],
        ['all-hang-timeout', [{hang: true}, {hang: true}, {hang: true}]],
        ['first-fails-while-second-runs', [{fail: 2500, status: 500}, {answer: 1000}]],
        ['second-fails-first', [{hang: true}, {fail: 100, status: 502}, {answer: 100}]],
    ].map(function (c) {
        var r = runRetry(c[1]);
        return {name: c[0], behaviors: c[1], attempts: r.attempts, settled: r.settled};
    });

    var gate = [
        ['ten-minutes', [{at: 0, op: 'canLoad', index: 1}, {at: 0, op: 'update', index: 1}, {at: 1000, op: 'canLoad', index: 1},
            {at: 600000, op: 'canLoad', index: 1}, {at: 600001, op: 'canLoad', index: 1}]],
        ['reload-city', [{at: 0, op: 'update', index: 1}, {at: 5000, op: 'canLoad', index: 1}, {at: 5000, op: 'reload', index: 1},
            {at: 5000, op: 'canLoad', index: 1}]],
        ['disabled-and-other', [{at: 0, op: 'update', index: 1}, {at: 0, op: 'canLoad', index: 0}, {at: 0, op: 'canLoad', index: 2},
            {at: 0, op: 'canLoad', index: 3}]],
    ].map(function (c) {
        var r = runGate(c[1]);
        return {name: c[0], steps: r.steps, results: r.results};
    });

    print(JSON.stringify({units: UNITS, retry: retry, gate: gate}));
})(arguments);
