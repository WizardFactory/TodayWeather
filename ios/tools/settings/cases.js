// The settings pages, the menu's hand-offs and About of the Cordova app with the platform reporting iOS (IN-12, #2961),
// run in the macOS JavaScriptCore shell (the engine of the Cordova iOS app) by generate.py:
//   TZ=<zone> jsc cases.js -- <client/www> <zone>
// It prints one JSON document. Only the Cordova code is real: Util, Units, UnitsCtrl, radioList, RadioCtrl, SettingCtrl
// and the Push service (service.push.js, with service.weatherutil.js for the town of a Korean address); $http, TwStorage,
// $translate, $location, the side menu, the popups, InAppBrowser, WeatherInfo's reloads, the timers and the clock are
// recorders or fixed values. The steps follow android/tools/corpus/generate.mjs (settingsCases) with the iOS platform and
// the real Push service instead of its recorder, so a unit change records the request `Push.updateUnits` sends.
(function (args) {
    'use strict';
    var www = args[0];
    var zone = args[1];
    var read = function (rel) { return readFile(www + '/' + rel); };
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
    var NOW = Date.UTC(2026, 10, 14, 3, 0, 0);
    class FixedDate extends Date {
        constructor(...a) { super(...(a.length ? a : [NOW])); }
        static now() { return NOW; }
    }

    // The build inputs of the iOS test: the TodayWeather package, a placeholder feedback address (the real one is a
    // private build input), the App Store page of the shipped app (docs/rewrite/screen-overlays.md) and a server URL.
    var CONFIG = {package: 'todayWeather', mailTo: 'feedback@example.com',
        iOSStoreUrl: 'https://itunes.apple.com/app/todayweather/id1041700694', serverUrl: 'https://server'};
    // navigator.userAgent of the Cordova build's WKWebView on the iOS 26.5 simulator (ios/provenance/*-captures.json).
    var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    var DEVICE = {uuid: '0F0B1C9E-5B4A-4C1D-9E2F-3A4B5C6D7E8F', version: '2.0.0'};
    var KR_UNITS = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm',
        airUnit: 'airkorea'};
    var KR_SETTINGS = {startupPage: '0', refreshInterval: '0', theme: 'light'};
    var CITIES = [
        {currentPosition: true, disable: false, name: '회현동', address: '대한민국 서울특별시 중구 회현동', source: 'KMA',
            location: {lat: 37.56, long: 126.98}},
        {currentPosition: false, disable: false, name: '명동', address: '대한민국 서울특별시 중구 명동', source: 'KMA',
            location: {lat: 37.56, long: 126.98}},
        {currentPosition: false, disable: false, name: 'London', address: 'United Kingdom London', country: 'GB', source: 'VC',
            location: {lat: 51.51, long: -0.13}},
    ];
    // The stored push list (pushData2): the current position's alert with a stale name (loadPushInfo repairs records of
    // index 0), an alert and an alarm of 명동, London's alert with equal start and end (the end moves one minute back) and
    // a disabled alarm.
    var LIST = [
        {cityIndex: 0, id: 1, startTime: '2026-11-13T22:00:00.000Z', endTime: '2026-11-14T13:00:00.000Z', enable: true, category: 'alert', name: 'stale'},
        {cityIndex: 1, id: 1, startTime: '2026-11-13T22:00:00.000Z', endTime: '2026-11-14T13:00:00.000Z', enable: true, category: 'alert',
            name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: {first: '서울특별시', second: '중구', third: '명동'}},
        {cityIndex: 1, id: 2, time: '2026-11-13T22:40:00.000Z', dayOfWeek: [false, true, true, true, true, true, false], enable: true,
            category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: {first: '서울특별시', second: '중구', third: '명동'}},
        {cityIndex: 2, id: 1, startTime: '2026-11-14T03:00:00.000Z', endTime: '2026-11-14T03:00:00.000Z', enable: true, category: 'alert',
            name: 'London', source: 'VC', location: {lat: 51.51, long: -0.13}},
        {cityIndex: 2, id: 2, time: '2026-11-13T21:00:00.000Z', dayOfWeek: [true, true, true, true, true, true, true], enable: false,
            category: 'alarm', name: 'London', source: 'VC', location: {lat: 51.51, long: -0.13}},
    ];
    // New York: alerts whose start equals their end around the 2026 daylight-saving changes (setMinutes moves the local
    // wall time, which differs from 60 seconds there).
    var DST_LIST = ['2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z', '2026-03-08T07:00:00.000Z'].map(function (t, i) {
        return {cityIndex: 2, id: i + 1, startTime: t, endTime: t, enable: true, category: 'alert', name: 'London', source: 'VC',
            location: {lat: 51.51, long: -0.13}};
    });
    var catalogs = {ko: JSON.parse(read('locales/ko.json')), en: JSON.parse(read('locales/en.json'))};

    // angular.module(...).factory/controller of service files, collected by name.
    function load(files, globals) {
        var reg = {};
        var mod = {factory: function (n, f) { reg[n] = f; return mod; }, controller: function (n, f) { reg[n] = f; return mod; }};
        var g = Object.assign({angular: {module: function () { return mod; }, noop: function () {},
            element: function () { return {hasClass: function () { return false; }}; }}}, globals);
        var names = Object.keys(g);
        files.forEach(function (file) {
            Function.apply(null, names.concat([read(file)])).apply(null, names.map(function (k) { return g[k]; }));
        });
        return reg;
    }

    // One app: the settings services over stored units, settings and push list. `token` is the stored FCM token (null:
    // none), `list` the stored push list (null: no pushData2). Push.init ran at the start, as on every launch (its
    // 3-second list post is not part of the steps); the trace starts after it.
    function app(lang, opts) {
        opts = opts || {};
        var tr = catalogs[lang];
        var trace = [];
        var window = {location: {}, device: {uuid: DEVICE.uuid}};
        window.cordova = {InAppBrowser: {open: function (url, target) { trace.push(['InAppBrowser.open', url, target]); }}};
        var ionic = {Platform: {isIOS: function () { return true; }, isAndroid: function () { return false; }, ua: UA}};
        Function('window', read('data/theme.js'))(window);
        var globals = {console: quiet, clientConfig: CONFIG, window: window, cordova: window.cordova, ionic: ionic,
            document: {getElementsByClassName: function () { return []; }}, setTimeout: function () {}, Date: FixedDate};
        var reg = load(['js/service.util.js', 'js/controller.units.js', 'js/controller.setting.radio.js',
            'js/controller.settingctrl.js', 'js/service.push.js', 'js/service.weatherutil.js'], globals);
        var stored = {units: clone(opts.units === undefined ? KR_UNITS : opts.units),
            settingsInfo: clone(opts.settings || KR_SETTINGS)};
        if (opts.list !== null) {
            stored.pushData2 = {registrationId: null, type: 'ios', category: '', fcmToken: opts.token === undefined ? 'token-a' : opts.token,
                pushList: clone(opts.list || LIST)};
        }
        var TwStorage = {get: function (k) { return clone(stored[k] === undefined ? null : stored[k]); },
            set: function (k, v) { stored[k] = clone(v); trace.push(['TwStorage.set', k, clone(v)]); }};
        var $translate = function (keys) {
            return {then: function (ok) {
                if (Array.isArray(keys)) {
                    var o = {};
                    keys.forEach(function (k) { o[k] = tr[k] === undefined ? k : tr[k]; });
                    ok(o);
                } else {
                    ok(tr[keys] === undefined ? keys : tr[keys]);
                }
                return {finally: function (fn) { fn(); }};
            }};
        };
        var Monetization = {init: function () {}, screen: function () {}, track: function () {}, setCollectionEnabled: function () {},
            getCollectionChoice: function () { return false; }};
        var Util = reg.Util({}, Monetization);
        Object.assign(Util, {version: DEVICE.version, region: 'KR', language: lang === 'ko' ? 'ko-KR' : 'en-US', uuid: DEVICE.uuid});
        var Units = reg.Units(TwStorage, Util);
        Units.loadUnits();
        var $http = function (cfg) {
            trace.push(['$http', clone({method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data})]);
            return {success: function () { return this; }, error: function () { return this; }};
        };
        var WeatherUtil = reg.WeatherUtil({}, function () { throw new Error('no network'); }, Util, Units, {track: function () {}});
        var WeatherInfo = {getCityOfIndex: function (i) { return clone(CITIES[i]); }, getCityCount: function () { return CITIES.length; },
            reloadCity: function (i) { trace.push(['WeatherInfo.reloadCity', i]); }};
        var $rootScope = {settingsInfo: clone(stored.settingsInfo), title: 'LOC_TODAYWEATHER', state: 'forecast',
            $broadcast: function (name, sender) { trace.push(['$broadcast', name, sender === undefined ? null : sender]); }};
        var Firebase = {init: function () {}, inited: true};
        var Push = reg.Push($http, TwStorage, Util, WeatherUtil, WeatherInfo, Units, $rootScope, Firebase);
        Push.init();
        if (Push.pushData.type !== 'ios') { throw new Error('platform is not iOS: ' + Push.pushData.type); }
        var radioList = reg.radioList($rootScope, Units, TwStorage, Util, Push);
        var $location = {path: function (p) { trace.push(['$location.path', p]); }};
        var side = {toggleLeft: function () { trace.push(['toggleLeft']); }, isOpen: function () { return true; }};
        var $ionicHistory = {goBack: function () { trace.push(['goBack']); }};
        var $ionicPopup = {alert: function (o) { trace.push(['$ionicPopup.alert', clone(o)]); return {then: function () {}}; }};
        function scope() {
            var handlers = {};
            return {$on: function (n, f) { handlers[n] = f; }, $emit: function (n) { if (handlers[n]) { handlers[n](); } },
                $evalAsync: function (f) { f(); }};
        }
        var menu = scope();
        reg.SettingCtrl(menu, $rootScope, Util, $ionicHistory, $translate, side, $ionicPopup, $location, TwStorage, radioList, Monetization);
        trace.length = 0;
        return {
            trace: trace, stored: stored, Units: Units, menu: menu, window: window,
            unitsPage: function () {
                var s = scope();
                reg.UnitsCtrl(s, $translate, $ionicHistory, Units, Util, Push, $location, radioList);
                s.$emit('$ionicView.enter');
                return s;
            },
            radioPage: function () {
                var s = scope();
                reg.RadioCtrl($rootScope, s, $ionicHistory, Util, radioList, WeatherInfo);
                return s;
            },
            text: function (k) { return k === undefined || k === null ? '' : (tr[k] === undefined ? k : tr[k]); },
        };
    }

    var UNIT_NAMES = ['temperatureUnit', 'windSpeedUnit', 'pressureUnit', 'distanceUnit', 'precipitationUnit', 'airUnit'];
    function take(a) { return a.trace.splice(0); }
    function open(a, name) {
        if (UNIT_NAMES.indexOf(name) >= 0) {
            var s = a.unitsPage();
            s.settingRadio(s.units.filter(function (u) { return u.name === name; })[0]);
        } else {
            a.menu.settingRadio(name);
        }
    }
    function page(a, s) {
        return {title: s.title, value: s.data.value, items: s.list.map(function (i) { return {label: i.label, value: i.value, text: a.text(i.label)}; })};
    }
    // Opens list `name` and chooses `value` (RadioCtrl's valueChanged, as the radio's ng-change calls it).
    function choose(opts, name, value) {
        var a = app('ko', opts);
        open(a, name);
        var s = a.radioPage();
        take(a);
        s.data.value = value;
        s.valueChanged(s.list.filter(function (i) { return i.value === value; })[0]);
        return {value: value, trace: take(a), stored: a.stored};
    }

    var out = {zone: zone, now: NOW, config: CONFIG, ua: UA, device: DEVICE, cities: CITIES, pushList: LIST};
    if (zone === 'Asia/Seoul') {
        // S07 and each S08 list from the Korean defaults: what opening sends, the page, and every other choice.
        out.units = ['ko', 'en'].map(function (lang) {
            var a = app(lang);
            var s = a.unitsPage();
            return {lang: lang, rows: s.units.map(function (u) {
                return {name: u.name, nameKey: s.getUnitNameStr(u.name), valueKey: s.getUnitValueStr(u) === undefined ? null : s.getUnitValueStr(u),
                    name_text: a.text(s.getUnitNameStr(u.name)), value_text: a.text(s.getUnitValueStr(u))};
            })};
        });
        out.lists = UNIT_NAMES.concat(['startupPage', 'refreshInterval', 'theme']).map(function (name) {
            var first = app('ko');
            open(first, name);
            var opened = take(first);
            var shown = page(first, first.radioPage());
            var en = app('en');
            open(en, name);
            var choices = shown.items.filter(function (i) { return i.value !== shown.value; }).map(function (i) {
                return choose({}, name, i.value);
            });
            return {name: name, opened: opened, page: shown, en: page(en, en.radioPage()), choices: choices};
        });
        // Push.updateUnits without a token, without records and without pushData2: nothing is sent.
        out.push = [
            {name: 'no-token', token: null, list: LIST},
            {name: 'empty-token', token: '', list: LIST},
            {name: 'no-records', token: 'token-a', list: []},
            {name: 'no-push-data', token: null, list: null},
            {name: 'airnow-from-airkorea', token: 'token-a', list: LIST, unit: 'airUnit', value: 'airnow'},
            {name: 'airkorea-who-from-airnow', token: 'token-a', list: LIST, unit: 'airUnit', value: 'airkorea_who',
                units: Object.assign({}, KR_UNITS, {airUnit: 'airnow'})},
        ].map(function (c) {
            var r = choose({token: c.token, list: c.list, units: c.units}, c.unit || 'temperatureUnit', c.value || 'F');
            return {name: c.name, token: c.token, list: c.list, units: c.units || KR_UNITS, unit: c.unit || 'temperatureUnit',
                value: r.value, trace: r.trace};
        });
        // The menu's values at the right of its rows.
        out.menu = [];
        ['ko', 'en'].forEach(function (lang) {
            ['nullschool', 'sendMail', 'openMarket', 'openInfo'].forEach(function (row) {
                var a = app(lang);
                a.menu.clickMenu(row);
                out.menu.push({lang: lang, row: row, trace: take(a), location: a.window.location.href === undefined ? null : a.window.location.href});
            });
        });
    } else if (zone === 'America/New_York') {
        out.pushList = DST_LIST;
        out.push = [{name: 'dst-new-york', token: 'token-a', list: DST_LIST, units: KR_UNITS, unit: 'temperatureUnit', value: 'F',
            trace: choose({token: 'token-a', list: DST_LIST}, 'temperatureUnit', 'F').trace}];
    } else {
        throw new Error('no cases for ' + zone);
    }
    print(JSON.stringify(out));
})(typeof scriptArgs !== 'undefined' ? scriptArgs : arguments);
