// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-09 (#2958): it records the air quality page S05 block by block, as
// android/tools/air-reference/capture.mjs does on Android, and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - The corpus responses are loaded through the app's own request path (WeatherUtil.getWeatherByGeoInfo, served by the
//   local server) and saved as places with the app's services. S01 is closed as StartCtrl closes it.
// - The states (S05 opened afresh each time, as the tab and goAirInfoPage do; taps go to the cells' own handlers):
//     kma-seoul             회현동 alone, the overall index (manual page 10, and scrolled to the end page 12)
//     kma-seoul-pm25        then the second detail cell, 초미세먼지 (manual page 11)
//     kma-seoul-station-1   afresh, then the second station
//     kma-seoul-o3          afresh at ?code=o3 (an hourly series without a forecast)
//     kma-seoul-dark        the overall index in the dark theme
//     vc-london             런던 added and selected: an overseas place, with the arrows of more than one place
//     kma-jeju-no-air       연동 (kma-jeju without its stations and observation) added and selected: the grade scale only
//   then O08 (the forecast source's description) and a pollutant chosen on S03 followed through the tab bar.
// - Each page is cut into blocks: the header block (with the header bar over it), the gauge, then each card. A block
//   taller than the space between the bars is captured a screen at a time and stacked by the host. Every element of a
//   block is described (rect, text, image, font, color), with the scope values the template read, the gauge's widths
//   and the chart's SVG element by element.
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

    var inj, WeatherInfo, WeatherUtil, TwStorage, Util, $state, $rootScope, $location;
    function closePopups() {
        document.querySelectorAll('.popup-container .popup-buttons button').forEach(function (b) { b.click(); });
        return wait(400).then(function () {
            document.querySelectorAll('.popup-container, .backdrop').forEach(function (e) { e.remove(); });
            document.body.classList.remove('popup-open');
        });
    }
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shown(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible)[0]; }
    function all(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\s+/g, ' ').trim();
    }
    var PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'opacity',
        'text-shadow', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom',
        'border-top-width', 'border-bottom-width', 'border-top-color', 'vertical-align', 'text-align'];
    function style(el) {
        var cs = getComputedStyle(el), o = {};
        PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
        return o;
    }
    // Every element of a block with its own text, an image, a glyph or a border (the gauge's bands and label, the
    // cells); rects relative to the block's top left.
    function elements(block) {
        var b = block.getBoundingClientRect();
        return Array.prototype.filter.call(block.querySelectorAll('*'), function (e) {
            var r = e.getBoundingClientRect();
            var cls = e.getAttribute('class') || '';
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' &&
                (ownText(e) !== '' || e.tagName === 'IMG' || e.tagName === 'I' || e.tagName === 'svg' || e.tagName === 'TD' ||
                 /(^|\s)(ion-|icon-|air-std|outline|line|air-label|main-box-air-title)/.test(cls));
        }).map(function (e) {
            var cs = getComputedStyle(e), r = e.getBoundingClientRect();
            var after = getComputedStyle(e, '::after').content;
            var before = getComputedStyle(e, '::before').content;
            return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: ownText(e), src: e.getAttribute('src') || undefined,
                rect: {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height}, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, color: cs.color, background: cs.backgroundColor,
                borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor, borderRight: cs.borderRightWidth + ' ' + cs.borderRightColor,
                opacity: cs.opacity, after: after && after !== 'none' ? after : undefined,
                before: before && before !== 'none' ? before : undefined};
        });
    }
    function content() { return shown('ion-content.main-content'); }
    function blocks() {
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
    function bars() {
        var header = shown('ion-side-menu-content .bar-header'), tabs = shown('.tabs');
        return {top: header ? header.getBoundingClientRect().bottom : 0, bottom: tabs ? tabs.getBoundingClientRect().top : innerHeight};
    }
    function header() {
        var bar = shown('ion-side-menu-content .bar-header');
        var title = Array.prototype.filter.call(bar.querySelectorAll('.title'), function (t) {
            return t.textContent.trim() !== '' && visible(t);
        })[0];
        var out = {rect: rect(bar), style: style(bar), title: null, buttons: []};
        if (title) {
            out.title = {text: title.textContent.replace(/\s+/g, ' ').trim(), rect: rect(title), style: style(title),
                parts: Array.prototype.filter.call(title.querySelectorAll('span, i, ion-spinner'), visible).map(function (e) {
                    return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: e.textContent.trim(), rect: rect(e),
                        style: style(e)};
                })};
        }
        out.buttons = Array.prototype.filter.call(bar.querySelectorAll('.button'), visible).map(function (b) {
            return {className: String(b.className), rect: rect(b), style: style(b)};
        });
        return out;
    }

    // Finds the WebView's origin on the screen from a calibration marker (once per page; removed before the shots).
    function calibrate(name) {
        var m = document.createElement('div');
        var top = Math.round(innerHeight / 2);
        m.style.cssText = 'position:fixed;left:' + (innerWidth - 20) + 'px;top:' + top + 'px;width:20px;height:20px;' +
            'background:#ff00ff;z-index:2147483647';
        document.body.appendChild(m);
        return frames().then(function () { return wait(300); }).then(function () {
            return post('/__tw/origin', {name: name, dpr: devicePixelRatio, marker: {left: innerWidth - 20, top: top, size: 20}});
        }).then(function () {
            m.remove();
            return frames().then(function () { return wait(300); });
        });
    }
    function shoot(name) { return frames().then(function () { return wait(250); }).then(function () { return post('/__tw/screen', {name: name}); }); }

    // Captures block i of the shown page: in view between the bars, or a screen at a time for a taller block.
    function cut(page, i) {
        var el = blocks()[i];
        var c = content();
        if (i === 0) { c.scrollTop = 0; } else { c.scrollTop += el.getBoundingClientRect().top - bars().top; }
        return wait(500).then(function () {
            var b = bars(), r = el.getBoundingClientRect();
            var top = i === 0 ? 0 : b.top;
            var record = {index: i, cls: el.getAttribute('class') || '', rect: rect(el), bars: b, scrollTop: c.scrollTop,
                background: getComputedStyle(el).backgroundColor, elements: elements(el), pieces: []};
            var pieces = [];
            var done = 0;
            function step() {
                var r2 = el.getBoundingClientRect(), b2 = bars();
                var from = r2.top + done, to = Math.min(r2.bottom, b2.bottom);
                if (to <= from + 0.5) {
                    // The page ends a pixel under the tab bar's top: up to 2 CSS px are left out and recorded.
                    if (r2.height - done <= 2) { record.hidden = r2.height - done; return Promise.resolve(); }
                    return Promise.reject(new Error(page + ' block ' + i + ': no progress at ' + done));
                }
                return shoot(page + '-' + i + '-' + pieces.length).then(function (shot) {
                    pieces.push({file: shot.file, x: r2.left, y: from, w: r2.width, h: to - from, scrollTop: c.scrollTop});
                    done = to - r2.top;
                    if (done >= r2.height - 0.5) { return; }
                    c.scrollTop += to - b2.top;
                    return wait(400).then(step);
                });
            }
            if (i !== 0 && r.top < top - 0.5) { return Promise.reject(new Error(page + ' block ' + i + ' starts above the bar')); }
            return step().then(function () {
                record.pieces = pieces;
                return post('/__tw/stack', {name: page + '-' + i, dpr: devicePixelRatio, pieces: pieces});
            }).then(function (stacked) {
                record.image = stacked;
                return record;
            });
        });
    }

    // The SVG of the chart directive, element by element (as android/tools/air-reference records it).
    function scene(svg) {
        function walk(el) {
            var node = {tag: el.tagName.toLowerCase()};
            Array.prototype.forEach.call(el.attributes, function (a) { node[a.name] = a.value; });
            if (node.tag === 'text') {
                node.text = '';
                node.tspans = [];
                el.childNodes.forEach(function (ch) {
                    if (ch.nodeType === 3) { node.text += ch.textContent; }
                    else if (ch.tagName && ch.tagName.toLowerCase() === 'tspan') {
                        var t = {text: ch.textContent};
                        Array.prototype.forEach.call(ch.attributes, function (a) { t[a.name] = a.value; });
                        node.tspans.push(t);
                    }
                });
            } else if (el.children.length) {
                node.children = Array.prototype.map.call(el.children, walk);
            }
            return node;
        }
        return walk(svg);
    }
    function airScope() {
        var el = shown('.air-std-table');
        return el ? angular.element(el).scope() : null;
    }
    // What the page shows: the scope values the template reads, the gauge's widths (getLabelPosition reads them from
    // the page) and the chart's SVG.
    function describe() {
        var s = airScope() || {};
        var std = shown('#aqistd'), label = shown('#aqistd-label');
        var svg = shown('[ng-air-chart] svg');
        var chart = shown('[ng-air-chart]');
        return {
            url: $location.url(), state: $state.current.name, body: document.body.className,
            scope: JSON.parse(angular.toJson({address: s.address, aqiCode: s.aqiCode, airCodeName: s.airCodeName, mainName: s.mainName,
                stnIndex: s.stnIndex, airCodeGrade: s.airCodeGrade, airCodeValue: s.airCodeValue, airCodeStr: s.airCodeStr,
                mainInfo: s.mainInfo, airCodeActionGuide: s.airCodeActionGuide, cityCount: s.cityCount,
                forecastPubdate: s.forecastPubdate, forecastSource: s.forecastSource, hourlyChartTitle: s.hourlyChartTitle,
                chartAirHeight: s.chartAirHeight, bodyWidth: s.bodyWidth, bodyHeight: s.bodyHeight, bigFontSize: s.bigFontSize,
                headerHeight: s.headerHeight, strHour: s.strHour})),
            gauge: std && label ? {width: std.offsetWidth, labelWidth: label.offsetWidth, left: label.style.left,
                labelRect: rect(label), stdRect: rect(std)} : null,
            chart: svg ? {rect: rect(chart), scene: scene(svg)} : null,
        };
    }
    function settle() {
        return wait(1500).then(closePopups).then(function () { content().scrollTop = 0; return wait(400); }).then(frames);
    }
    // Opens S05 afresh at /tab/air, with ?code= as goAirInfoPage builds it (AirCtrl initializes on every entry).
    function openAir(code) {
        return Promise.resolve($state.go('tab.search')).then(function () { return wait(800); }).then(closePopups).then(function () {
            $location.url('/tab/air' + (code ? '?code=' + code : '')); $rootScope.$apply();
        }).then(settle).then(describe);
    }
    // A cell's own handler (ng-click of the detail and station cells; Ionic drops synthetic clicks).
    function tapCell(kind, i) {
        var s = airScope();
        return wait(0).then(function () {
            if (kind === 'setMainAqiCode') { s.setMainAqiCode(s.aqiList[i].code); } else { s.setStation(i); }
            s.$apply();
        }).then(settle).then(describe);
    }
    // The theme as the settings page sets it (controller.setting.radio.js): the body class and the image folders.
    function theme(name) {
        $rootScope.settingsInfo.theme = name;
        $rootScope.iconsImgPath = window.theme[name].icons;
        $rootScope.weatherImgPath = window.theme[name].weather;
        $rootScope.$apply();
        return wait(500);
    }
    function page(name, shownState, places) {
        return calibrate(name).then(function () {
            var record = {page: name, places: places, header: header(), blocks: []};
            Object.keys(shownState).forEach(function (k) { record[k] = shownState[k]; });
            var count = blocks().length;
            var chain = Promise.resolve();
            for (var i = 0; i < count; i++) {
                (function (i) { chain = chain.then(function () { return cut(name, i); }).then(function (b) { record.blocks.push(b); }); })(i);
            }
            return chain.then(function () {
                content().scrollTop = 0;
                return wait(300);
            }).then(function () { return post('/__tw/record', record); });
        });
    }
    function addPlace(fixture, info, mutations) {
        return post('/__tw/select', {fixture: fixture}).then(function () {
            return WeatherUtil.getWeatherByGeoInfo({location: info.location});
        }).then(function (weatherData) {
            var city = {name: info.name, address: info.address, country: info.country, location: info.location, currentPosition: false};
            var data = WeatherUtil.convertWeatherData(weatherData);
            Object.keys(data).forEach(function (k) { city[k] = data[k]; });
            (mutations || []).forEach(function (m) {
                var parent = m.path.slice(0, -1).reduce(function (o, k) { return o[k]; }, city);
                delete parent[m.path[m.path.length - 1]];
            });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            TwStorage.set('startVersion', Util.startVersion); // StartCtrl's close()
            return closePopups();
        });
    }
    // O08: the forecast source's description (popUpAirForecastInfo, the info row's handler).
    function forecastSource(name, source) {
        var s = airScope();
        return wait(0).then(function () { s.popUpAirForecastInfo(source); s.$apply(); return wait(1500); }).then(function () {
            var popup = shown('.popup-container .popup');
            if (!popup) { throw new Error('no forecast source popup'); }
            return calibrate(name).then(function () { return shoot(name); }).then(function (shot) {
                var r = rect(popup);
                var info = {page: name, source: source, popup: {rect: r, style: style(popup), elements: elements(popup)},
                    buttons: Array.prototype.map.call(popup.querySelectorAll('.popup-buttons button'), function (b) {
                        return {text: b.textContent.trim(), rect: rect(b), className: String(b.className), style: style(b)};
                    })};
                return post('/__tw/stack', {name: name, dpr: devicePixelRatio, pieces: [{file: shot.file, x: r.x, y: r.y, w: r.w, h: r.h}]})
                    .then(function (img) { info.image = img; return post('/__tw/record', info); });
            });
        }).then(closePopups);
    }
    // A tap on a tab as Ionic accepts it: ionic.tap drops clicks it did not create, so the click carries isIonicTap.
    function tapTab(i) {
        var el = all('.tabs a.tab-item')[i];
        var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        var target = document.elementFromPoint(x, y);
        if (!target || !(target === el || el.contains(target))) { throw new Error('tab ' + i + ' covered'); }
        var ev = document.createEvent('MouseEvents');
        ev.initMouseEvent('click', true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
        ev.isIonicTap = true;
        target.dispatchEvent(ev);
        return wait(1800).then(closePopups);
    }
    // goAirInfoPage(code) as S03's air cells call it, then the tab bar: Hourly, Air, Daily, Air, Locations, Air.
    function navigation(code) {
        var steps = [];
        function note(what) {
            var s = airScope();
            steps.push({url: $location.url(), state: $state.current.name, aqiCode: s ? s.aqiCode : null, after: what});
        }
        return Promise.resolve($state.go('tab.forecast')).then(function () { return wait(1500); }).then(closePopups).then(function () {
            var s = angular.element(content()).scope();
            s.goAirInfoPage(code); s.$apply();
            return wait(1500);
        })
            .then(function () { note('goAirInfoPage(' + code + ') on S03'); return tapTab(1); })
            .then(function () { note('Hourly tab'); return tapTab(3); })
            .then(function () { note('Air tab'); return tapTab(2); })
            .then(function () { note('Daily tab'); return tapTab(3); })
            .then(function () { note('Air tab'); return tapTab(0); })
            .then(function () { note('Locations tab'); return tapTab(3); })
            .then(function () { note('Air tab'); return post('/__tw/record', {page: 'navigation', place: 'kma-seoul', steps: steps}); });
    }
    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, theme: $rootScope.settingsInfo && $rootScope.settingsInfo.theme,
            units: inj.get('Units').getAllUnits(), body: document.body.className};
    }

    var SEOUL = {fixture: 'kma-seoul', info: {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR',
        location: {lat: 37.56, long: 126.98}}};
    var LONDON = {fixture: 'vc-london', info: {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13}}};
    var NO_AIR = {fixture: 'kma-jeju', info: {name: '연동', address: '대한민국 제주특별자치도 제주시 연동', country: 'KR',
        location: {lat: 33.5, long: 126.53}}, mutations: [{path: ['airInfoList']}, {path: ['currentWeather', 'arpltn']}]};
    function placesOf() {
        return Array.prototype.map.call(arguments, function (p) {
            var o = {fixture: p.fixture, mutations: p.mutations || []};
            Object.keys(p.info).forEach(function (k) { o[k] = p.info[k]; });
            return o;
        });
    }
    function add(p) { return addPlace(p.fixture, p.info, p.mutations); }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            inj = angular.element(document.body).injector();
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope'); $location = inj.get('$location');
            return post('/__tw/env', {phase: 'start', env: env()});
        }).then(closePopups)
            .then(function () { return add(SEOUL); })
            .then(function () { return openAir(); })
            .then(function (s) { return page('kma-seoul', s, placesOf(SEOUL)); })
            .then(function () { return forecastSource('o08-airkorea', 'airkorea'); })
            .then(function () { return tapCell('setMainAqiCode', 1); })
            .then(function (s) { return page('kma-seoul-pm25', s, placesOf(SEOUL)); })
            .then(function () { return openAir(); })
            .then(function () { return tapCell('setStation', 1); })
            .then(function (s) { return page('kma-seoul-station-1', s, placesOf(SEOUL)); })
            .then(function () { return openAir('o3'); })
            .then(function (s) { return page('kma-seoul-o3', s, placesOf(SEOUL)); })
            .then(function () { return theme('dark'); })
            .then(function () { return openAir(); })
            .then(function (s) { return page('kma-seoul-dark', s, placesOf(SEOUL)); })
            .then(function () { return theme('light'); })
            .then(function () { return add(LONDON); })
            .then(function () { return openAir(); })
            .then(function (s) { return page('vc-london', s, placesOf(SEOUL, LONDON)); })
            .then(function () { return add(NO_AIR); })
            .then(function () { return openAir(); })
            .then(function (s) { return page('kma-jeju-no-air', s, placesOf(SEOUL, LONDON, NO_AIR)); })
            .then(function () { WeatherInfo.setCityIndex(0); return navigation('pm25'); })
            .then(function () { return post('/__tw/done', env()); })
            .catch(function (e) { post('/__tw/error', {error: String(e) + ' ' + String(e && e.stack)}); });
    }, false);
})();
