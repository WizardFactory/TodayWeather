#!/usr/bin/env node
// Records the Cordova settings pages and the weather page after a settings change that the native app is compared
// with (AN-12, #2891): run by capture.sh for each language while the Cordova debug build runs offline at 384x832 dp,
// density 2. The page talks to a stand-in server inside the WebView (XMLHttpRequest replaced for the server's URLs):
// a weather request gets the AN-02 corpus fixture whose units match the request (kma-seoul in °C, kma-seoul-f in °F),
// the photo feed gets one synthetic photo for every sky (photo.png, as a data URL) and the push list gets 200. The
// place is 회현동 (kma-seoul) with an alarm and a token, so a unit change posts the push list. Every step is a real
// tap on the screen (adb input tap at the element's center), as a user does it:
//   ko-KR  units                       S07 (manual page 25)
//          radio-<list>                S08 of each unit, the startup page, the refresh interval and the theme
//                                      (pages 26, 28 and 29)
//          hourly-f/hourly-<n>         S03 after 온도단위 F (page 27): every block of the page
//          radio-theme-<theme>, units-<theme>   S08 and S07 in the dark, photo and old themes
//          hourly-dark/…, hourly-photo/…        S03 in the dark and photo themes (pages 30 and 31)
//          about                       the About popup over the menu scrolled to its end (page 36)
//          requests.json               what each step sent, in order
//   en-US  units, about
//   app/src/test/resources/settings-reference/<lang>/<state>.png and <state>.json
//   node capture.mjs <emulator-serial> <lang> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {BLOCKS, cutBlocks} from '../emulator/page-blocks.mjs';
import {Screen} from '../emulator/screen.mjs';
import {referenceRoot, recordView} from '../emulator/reference-view.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(referenceRoot(root, 'settings'), lang);
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const input = (name) => JSON.parse(fs.readFileSync(path.join(corpus, 'inputs', `${name}.json`), 'utf8'));
const photo = fs.readFileSync(path.join(root, 'app/src/test/resources/settings-reference/photo.png'));
const screenshots = new Screen(serial);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);

const dt = await connect(serial);
await dt.settled();
await recordView(dt, new Screen(serial), OUT);

// The stand-in server: requests to http(s) URLs other than the app's own pages are answered here and recorded, with
// the server's address, the device id and the token left out of the record.
const FIXTURES = ['kma-seoul', 'kma-seoul-f'].map((name) => ({units: input(name).units, body: JSON.stringify(input(name))}));
const FEED = JSON.stringify(['lightning', 'rain', 'snow', 'sun_smallcloud', 'sun_bigcloud', 'sun', 'moon_smallcloud', 'moon_bigcloud', 'moon', 'cloud']
    .map((tag, i) => ({id: `capture-${i}`, tags: [tag], twUrls: {regular: `data:image/png;base64,${photo.toString('base64')}`}})));
await dt.evaluate(`(function (fixtures, feed) {
    var Real = window.XMLHttpRequest;
    var log = window.twServerLog = [];
    var step = {name: 'start'};
    window.twStep = function (name) { step = {name: name}; };
    function local(url) { return !/^https?:/.test(url) || /^https?:\\/\\/localhost\\//.test(url); }
    // The photo feed's whole URL is a private build input; the server's address is too.
    function redact(url) { return /photos/.test(url) ? '<photo-feed>' : String(url).replace(/^https?:\\/\\/[^\\/]+/, '<server>'); }
    function answer(method, url) {
        var m = /\\/weather\\/v000903\\/coord\\/[^?]+\\?(.*)$/.exec(url);
        if (method === 'GET' && m) {
            var query = {};
            m[1].split('&').forEach(function (kv) { var p = kv.split('='); query[p[0]] = decodeURIComponent(p[1]); });
            var match = fixtures.filter(function (f) {
                return Object.keys(f.units).every(function (k) { return query[k] === f.units[k]; });
            })[0];
            return match ? {status: 200, body: match.body} : {status: 500, body: 'no fixture for these units'};
        }
        if (url === '<photo-feed>') return {status: 200, body: feed};
        if (method === 'POST' && /\\/push-list$/.test(url)) return {status: 200, body: '{}'};
        return {status: 404, body: ''};
    }
    function Server() {
        var self = this, headers = {}, real = null;
        self.readyState = 0; self.status = 0; self.statusText = ''; self.response = ''; self.responseText = '';
        self.open = function (method, url) {
            self._method = method; self._url = url;
            if (local(url)) { real = new Real(); real.open.apply(real, arguments); }
            self.readyState = 1;
        };
        self.setRequestHeader = function (k, v) { headers[k] = v; if (real) real.setRequestHeader(k, v); };
        self.getAllResponseHeaders = function () { return real ? real.getAllResponseHeaders() : 'content-type: application/json\\r\\n'; };
        self.getResponseHeader = function (k) { return real ? real.getResponseHeader(k) : (/content-type/i.test(k) ? 'application/json' : null); };
        self.addEventListener = function () {};
        self.upload = {addEventListener: function () {}};
        self.abort = function () { if (real) real.abort(); };
        self.send = function (body) {
            if (real) {
                ['withCredentials', 'responseType', 'timeout'].forEach(function (k) { if (self[k] !== undefined) real[k] = self[k]; });
                real.onload = function () {
                    ['readyState', 'status', 'statusText', 'response', 'responseText'].forEach(function (k) { try { self[k] = real[k]; } catch (e) {} });
                    if (self.onload) self.onload();
                };
                real.onerror = function () { if (self.onerror) self.onerror(); };
                real.onabort = function () { if (self.onabort) self.onabort(); };
                real.ontimeout = function () { if (self.ontimeout) self.ontimeout(); };
                return real.send(body);
            }
            var url = redact(self._url);
            var h = {};
            Object.keys(headers).forEach(function (k) { h[k] = k === 'Device-Id' ? '<device-id>' : headers[k]; });
            var data = body ? String(body).replace(/"uuid":"[^"]*"/g, '"uuid":"<device-id>"') : null;
            log.push({step: step.name, method: self._method, url: url, headers: h, body: data ? JSON.parse(data) : null, page: location.hash});
            var a = answer(self._method, url);
            setTimeout(function () {
                self.readyState = 4; self.status = a.status; self.statusText = a.status === 200 ? 'OK' : 'Error';
                self.response = self.responseText = a.body;
                if (self.onreadystatechange) self.onreadystatechange();
                if (self.onload) self.onload();
            }, 30);
        };
    }
    window.XMLHttpRequest = Server;
})(${JSON.stringify(FIXTURES)}, ${JSON.stringify(FEED)})`);

await dt.evaluate(BLOCKS);
await dt.evaluate(`window.twSettings = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil'), Push = inj.get('Push');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope');
    var wait = twBlocks.wait;
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shownAll(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function box(el) { var r = rect(el); return [r.x, r.y, r.w, r.h]; }
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo || null);
        return {color: cs.color, background: cs.backgroundColor, backgroundImage: cs.backgroundImage.slice(0, 80), fontSize: cs.fontSize,
            fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor,
            borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomColor, padding: cs.padding, opacity: cs.opacity,
            content: pseudo ? cs.content : undefined};
    }
    // The settings page shown (S07 or S08): its header bar in the nav bar's active block and its view.
    function view() {
        return Array.prototype.filter.call(document.querySelectorAll('ion-view'), function (v) {
            return visible(v) && v.getAttribute('nav-view') === 'active' && !v.querySelector('ion-view');
        }).pop();
    }
    function bar() { var b = document.querySelector('ion-nav-bar .nav-bar-block[nav-bar="active"] .bar'); return b && visible(b) ? b : null; }
    function popups() { return shownAll('.popup-container .popup'); }
    // Closes each popup with its first button, tapped as a user does (ionic.tap drops clicks it did not create): the
    // popup goes and Ionic keeps its backdrop for the next one.
    function closePopups() {
        popups().forEach(function (p) {
            var b = p.querySelector('.popup-buttons .button'), r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
            var ev = document.createEvent('MouseEvents');
            ev.initMouseEvent('click', true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
            ev.isIonicTap = true;
            b.dispatchEvent(ev);
        });
        return wait(600);
    }
    return {
        setup: function (data, info) {
            var converted = WeatherUtil.convertWeatherData([{data: data}]);
            var city = {name: info.name, address: info.address, country: info.country, location: info.location, currentPosition: false};
            Object.keys(converted).forEach(function (k) { city[k] = converted[k]; });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            // An alarm for the place and a token, so a unit change posts the push list (Push.updateUnits).
            Push.pushData.fcmToken = 'capture-token';
            Push.pushData.pushList = [Push.newPushAlarm(1, WeatherInfo.getCityIndex(), 8 * 3600, [true, true, true, true, true, true, true])];
            Push.savePushInfo();
            return closePopups().then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(2500); })
                .then(closePopups).then(function () { return location.hash; });
        },
        where: function () {
            var units = inj.get('Units').getAllUnits();
            return {page: location.hash, settings: angular.copy($rootScope.settingsInfo), units: units, popups: popups().length,
                menu: inj.get('$ionicSideMenuDelegate').isOpenLeft(), body: document.body.className.split(' ').filter(function (c) { return /theme/.test(c); }).join(' ')};
        },
        // Rects of what to tap, in CSS px.
        navicon: function () { return box(shownAll('.button.ion-navicon, .ion-navicon')[0]); },
        menuRow: function (click) {
            var row = shownAll('ion-side-menu [ng-click="' + click + '"]')[0] || document.querySelector('ion-side-menu [ng-click="' + click + '"]');
            row.scrollIntoView({block: 'nearest'});
            return wait(300).then(function () { return box(row); });
        },
        menuToEnd: function () {
            var c = document.querySelector('ion-side-menu ion-content');
            c.scrollTop = c.scrollHeight;
            return wait(400).then(function () { return {scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, height: c.clientHeight}; });
        },
        item: function (i) { return box(view().querySelectorAll('.list .item')[i]); },
        back: function () { return box(bar().querySelector('.button')); },
        popupButton: function (i) { return box(popups()[0].querySelectorAll('.popup-buttons .button')[i]); },
        // The settings page: header bar, title, back button, every row with its value or check mark.
        page: function () {
            var b = bar(), v = view(), list = v.querySelector('.list');
            var items = Array.prototype.map.call(list.querySelectorAll('.item'), function (e) {
                var icon = e.querySelector('.radio-icon'), span = e.querySelector('span'), input = e.querySelector('input');
                var label = e.querySelector('.item-content') || e;
                return {text: e.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(e), style: style(e),
                    label: {rect: rect(label), style: style(label)},
                    value: span ? {text: span.textContent.trim(), rect: rect(span), style: style(span)} : undefined,
                    checked: input ? input.checked : undefined,
                    check: icon ? {rect: rect(icon), visibility: getComputedStyle(icon).visibility, style: style(icon), glyph: style(icon, '::before')} : undefined};
            });
            var content = v.querySelector('ion-content') || v;
            return {page: location.hash, body: document.body.className.split(' ').filter(function (c) { return /theme/.test(c); }).join(' '),
                bar: {rect: rect(b), style: style(b), after: style(b, '::after')},
                back: {rect: rect(b.querySelector('.button')), style: style(b.querySelector('.button')), glyph: style(b.querySelector('.button'), '::before')},
                title: {text: b.querySelector('.title').textContent.trim(), rect: rect(b.querySelector('.title')), style: style(b.querySelector('.title'))},
                content: {rect: rect(content), style: style(content)}, list: {rect: rect(list), style: style(list)}, items: items};
        },
        // The About popup over the menu: every part of the popup and the backdrop.
        popup: function () {
            var p = popups()[0];
            var parts = Array.prototype.map.call(p.querySelectorAll('.popup-head, .popup-title, .popup-body, .popup-body span, .popup-buttons, .popup-buttons .button'), function (e) {
                return {cls: e.getAttribute('class') || '', tag: e.tagName.toLowerCase(), text: e.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(e), style: style(e)};
            });
            var backdrop = shownAll('.backdrop')[0];
            return {popup: {rect: rect(p), style: style(p)}, parts: parts, body: p.querySelector('.popup-body').innerHTML,
                backdrop: backdrop && {rect: rect(backdrop), style: style(backdrop)}};
        },
        // Opens a weather page afresh, as the forecast reference does, after the settings pages closed.
        weather: function (state) {
            return wait(0).then(function () { return $state.go('tab.search'); }).then(function () { return wait(600); })
                .then(function () { return $state.go(state); }).then(function () { return wait(1500); })
                .then(function () { twBlocks.content().scrollTop = 0; return wait(500); })
                .then(function () { return {count: twBlocks.blocks().length, body: document.body.className}; });
        },
    };
})()`);

const origin = screenshots.webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
const view = await dt.evaluate('({width: innerWidth, height: innerHeight})');
fs.mkdirSync(OUT, {recursive: true});

/** A real tap at the center of the rect [x, y, w, h] (CSS px) the expression gives, then a wait. */
async function tap(expression, ms = 1500) {
    const [x, y, w, h] = await dt.evaluate(expression);
    adb('shell', 'input', 'tap', String(Math.round(origin.x + (x + w / 2) * dpr)), String(Math.round(origin.y + (y + h / 2) * dpr)));
    await sleep(ms);
}
async function step(name) { await dt.evaluate(`twStep(${JSON.stringify(name)})`); }
async function expectPage(hash) {
    const where = await dt.evaluate('twSettings.where()');
    if (where.page !== hash || where.popups) throw new Error(`expected ${hash} without popups, got ${JSON.stringify(where)}`);
    return where;
}
/** The top of the WebView down to [bottom] CSS px, cut from the screen. */
function cut(file, bottom) {
    const height = Math.round(bottom * dpr);
    fs.writeFileSync(path.join(OUT, file), screenshots.png(screenshots.screen(), {x: origin.x, y: origin.y, width: Math.round(view.width * dpr), height}));
    return {screen: {x: origin.x, y: origin.y}, size: {width: Math.round(view.width * dpr), height}};
}
/** A settings page: the header bar and the list with 20 CSS px of the page under it. */
async function page(state) {
    const p = await dt.evaluate('twSettings.page()');
    const bottom = p.list.rect.y + p.list.rect.h + 20;
    const clip = cut(`${state}.png`, bottom);
    fs.writeFileSync(path.join(OUT, `${state}.json`), JSON.stringify({state, lang, ...p, clip}) + '\n');
    console.log(`${lang} ${state}: ${p.title.text}, ${p.items.map((i) => i.text + (i.checked ? ' ✓' : '')).join(' | ')}`);
}
async function weather(state, page = 'hourly') {
    const shown = await dt.evaluate(`twSettings.weather('${page === 'hourly' ? 'tab.forecast' : 'tab.dailyforecast'}')`);
    const blocks = await cutBlocks(dt, screenshots, origin, dpr, path.join(OUT, state), page, shown.count, `${lang} ${state}`);
    fs.writeFileSync(path.join(OUT, state, `${page}.json`), JSON.stringify({state, body: shown.body, blocks}) + '\n');
    console.log(`${lang} ${state}: ${blocks.length} blocks`);
}
const openMenu = () => tap('twSettings.navicon()', 900);
const menuRow = (click) => tap(`twSettings.menuRow(${JSON.stringify(click)})`);
const back = () => tap('twSettings.back()');
async function chooseInMenu(click, index) {
    await openMenu();
    await menuRow(click);
    await tap(`twSettings.item(${index})`, 2500);
    await back();
}

const SEOUL = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}};
await step('setup');
await dt.evaluate(`twSettings.setup(${JSON.stringify(input('kma-seoul'))}, ${JSON.stringify(SEOUL)})`);
await expectPage('#/tab/forecast');

if (process.env.TW_REFERENCE_SIZE) {
    // Added sizes use representative settings states; historical capture keeps its full matrix below.
    await openMenu();
    await menuRow(`clickMenu('units')`);
    await page('units');
    await tap('twSettings.item(0)');
    await page('radio-temperatureUnit');
    await back();
    await back();
    for (const [theme, index] of [['dark', 2], ['photo', 0], ['old', 3]]) {
        await chooseInMenu(`settingRadio('theme')`, index);
        await weather(`hourly-${theme}`);
        await weather(`daily-${theme}`, 'daily');
        await openMenu();
        await menuRow(`clickMenu('units')`);
        await page(`units-${theme}`);
        await back();
    }
    await chooseInMenu(`settingRadio('theme')`, 1);
} else if (lang === 'ko-KR') {
    const UNITS = ['temperatureUnit', 'windSpeedUnit', 'pressureUnit', 'distanceUnit', 'precipitationUnit', 'airUnit'];
    await step('open units');
    await openMenu();
    await menuRow(`clickMenu('units')`);
    await expectPage('#/units');
    await page('units');
    for (const [i, name] of UNITS.entries()) {
        await step(`open ${name}`);
        await tap(`twSettings.item(${i})`);
        await expectPage('#/setting-radio');
        await page(`radio-${name}`);
        await back();
    }
    // 온도단위 F: the push list and the weather in °F at once; then the weather page in °F.
    await step('choose temperatureUnit F');
    await tap('twSettings.item(0)');
    await tap('twSettings.item(1)', 3000);
    await expectPage('#/setting-radio');
    await page('radio-temperatureUnit-f');
    await step('back to units');
    await back();
    await page('units-f');
    await step('back to the weather');
    await back();
    await expectPage('#/tab/forecast');
    await weather('hourly-f');
    await step('choose temperatureUnit C');
    await openMenu();
    await menuRow(`clickMenu('units')`);
    await tap('twSettings.item(0)');
    await tap('twSettings.item(0)', 3000);
    await back();
    await back();

    for (const [list, index] of [['startupPage', 1], ['refreshInterval', 1]]) {
        await step(`open ${list}`);
        await openMenu();
        await menuRow(`settingRadio('${list}')`);
        await expectPage('#/setting-radio');
        await page(`radio-${list}`);
        await step(`choose ${list} ${index}`);
        await tap(`twSettings.item(${index})`, 3000);
        await back();
        await step(`choose ${list} 0`);
        await chooseInMenu(`settingRadio('${list}')`, 0);
    }

    await step('open theme');
    await openMenu();
    await menuRow(`settingRadio('theme')`);
    await page('radio-theme');
    await back();
    // Theme list: photo, light, dark, old.
    for (const [theme, index] of [['dark', 2], ['photo', 0], ['old', 3]]) {
        await step(`choose theme ${theme}`);
        await openMenu();
        await menuRow(`settingRadio('theme')`);
        await tap(`twSettings.item(${index})`, 3000);
        await page(`radio-theme-${theme}`);
        await back();
        if (theme !== 'old') await weather(`hourly-${theme}`);
        await step(`units in ${theme}`);
        await openMenu();
        await menuRow(`clickMenu('units')`);
        await page(`units-${theme}`);
        await back();
    }
    await step('choose theme light');
    await chooseInMenu(`settingRadio('theme')`, 1);
} else {
    await step('open units');
    await openMenu();
    await menuRow(`clickMenu('units')`);
    await expectPage('#/units');
    await page('units');
    await back();
}

// About over the menu scrolled to its end (manual page 36), then 확인.
await step('open about');
await openMenu();
const menu = await dt.evaluate('twSettings.menuToEnd()');
await tap(`twSettings.menuRow("clickMenu('openInfo')")`, 1500);
const popup = await dt.evaluate('twSettings.popup()');
const clip = cut('about.png', view.height);
fs.writeFileSync(path.join(OUT, 'about.json'), JSON.stringify({state: 'about', lang, menu, ...popup, clip}) + '\n');
console.log(`${lang} about: ${popup.parts.map((p) => p.text).filter(Boolean).slice(0, 1).join('')} (menu at ${menu.scrollTop})`);
await step('close about');
await tap('twSettings.popupButton(0)', 1000);
const after = await dt.evaluate('twSettings.where()');
if (after.popups) throw new Error('the About popup did not close');

const requests = await dt.evaluate('twServerLog');
fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify({lang, after, requests}, null, 1) + '\n');
console.log(`${lang}: ${requests.length} requests (${[...new Set(requests.map((r) => r.step))].length} steps)`);
dt.close();
