// Injected by run-upgrade-test.sh as the first script of the Cordova test build's www/index.html (a copy of the
// built app; client/www is never changed). It reports every request the page starts to the local recorder and
// sends a request for another host to the recorder instead. Then it
// seeds places, units, settings, alarms and an analytics opt-in through the app's own services, as a user of
// 1.1.1 would have them, and posts the state it wrote (localStorage, the App Group suite, device.uuid, the
// analytics flags) to the recorder's /__tw/seeded.
(function () {
    'use strict';
    var recorder = window.TW_RECORDER;
    var suiteName = 'group.net.wizardfactory.todayweather';
    var keys = ['cities', 'cityIndex', 'cityList', 'units', 'settingsInfo', 'pushData2', 'pushData',
        'expandShortChart', 'startVersion', 'appVersion', 'disableUpdateInfo', 'twAnalyticsConsentV1'];

    function post(path, body) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', recorder + path, true);
        xhr.setRequestHeader('Content-Type', 'text/plain'); // a simple request: no CORS preflight
        xhr.send(JSON.stringify(body));
    }
    // Every request the page starts is reported; one to a host other than this Mac goes to the recorder instead
    // (so the test build cannot reach a production host, whatever its configuration says).
    function guard(kind, method, url) {
        var href;
        try { href = new URL(String(url), location.href).href; } catch (e) { href = String(url); }
        if (href.indexOf(recorder + '/__tw/') === 0) { return url; }
        var local = /^(app:\/\/localhost|https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)(\/|$)/.test(href) ||
            /^(data|blob):/.test(href);
        try { post('/__tw/observed', {kind: kind, method: method, url: href, blocked: !local}); } catch (e) { }
        return local ? url : recorder + '/__tw/blocked?url=' + encodeURIComponent(href);
    }
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        var args = Array.prototype.slice.call(arguments);
        args[1] = guard('xhr', method, url);
        return open.apply(this, args);
    };
    if (window.fetch) {
        var fetch0 = window.fetch;
        window.fetch = function (input, init) {
            var url = input && input.url ? input.url : input;
            return fetch0.call(this, guard('fetch', (init && init.method) || 'GET', url), init);
        };
    }
    if (navigator.sendBeacon) {
        var beacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) { return beacon(guard('beacon', 'POST', url), data); };
    }

    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function ready(i) {
        var inj = window.angular && angular.element(document.body).injector();
        // TwStorage.init ends with setForwardCompatibility, which stores settingsInfo.
        if (inj && localStorage.getItem('settingsInfo') !== null) { return wait(3000); }
        if (i > 120) { return Promise.reject(new Error('app did not start')); }
        return wait(500).then(function () { return ready(i + 1); });
    }
    function suiteValues() {
        var suite = window.plugins.appPreferences.suite(suiteName);
        return Promise.all(keys.map(function (key) {
            return new Promise(function (resolve) {
                suite.fetch(function (value) { resolve([key, value === undefined ? null : value]); },
                    function () { resolve([key, {fetchError: true}]); }, key);
            });
        })).then(function (pairs) {
            var out = {};
            pairs.forEach(function (p) { out[p[0]] = p[1]; });
            return out;
        });
    }
    function sdkCollectionFlag() {
        return new Promise(function (resolve) {
            try {
                window.FirebasexAnalytics.isAnalyticsCollectionEnabled(function (v) { resolve(v); },
                    function () { resolve('error'); });
            } catch (e) { resolve('unavailable'); }
        });
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            var inj = angular.element(document.body).injector();
            var WeatherInfo = inj.get('WeatherInfo'), TwStorage = inj.get('TwStorage'), Units = inj.get('Units');
            var Push = inj.get('Push'), Monetization = inj.get('Monetization'), Util = inj.get('Util');
            var $rootScope = inj.get('$rootScope');
            WeatherInfo.addCity({name: '명동', address: '대한민국 서울특별시 중구 명동', country: 'KR',
                location: {lat: 37.56, long: 126.98}, currentPosition: false, source: 'KMA'});
            WeatherInfo.addCity({name: 'London', address: 'United Kingdom London', country: 'GB',
                location: {lat: 51.51, long: -0.13}, currentPosition: false});
            WeatherInfo.setCityIndex(2);
            Units.setUnit('temperatureUnit', 'F'); Units.setUnit('windSpeedUnit', 'km/h'); Units.setUnit('airUnit', 'airnow');
            Units.saveUnits();
            $rootScope.settingsInfo = {startupPage: '1', refreshInterval: '30', theme: 'dark'};
            TwStorage.set('settingsInfo', $rootScope.settingsInfo);
            TwStorage.set('expandShortChart', true);
            TwStorage.set('startVersion', Util.startVersion); // StartCtrl.close() after the start page
            var week = [false, true, true, true, true, true, false];
            Push.updatePushListByCityIndex([Push.newPushAlert(1, 1, 7, 22),
                Push.newPushAlarm(2, 1, 7 * 3600 + 40 * 60, week), Push.newPushAlarm(3, 1, 20 * 3600 + 20 * 60, week)], 1);
            Push.updatePushListByCityIndex([Push.newPushAlarm(2, 2, 6 * 3600, [true, true, true, true, true, true, true])], 2);
            // A stored FCM token, as an install with push has (the dummy Firebase project gives none).
            Push.pushData.fcmToken = 'token-a';
            Push.savePushInfo();
            return new Promise(function (resolve) { Monetization.setCollectionEnabled(true, resolve); }).then(function (ok) {
                // An event through the app's own path while the opt-in holds.
                Monetization.track('favorite_change', {action: 'add'});
                return wait(3000).then(function () { return ok; }); // the suite writes are asynchronous
            });
        }).then(function (optInStored) {
            var storage = {};
            keys.forEach(function (k) { storage[k] = localStorage.getItem(k); });
            var Monetization = angular.element(document.body).injector().get('Monetization');
            return Promise.all([suiteValues(), sdkCollectionFlag()]).then(function (r) {
                post('/__tw/seeded', {deviceId: window.device && device.uuid, optInStored: optInStored,
                    analyticsChoice: Monetization.getCollectionChoice(), sdkCollectionEnabled: r[1],
                    storage: storage, suite: r[0], origin: location.origin});
            });
        }).catch(function (e) {
            post('/__tw/seeded', {error: String(e && e.stack || e)});
        });
    }, false);
})();
