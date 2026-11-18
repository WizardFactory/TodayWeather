// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-14 (#2963): it records the notification settings S09 (setting-push.html, PushCtrl) with the time
// picker O14, the save confirmation O12, the equal-hours message O13 and the permission dialog O11, and TabCtrl's
// weather-alert introduction O06 and foreground notification O07 over the Hourly tab (the Cordova manual's pages 21-23),
// and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead. The local server answers the weather requests with the corpus response kma-seoul.
// - The firebasex messaging plugin's grantPermission and hasPermission are answered here (granted; notifications off
//   while `permissionOff` is set), so the system's notification prompt never covers the page. No FCM token exists, so
//   nothing is posted (a push request fails the run).
// - The Ads SDK is not started: no UMP form or ATT prompt over the page (#2945), and no banner.
// - 서울 is added with the app's own services (as places-reference adds it); S01 is closed as StartCtrl closes it. S09
//   opens by its state (`setting-push?fav=1`, after a visit of the Locations tab, so no earlier S09 view is kept), and
//   PushCtrl and TabCtrl are driven through their own scope functions and events (Ionic ignores synthetic clicks):
//   settings      S09 of 서울 without records: the defaults (manual page 21)
//   picker        O14 on the add row (08 : 00 AM; page 22)
//   picker-alarm  O14 on the 7:40 row
//   confirm       O12 after the back arrow (`onClose`; the defaults count as edits; page 23)
//   alert-off     the alert's switch off (`ng-change`): the hour bar hidden
//   equal         O13 after Save (`onOkay`) with a stored alert from 09 to 09 and an alarm at 07:40
//   permission    O11 at the page's opening while hasPermission reports notifications off
//   intro         O06 over Hourly (`showAlertInfoEvent`)
//   foreground    O07 over Hourly (`notificationEvent` with a title and a message, as the iOS branch builds it)
(function () {
    'use strict';
    var server = window.TW_SERVER;

    // SearchCtrl (the Locations tab S09 opens from) loads the Google Maps JavaScript API unless `window.google` exists:
    // an inert stand-in, so no script is fetched.
    window.google = {maps: {places: {
        AutocompleteService: function () { this.getPlacePredictions = function () { }; },
        PlacesServiceStatus: {OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS'}
    }}};

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


    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shownAll(sel, root) { return Array.prototype.filter.call((root || document).querySelectorAll(sel), visible); }
    function shown(sel, root) { return shownAll(sel, root)[0]; }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\s+/g, ' ').trim();
    }
    var PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'opacity',
        'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom', 'margin-left',
        'margin-right', 'border-top-width', 'border-bottom-width', 'border-left-width', 'border-top-color',
        'border-radius', 'text-align', 'visibility', 'white-space', 'min-height', 'height', 'letter-spacing', 'vertical-align'];
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo), o = {};
        PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
        return o;
    }
    function part(el) {
        return el ? {rect: rect(el), style: style(el), className: String(el.getAttribute('class') || ''),
            text: el.textContent.replace(/\s+/g, ' ').trim()} : null;
    }
    // Each line box of an element's text nodes, as WebKit broke them.
    function lines(el) {
        var out = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node;
        while ((node = walker.nextNode())) {
            for (var i = 0; i < node.textContent.length; i++) {
                range.setStart(node, i); range.setEnd(node, i + 1);
                var r = range.getClientRects()[0];
                if (!r) { continue; }
                var last = out[out.length - 1];
                if (!last || Math.abs(last.y - r.top) > 2) { out.push({x: r.left, y: r.top, h: r.height, w: r.width, text: node.textContent[i]}); }
                else { last.text += node.textContent[i]; last.w = r.right - last.x; }
            }
        }
        return out.filter(function (l) { return l.text.trim() !== ''; });
    }
    // Every element of the view with a box; rects in the WebView's coordinates.
    function elements(root) {
        return Array.prototype.filter.call(root.querySelectorAll('*'), function (e) {
            var r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
        }).map(function (e) {
            var out = part(e);
            out.tag = e.tagName.toLowerCase();
            out.text = ownText(e);
            if (e.tagName === 'IMG') { out.src = e.getAttribute('src'); out.natural = {w: e.naturalWidth, h: e.naturalHeight}; }
            if (e.tagName === 'INPUT') {
                out.value = e.value;
                out.placeholder = e.getAttribute('placeholder');
                var ph = getComputedStyle(e, '::placeholder');
                out.placeholderStyle = {color: ph.color, fontSize: ph.fontSize};
            }
            var before = getComputedStyle(e, '::before').content;
            if (before && before !== 'none' && before !== 'normal') {
                out.glyph = before; out.glyphStyle = style(e, '::before');
            }
            return out;
        });
    }


    var permissionOff = false;
    // The plugin's permission calls, answered without the system prompt.
    function stubMessaging() {
        var m = window.FirebasexMessaging;
        if (!m) { return false; }
        m.grantPermission = function (success) { setTimeout(function () { success(true); }, 0); };
        m.hasPermission = function (success) { setTimeout(function () { success(!permissionOff); }, 0); };
        return true;
    }
    var stubbed = false;
    document.addEventListener('deviceready', function () {
        var admob = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        if (admob) { admob.initialize = function () { }; }
        stubbed = stubMessaging();
    }, false);

    var inj, WeatherInfo, WeatherUtil, TwStorage, Util, Push, $state, $rootScope;

    function ready(i) {
        inj = window.angular && angular.element(document.body).injector();
        if (inj && localStorage.getItem('settingsInfo') !== null && shown('.popup-container .popup')) { return wait(2500); }
        if (i > 240) { return Promise.reject(new Error('the app did not start')); }
        return wait(500).then(function () { return ready(i + 1); });
    }
    function apply() { if (!$rootScope.$$phase) { $rootScope.$apply(); } }
    // Closes the popups shown with the button `index` (default: the first) through the popup's own handler.
    function closePopups(index) {
        shownAll('.popup-container .popup').forEach(function (popup) {
            var s = angular.element(popup).scope();
            if (s && s.buttons) {
                s.$buttonTapped(s.buttons[index || 0], {preventDefault: function () { }, defaultPrevented: false});
            }
        });
        apply();
        return wait(1000).then(frames);
    }

    function addPlace(city) {
        return Promise.resolve(WeatherUtil.getWeatherByGeoInfo({location: city.location})).then(function (weatherData) {
            var data = WeatherUtil.convertWeatherData(weatherData);
            if (!data) { throw new Error('the fixture did not convert for ' + city.name); }
            Object.keys(data).forEach(function (k) { if (city[k] === undefined) { city[k] = data[k]; } });
            if (WeatherInfo.addCity(city) === false) { throw new Error('not added: ' + city.name); }
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            TwStorage.set('startVersion', Util.startVersion); // StartCtrl's close()
        });
    }
    // Push's list for 서울 (index 1): none, or an alert from `start` to `end` and an alarm at 07:40 Mon-Fri.
    function seed(start, end) {
        Push.pushData.pushList = start === null ? [] : [Push.newPushAlert(1, 1, start, end),
            Push.newPushAlarm(2, 1, 7 * 3600 + 40 * 60, [false, true, true, true, true, true, false])];
        Push.savePushInfo();
    }
    function view() { return shownAll('ion-view').filter(function (v) { return v.querySelector('.buttons-bottom'); })[0]; }
    function pushScope() { var v = view(); return v && angular.element(v.querySelector('ion-content')).scope(); }
    function navBar() { return shownAll('.nav-bar-block[nav-bar="active"] ion-header-bar')[0] || shownAll('ion-header-bar')[0]; }
    // A new S09 visit of 서울 (`cache: false`), from the Locations tab as the bell opens it.
    function openPush() {
        return closePopups().then(function () { return $state.go('tab.search', {}, {reload: true}); })
            .then(function () { return wait(2000); }).then(closePopups)
            .then(function () { return $state.go('setting-push', {fav: 1}, {reload: true}); })
            .then(function () { return wait(2500).then(frames); })
            .then(function () { if (!view()) { throw new Error('S09 did not open: ' + location.hash); } });
    }
    function openHourly() {
        return closePopups().then(function () { return $state.go('tab.forecast', {}, {reload: true}); })
            .then(function () { return wait(3000).then(frames); }).then(closePopups);
    }
    function mode() {
        var s = pushScope();
        return {hash: location.hash, popups: shownAll('.popup-container .popup').length, cities: WeatherInfo.getCityCount(),
            cityIndex: WeatherInfo.getCityIndex(), stubbed: stubbed, inited: Push.inited, permissionOff: permissionOff,
            records: Push.pushData.pushList.length, token: !!Push.pushData.fcmToken,
            alert: s && s.alert ? {enable: s.alert.enable} : null, alarms: s && s.alarmList ? s.alarmList.length : null,
            days: s && s.dayOfWeek ? s.dayOfWeek.slice() : null};
    }

    function shoot(prefix, rects) {
        var m = document.createElement('div');
        var top = Math.round(innerHeight - 140);
        m.style.cssText = 'position:fixed;left:' + (innerWidth - 20) + 'px;top:' + top + 'px;width:20px;height:20px;' +
            'background:#ff00ff;z-index:2147483647';
        document.body.appendChild(m);
        return frames().then(function () { return wait(300); }).then(function () {
            return post('/__tw/origin', {name: prefix, dpr: devicePixelRatio, marker: {left: innerWidth - 20, top: top, size: 20}});
        }).then(function () {
            m.remove();
            return frames().then(function () { return wait(400); });
        }).then(function () {
            return post('/__tw/shot', {name: prefix, rects: rects, dpr: devicePixelRatio});
        });
    }

    function style2(el, pseudo) {
        var cs = getComputedStyle(el, pseudo), o = style(el, pseudo);
        o['box-shadow'] = cs.boxShadow; o['border-style'] = cs.borderTopStyle; o['border-right-width'] = cs.borderRightWidth;
        o['border-bottom-color'] = cs.borderBottomColor; o['background-image'] = cs.backgroundImage;
        o['background-position'] = cs.backgroundPosition; o['text-transform'] = cs.textTransform; o.display = cs.display;
        o.position = cs.position; o.width = cs.width; o.top = cs.top; o.left = cs.left; o.transform = cs.transform;
        if (pseudo) { o.content = cs.content; }
        return o;
    }
    function full(el) {
        if (!el) { return null; }
        return {rect: rect(el), style: style2(el), className: String(el.getAttribute('class') || ''),
            text: el.textContent.replace(/\s+/g, ' ').trim(), lines: lines(el)};
    }
    function glyph(el) {
        if (!el) { return null; }
        return {rect: rect(el), className: String(el.getAttribute('class') || ''), style: style2(el),
            before: style2(el, '::before')};
    }
    function pageRecord() {
        var v = view();
        if (!v) { return null; }
        var s = shownAll('.irs', v)[0];
        var slider = s && s.parentNode;
        var one = function (sel) { return full(slider.querySelector(sel)); };
        var toggle = shownAll('.toggle', v)[0];
        return {
            content: full(v.querySelector('ion-content')),
            scroll: full(v.querySelector('.scroll')),
            cards: shownAll('.list.card', v).map(full),
            items: shownAll('.item', v).map(full),
            titles: shownAll('.item-title', v).map(full),
            descriptions: shownAll('.item-desc', v).map(full),
            toggle: toggle && {toggle: full(toggle), track: full(toggle.querySelector('.track')),
                handle: full(toggle.querySelector('.handle')), handleBefore: style2(toggle.querySelector('.handle'), '::before'),
                checked: toggle.querySelector('input').checked},
            slider: slider && {item: full(slider), irs: one('.irs'), line: one('.irs-line'),
                lineParts: shownAll('.irs-line > span', slider).map(full), bar: one('.irs-bar'),
                barEdge: one('.irs-bar-edge'), shadow: one('.irs-shadow'), min: one('.irs-min'), max: one('.irs-max'),
                from: one('.irs-from'), to: one('.irs-to'), single: one('.irs-single'),
                handles: shownAll('.irs-slider', slider).map(full),
                grid: one('.irs-grid'), pols: shownAll('.irs-grid-pol', slider).map(full),
                texts: shownAll('.irs-grid-text', slider).map(full)},
            dayRow: full(shownAll('.item.row', v)[0]),
            days: shownAll('.day-button', v).map(full),
            alarmRows: shownAll('.item-icon-right', v).map(function (row) {
                return {row: full(row), icon: glyph(row.querySelector('i.icon'))};
            }),
            buttonsBottom: full(v.querySelector('.buttons-bottom')),
            buttons: shownAll('.buttons-bottom .button', v).map(full),
            elements: elements(v)
        };
    }
    function headerRecord() {
        var bar = navBar();
        if (!bar) { return null; }
        var back = shownAll('.button', bar)[0];
        return {bar: full(bar), back: back && glyph(back), title: full(shownAll('.title', bar)[0]), elements: elements(bar)};
    }
    function popupRecord() {
        var p = shownAll('.popup-container .popup')[0];
        if (!p) { return null; }
        var container = p.closest('.popup-container');
        return {container: full(container), popup: full(p), head: full(p.querySelector('.popup-head')),
            title: full(p.querySelector('.popup-title')), subTitle: full(p.querySelector('.popup-sub-title')),
            body: full(p.querySelector('.popup-body')), buttonBar: full(p.querySelector('.popup-buttons')),
            buttons: shownAll('.popup-buttons .button', p).map(full),
            heading: full(p.querySelector('.heading')),
            boxes: shownAll('.time_picker_box_text', p).map(full),
            colons: shownAll('.time_picker_colon', p).map(full),
            arrows: shownAll('.time_picker_arrows', p).map(function (a) { return {rect: rect(a), icon: glyph(a.querySelector('.icon'))}; }),
            rows: shownAll('.row', p).map(full),
            backdrop: full(shown('.backdrop.visible') || document.querySelector('.backdrop')),
            elements: elements(p)};
    }
    function tabsRecord() {
        var t = shown('.tabs');
        return t ? {tabs: full(t)} : null;
    }

    function record(name, check) {
        var m = mode();
        if (!check(m)) { return Promise.reject(new Error(name + ': ' + JSON.stringify(m))); }
        var out = {name: name, mode: m, env: env(), header: headerRecord(), page: pageRecord(), popup: popupRecord(),
            tabs: tabsRecord(), view: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
            scripts: Array.prototype.map.call(document.scripts, function (s) { return s.src || null; }).filter(function (s) { return s; })};
        var rects = {page: {x: 0, y: 0, w: innerWidth, h: innerHeight}, statusBar: 'above'};
        return shoot(name, rects).then(function (shot) {
            out.shot = shot;
            return post('/__tw/record', out);
        });
    }

    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, theme: $rootScope.settingsInfo && $rootScope.settingsInfo.theme,
            body: document.body.className, state: $rootScope.state, messaging: !!window.FirebasexMessaging};
    }
    function step(name) { return post('/__tw/step', {name: name}); }
    function act(fn, ms) { return function () { fn(); apply(); return wait(ms || 1500).then(frames); }; }

    var SEOUL = {name: '서울', address: '대한민국 서울특별시', country: 'KR', location: {lat: 37.567, long: 126.978}, currentPosition: false};
    var S09 = function (m) { return m.hash.indexOf('#/setting-push') === 0 && m.cityIndex === 1 && m.stubbed && m.inited && !m.token; };
    var TITLE = window.TW_LANG === 'ko-KR' ? '오늘날씨' : 'TodayWeather';

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); Push = inj.get('Push'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            return post('/__tw/env', {phase: 'start', env: env()});
        }).then(function () { return closePopups(); })
            .then(function () { return addPlace(SEOUL); })
            .then(function () { seed(null); })
            .then(openPush)
            .then(function () { return step('settings'); })
            .then(function () { return record('settings', function (m) { return S09(m) && !m.popups && m.alarms === 2 && m.records === 0; }); })
            .then(act(function () { var s = pushScope(); s.onOpenTimePicker(s.alarmList.length); }))
            .then(function () { return step('picker'); })
            .then(function () { return record('picker', function (m) { return S09(m) && m.popups === 1; }); })
            .then(function () { return closePopups(2); }) // Close
            .then(act(function () { pushScope().onOpenTimePicker(0); }))
            .then(function () { return step('picker-alarm'); })
            .then(function () { return record('picker-alarm', function (m) { return S09(m) && m.popups === 1; }); })
            .then(function () { return closePopups(2); })
            .then(act(function () { pushScope().onClose(); }))
            .then(function () { return step('confirm'); })
            .then(function () { return record('confirm', function (m) { return S09(m) && m.popups === 1; }); })
            .then(function () { return closePopups(0); }) // Close: back without saving
            .then(openPush)
            .then(act(function () { var s = pushScope(); s.alert.enable = false; s.onToggleEnableAlert(); }))
            .then(function () { return step('alert-off'); })
            .then(function () { return record('alert-off', function (m) { return S09(m) && !m.popups && m.alert && m.alert.enable === false; }); })
            .then(function () { seed(9, 9); })
            .then(openPush)
            .then(act(function () { pushScope().onOkay(); }))
            .then(function () { return step('equal'); })
            .then(function () { return record('equal', function (m) { return S09(m) && m.popups === 1 && m.records === 2; }); })
            .then(function () { return closePopups(0); })
            .then(function () { seed(null); permissionOff = true; })
            .then(openPush)
            .then(function () { return step('permission'); })
            .then(function () { return record('permission', function (m) { return S09(m) && m.popups === 1 && m.permissionOff; }); })
            .then(function () { permissionOff = false; return closePopups(0); })
            .then(openHourly)
            .then(act(function () { $rootScope.$broadcast('showAlertInfoEvent'); }))
            .then(function () { return step('intro'); })
            .then(function () { return record('intro', function (m) { return m.hash.indexOf('#/tab/forecast') === 0 && m.popups === 1; }); })
            .then(function () { return closePopups(0); }) // Close: the alerts stay as they are, nothing is posted
            .then(act(function () { $rootScope.$broadcast('notificationEvent', {title: TITLE, message: 'Seoul 7:40 sunny'}); }))
            .then(function () { return step('foreground'); })
            .then(function () { return record('foreground', function (m) { return m.hash.indexOf('#/tab/forecast') === 0 && m.popups === 1; }); })
            .then(function () { return closePopups(0); })
            .then(function () { return post('/__tw/done', env()); })
            .catch(function (e) { return post('/__tw/error', {error: String(e && e.stack || e)}); });
    }, false);
}());
