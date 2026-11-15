// Injected by capture.py as the first script of a copy of the Cordova iOS test build's www/index.html (client/www
// is never changed). IN-05 (#2954): it records the Cordova charts for one screen size, as
// android/tools/chart-reference/capture.mjs does on Android, and asks the host for the screenshots.
//
// - Every request the page starts is reported to the local server; one for a host other than this Mac goes to the
//   local server instead, so the test build cannot reach a production host whatever its configuration says.
// - For each fixture of the plan (GET /__tw/plan), the server is told which fixture to answer with, and the app
//   loads the weather through its own request path (WeatherUtil.getWeatherByGeoInfo, which calls the server URL
//   of the build: the local server) and converts it (WeatherUtil.convertWeatherData), as TabCtrl does. The place is
//   shown as the selected place on the hourly and the daily tab; the SVG of each chart directive, the rects of the
//   header labels, legend, separators and expander, computed styles and the scroll offsets are posted to
//   /__tw/record.
// - For the screenshot fixtures, the chart is scrolled to the opening position and both ends and the host takes a
//   simulator screenshot (/__tw/shot answers when it is done) and crops it to the chart wrapper, after finding the
//   WebView's origin from a calibration marker drawn outside the chart in the same screenshot.
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
    // The app may reload its page while it starts; wait until Angular runs and TwStorage has initialized.
    function ready(i) {
        var inj = window.angular && angular.element(document.body).injector();
        if (inj && localStorage.getItem('settingsInfo') !== null) { return wait(3000); }
        if (i > 120) { return Promise.reject(new Error('app did not start')); }
        return wait(500).then(function () { return ready(i + 1); });
    }

    // ---------------------------------------------------------------- page helpers (as capture.mjs)
    var inj, WeatherInfo, WeatherUtil, TwStorage, $state, $rootScope;
    function closePopups() {
        document.querySelectorAll('.popup-container .popup-buttons button').forEach(function (b) { b.click(); });
        return wait(400).then(function () {
            document.querySelectorAll('.popup-container, .backdrop').forEach(function (e) { e.remove(); });
            document.body.classList.remove('popup-open');
        });
    }
    function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function rel(el, base) {
        var r = el.getBoundingClientRect(), b = base.getBoundingClientRect();
        return {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height};
    }
    function label(el, base) { var o = rel(el, base); o.text = el.textContent.trim(); return o; }
    var PROPS = ['color', 'fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size', 'font-weight', 'line-height',
        'letter-spacing', 'text-align', 'text-anchor', 'background-color', 'border-radius', 'border-left-width', 'border-left-color',
        'padding-top', 'padding-left', 'margin-top', 'margin-left'];
    function styles(base, selectors) {
        var out = {};
        selectors.forEach(function (sel) {
            var el = base.querySelector(sel);
            if (!el) { return; }
            var cs = getComputedStyle(el), o = {};
            PROPS.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
            out[sel] = o;
        });
        return out;
    }
    function scene(svg) {
        function walk(el) {
            var node = {tag: el.tagName.toLowerCase()};
            Array.prototype.forEach.call(el.attributes, function (a) { node[a.name] = a.value; });
            if (node.tag === 'text') {
                node.text = '';
                node.tspans = [];
                el.childNodes.forEach(function (c) {
                    if (c.nodeType === 3) { node.text += c.textContent; }
                    else if (c.tagName && c.tagName.toLowerCase() === 'tspan') {
                        var t = {text: c.textContent};
                        Array.prototype.forEach.call(c.attributes, function (a) { t[a.name] = a.value; });
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
    var cityIndex = null;
    // Loads the fixture through the app's request path and shows it as the selected place on a tab.
    function show(fixture, state) {
        return post('/__tw/select', {fixture: fixture}).then(function () {
            var location = {lat: 37.56, long: 126.98};
            return WeatherUtil.getWeatherByGeoInfo({location: location});
        }).then(function (weatherData) {
            TwStorage.set('expandShortChart', true);
            var data = WeatherUtil.convertWeatherData(weatherData);
            if (cityIndex !== null) { WeatherInfo.removeCity(cityIndex); }
            var city = {name: fixture, address: 'capture ' + fixture, country: 'KR', location: {lat: 37.56, long: 126.98},
                currentPosition: false};
            Object.keys(data).forEach(function (k) { city[k] = data[k]; });
            WeatherInfo.addCity(city);
            cityIndex = WeatherInfo.getCityCount() - 1;
            WeatherInfo.setCityIndex(cityIndex);
            return closePopups();
        }).then(function () { return $state.go(state); }).then(function () { return wait(800); })
            .then(function () { $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply(); return wait(1500); })
            .then(closePopups).then(frames).then(function () {
                if (document.querySelector('.popup-container, .backdrop.active')) { throw new Error('popup still open'); }
            });
    }
    function hourly() {
        var scroll = document.getElementById('chartShortScroll');
        var content = scroll.firstElementChild, wrap = scroll.parentElement;
        wrap.scrollIntoView({block: 'center'});
        return {
            scroll: {left: scroll.scrollLeft, width: scroll.scrollWidth, clientWidth: scroll.clientWidth},
            wrapper: rel(wrap, wrap),
            content: rel(content, wrap),
            dayTitles: Array.prototype.filter.call(content.querySelectorAll('.day-title'), visible).map(function (e) { return label(e, content); }),
            hourTitles: Array.prototype.map.call(content.querySelectorAll('.chart-header .chart-title'), function (e) { return label(e, content); }),
            chart: rel(content.querySelector('[ng-short-chart]'), content),
            legend: {box: rel(wrap.querySelector('.chart-label'), wrap),
                today: label(wrap.querySelector('.chart-label-today'), wrap),
                yesterday: label(wrap.querySelector('.chart-label-yesterday'), wrap)},
            separators: Array.prototype.map.call(content.querySelectorAll('.chart-separator'), function (e) { return rel(e, content); }),
            detail: rel(content.querySelector('[ng-short-detail-chart]'), content),
            expander: {box: rel(content.querySelector('.chart-expander'), content),
                icon: label(content.querySelector('.chart-expander i'), content)},
            scene: scene(content.querySelector('[ng-short-chart] svg')),
            detailScene: scene(content.querySelector('[ng-short-detail-chart] svg')),
            styles: styles(wrap, ['.day-title', '.chart-header .chart-title', '.chart-label', '.chart-label-today', '.chart-label-yesterday',
                '.chart-expander i', '.chart-separator', '[ng-short-chart] .chart-text', '[ng-short-chart] .chart-sub-text',
                '[ng-short-chart] .chart-unit-text', '[ng-short-chart] .text-today', '[ng-short-chart] .text-yesterday',
                '[ng-short-detail-chart] .chart-text', '[ng-short-detail-chart] .chart-unit-text']),
            background: getComputedStyle(wrap.closest('.card') || document.body).backgroundColor,
        };
    }
    function daily() {
        var scroll = document.getElementById('chartMidScroll');
        var content = scroll.firstElementChild;
        scroll.scrollIntoView({block: 'center'});
        var rows = content.querySelectorAll('.chart-header .row');
        return {
            scroll: {left: scroll.scrollLeft, width: scroll.scrollWidth, clientWidth: scroll.clientWidth},
            wrapper: rel(scroll, scroll),
            content: rel(content, scroll),
            dayNames: Array.prototype.map.call(rows[0].querySelectorAll('.chart-small-title'), function (e) { return label(e, content); }),
            dates: Array.prototype.map.call(rows[1].querySelectorAll('.chart-title'), function (e) { return label(e, content); }),
            chart: rel(content.querySelector('[ng-mid-chart]'), content),
            scene: scene(content.querySelector('[ng-mid-chart] svg')),
            styles: styles(scroll, ['.chart-small-title', '.chart-header .chart-title', '[ng-mid-chart] .chart-text',
                '[ng-mid-chart] .chart-sub-text', '[ng-mid-chart] .chart-unit-text', '[ng-mid-chart] .chart-sub-text tspan']),
            background: getComputedStyle(scroll.closest('.card') || document.body).backgroundColor,
        };
    }
    // Scrolls the chart and returns its wrapper's rect in the WebView's viewport (CSS px).
    function scrollTo(id, left) {
        var scroll = document.getElementById(id);
        var wrap = id === 'chartShortScroll' ? scroll.parentElement : scroll;
        scroll.scrollLeft = left;
        return frames().then(function () { return wait(400); }).then(function () {
            var r = wrap.getBoundingClientRect();
            // The fixed header and tab bars must not cover the chart.
            document.querySelectorAll('ion-header-bar, .bar-header, .tabs, .tab-nav').forEach(function (bar) {
                var b = bar.getBoundingClientRect();
                if (b.width > 0 && b.height > 0 && getComputedStyle(bar).visibility !== 'hidden' &&
                    b.top < r.bottom && b.bottom > r.top && b.left < r.right && b.right > r.left) {
                    throw new Error('a bar covers the chart: ' + bar.className + ' ' + JSON.stringify(b));
                }
            });
            if (r.top < 0 || r.bottom > innerHeight) { throw new Error('chart outside the viewport ' + JSON.stringify(r)); }
            return {left: scroll.scrollLeft, rect: {x: r.left, y: r.top, width: r.width, height: r.height}};
        });
    }
    function capturePositions(fixture, id, chart, opening, maxLeft) {
        var out = [];
        var positions = [['opening', opening], ['start', 0], ['end', maxLeft]];
        return positions.reduce(function (p, pos) {
            return p.then(function () { return scrollTo(id, pos[1]); }).then(function (shot) {
                var name = chart + '-' + pos[0];
                // A calibration marker in the same screenshot, above or below the chart, so the host finds the
                // WebView's origin in it (the page may sit lower on the screen from one launch to the next).
                var top = shot.rect.y >= 30 ? shot.rect.y - 25 : shot.rect.y + shot.rect.height + 5;
                var m = document.createElement('div');
                m.style.cssText = 'position:fixed;left:0;top:' + top + 'px;width:20px;height:20px;background:#ff00ff;z-index:2147483647';
                document.body.appendChild(m);
                return frames().then(function () { return wait(300); }).then(function () {
                    return post('/__tw/shot', {fixture: fixture, name: name, rect: shot.rect, dpr: devicePixelRatio,
                        marker: {left: 0, top: top, size: 20}});
                }).then(function (r) {
                    m.remove();
                    out.push({position: pos[0], scrollLeft: shot.left, rect: shot.rect, file: r.file, pixels: r.pixels,
                        webViewOrigin: r.origin});
                    return frames();
                });
            });
        }, Promise.resolve()).then(function () { return scrollTo(id, opening); }).then(function () { return out; });
    }
    function env() {
        return {screen: {width: screen.width, height: screen.height}, viewport: {width: innerWidth, height: innerHeight},
            devicePixelRatio: devicePixelRatio, language: navigator.language, userAgent: navigator.userAgent,
            theme: $rootScope.settingsInfo.theme};
    }

    document.addEventListener('deviceready', function () {
        ready(0).then(function () {
            inj = angular.element(document.body).injector();
            WeatherInfo = inj.get('WeatherInfo'); WeatherUtil = inj.get('WeatherUtil'); TwStorage = inj.get('TwStorage');
            $state = inj.get('$state'); $rootScope = inj.get('$rootScope');
            return closePopups();
        }).then(function () { return request('GET', '/__tw/plan'); }).then(function (plan) {
            return plan.fixtures.reduce(function (p, f) {
                return p.then(function () {
                    var record = {fixture: f.name, from: f.from, patched: f.patched};
                    return show(f.name, 'tab.forecast').then(function () {
                        record.hourly = hourly();
                        if (!f.screenshots) { return; }
                        var s = record.hourly.scroll;
                        return capturePositions(f.name, 'chartShortScroll', 'hourly', s.left, s.width - s.clientWidth)
                            .then(function (c) { record.hourly.captures = c; });
                    }).then(function () { return show(f.name, 'tab.dailyforecast'); }).then(function () {
                        record.daily = daily();
                        if (!f.screenshots) { return; }
                        var s = record.daily.scroll;
                        return capturePositions(f.name, 'chartMidScroll', 'daily', s.left, s.width - s.clientWidth)
                            .then(function (c) { record.daily.captures = c; });
                    }).then(function () { return post('/__tw/record', record); });
                });
            }, Promise.resolve());
        }).then(function () {
            return post('/__tw/done', env());
        }).catch(function (e) {
            post('/__tw/error', {error: String(e && e.stack || e)});
        });
    }, false);
})();
