// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-12 (#2961): it records the settings pages S07 and S08, the weather page after a unit and a theme
// change and the About popup O10 (the states of the Cordova manual's pages 25-31 and 36), and asks the host for the
// screenshots. The page's own controllers are driven through their scopes (Ionic ignores synthetic taps), in the order
// a user goes: the menu, 단위설정, each unit's list, 온도단위 F, back to the weather, the startup page, the refresh
// interval, the theme list, each theme, About.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - 회현동 (kma-seoul) is loaded through the app's own request path and saved as the only place; S01 is closed as
//   StartCtrl closes it. The server answers a weather request in °F with kma-seoul-f, as the server converts units.
// - WebKit's URL of the mail link: the strings the Cordova code assigns to location.href (from the JavaScriptCore
//   golden) parsed by this WebView's URL parser (`new URL(text).href`), which the navigation uses.
(function () {
    'use strict';
    var server = window.TW_SERVER;
    var lang = window.TW_LANG;

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

    var inj, WeatherInfo, WeatherUtil, TwStorage, Util, $state, $rootScope, $ionicHistory;
    // Closes the popups shown with their first button through the popup's own handler (`$buttonTapped`, what its
    // ng-click calls), so Ionic hides its shared backdrop as it does after a tap; Ionic ignores synthetic clicks.
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
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shown(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible)[0]; }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\s+/g, ' ').trim();
    }
    var PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'opacity',
        'text-shadow', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom',
        'border-top-width', 'border-bottom-width', 'border-top-color', 'vertical-align', 'text-align', 'visibility'];
    function style(el) {
        var cs = getComputedStyle(el), o = {};
        PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
        return o;
    }
    function part(el) { return el ? {rect: rect(el), style: style(el), className: String(el.className)} : null; }
    // Every element of a block with its own text, an image or a glyph; rects relative to the block's top left.
    function elements(block) {
        var b = block.getBoundingClientRect();
        return Array.prototype.filter.call(block.querySelectorAll('*'), function (e) {
            var r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' &&
                (ownText(e) !== '' || e.tagName === 'IMG' || e.tagName === 'I' || e.tagName === 'svg' ||
                 /(^|\s)(ion-|icon-)/.test(e.getAttribute('class') || ''));
        }).map(function (e) {
            var cs = getComputedStyle(e), r = e.getBoundingClientRect();
            return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: ownText(e), src: e.getAttribute('src') || undefined,
                rect: {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height}, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, color: cs.color, background: cs.backgroundColor,
                opacity: cs.opacity};
        });
    }
    function content() { return shown('ion-content.main-content'); }

    // The header bar of the shown view (the nav bar's `.bar-header` in the side menu's content).
    function navBar() {
        // The active view's bar (Ionic keeps the previous view's bar, hidden, in the other nav-bar block).
        var bar = shown('ion-side-menu-content .nav-bar-block[nav-bar="active"] .bar-header') ||
            shown('ion-side-menu-content .bar-header');
        var out = part(bar);
        var title = Array.prototype.filter.call(bar.querySelectorAll('.title'), function (t) {
            return t.textContent.trim() !== '' && visible(t);
        })[0];
        out.title = title ? {text: title.textContent.replace(/\s+/g, ' ').trim(), rect: rect(title), style: style(title)} : null;
        out.buttons = Array.prototype.filter.call(bar.querySelectorAll('.button'), visible).map(function (b) {
            return {className: String(b.className), rect: rect(b), style: style(b)};
        });
        return out;
    }

    // A settings page (S07 or S08): the bar, the content and every row with its texts, value or check mark.
    function settingsPage(name) {
        var c = content();
        var rows = Array.prototype.filter.call(c.querySelectorAll('.list .item'), visible).map(function (e) {
            var value = e.querySelector('span'), item = e.querySelector('.item-content'), icon = e.querySelector('.radio-icon');
            var input = e.querySelector('input');
            return {text: (item || e).textContent.replace(/\s+/g, ' ').trim(), label: ownText(item || e), rect: rect(e), style: style(e),
                content: item ? {rect: rect(item), style: style(item)} : null,
                value: value ? {text: value.textContent.trim(), rect: rect(value), style: style(value)} : null,
                check: icon ? {rect: rect(icon), style: style(icon), checked: !!(input && input.checked),
                    shown: getComputedStyle(icon).visibility !== 'hidden', glyph: getComputedStyle(icon, '::before').content} : null};
        });
        return {name: name, state: $rootScope.state, body: document.body.className, header: navBar(),
            content: part(c), list: part(c.querySelector('.list')), rows: rows,
            viewport: {width: innerWidth, height: innerHeight}};
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

    function capturePage(name) {
        return wait(1200).then(frames).then(function () {
            var record = settingsPage(name);
            return shoot(name, {page: {x: 0, y: 0, w: innerWidth, h: innerHeight}, statusBar: 'above'},
                Math.round(innerHeight - 60)).then(function (shot) {
                record.shot = shot;
                return post('/__tw/record', record);
            });
        });
    }

    function menuScope() { return angular.element(document.querySelector('ion-side-menu')).scope(); }
    function viewScope() { return angular.element(content()).scope(); }
    function back() {
        viewScope().onClose(); $rootScope.$apply();
        return wait(1200).then(frames);
    }
    function apply(fn) { fn(); $rootScope.$apply(); }

    // The menu button of the tab's header bar (a click reaches Ionic's button), then the row's handler: the rows that open
    // a page toggle the menu closed first.
    function openMenu() {
        shown('.button.ion-navicon, .ion-navicon').click();
        return wait(900).then(frames);
    }
    // S07 from the menu (clickMenu('units') closes the menu and opens the page).
    function openUnits() {
        return openMenu().then(function () {
            apply(function () { menuScope().clickMenu('units'); });
            return wait(1200).then(frames);
        });
    }
    function openUnitList(name) {
        var s = viewScope();
        apply(function () { s.settingRadio(s.units.filter(function (u) { return u.name === name; })[0]); });
        return wait(1200).then(frames);
    }
    function openMenuList(name) {
        return openMenu().then(function () {
            apply(function () { menuScope().settingRadio(name); });
            return wait(1200).then(frames);
        });
    }
    // RadioCtrl's valueChanged, as the radio's ng-change calls it for another value.
    function choose(value) {
        var s = viewScope();
        apply(function () {
            s.data.value = value;
            s.valueChanged(s.list.filter(function (i) { return i.value === value; })[0]);
        });
        return wait(2500).then(frames);
    }
    function step(name) { return post('/__tw/step', {name: name}); }

    // The weather page's blocks 0 (the header block with the bar over it) and 1 (the hourly chart), as the forecast
    // capture cuts them: in view between the bars, a screen at a time.
    function bars() {
        var header = shown('ion-side-menu-content .bar-header'), tabs = shown('.tabs');
        return {top: header ? header.getBoundingClientRect().bottom : 0, bottom: tabs ? tabs.getBoundingClientRect().top : innerHeight};
    }
    function weatherBlocks() {
        var scroll = content().querySelector('.scroll') || content();
        var list = [];
        Array.prototype.forEach.call(scroll.children, function (child) {
            if (!visible(child)) { return; }
            var header = child.querySelector('[md-page-header]');
            if (header) {
                list.push(header);
                Array.prototype.forEach.call(child.children, function (c) { if (c !== header && visible(c)) { list.push(c); } });
            } else {
                list.push(child);
            }
        });
        return list;
    }
    function cut(page, i) {
        var el = weatherBlocks()[i];
        var c = content();
        if (i === 0) { c.scrollTop = 0; } else { c.scrollTop += el.getBoundingClientRect().top - bars().top; }
        return wait(500).then(function () {
            var r = el.getBoundingClientRect(), b = bars();
            var top = i === 0 ? 0 : b.top;
            if (r.bottom > b.bottom + 0.5) { throw new Error(page + ' block ' + i + ' is taller than the screen'); }
            if (i !== 0 && r.top < top - 0.5) { throw new Error(page + ' block ' + i + ' starts above the bar'); }
            var record = {index: i, cls: el.getAttribute('class') || '', rect: rect(el), bars: b, background: getComputedStyle(el).backgroundColor,
                elements: elements(el)};
            var from = i === 0 ? 0 : r.top;
            return post('/__tw/shot', {name: page + '-' + i, dpr: devicePixelRatio,
                rects: {block: {x: r.left, y: from, w: r.width, h: r.bottom - from}}}).then(function (shot) {
                record.shot = shot;
                return record;
            });
        });
    }
    function weatherPage(name) {
        return Promise.resolve($state.go('tab.forecast')).then(function () { return wait(1500); }).then(closePopups).then(function () {
            $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply();
            return wait(1500);
        }).then(closePopups).then(frames).then(function () {
            // The calibration marker in the page's middle, where neither block is cut.
            return shoot(name + '-calibration', {}, Math.round(innerHeight / 2));
        }).then(function () {
            var record = {name: name, state: $rootScope.state, body: document.body.className, header: navBar(),
                units: inj.get('Units').getAllUnits(), theme: $rootScope.settingsInfo.theme, blocks: []};
            return cut(name, 0).then(function (b) { record.blocks.push(b); return cut(name, 1); }).then(function (b) {
                record.blocks.push(b);
                content().scrollTop = 0;
                return post('/__tw/record', record);
            });
        });
    }

    // About (O10) over the menu: the popup and its parts.
    function about(name) {
        return openMenu().then(function () {
            apply(function () { menuScope().clickMenu('openInfo'); });
            return wait(1200).then(frames);
        }).then(function () {
            var popup = shown('.popup-container .popup');
            if (!popup) { throw new Error('no About popup'); }
            var head = popup.querySelector('.popup-head'), body = popup.querySelector('.popup-body');
            var record = {name: name, popup: part(popup), head: part(head), title: part(popup.querySelector('.popup-title')),
                body: part(body), bodyText: body.innerText, bodyHtml: body.innerHTML.trim(),
                buttons: Array.prototype.map.call(popup.querySelectorAll('.popup-buttons button'), function (b) {
                    return {text: b.textContent.trim(), rect: rect(b), className: String(b.className), style: style(b)};
                }),
                backdrop: part(document.querySelector('.backdrop')), viewport: {width: innerWidth, height: innerHeight}};
            record.title.text = popup.querySelector('.popup-title').textContent.trim();
            return shoot(name, {page: {x: 0, y: 0, w: innerWidth, h: innerHeight}}, 20).then(function (shot) {
                record.shot = shot;
                return post('/__tw/record', record);
            });
        }).then(function () {
            return closePopups();
        }).then(function () {
            var b = shown('ion-side-menu .button');
            if (b) { b.click(); }
            return wait(900);
        });
    }

    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, version: Util.version,
            theme: $rootScope.settingsInfo && $rootScope.settingsInfo.theme, units: inj.get('Units').getAllUnits(),
            body: document.body.className};
    }
    function place() {
        return post('/__tw/step', {name: 'place'}).then(function () {
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
    // WebKit's parse of the mail links (from the golden) and the WebView's user agent.
    function mail() {
        return request('GET', '/__tw/mail-raw').then(function (raws) {
            return post('/__tw/mail', {hrefs: raws.map(function (r) { return {raw: r, href: new URL(r).href}; }),
                userAgent: navigator.userAgent});
        });
    }

    var UNITS = ['temperatureUnit', 'windSpeedUnit', 'pressureUnit', 'distanceUnit', 'precipitationUnit', 'airUnit'];
    function korean() {
        var chain = openUnits().then(function () { return capturePage('units'); });
        UNITS.forEach(function (name) {
            chain = chain.then(function () { return step('open-' + name); }).then(function () { return openUnitList(name); })
                .then(function () { return capturePage('radio-' + name); }).then(back);
        });
        return chain.then(function () { return step('open-temperatureUnit'); })
            .then(function () { return openUnitList('temperatureUnit'); })
            .then(function () { return step('choose-temperatureUnit-F'); }).then(function () { return choose('F'); })
            .then(function () { return capturePage('radio-temperatureUnit-f'); })
            .then(function () { return step('back'); }).then(back).then(function () { return capturePage('units-f'); }).then(back)
            .then(function () { return weatherPage('hourly-f'); })
            .then(function () { return openUnits(); }).then(function () { return openUnitList('temperatureUnit'); })
            .then(function () { return step('choose-temperatureUnit-C'); }).then(function () { return choose('C'); })
            .then(back).then(back)
            .then(function () { return step('open-startupPage'); }).then(function () { return openMenuList('startupPage'); })
            .then(function () { return capturePage('radio-startupPage'); }).then(back)
            .then(function () { return step('open-refreshInterval'); }).then(function () { return openMenuList('refreshInterval'); })
            .then(function () { return capturePage('radio-refreshInterval'); }).then(back)
            .then(function () { return step('open-theme'); }).then(function () { return openMenuList('theme'); })
            .then(function () { return capturePage('radio-theme'); })
            .then(function () { return step('choose-theme-dark'); }).then(function () { return choose('dark'); })
            .then(function () { return capturePage('radio-theme-dark'); }).then(back)
            .then(function () { return weatherPage('hourly-dark'); })
            .then(function () { return openMenuList('theme'); })
            .then(function () { return step('choose-theme-photo'); }).then(function () { return choose('photo'); })
            .then(function () { return capturePage('radio-theme-photo'); }).then(back)
            .then(function () { return weatherPage('hourly-photo'); })
            .then(function () { return openMenuList('theme'); })
            .then(function () { return step('choose-theme-light'); }).then(function () { return choose('light'); }).then(back)
            .then(function () { return step('about'); }).then(function () { return about('about'); })
            .then(mail);
    }
    function english() {
        var chain = openUnits().then(function () { return capturePage('units'); });
        if (window.TW_MATRIX) {
            // ios/tools/matrix-reference: S08 too, the temperature list as the Korean set opens it.
            chain = chain.then(function () { return step('open-temperatureUnit'); })
                .then(function () { return openUnitList('temperatureUnit'); })
                .then(function () { return capturePage('radio-temperatureUnit'); }).then(back);
        }
        return chain.then(back)
            .then(function () { return step('about'); }).then(function () { return about('about'); });
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            inj = angular.element(document.body).injector();
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            $ionicHistory = inj.get('$ionicHistory');
            return post('/__tw/env', {phase: 'start', env: env()});
        }).then(closePopups).then(place).then(function () { return lang === 'ko-KR' ? korean() : english(); })
            .then(function () { return post('/__tw/done', env()); })
            .catch(function (e) { post('/__tw/error', {error: String(e) + ' ' + String(e && e.stack)}); });
    }, false);
})();
