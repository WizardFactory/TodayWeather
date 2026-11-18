// Injected by run-handback-test.sh (IN-17, #2966) as the first script of a copy of the fallback Cordova build's
// www/index.html (client/www is never changed). Like seed-cordova.js it reports every request the page starts to the local
// recorder and sends a request for another host to the recorder instead. Once TwStorage.init has finished (app.js loaded
// the cities after it), it works through the app's own services, by window.TW_HANDBACK_MODE:
//   check     reports what the build shows and holds (/__tw/report/<TW_HANDBACK_REPORT>);
//   edit      S02, S09 and settings edits there and an analytics grant, then reports;
//   withdraw  the analytics choice withdrawn there, then reports.
(function () {
    'use strict';
    var recorder = window.TW_RECORDER;
    var mode = window.TW_HANDBACK_MODE;
    var report = window.TW_HANDBACK_REPORT;
    var suiteName = 'group.net.wizardfactory.todayweather';
    var keys = ['cities', 'cityIndex', 'cityList', 'units', 'settingsInfo', 'pushData2', 'pushData',
        'expandShortChart', 'startVersion', 'appVersion', 'disableUpdateInfo', 'twAnalyticsConsentV1'];

    function post(path, body) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', recorder + path, true);
        xhr.setRequestHeader('Content-Type', 'text/plain'); // a simple request: no CORS preflight
        xhr.send(JSON.stringify(body));
    }
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
    // TwStorage.init has finished once app.js loaded the cities (WeatherInfo.loadCities runs after it).
    function ready(i) {
        var inj = window.angular && angular.element(document.body).injector();
        if (inj && inj.get('WeatherInfo').getCityCount() > 0) { return wait(3000); }
        if (i > 240) { return Promise.reject(new Error('TwStorage.init did not finish')); }
        return wait(500).then(function () { return ready(i + 1); });
    }
    function suite() { return window.plugins.appPreferences.suite(suiteName); }
    function fetchKey(key) {
        return new Promise(function (ok) { suite().fetch(ok, function () { ok({fetchError: true}); }, key); });
    }
    function sdkCollectionFlag() {
        return new Promise(function (resolve) {
            try {
                window.FirebasexAnalytics.isAnalyticsCollectionEnabled(function (v) { resolve(v); },
                    function () { resolve('error'); });
            } catch (e) { resolve('unavailable'); }
        });
    }
    function services() {
        var inj = angular.element(document.body).injector();
        return {WeatherInfo: inj.get('WeatherInfo'), TwStorage: inj.get('TwStorage'), Units: inj.get('Units'),
            Push: inj.get('Push'), Monetization: inj.get('Monetization'), $rootScope: inj.get('$rootScope')};
    }

    // What the app holds after its start: the services' state, the stored texts and the suite's marker and choice.
    function snapshot() {
        var s = services();
        var cities = [];
        for (var i = 0; i < s.WeatherInfo.getCityCount(); i++) {
            var c = s.WeatherInfo.getCityOfIndex(i);
            cities.push({name: c.name || null, address: c.address || null, location: c.location || null, disable: !!c.disable});
        }
        var local = {};
        keys.forEach(function (k) { local[k] = localStorage.getItem(k); });
        return Promise.all([fetchKey('_twHandBack'), fetchKey('twAnalyticsConsentV1'), sdkCollectionFlag()]).then(function (r) {
            return {cities: cities, cityIndex: s.WeatherInfo.getCityIndex(), units: s.Units.getAllUnits(),
                settingsInfo: s.$rootScope.settingsInfo,
                // loadPushInfo holds the times as Dates: their JSON is the stored text.
                pushList: JSON.parse(JSON.stringify(s.Push.pushData.pushList)), fcmToken: s.Push.pushData.fcmToken,
                choice: s.Monetization.getCollectionChoice(), sdkCollectionEnabled: r[2],
                applied: localStorage.getItem('twHandBackApplied'), local: local, marker: r[0], suiteConsent: r[1],
                version: window.clientConfig && clientConfig.version, origin: location.origin};
        });
    }

    // S02: 부산 (index 2) deleted as OnDeleteCity does, 대전 added and selected; S09: an alarm at 09:00 for 대전 (index 2);
    // settings: °F and the dark theme; the menu's analytics grant.
    function edit() {
        var s = services();
        if (s.WeatherInfo.getCityOfIndex(2).name !== '부산') {
            return Promise.reject(new Error('unexpected place ' + s.WeatherInfo.getCityOfIndex(2).name));
        }
        if (s.Push.hasPushInfo(2)) { s.Push.removePushListByCityIndex(2); }
        s.WeatherInfo.removeCity(2);
        s.WeatherInfo.addCity({name: '대전', address: '대한민국 대전광역시', country: 'KR', location: {lat: 36.35, long: 127.38},
            currentPosition: false});
        s.WeatherInfo.setCityIndex(s.WeatherInfo.getCityCount() - 1);
        s.Push.updatePushListByCityIndex([s.Push.newPushAlarm(2, 2, 9 * 3600, [true, true, true, true, true, true, true])], 2);
        s.Units.setUnit('temperatureUnit', 'F');
        s.Units.saveUnits();
        s.$rootScope.settingsInfo.theme = 'dark';
        s.TwStorage.set('settingsInfo', s.$rootScope.settingsInfo);
        return new Promise(function (resolve) { s.Monetization.setCollectionEnabled(true, resolve); })
            // The suite writes are asynchronous, and WebView storage reaches its files later still.
            .then(function (saved) { return wait(6000).then(function () { return saved; }); })
            .then(function (saved) {
                return fetchKey('twAnalyticsConsentV1').then(function (mirrored) {
                    return {saved: saved, choice: s.Monetization.getCollectionChoice(), mirrored: mirrored,
                        places: s.WeatherInfo.getCityCount(), cityIndex: s.WeatherInfo.getCityIndex()};
                });
            });
    }

    function withdraw() {
        var s = services();
        return new Promise(function (resolve) { s.Monetization.setCollectionEnabled(false, resolve); })
            .then(function (saved) { return wait(6000).then(function () { return saved; }); })
            .then(function (saved) {
                return fetchKey('twAnalyticsConsentV1').then(function (mirrored) {
                    return {saved: saved, choice: s.Monetization.getCollectionChoice(),
                        stored: localStorage.getItem('twAnalyticsConsentV1'), mirrored: mirrored};
                });
            });
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            if (mode === 'edit') { return edit(); }
            if (mode === 'withdraw') { return withdraw(); }
            return wait(5000).then(snapshot);
        }).then(function (result) {
            post('/__tw/report/' + report, {mode: mode, result: result});
        }).catch(function (e) {
            post('/__tw/report/' + report, {mode: mode, error: String(e && e.stack || e)});
        });
    }, false);
})();
