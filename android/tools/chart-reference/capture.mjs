#!/usr/bin/env node
// Records the Cordova charts for one screen size (AN-05, #2884). Run by capture.sh while the Cordova debug
// build runs on an offline emulator at density 2:
//   node capture.mjs <emulator-serial> <WxH> <android-dir>
// For each fixture the app converts the server response itself (WeatherUtil.convertWeatherData), shows it
// as a saved place on the hourly and the daily tab, and this records under
// core-domain/src/test/resources/chart-reference/<WxH>/:
//   <fixture>.json  SVG scenes, element rects and computed styles
//   <fixture>/<chart>-<position>.png  wrapper captures at the opening position and both scroll ends
//   (fixtures with screenshots only)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [serial, size, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial; physical devices are not allowed');
if (!/^\d+x\d+$/.test(size || '') || !root) throw new Error('usage: capture.mjs <emulator-serial> <WxH> <android-dir>');

const CORPUS = path.join(root, 'core-domain/src/test/resources/corpus');
const OUT_SCENES = path.join(root, 'core-domain/src/test/resources/chart-reference', size);
const OUT_PNG = OUT_SCENES;
const BASE_SIZE = '384x832';

// Fixtures from the AN-02 corpus (server responses, or edge cases built from them). All sizes for the
// screenshot fixture and a world fixture with two table rows; the others at the base size.
const FIXTURES = [
    {name: 'kma-seoul', allSizes: true, screenshots: true},
    {name: 'vc-london', allSizes: true},
    {name: 'kma-jeju'},
    {name: 'vc-newyork'},
    {name: 'vc-sydney'},
    {name: 'vc-tokyo'},
    {name: 'kma-seoul-fahrenheit'},
    {name: 'kma-rain-everywhere'},
    {name: 'kma-current-index-first'},
    {name: 'kma-midnight-today-first-day'},
    // "On the hour": liveTime equal to time + '00' with time % 3 == 0 (the other fixtures are not).
    {name: 'kma-seoul-sharp', from: 'kma-seoul', patch: (d) => { d.current.liveTime = '2400'; }},
];

function input(fixture) {
    const c = JSON.parse(fs.readFileSync(path.join(CORPUS, 'conversion', `${fixture.from || fixture.name}.json`), 'utf8'));
    const data = c.input !== undefined ? c.input : JSON.parse(fs.readFileSync(path.join(CORPUS, c.inputFile), 'utf8'));
    if (fixture.patch) fixture.patch(data);
    return data;
}

const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtoolsSocket() {
    for (let i = 0; i < 90; i++) {
        let pid = '';
        try { pid = adb('shell', 'pidof', 'net.wizardfactory.todayweather'); } catch (_) { /* not started yet */ }
        if (pid) {
            try {
                adb('forward', 'tcp:9339', `localabstract:webview_devtools_remote_${pid}`);
                const pages = await (await fetch('http://127.0.0.1:9339/json')).json();
                const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
                if (page) return page.webSocketDebuggerUrl;
            } catch (_) { /* not ready yet */ }
        }
        await sleep(1000);
    }
    throw new Error('WebView DevTools socket not found');
}

const ws = new WebSocket(await devtoolsSocket());
await new Promise((r) => ws.addEventListener('open', r, {once: true}));
let seq = 0;
function send(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({id, method, params}));
    return new Promise((resolve, reject) => {
        const onMessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.id !== id) return;
            ws.removeEventListener('message', onMessage);
            if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
        };
        ws.addEventListener('message', onMessage);
    });
}
async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
}

// Page helpers: show a converted fixture as the selected place on a tab, close popups (the offline load of
// the current-position place opens an error popup), and read scenes and rects.
// The app may reload its page while it starts; wait until the same page has been ready for 3 seconds.
async function settled() {
    let last = null;
    for (let i = 0; i < 90; i++) {
        let origin = null;
        try {
            origin = await evaluate('window.angular && angular.element(document.body).injector() ? performance.timeOrigin : null');
        } catch (e) {
            if (!/context was destroyed|Cannot find context/.test(e.message)) throw e;
        }
        if (origin !== null && origin === last) return;
        last = origin;
        await sleep(3000);
    }
    throw new Error('app did not settle');
}
await settled();
await evaluate(`window.twCapture = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil'), TwStorage = inj.get('TwStorage');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope');
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function frames() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
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
    // Computed styles of the elements the native chart draws itself (text, colors, boxes).
    var PROPS = ['color', 'fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size', 'font-weight', 'line-height',
        'letter-spacing', 'text-align', 'text-anchor', 'background-color', 'border-radius', 'border-left-width', 'border-left-color',
        'padding-top', 'padding-left', 'margin-top', 'margin-left'];
    function styles(base, selectors) {
        var out = {};
        selectors.forEach(function (sel) {
            var el = base.querySelector(sel);
            if (!el) return;
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
                    if (c.nodeType === 3) node.text += c.textContent;
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
    return {
        show: function (input, name, state) {
            TwStorage.set('expandShortChart', true);
            var data = WeatherUtil.convertWeatherData([{data: input}]);
            if (cityIndex !== null) WeatherInfo.removeCity(cityIndex);
            var city = {name: name, address: 'capture ' + name, country: 'KR', location: {lat: 37.56, long: 126.98},
                currentPosition: false};
            Object.keys(data).forEach(function (k) { city[k] = data[k]; });
            WeatherInfo.addCity(city);
            cityIndex = WeatherInfo.getCityCount() - 1;
            WeatherInfo.setCityIndex(cityIndex);
            return closePopups().then(function () { return $state.go(state); }).then(function () { return wait(800); })
                .then(function () { $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply(); return wait(1500); })
                .then(closePopups).then(frames).then(function () {
                    if (document.querySelector('.popup-container, .backdrop.active')) throw new Error('popup still open');
                    return true;
                });
        },
        hourly: function () {
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
        },
        daily: function () {
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
        },
        // Scrolls the chart and returns the capture clip of its wrapper in page coordinates.
        scrollTo: function (id, left) {
            var scroll = document.getElementById(id);
            var wrap = id === 'chartShortScroll' ? scroll.parentElement : scroll;
            scroll.scrollLeft = left;
            return frames().then(function () { return wait(150); }).then(function () {
                var r = wrap.getBoundingClientRect();
                // The fixed header and tab bars must not cover the chart.
                document.querySelectorAll('ion-header-bar, .bar-header, .tabs, .tab-nav').forEach(function (bar) {
                    var b = bar.getBoundingClientRect();
                    if (b.width > 0 && b.height > 0 && getComputedStyle(bar).visibility !== 'hidden' &&
                        b.top < r.bottom && b.bottom > r.top && b.left < r.right && b.right > r.left) {
                        throw new Error('a bar covers the chart: ' + bar.className + ' ' + JSON.stringify(b));
                    }
                });
                if (r.top < 0 || r.bottom > innerHeight) throw new Error('chart outside the viewport ' + JSON.stringify(r));
                // A clip on whole CSS pixels (a fractional clip is cut to whole pixels inside it); the wrapper is
                // painted at device pixels rounded from its layout position, at the recorded offset in the capture.
                var dpr = devicePixelRatio, x0 = Math.floor(r.left), y0 = Math.floor(r.top);
                return {left: scroll.scrollLeft,
                    clip: {x: x0 + window.scrollX, y: y0 + window.scrollY, width: Math.ceil(r.right) - x0, height: Math.ceil(r.bottom) - y0},
                    offset: {x: Math.round(r.left * dpr) - x0 * dpr, y: Math.round(r.top * dpr) - y0 * dpr},
                    size: {width: Math.round(r.right * dpr) - Math.round(r.left * dpr), height: Math.round(r.bottom * dpr) - Math.round(r.top * dpr)}};
            });
        },
        env: function () {
            return {screen: {width: screen.width, height: screen.height}, devicePixelRatio: devicePixelRatio,
                language: navigator.language, userAgent: navigator.userAgent, theme: $rootScope.settingsInfo.theme};
        },
    };
})()`);

const env = await evaluate('twCapture.env()');
if (`${env.screen.width}x${env.screen.height}` !== size || env.devicePixelRatio !== 2) {
    throw new Error(`unexpected display ${JSON.stringify(env)}`);
}
if (env.theme !== 'light') throw new Error(`unexpected theme ${env.theme}`);

async function capturePositions(id, opening, maxLeft, dir, chart) {
    const out = [];
    for (const [position, left] of [['opening', opening], ['start', 0], ['end', maxLeft]]) {
        const shot = await evaluate(`twCapture.scrollTo(${JSON.stringify(id)}, ${left})`);
        const png = await send('Page.captureScreenshot', {format: 'png', clip: {...shot.clip, scale: 1}, captureBeyondViewport: true});
        fs.mkdirSync(dir, {recursive: true});
        const file = path.join(dir, `${chart}-${position}.png`);
        fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
        out.push({position, scrollLeft: shot.left, clip: shot.clip, offset: shot.offset, size: shot.size, file: path.relative(root, file)});
    }
    await evaluate(`twCapture.scrollTo(${JSON.stringify(id)}, ${opening})`);
    return out;
}

fs.mkdirSync(OUT_SCENES, {recursive: true});
const captured = [];
for (const fixture of FIXTURES) {
    if (!fixture.allSizes && size !== BASE_SIZE) continue;
    const data = input(fixture);
    const record = {fixture: fixture.name, from: fixture.from || fixture.name, patched: Boolean(fixture.patch)};
    await evaluate(`twCapture.show(${JSON.stringify(data)}, ${JSON.stringify(fixture.name)}, 'tab.forecast')`);
    record.hourly = await evaluate('twCapture.hourly()');
    if (fixture.screenshots) {
        const s = record.hourly.scroll;
        record.hourly.captures = await capturePositions('chartShortScroll', s.left, s.width - s.clientWidth, path.join(OUT_PNG, fixture.name), 'hourly');
    }
    await evaluate(`twCapture.show(${JSON.stringify(data)}, ${JSON.stringify(fixture.name)}, 'tab.dailyforecast')`);
    record.daily = await evaluate('twCapture.daily()');
    if (fixture.screenshots) {
        const s = record.daily.scroll;
        record.daily.captures = await capturePositions('chartMidScroll', s.left, s.width - s.clientWidth, path.join(OUT_PNG, fixture.name), 'daily');
    }
    fs.writeFileSync(path.join(OUT_SCENES, `${fixture.name}.json`), JSON.stringify(record) + '\n');
    captured.push(fixture.name);
    console.log(`${size} ${fixture.name}: hourly ${record.hourly.scroll.width}x${record.hourly.wrapper.h}, daily ${record.daily.scroll.width}`);
}
fs.writeFileSync(path.join(OUT_SCENES, 'capture.json'), JSON.stringify({size, env, fixtures: captured}, null, 1) + '\n');
ws.close();
