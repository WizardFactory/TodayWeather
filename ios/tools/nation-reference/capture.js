// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-13 (#2962): it records the nationwide weather S10 in its three modes, the nationwide air S11 in its
// six tabs and the warnings S12 (the states of the Cordova manual's pages 32-35), the loading, failed and empty states
// and the dark theme, and asks the host for the screenshots. The pages are opened through the menu's own handler
// (`clickMenu`) and driven through their scopes (Ionic ignores synthetic taps).
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - 회현동 (kma-seoul) is loaded through the app's own request path and saved as the only place; S01 is closed as
//   StartCtrl closes it.
// - The local server answers /v000903/nation/KR and /v000903/kma/special as the step asks (`/__tw/answer`): the corpus
//   answers, late (after 5 s), empty, or 500.
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

    document.addEventListener('deviceready', function () {
        // The Ads SDK is not started: no UMP form or ATT prompt over the page (#2945), and no banner (IN-15).
        var admob = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        if (admob) { admob.initialize = function () { }; }
    }, false);

    function ready(i) {
        var inj = window.angular && angular.element(document.body).injector();
        if (inj && localStorage.getItem('settingsInfo') !== null) { return wait(3000); }
        if (i > 120) { return Promise.reject(new Error('app did not start')); }
        return wait(500).then(function () { return ready(i + 1); });
    }

    var inj, WeatherInfo, WeatherUtil, TwStorage, Util, $state, $rootScope;
    function closePopups() { return closeRound(0); }
    function closeRound(round) {
        var popups = Array.prototype.filter.call(document.querySelectorAll('.popup-container .popup'), visible);
        if (popups.length === 0 || round > 5) { return wait(300); }
        popups.forEach(function (p) {
            var s = angular.element(p).scope();
            if (s && s.$buttonTapped && s.buttons && s.buttons.length) {
                s.$buttonTapped(s.buttons[0], {preventDefault: function () { }, defaultPrevented: false});
            }
        });
        if ($rootScope && !$rootScope.$$phase) { $rootScope.$apply(); }
        return wait(600).then(function () { return closeRound(round + 1); });
    }
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    }
    function onScreen(el) { var r = el.getBoundingClientRect(); return visible(el) && r.left >= -1 && r.right <= innerWidth + 1; }
    function shown(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), onScreen)[0]; }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\s+/g, ' ').trim();
    }
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo || null);
        return {color: cs.color, background: cs.backgroundColor, backgroundImage: cs.backgroundImage.slice(0, 160),
            backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition, fontSize: cs.fontSize,
            fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
            border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(' ') + ' ' +
                [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].join(' '),
            borderRadius: cs.borderTopLeftRadius, padding: cs.padding, margin: cs.margin, opacity: cs.opacity,
            whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, overflow: cs.overflow,
            content: pseudo ? cs.content : undefined};
    }
    // The line boxes of an element's own text nodes (Range.getClientRects), relative to `o`.
    function lines(el, o) {
        var out = [];
        Array.prototype.forEach.call(el.childNodes, function (n) {
            if (n.nodeType !== 3 || !n.textContent.trim()) { return; }
            var range = document.createRange();
            range.selectNodeContents(n);
            Array.prototype.forEach.call(range.getClientRects(), function (r) {
                out.push({x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height});
            });
        });
        return out;
    }
    // Every visible element under el with its rect relative to `origin` (default el), its own text and style.
    function parts(el, origin) {
        var o = (origin || el).getBoundingClientRect();
        return Array.prototype.filter.call(el.querySelectorAll('*'), visible).map(function (e) {
            var r = e.getBoundingClientRect();
            return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: ownText(e),
                src: e.getAttribute('src') || undefined, natural: e.tagName === 'IMG' ? [e.naturalWidth, e.naturalHeight] : undefined,
                rect: {x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height}, style: style(e), lines: lines(e, o)};
        });
    }
    // The page shown: the active view of the nav view.
    function view() {
        return Array.prototype.filter.call(document.querySelectorAll('ion-view'), function (v) {
            return visible(v) && v.getAttribute('nav-view') === 'active' && !v.querySelector('ion-view');
        }).pop();
    }
    function content() { return view().querySelector('ion-content'); }
    function bar() {
        return shown('ion-side-menu-content .nav-bar-block[nav-bar="active"] .bar-header') ||
            shown('ion-side-menu-content .bar-header');
    }
    function header() {
        var b = bar(), back = b.querySelector('.button'), title = Array.prototype.filter.call(b.querySelectorAll('.title'), function (t) {
            return t.textContent.trim() !== '' && visible(t);
        })[0];
        return {bar: {rect: rect(b), style: style(b), after: style(b, '::after'), className: String(b.className)},
            back: back ? {rect: rect(back), style: style(back), glyph: style(back, '::before'), className: String(back.className)} : null,
            title: title ? {text: title.textContent.replace(/\s+/g, ' ').trim(), rect: rect(title), style: style(title),
                parts: parts(title, b)} : null};
    }
    function theme() { return document.body.className; }
    function loading() {
        var lc = shown('.loading-container.visible'), box = lc && lc.querySelector('.loading'), sp = box && box.querySelector('ion-spinner');
        var bd = shown('.backdrop.visible');
        return {container: lc ? {rect: rect(lc), style: style(lc), cls: lc.className} : null,
            box: box ? {rect: rect(box), style: style(box)} : null,
            spinner: sp ? {rect: rect(sp), cls: sp.className, svg: sp.innerHTML.slice(0, 2000), style: style(sp)} : null,
            backdrop: bd ? {rect: rect(bd), style: style(bd), cls: bd.className} : null};
    }
    // S10 or S11: the header, the mode buttons or pollutant tabs, the map and every label with its parts.
    function nationRecord(name) {
        var v = view(), c = content(), map = v.querySelector('.nation');
        var buttons = Array.prototype.map.call(v.querySelectorAll('.nation-bar a, .nation-air-label a'), function (a) {
            return {text: a.textContent.replace(/\s+/g, ' ').trim(), rect: rect(a), style: style(a), className: String(a.className),
                lines: lines(a, {left: 0, top: 0})};
        });
        var labels = Array.prototype.map.call(map.querySelectorAll('.nation-label'), function (l) {
            return {name: l.children[0].textContent.trim(), rect: rect(l), style: style(l), parts: parts(l)};
        });
        var buttonBar = v.querySelector('.nation-bar, .nation-air-label');
        var s = v.querySelector('ion-scroll');
        return {name: name, state: $rootScope.state, page: location.hash, theme: theme(), header: header(),
            content: {rect: rect(c), style: style(c), scrollTop: c.scrollTop},
            buttonBar: {rect: rect(buttonBar), style: style(buttonBar)},
            strip: s ? {rect: rect(s), scrollLeft: s.scrollLeft, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth} : undefined,
            buttons: buttons, map: {rect: rect(map), style: style(map)}, labels: labels, loading: loading(),
            units: inj.get('Units').getAllUnits(), viewport: {width: innerWidth, height: innerHeight}};
    }
    // S12: the header, the content and each card with its parts.
    function warningsRecord(name) {
        var v = view(), c = content();
        var cards = Array.prototype.map.call(v.querySelectorAll('.item-body'), function (card) {
            return {rect: rect(card), style: style(card), parts: parts(card), text: card.innerText};
        });
        return {name: name, state: $rootScope.state, page: location.hash, theme: theme(), header: header(),
            content: {rect: rect(c), style: style(c), scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight},
            cards: cards, loading: loading(), viewport: {width: innerWidth, height: innerHeight}};
    }

    // Asks the host to screenshot and crop `rects` (name -> CSS rect, or 'above' for the status bar over the WebView): a
    // first screenshot with a calibration marker finds the WebView's origin on the screen, the second, without it, is
    // cropped.
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
            return post('/__tw/shot', {name: prefix, rects: rects, dpr: devicePixelRatio});
        });
    }
    function capture(record, markerTop) {
        return shoot(record.name, {page: {x: 0, y: 0, w: innerWidth, h: innerHeight}, statusBar: 'above'},
            markerTop === undefined ? Math.round(innerHeight - 30) : markerTop).then(function (shot) {
            record.shot = shot;
            return post('/__tw/record', record);
        });
    }

    function menuScope() { return angular.element(document.querySelector('ion-side-menu')).scope(); }
    function viewScope() { return angular.element(content()).scope(); }
    function apply(fn) { fn(); $rootScope.$apply(); }
    function back() {
        apply(function () { viewScope().onClose(); });
        return wait(1200).then(frames);
    }
    function openMenu() {
        shown('.button.ion-navicon, .ion-navicon').click();
        return wait(900).then(frames);
    }
    // The menu row (clickMenu closes the menu and goes to the page).
    function openRow(menu, ms) {
        return openMenu().then(function () {
            apply(function () { menuScope().clickMenu(menu); });
            return wait(ms === undefined ? 2500 : ms).then(frames);
        });
    }
    function step(name) { return post('/__tw/step', {name: name}); }
    function answer(kind, how) { return post('/__tw/answer', {kind: kind, how: how}); }
    function settle() { return wait(1200).then(frames); }

    function nationPage(name) { return settle().then(function () { return capture(nationRecord(name)); }); }
    function warningsPage(name) { return settle().then(function () { return capture(warningsRecord(name), 120); }); }
    // S12 scrolled a screen under the header at a time, to the end: warnings-1, warnings-2, …
    function warningsScrolled(i) {
        var c = content(), head = bar().getBoundingClientRect().bottom;
        var step = innerHeight - head;
        var max = c.scrollHeight - c.clientHeight;
        if (c.scrollTop >= max - 0.5) { c.scrollTop = 0; return wait(300); }
        c.scrollTop = Math.min(max, c.scrollTop + step);
        return wait(800).then(frames).then(function () {
            return capture(warningsRecord('warnings-' + i), 120);
        }).then(function () { return warningsScrolled(i + 1); });
    }

    // The theme list (S08), as the settings capture chooses a theme.
    function chooseTheme(value) {
        return openMenu().then(function () {
            apply(function () { menuScope().settingRadio('theme'); });
            return wait(1200).then(frames);
        }).then(function () {
            var s = viewScope();
            apply(function () {
                s.data.value = value;
                s.valueChanged(s.list.filter(function (i) { return i.value === value; })[0]);
            });
            return wait(2500).then(frames);
        }).then(back);
    }

    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, version: Util.version, package: (menuScope() || {}).package,
            theme: $rootScope.settingsInfo && $rootScope.settingsInfo.theme, units: inj.get('Units').getAllUnits(),
            body: document.body.className};
    }
    function place() {
        return step('place').then(function () {
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
        }).then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(1500); }).then(closePopups);
    }
    // The Korea-only menu rows the WebView shows (`getRegion() === 'KR'`, `package === 'todayWeather'`).
    function menuRows() {
        return openMenu().then(function () {
            var rows = Array.prototype.filter.call(document.querySelectorAll('ion-side-menu [ng-click]'), visible).map(function (r) {
                return {click: r.getAttribute('ng-click'), text: r.textContent.replace(/\s+/g, ' ').trim()};
            });
            return post('/__tw/menu', {rows: rows});
        }).then(function () {
            var b = shown('ion-side-menu .button');
            if (b) { b.click(); }
            return wait(900);
        });
    }

    var MODES = ['nation-weather', 'nation-rain', 'nation-wind'];
    var TYPES = ['pm2.5', 'pm10', 'o3', 'no2', 'so2', 'co'];
    function korean() {
        var chain = menuRows()
            // S10 while its request runs (the server answers after 5 s), then its three modes (pages 33 and 34).
            .then(function () { return answer('nation', 'late'); }).then(function () { return step('open-nation-late'); })
            .then(function () { return openRow('nation', 1500); })
            .then(function () { return capture(nationRecord('nation-loading'), 120); })
            .then(function () { return wait(6000); });
        MODES.forEach(function (name, i) {
            chain = chain.then(function () { apply(function () { viewScope().changeWeatherType(i); }); return nationPage(name); });
        });
        // S11 in its six tabs (page 35).
        chain = chain.then(back).then(function () { return answer('nation', 'ok'); })
            .then(function () { return step('open-nation-air'); }).then(function () { return openRow('nation-air'); });
        TYPES.forEach(function (type) {
            chain = chain.then(function () { apply(function () { viewScope().changeAirType(type); }); return nationPage('nation-air-' + type); });
        });
        // S12 (page 32), from the top to the end.
        return chain.then(back).then(function () { return answer('special', 'ok'); })
            .then(function () { return step('open-kma-special'); }).then(function () { return openRow('kma-special'); })
            .then(function () { return warningsPage('warnings'); }).then(function () { return warningsScrolled(1); })
            .then(back)
            // Failed and empty answers.
            .then(function () { return answer('nation', 'fail'); })
            .then(function () { return step('open-nation-failed'); }).then(function () { return openRow('nation'); })
            .then(function () { return nationPage('nation-weather-failed'); }).then(back)
            .then(function () { return step('open-nation-air-failed'); }).then(function () { return openRow('nation-air'); })
            .then(function () { return nationPage('nation-air-failed'); }).then(back)
            .then(function () { return answer('nation', 'empty'); })
            .then(function () { return step('open-nation-empty'); }).then(function () { return openRow('nation'); })
            .then(function () { return nationPage('nation-weather-empty'); }).then(back)
            .then(function () { return answer('special', 'empty'); })
            .then(function () { return step('open-kma-special-empty'); }).then(function () { return openRow('kma-special'); })
            .then(function () { return warningsPage('warnings-empty'); }).then(back)
            .then(function () { return answer('special', 'fail'); })
            .then(function () { return step('open-kma-special-failed'); }).then(function () { return openRow('kma-special', 5000); })
            .then(function () { return warningsPage('warnings-failed'); }).then(back)
            // The dark theme.
            .then(function () { return answer('nation', 'ok'); }).then(function () { return answer('special', 'ok'); })
            .then(function () { return step('theme-dark'); }).then(function () { return chooseTheme('dark'); })
            .then(function () { return step('open-nation-dark'); }).then(function () { return openRow('nation'); })
            .then(function () { return nationPage('nation-weather-dark'); }).then(back)
            .then(function () { return step('open-kma-special-dark'); }).then(function () { return openRow('kma-special'); })
            .then(function () { return warningsPage('warnings-dark'); }).then(back)
            .then(function () { return step('theme-light'); }).then(function () { return chooseTheme('light'); });
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            inj = angular.element(document.body).injector();
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            return post('/__tw/env', {phase: 'start', env: env()});
        }).then(closePopups).then(place).then(korean)
            .then(function () { return post('/__tw/done', env()); })
            .catch(function (e) { post('/__tw/error', {error: String(e) + ' ' + String(e && e.stack)}); });
    }, false);
})();
