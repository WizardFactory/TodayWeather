// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-07 (#2956): it records the Cordova shell for one language, as
// android/tools/shell-reference/capture.mjs does on Android, and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - Before the splash screen is hidden (`navigator.splashscreen.hide`, called on the first view), the host takes a
//   screenshot of the launch screen.
// - The kma-seoul response is loaded through the app's own request path (WeatherUtil.getWeatherByGeoInfo, served by
//   the local server) and saved as the selected place 회현동 with the app's services; S01 is closed as StartCtrl
//   closes it (startVersion 1).
// - For each theme the tab bar, the header bar and the open side menu are measured (rects, texts, computed styles)
//   and the host crops them from a simulator screenshot, after finding the WebView's origin from a calibration
//   marker drawn in the same screenshot.
(function () {
    'use strict';
    var server = window.TW_SERVER;

    function request(method, path, body) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, server + path, true);
            xhr.setRequestHeader('Content-Type', 'text/plain'); // a simple request: no CORS preflight
            xhr.timeout = 120000;
            xhr.onload = function () {
                if (xhr.status !== 200) { return reject(new Error(path + ': HTTP ' + xhr.status + ' ' + xhr.responseText)); }
                resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
            };
            xhr.onerror = function () { reject(new Error(path + ': network error')); };
            xhr.ontimeout = function () { reject(new Error(path + ': timeout')); };
            xhr.send(body === undefined ? null : JSON.stringify(body));
        });
    }
    function post(path, body) { return request('POST', path, body); }

    function guard(kind, method, url) {
        var href;
        try { href = new URL(String(url), location.href).href; } catch (e) { href = String(url); }
        if (href.indexOf(server + '/__tw/') === 0) { return url; }
        var local = /^(app:\/\/localhost|https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)(\/|$)/.test(href) ||
            /^(data|blob):/.test(href);
        post('/__tw/observed', {kind: kind, method: method, url: href, blocked: !local}).catch(function () { });
        return local ? url : server + '/__tw/blocked?url=' + encodeURIComponent(href);
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
    function frames() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }

    // The launch screen stays until the first view hides it; the host takes its screenshot first.
    var splashShot = null;
    document.addEventListener('deviceready', function () {
        // The Ads SDK is not started: no UMP form, IDFA explainer or ATT prompt over the page (#2945), and no banner,
        // whose slot IN-15 fills. The shell is captured as on a first launch before the banner loaded.
        var admob = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        if (admob) { admob.initialize = function () { }; }
        var splash = navigator.splashscreen;
        if (!splash || !splash.hide) { splashShot = Promise.resolve({missing: true}); return; }
        var hide = splash.hide.bind(splash);
        var once = null;
        splash.hide = function () {
            if (!once) {
                once = post('/__tw/splash', {}).catch(function (e) { return {error: String(e)}; })
                    .then(function (r) { hide(); return r; });
                splashShot = once;
            }
        };
    }, false);

    function ready(i) {
        var inj = window.angular && angular.element(document.body).injector();
        if (inj && localStorage.getItem('settingsInfo') !== null && splashShot) { return splashShot.then(function () { return wait(3000); }); }
        if (i > 120) { return Promise.reject(new Error('app did not start')); }
        return wait(500).then(function () { return ready(i + 1); });
    }

    var inj, WeatherInfo, WeatherUtil, TwStorage, Util, $state, $rootScope;
    function closePopups() {
        document.querySelectorAll('.popup-container .popup-buttons button').forEach(function (b) { b.click(); });
        return wait(400).then(function () {
            document.querySelectorAll('.popup-container, .backdrop').forEach(function (e) { e.remove(); });
            document.body.classList.remove('popup-open');
        });
    }
    // On screen: the closed side menu sits at left -100% and does not count.
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shown(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible)[0]; }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    var PROPS = ['color', 'background-color', 'background-image', 'font-family', 'font-size', 'font-weight', 'line-height',
        'opacity', 'text-shadow', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'height', 'border-top-width',
        'border-bottom-width', 'border-top-color', 'border-bottom-color', 'border-radius', 'margin-top'];
    function style(el) {
        var cs = getComputedStyle(el), o = {};
        PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
        return o;
    }
    function part(el) { return {rect: rect(el), style: style(el), className: String(el.className)}; }
    // CSS env() safe-area insets as the page sees them.
    function insets() {
        var probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;' +
            'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);' +
            'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)';
        document.body.appendChild(probe);
        var cs = getComputedStyle(probe);
        var o = {top: cs.paddingTop, bottom: cs.paddingBottom, left: cs.paddingLeft, right: cs.paddingRight};
        probe.remove();
        return o;
    }
    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, utilLanguage: Util.language,
            translate: inj.get('$translate').use(), insets: insets(), body: document.body.className};
    }

    function place() {
        return post('/__tw/select', {fixture: 'kma-seoul'}).then(function () {
            return WeatherUtil.getWeatherByGeoInfo({location: {lat: 37.56, long: 126.98}});
        }).then(function (weatherData) {
            var data = WeatherUtil.convertWeatherData(weatherData);
            var city = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR',
                location: {lat: 37.56, long: 126.98}, currentPosition: false};
            Object.keys(data).forEach(function (k) { city[k] = data[k]; });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            TwStorage.set('startVersion', Util.startVersion); // StartCtrl's close()
            return closePopups();
        }).then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(1200); })
            .then(function () { $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply(); return wait(1500); })
            .then(closePopups);
    }
    function theme(name) {
        $rootScope.settingsInfo.theme = name;
        TwStorage.set('settingsInfo', $rootScope.settingsInfo);
        // controller.setting.radio.js: image folders and the iOS status bar follow the theme at once.
        $rootScope.iconsImgPath = window.theme[name].icons;
        $rootScope.weatherImgPath = window.theme[name].weather;
        Util.applyIOSStatusBar(name, $rootScope.state);
        $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply();
        return wait(1200).then(closePopups).then(frames);
    }
    function tabs() {
        var bar = shown('.tabs');
        var out = part(bar);
        out.items = Array.prototype.map.call(bar.querySelectorAll('.tab-item'), function (e) {
            var icon = e.querySelector('.icon'), title = e.querySelector('.tab-title');
            return {text: e.textContent.trim(), rect: rect(e), active: e.classList.contains('tab-item-active'), style: style(e),
                icon: icon ? {className: String(icon.className), rect: rect(icon), style: style(icon)} : null,
                title: title ? {rect: rect(title), style: style(title)} : null};
        });
        return out;
    }
    function header() {
        var bar = shown('ion-side-menu-content .bar-header');
        var out = part(bar);
        var title = bar.querySelector('.title');
        out.title = title ? {text: title.textContent.replace(/\s+/g, ' ').trim(), rect: rect(title), style: style(title)} : null;
        out.buttons = Array.prototype.filter.call(bar.querySelectorAll('.button'), visible).map(function (b) {
            return {className: String(b.className), rect: rect(b), style: style(b), text: b.textContent.trim()};
        });
        return out;
    }
    function openMenu() {
        shown('.button.ion-navicon, .ion-navicon').click();
        return wait(900).then(frames).then(function () {
            var menu = shown('ion-side-menu') || document.querySelector('ion-side-menu');
            var out = part(menu);
            var bar = menu.querySelector('.bar-header');
            out.header = part(bar);
            var title = bar.querySelector('.title');
            out.header.title = {text: title.textContent.trim(), rect: rect(title), style: style(title)};
            var back = bar.querySelector('.button');
            out.header.back = {className: String(back.className), rect: rect(back), style: style(back)};
            out.rows = Array.prototype.filter.call(menu.querySelectorAll('.list .item'), visible).map(function (e) {
                var value = e.querySelector('span'), chevron = e.querySelector('.ion-chevron-right');
                return {text: e.textContent.replace(/\s+/g, ' ').trim(), rect: rect(e), style: style(e), tag: e.tagName.toLowerCase(),
                    value: value ? {text: value.textContent.trim(), rect: rect(value)} : null,
                    chevron: chevron ? {rect: rect(chevron), style: style(chevron)} : null};
            });
            return out;
        });
    }
    function closeMenu() {
        var back = shown('ion-side-menu .button');
        if (back) { back.click(); }
        return wait(900).then(frames);
    }
    // Asks the host to screenshot and crop `rects` (name -> CSS rect): a first screenshot with a calibration marker
    // finds the WebView's origin on the screen, the second, without it, is cropped.
    function shoot(prefix, rects, markerTop) {
        var m = document.createElement('div');
        m.style.cssText = 'position:fixed;left:' + (innerWidth - 20) + 'px;top:' + markerTop + 'px;width:20px;height:20px;' +
            'background:#ff00ff;z-index:2147483647';
        document.body.appendChild(m);
        return frames().then(function () { return wait(300); }).then(function () {
            return post('/__tw/origin', {name: prefix, dpr: devicePixelRatio, marker: {left: innerWidth - 20, top: markerTop, size: 20}});
        }).then(function () {
            m.remove();
            return frames().then(function () { return wait(300); });
        }).then(function () {
            return post('/__tw/shot', {name: prefix, rects: rects, dpr: devicePixelRatio,
                viewport: {width: innerWidth, height: innerHeight}});
        });
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            inj = angular.element(document.body).injector();
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            return post('/__tw/env', {phase: 'start', env: env(), state: $rootScope.state});
        }).then(closePopups).then(place).then(function () {
            return ['light', 'dark', 'photo', 'old'].reduce(function (p, name) {
                var record = {theme: name, tabs: {}};
                return p.then(function () { return theme(name); }).then(function () {
                    // The tab bar and the header bar on each tab (the photo and old themes color them per tab).
                    return ['dailyforecast', 'air', 'search', 'forecast'].reduce(function (q, tab) {
                        return q.then(function () { return $state.go('tab.' + tab); })
                            .then(function () { return wait(1500); }).then(closePopups).then(frames).then(function () {
                                var bars = {state: $rootScope.state, body: document.body.className, tabs: tabs(), header: header()};
                                record.tabs[tab] = bars;
                                // The marker sits in the page under the header bar, where neither bar is cropped.
                                var mid = Math.round(bars.header.rect.y + bars.header.rect.h + 40);
                                return shoot(name + '-' + tab, {tabs: bars.tabs.rect, header: bars.header.rect, statusBar: 'above'}, mid)
                                    .then(function (shot) { bars.shot = shot; });
                            });
                    }, Promise.resolve());
                }).then(function () {
                    return openMenu().then(function (menu) {
                        record.menu = menu;
                        // The marker sits in the menu's header bar (the list runs past the screen); it is removed
                        // before the crop.
                        return shoot(name + '-menu', {menu: menu.rect, statusBar: 'above'}, Math.round(menu.header.rect.y + 12));
                    }).then(function (shot) {
                        record.menuShot = shot;
                        return closeMenu();
                    }).then(function () { return post('/__tw/record', record); });
                });
            }, Promise.resolve());
        }).then(function () {
            return post('/__tw/done', env());
        }).catch(function (e) {
            post('/__tw/error', {error: String(e) + ' ' + String(e && e.stack)});
        });
    }, false);
})();
