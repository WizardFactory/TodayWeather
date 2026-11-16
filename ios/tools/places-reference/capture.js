// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-11 (#2960): it records the saved places S02 (tab-search.html, SearchCtrl) in the states of the
// Cordova manual's pages 13, 14, 18 and 19, and the list with an alarm's bell, and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says. The local
//   server answers the weather requests with the corpus responses (kma-seoul; vc-london for London's coordinates) and
//   the coordinates geocode with geocode-seoul.
// - SearchCtrl loads the Google Maps JavaScript API unless `window.google` exists; an inert stand-in is defined first,
//   so no script is fetched and no prediction is shown (the towns are the bundled list's).
// - The Ads SDK is not started: no UMP form or ATT prompt over the page (#2945), and no banner.
// - Places are added with the app's own services (WeatherUtil.getWeatherByGeoInfo through the local server,
//   WeatherInfo.addCity), as the manual's run had added them; S01 is closed as StartCtrl closes it. Modes change
//   through SearchCtrl's own handlers (Ionic ignores synthetic clicks): a focus without the keyboard, the word set as
//   typing sets it, OnEdit, OnSearchCurrentPosition (the real position: capture.py grants location and sets the
//   simulator's position).
//   favorites   the list with 서울 (manual page 13)
//   search      the search for 부산: 현재위치로 지역찾기, ten bundled towns and "powered by TodayWeather" (page 14)
//   list        서울, 부산광역시 and London, London with an enabled alarm (its bell on)
//   edit        edit mode with 현재위치 (switch off), 서울, 부산광역시 and London (page 18)
//   location    the find-by-location result with Google's logo (page 19)
(function () {
    'use strict';
    var server = window.TW_SERVER;

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

    document.addEventListener('deviceready', function () {
        var admob = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        if (admob) { admob.initialize = function () { }; }
    }, false);

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

    var inj, WeatherInfo, WeatherUtil, TwStorage, Util, Push, $state, $rootScope;

    function ready(i) {
        inj = window.angular && angular.element(document.body).injector();
        if (inj && localStorage.getItem('settingsInfo') !== null && shown('.popup-container .popup')) { return wait(2500); }
        if (i > 240) { return Promise.reject(new Error('the app did not start')); }
        return wait(500).then(function () { return ready(i + 1); });
    }
    // Closes the shown popups through their own handlers (O01 on S01).
    function closePopups() {
        shownAll('.popup-container .popup').forEach(function (popup) {
            var s = angular.element(popup).scope();
            if (s && s.buttons) { s.$buttonTapped(s.buttons[0], {preventDefault: function () { }, defaultPrevented: false}); }
        });
        if (!$rootScope.$$phase) { $rootScope.$apply(); }
        return wait(1000).then(frames);
    }
    function apply() { if (!$rootScope.$$phase) { $rootScope.$apply(); } }

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
    function input() { return shown('#searchInput'); }
    function view() { var c = shown('ion-content[delegate-handle="cityList"]'); return c && c.closest('ion-view'); }
    function scope() { return angular.element(input()).scope(); }
    // A new visit of S02 (`cache: false`).
    function openSearch() {
        return Promise.resolve($state.go('tab.search', {}, {reload: true})).then(function () { return wait(2500); })
            .then(closePopups).then(function () {
                if (!input() || !view()) { throw new Error('S02 did not open: ' + location.hash); }
            });
    }
    function mode() {
        var s = scope();
        return {hash: location.hash, editing: s.isEditing, searching: s.isSearching, word: s.search && s.search.word,
            towns: (s.searchResults || []).length, results: (s.searchResults2 || []).length, cities: WeatherInfo.getCityCount(),
            popups: shownAll('.popup-container .popup').length};
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

    function record(name) {
        var v = view();
        var header = input().closest('.search-header');
        var bar = header.closest('.bar');
        var tabs = shown('.tabs');
        var rows = shownAll('.list .item', v).map(function (item) {
            var name = item.querySelector('.search-name');
            var img = item.querySelector('.search-item img');
            var temp = shownAll('.search-item span', item);
            var bell = shownAll('.last-item a.icon', item)[0];
            var toggle = shownAll('.toggle', item)[0];
            return {item: part(item), name: name && visible(name) ? part(name) : null, lines: name && visible(name) ? lines(name) : [],
                glyph: name && name.querySelector('i.material-icons') ? part(name.querySelector('i.material-icons')) : null,
                image: img && visible(img) ? {rect: rect(img), src: img.getAttribute('src')} : null,
                cells: shownAll('.search-item', item).map(part),
                temperature: temp.map(function (t) { var p = part(t); p.lines = lines(t); return p; }),
                bell: bell ? {rect: rect(bell), className: bell.getAttribute('class'), style: style(bell, '::before'),
                    glyph: getComputedStyle(bell, '::before').content} : null,
                toggle: toggle ? {rect: rect(toggle), checked: toggle.querySelector('input').checked, track: part(toggle.querySelector('.track')),
                    handle: part(toggle.querySelector('.handle'))} : null};
        });
        var find = shownAll('.button', v).filter(function (b) { return b.getAttribute('ng-click') === 'OnSearchCurrentPosition()'; })[0];
        var field = input();
        var out = {name: name, mode: mode(), env: env(),
            bar: part(bar), header: part(header),
            glyph: part(header.querySelector('.icon')), glyphContent: getComputedStyle(header.querySelector('.icon'), '::before').content,
            glyphStyle: style(header.querySelector('.icon'), '::before'),
            wrapper: part(header.querySelector('.item-input-wrapper')),
            input: {rect: rect(field), style: style(field), value: field.value, placeholder: field.placeholder,
                placeholderStyle: {color: getComputedStyle(field, '::placeholder').color, fontSize: getComputedStyle(field, '::placeholder').fontSize}},
            modeButton: part(header.querySelector('.button')),
            menuButton: part(shown('.button[menu-toggle]', bar)),
            content: part(v.querySelector('ion-content')), list: part(shownAll('.list', v)[0]),
            rows: rows, find: part(find), dividers: shownAll('.item-divider', v).map(part),
            tabs: tabs ? rect(tabs) : null, elements: elements(v),
            scripts: Array.prototype.map.call(document.scripts, function (s) { return s.src || null; }).filter(function (s) { return s; })};
        var bottom = tabs ? tabs.getBoundingClientRect().top : innerHeight;
        var rects = {page: {x: 0, y: 0, w: innerWidth, h: bottom}, statusBar: 'above'};
        return shoot(name, rects).then(function (shot) {
            out.shot = shot;
            return post('/__tw/record', out);
        });
    }

    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, locationStatus: Util.locationStatus,
            theme: $rootScope.settingsInfo && $rootScope.settingsInfo.theme, body: document.body.className,
            state: $rootScope.state};
    }

    function step(name) { return post('/__tw/step', {name: name}); }
    function check(name, test) {
        var m = mode();
        if (!test(m)) { throw new Error(name + ': ' + JSON.stringify(m)); }
    }

    var SEOUL = {name: '서울', address: '대한민국 서울특별시', country: 'KR', location: {lat: 37.567, long: 126.978}, currentPosition: false};
    var BUSAN = {name: '부산광역시', address: '대한민국 부산광역시', country: 'KR', location: {lat: 35.18, long: 129.08}, currentPosition: false};
    var LONDON = {name: 'London', address: 'London, UK', country: 'GB', location: {lat: 51.51, long: -0.13}, currentPosition: false};

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); Push = inj.get('Push'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            return post('/__tw/env', {phase: 'start', env: env()});
        }).then(closePopups)
            .then(function () { return addPlace(SEOUL); })
            .then(openSearch)
            .then(function () { return step('favorites'); })
            .then(function () { check('favorites', function (m) { return !m.editing && !m.searching && !m.popups && m.cities === 2; }); })
            .then(function () { return record('favorites'); })
            .then(function () {
                var s = scope();
                s.OnFocusInput();
                s.search.word = '부산';
                s.OnChangeSearchWord();
                apply();
                return wait(1500).then(frames);
            })
            .then(function () { return step('search'); })
            .then(function () { check('search', function (m) { return m.searching && m.towns === 10 && m.results === 0; }); })
            .then(function () { return record('search'); })
            .then(function () { scope().OnEdit(); apply(); return wait(800); }) // Cancel
            .then(function () { return addPlace(BUSAN); })
            .then(function () { return addPlace(LONDON); })
            .then(function () {
                // An enabled alarm of London (index 3) in the service's list, so its bell is on (`Push.hasPushInfo`).
                Push.pushData.pushList.push({cityIndex: 3, id: 1, time: '2026-11-07T22:40:00.000Z',
                    dayOfWeek: [false, true, true, true, true, true, false], enable: true, category: 'alarm'});
                return openSearch();
            })
            .then(function () { return step('list'); })
            .then(function () { check('list', function (m) { return !m.editing && !m.searching && m.cities === 4; }); })
            .then(function () { return record('list'); })
            .then(function () { scope().OnEdit(); apply(); return wait(1200).then(frames); }) // Edit
            .then(function () { return step('edit'); })
            .then(function () { check('edit', function (m) { return m.editing && !m.searching; }); })
            .then(function () { return record('edit'); })
            .then(function () { scope().OnEdit(); apply(); return wait(800); }) // OK
            .then(function () { var s = scope(); s.OnFocusInput(); apply(); return wait(800); })
            .then(function () { return step('location'); })
            .then(function () { scope().OnSearchCurrentPosition(); apply(); return wait(6000).then(frames); })
            .then(function () { check('location', function (m) { return m.searching && m.results === 1 && m.towns === 0 && !m.popups; }); })
            .then(function () { return record('location'); })
            .then(function () { return post('/__tw/done', env()); })
            .catch(function (e) { return post('/__tw/error', {error: String(e && e.stack || e)}); });
    }, false);
}());
