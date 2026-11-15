// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www is
// never changed). IN-08 (#2957): it records the weather pages S03 (Hourly) and S04 (Daily) block by block, as
// android/tools/forecast-reference/capture.mjs does on Android, and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - The corpus responses are loaded through the app's own request path (WeatherUtil.getWeatherByGeoInfo, served by the
//   local server) and saved as places with the app's services: 회현동 (kma-seoul) alone, then 런던 (vc-london) added
//   and selected, so its pages have the arrows of more than one place. S01 is closed as StartCtrl closes it.
// - Each page is opened afresh and cut into blocks: the header block (with the header bar over it), the chart, each card
//   and the attribution. A block taller than the space between the bars is captured a screen at a time and stacked by
//   the host. Every element of a block is described (rect, text, image, font, color).
// - The hourly chart is also captured with its detail rows (the expander tapped, then tapped back), and the retry
//   confirmation O03 after a failed reload.
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
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\s+/g, ' ').trim();
    }
    var PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'opacity',
        'text-shadow', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom',
        'border-top-width', 'border-bottom-width', 'vertical-align', 'text-align'];
    function style(el) {
        var cs = getComputedStyle(el), o = {};
        PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
        return o;
    }
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
            var after = getComputedStyle(e, '::after').content;
            var before = getComputedStyle(e, '::before').content;
            return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: ownText(e), src: e.getAttribute('src') || undefined,
                rect: {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height}, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, color: cs.color, background: cs.backgroundColor,
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
    function page(name) {
        return calibrate(name).then(function () {
            var record = {page: name, state: $rootScope.state, body: document.body.className, header: header(),
                scope: angular.element(content()).scope() ? scopeInfo(angular.element(content()).scope()) : null, blocks: []};
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
    function scopeInfo(s) {
        return {headerHeight: s.headerHeight, bigFontSize: s.bigFontSize, bigImageSize: s.bigImageSize, smallImageSize: s.smallImageSize,
            cityCount: s.cityCount, expand: s.expand, timeWidth: s.timeWidth, dayWidth: s.dayWidth, address: s.address};
    }
    function openTab(tab) {
        // A native promise: the callbacks run outside Angular's digest, so $apply works there.
        return Promise.resolve($state.go('tab.' + tab)).then(function () { return wait(1500); }).then(closePopups).then(function () {
            $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply();
            return wait(1500);
        }).then(closePopups).then(frames);
    }
    function addPlace(fixture, city) {
        return post('/__tw/select', {fixture: fixture}).then(function () {
            return WeatherUtil.getWeatherByGeoInfo({location: city.location});
        }).then(function (weatherData) {
            var data = WeatherUtil.convertWeatherData(weatherData);
            Object.keys(data).forEach(function (k) { city[k] = data[k]; });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            TwStorage.set('startVersion', Util.startVersion); // StartCtrl's close()
            return closePopups();
        });
    }
    // The hourly chart with its detail rows: the expander tapped, block 1 captured, tapped back (expandShortChart false).
    function expanded(name) {
        var scope = angular.element(shown('.chart-expander div')).scope();
        scope.clickExpander(); scope.$apply();
        return wait(1200).then(frames).then(function () { return calibrate(name); }).then(function () {
            return cut(name, 1);
        }).then(function (b) {
            return post('/__tw/record', {page: name, state: $rootScope.state, header: header(), blocks: [b], expandShortChart: TwStorage.get('expandShortChart')});
        }).then(function () {
            var s2 = angular.element(shown('.chart-expander div')).scope();
            s2.clickExpander(); s2.$apply();
            return wait(1200);
        });
    }
    // O03 'weather': the next weather request fails (the server answers 503), the reload opens the confirmation.
    function retryConfirm(name) {
        return post('/__tw/select', {fixture: 'fail'}).then(function () {
            $rootScope.$broadcast('reloadEvent', 'tab'); $rootScope.$apply();
            return wait(4000);
        }).then(function () {
            var popup = shown('.popup-container .popup');
            if (!popup) { throw new Error('no retry confirmation'); }
            return calibrate(name).then(function () { return shoot(name); }).then(function (shot) {
                var r = rect(popup);
                var info = {page: name, popup: {rect: r, style: style(popup), elements: elements(popup)},
                    head: rect(popup.querySelector('.popup-head')), body: rect(popup.querySelector('.popup-body')),
                    buttons: Array.prototype.map.call(popup.querySelectorAll('.popup-buttons button'), function (b) {
                        return {text: b.textContent.trim(), rect: rect(b), className: String(b.className), style: style(b)};
                    })};
                return post('/__tw/stack', {name: name, dpr: devicePixelRatio, pieces: [{file: shot.file, x: r.x, y: r.y, w: r.w, h: r.h}]})
                    .then(function (img) { info.image = img; return post('/__tw/record', info); });
            });
        }).then(closePopups);
    }
    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, languages: navigator.languages,
            userAgent: navigator.userAgent, region: Util.region, theme: $rootScope.settingsInfo && $rootScope.settingsInfo.theme,
            units: inj.get('Units').getAllUnits(), body: document.body.className};
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            inj = angular.element(document.body).injector();
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            Util = inj.get('Util'); $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            return post('/__tw/env', {phase: 'start', env: env()});
        }).then(closePopups).then(function () {
            return addPlace('kma-seoul', {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR',
                location: {lat: 37.56, long: 126.98}, currentPosition: false});
        }).then(function () { return openTab('forecast'); })
            .then(function () { return page('kma-seoul-hourly'); })
            .then(function () { return expanded('kma-seoul-hourly-expanded'); })
            .then(function () { return openTab('dailyforecast'); })
            .then(function () { return page('kma-seoul-daily'); })
            .then(function () {
                return addPlace('vc-london', {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13},
                    currentPosition: false});
            })
            .then(function () { return openTab('forecast'); })
            .then(function () { return page('vc-london-hourly'); })
            .then(function () { return openTab('dailyforecast'); })
            .then(function () { return page('vc-london-daily'); })
            .then(function () { return openTab('forecast'); })
            .then(function () { return retryConfirm('o03-weather'); })
            .then(function () { return post('/__tw/done', env()); })
            .catch(function (e) { post('/__tw/error', {error: String(e) + ' ' + String(e && e.stack)}); });
    }, false);
})();
