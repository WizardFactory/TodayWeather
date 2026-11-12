#!/usr/bin/env node
// Records the Cordova nationwide pages and warnings that the native pages are compared with (AN-13, #2892). capture.sh
// runs it for each language while the Cordova debug build runs offline at 384x832 dp, density 2.
//
// The page talks to a stand-in server inside the WebView (XMLHttpRequest replaced for the server's URLs):
// - weather for the place: the corpus fixture kma-seoul;
// - /v000903/nation/KR: the corpus input nation.json (or an empty answer, a failure, or a late answer for the
//   loading state);
// - /v000903/kma/special: the corpus input special.json (or [] or a failure).
// Every step is a real tap on the screen (adb input tap at the element's center), as a user does it.
//
// States, written as app/src/test/resources/nation-reference/<lang>/<state>.png and <state>.json:
//   ko-KR
//     nation-loading             S10 while its request runs
//     nation-weather             S10 날씨/기온 (manual page 33)
//     nation-rain, nation-wind   the other two modes (page 34)
//     nation-air-<type>          S11 in each of its six tabs, CO after swiping the strip (page 35)
//     warnings, warnings-<i>     S12 (page 32): its top, then each card whole
//     nation-weather-failed, nation-air-failed, warnings-empty, warnings-failed
//     nation-weather-<theme>, warnings-<theme>       dark and old (the photo theme's bar is the old one's)
//     nation-wind-kph, nation-air-pm2.5-airnow      after a unit change
//   en-KR
//     nation-weather, nation-air-pm2.5, warnings, warnings-<i>
//   requests.json                what each step sent, in order
//   node capture.mjs <emulator-serial> <lang> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {BLOCKS} from '../emulator/page-blocks.mjs';
import {Screen} from '../emulator/screen.mjs';
import {referenceRoot, recordView} from '../emulator/reference-view.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(referenceRoot(root, 'nation'), lang);
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const input = (name) => JSON.parse(fs.readFileSync(path.join(corpus, 'inputs', `${name}.json`), 'utf8'));
const screenshots = new Screen(serial);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);

const dt = await connect(serial);
await dt.settled();
await recordView(dt, new Screen(serial), OUT);

// The stand-in server: requests to http(s) URLs other than the app's own pages are answered here and recorded, with
// the server's address left out of the record. window.twAnswer sets how the nation and warning requests are answered.
const WEATHER = JSON.stringify(input('kma-seoul'));
const NATION = JSON.stringify(input('nation'));
const SPECIAL = JSON.stringify(input('special'));
await dt.evaluate(`(function (weather, nation, special) {
    var Real = window.XMLHttpRequest;
    var log = window.twServerLog = [];
    var step = {name: 'start'};
    var mode = {nation: 'ok', special: 'ok'};
    window.twStep = function (name) { step = {name: name}; };
    window.twAnswer = function (kind, how) { mode[kind] = how; };
    function local(url) { return !/^https?:/.test(url) || /^https?:\\/\\/localhost\\//.test(url); }
    // The photo feed's whole URL is a private build input; the server's address is too.
    function redact(url) { return /photos/.test(url) ? '<photo-feed>' : String(url).replace(/^https?:\\/\\/[^\\/]+/, '<server>'); }
    function answer(method, url) {
        if (method === 'GET' && /\\/weather\\/v000903\\/coord\\//.test(url)) return {status: 200, body: weather};
        if (method === 'GET' && /\\/v000903\\/nation\\/KR\\?/.test(url)) {
            if (mode.nation === 'fail') return {status: 500, body: 'Internal Server Error'};
            if (mode.nation === 'empty') return {status: 200, body: '{"nation":"KR","weather":[],"air":[]}'};
            return {status: 200, body: nation, delay: mode.nation === 'late' ? 4000 : 30};
        }
        if (method === 'GET' && /\\/v000903\\/kma\\/special$/.test(url)) {
            if (mode.special === 'fail') return {status: 500, body: 'Internal Server Error'};
            if (mode.special === 'empty') return {status: 200, body: '[]'};
            return {status: 200, body: special};
        }
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
            log.push({step: step.name, method: self._method, url: url, headers: headers, responseType: self.responseType || '',
                timeout: self.timeout || 0, page: location.hash});
            var a = answer(self._method, url);
            setTimeout(function () {
                self.readyState = 4; self.status = a.status; self.statusText = a.status === 200 ? 'OK' : 'Error';
                // A json responseType gets the parsed body (null when it does not parse), as the WebView gives it.
                if (self.responseType === 'json') {
                    try { self.response = JSON.parse(a.body); } catch (e) { self.response = null; }
                } else {
                    self.response = self.responseText = a.body;
                }
                if (self.onreadystatechange) self.onreadystatechange();
                if (self.onload) self.onload();
            }, a.delay || 30);
        };
    }
    window.XMLHttpRequest = Server;
})(${JSON.stringify(WEATHER)}, ${JSON.stringify(NATION)}, ${JSON.stringify(SPECIAL)})`);

await dt.evaluate(BLOCKS);
await dt.evaluate(`window.twNation = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope');
    var wait = twBlocks.wait;
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    }
    function onScreen(el) { var r = el.getBoundingClientRect(); return visible(el) && r.left >= -1 && r.right <= innerWidth + 1; }
    function shownAll(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), onScreen); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function box(el) { var r = rect(el); return [r.x, r.y, r.w, r.h]; }
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo || null);
        return {color: cs.color, background: cs.backgroundColor, backgroundImage: cs.backgroundImage.slice(0, 120),
            backgroundSize: cs.backgroundSize, backgroundPosition: cs.backgroundPosition, fontSize: cs.fontSize,
            fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, textAlign: cs.textAlign,
            border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(' ') + ' ' + cs.borderTopColor,
            borderRadius: cs.borderTopLeftRadius, padding: cs.padding, margin: cs.margin, opacity: cs.opacity,
            content: pseudo ? cs.content : undefined};
    }
    function ownText(el) {
        return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
            .map(function (n) { return n.textContent; }).join('').replace(/\\s+/g, ' ').trim();
    }
    // Every visible element under el with its rect relative to [origin] (default el), its own text and its style.
    function parts(el, origin) {
        var o = (origin || el).getBoundingClientRect();
        return Array.prototype.filter.call(el.querySelectorAll('*'), visible).map(function (e) {
            var r = e.getBoundingClientRect();
            return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: ownText(e), src: e.getAttribute('src') || undefined,
                natural: e.tagName === 'IMG' ? [e.naturalWidth, e.naturalHeight] : undefined,
                rect: {x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height}, style: style(e)};
        });
    }
    // The page shown: the active view of the nav view.
    function view() {
        return Array.prototype.filter.call(document.querySelectorAll('ion-view'), function (v) {
            return visible(v) && v.getAttribute('nav-view') === 'active' && !v.querySelector('ion-view');
        }).pop();
    }
    function bar() { var b = document.querySelector('ion-nav-bar .nav-bar-block[nav-bar="active"] .bar'); return b && visible(b) ? b : null; }
    function content() { return view().querySelector('ion-content'); }
    function theme() { return document.body.className.split(' ').filter(function (c) { return /theme/.test(c); }).join(' '); }
    function header() {
        var b = bar(), back = b.querySelector('.button'), title = b.querySelector('.title');
        return {bar: {rect: rect(b), style: style(b), after: style(b, '::after')},
            back: {rect: rect(back), style: style(back), glyph: style(back, '::before')},
            title: {text: title.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(title), style: style(title), parts: parts(title, b)}};
    }
    // Closes each popup with its first button, tapped as a user does (ionic.tap drops clicks it did not create): the
    // popup goes and Ionic keeps its backdrop element, which the loading overlay uses later.
    function closePopups() {
        shownAll('.popup-container .popup').forEach(function (p) {
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
            return closePopups().then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(2500); })
                .then(closePopups).then(function () { return location.hash; });
        },
        where: function () {
            return {page: location.hash, theme: theme(), units: inj.get('Units').getAllUnits(), region: inj.get('Util').region,
                loading: shownAll('.loading-container.visible .loading').length, menu: inj.get('$ionicSideMenuDelegate').isOpenLeft()};
        },
        // Rects of what to tap, in CSS px.
        navicon: function () { return box(shownAll('.button.ion-navicon, .ion-navicon')[0]); },
        menuRow: function (click) {
            var row = shownAll('ion-side-menu [ng-click="' + click + '"]')[0] || document.querySelector('ion-side-menu [ng-click="' + click + '"]');
            row.scrollIntoView({block: 'nearest'});
            return wait(300).then(function () { return box(row); });
        },
        back: function () { return box(bar().querySelector('.button')); },
        item: function (i) { return box(view().querySelectorAll('.list .item')[i]); },
        mode: function (i) { return box(view().querySelectorAll('.nation-bar a')[i]); },
        tab: function (i) { return box(view().querySelectorAll('.nation-air-label a')[i]); },
        // The strip of S11 (ion-scroll, overflow scrolling): where to swipe and how far it is scrolled.
        strip: function () {
            var s = view().querySelector('ion-scroll'), scroller = s.querySelector('.scroll') || s;
            return {rect: rect(s), scrollLeft: s.scrollLeft, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth,
                inner: rect(scroller)};
        },
        // S10 or S11: header, the mode buttons or pollutant tabs, the map and every label with its parts.
        nation: function () {
            var v = view(), c = content(), map = v.querySelector('.nation');
            var buttons = Array.prototype.map.call(v.querySelectorAll('.nation-bar a, .nation-air-label a'), function (a) {
                return {text: a.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(a), style: style(a)};
            });
            var labels = Array.prototype.map.call(map.querySelectorAll('.nation-label'), function (l) {
                return {name: l.children[0].textContent.trim(), rect: rect(l), style: style(l), parts: parts(l)};
            });
            var bars = v.querySelector('.nation-bar, .nation-air-label');
            var s = v.querySelector('ion-scroll');
            return Object.assign(header(), {page: location.hash, theme: theme(), content: {rect: rect(c), style: style(c), scrollTop: c.scrollTop},
                bar: undefined, header: header().bar, buttonBar: {rect: rect(bars), style: style(bars)},
                strip: s ? {rect: rect(s), scrollLeft: s.scrollLeft, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth} : undefined,
                buttons: buttons, map: {rect: rect(map), style: style(map)}, labels: labels});
        },
        // S12: header, the content and each card with its parts.
        warnings: function () {
            var v = view(), c = content();
            var cards = Array.prototype.map.call(v.querySelectorAll('.item-body'), function (card) {
                return {rect: rect(card), style: style(card), html: card.innerHTML.length, parts: parts(card)};
            });
            return Object.assign(header(), {page: location.hash, theme: theme(), content: {rect: rect(c), style: style(c),
                scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight}, cards: cards});
        },
        // Scrolls card i so that it starts under the header, as far as the page lets it; returns its rect.
        card: function (i, by) {
            var c = content(), card = view().querySelectorAll('.item-body')[i];
            if (by === undefined) c.scrollTop += card.getBoundingClientRect().top - bar().getBoundingClientRect().bottom; else c.scrollTop += by;
            return wait(400).then(function () {
                return {rect: rect(card), top: bar().getBoundingClientRect().bottom, bottom: innerHeight, scrollTop: c.scrollTop};
            });
        },
        // The loading overlay: its container, box, spinner and backdrop.
        loading: function () {
            var lc = shownAll('.loading-container')[0], box = lc && lc.querySelector('.loading'), sp = box && box.querySelector('ion-spinner');
            var bd = shownAll('.backdrop')[0];
            return {container: lc && {rect: rect(lc), style: style(lc), cls: lc.className}, box: box && {rect: rect(box), style: style(box)},
                spinner: sp && {rect: rect(sp), cls: sp.className, svg: sp.innerHTML.slice(0, 2000), style: style(sp)},
                backdrop: bd && {rect: rect(bd), style: style(bd), cls: bd.className}};
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
async function answer(kind, how) { await dt.evaluate(`twAnswer(${JSON.stringify(kind)}, ${JSON.stringify(how)})`); }
async function expectPage(hash) {
    const where = await dt.evaluate('twNation.where()');
    if (where.page !== hash) throw new Error(`expected ${hash}, got ${JSON.stringify(where)}`);
    return where;
}
/** The top of the WebView down to [bottom] CSS px, cut from the screen. */
function cut(file, bottom) {
    const height = Math.round(Math.min(bottom, view.height) * dpr);
    fs.writeFileSync(path.join(OUT, file), screenshots.png(screenshots.screen(), {x: origin.x, y: origin.y, width: Math.round(view.width * dpr), height}));
    return {screen: {x: origin.x, y: origin.y}, size: {width: Math.round(view.width * dpr), height}};
}
async function record(state, data, bottom) {
    const where = await dt.evaluate('twNation.where()');
    const clip = cut(`${state}.png`, bottom);
    fs.writeFileSync(path.join(OUT, `${state}.json`), JSON.stringify({state, lang, where, ...data, clip}) + '\n');
}
/** S10 or S11 from the top of the page to 20 CSS px under the map. */
async function nation(state) {
    const p = await dt.evaluate('twNation.nation()');
    await record(state, p, p.map.rect.y + p.map.rect.h + 20);
    const values = p.labels.map((l) => l.parts.filter((x) => x.text && x.text !== l.name).map((x) => x.text).join('')).join(' ');
    console.log(`${lang} ${state}: ${p.title.text} [${p.buttons.map((b) => b.text).join('|')}] ${values.slice(0, 90)}`);
}
/** S12: the screen as it opens, then every card whole (stitched when taller than the screen under the header). */
async function warnings(state) {
    const p = await dt.evaluate('twNation.warnings()');
    await record(state, p, view.height);
    for (let i = 0; i < p.cards.length; i++) {
        let at = await dt.evaluate(`twNation.card(${i})`);
        // A card is 2 CSS px wider than the WebView (its side borders are outside it): it is cut at the WebView's edges.
        const x = Math.max(0, Math.round(at.rect.x * dpr)), width = Math.min(Math.round(view.width * dpr), Math.round((at.rect.x + at.rect.w) * dpr)) - x;
        const stack = [];
        // The first card starts 1 CSS px under the header's top edge and cannot scroll clear of it: what the header
        // hides is left out of the image and recorded as clipTop.
        const clipTop = Math.max(0, at.top - at.rect.y);
        let done = clipTop;
        while (done < at.rect.h - 0.5) {
            const from = Math.max(at.rect.y + done, at.top), to = Math.min(at.rect.y + at.rect.h, at.bottom);
            if (to <= from + 0.5) throw new Error(`${state} card ${i}: no progress at ${done}`);
            const y0 = Math.round(from * dpr), y1 = Math.round(to * dpr);
            stack.push({shot: screenshots.screen(), area: {x: origin.x + x, y: origin.y + y0, width, height: y1 - y0}});
            done = to - at.rect.y;
            if (done < at.rect.h - 0.5) at = await dt.evaluate(`twNation.card(${i}, ${to - at.top})`);
        }
        fs.writeFileSync(path.join(OUT, `${state}-${i}.png`), screenshots.pngStack(stack));
        fs.writeFileSync(path.join(OUT, `${state}-${i}.json`), JSON.stringify({state: `${state}-${i}`, lang, card: p.cards[i], clipTop, pieces: stack.length,
            size: {width, height: stack.reduce((h, s) => h + s.area.height, 0)}}) + '\n');
    }
    await dt.evaluate(`(function () { var c = document.querySelector('ion-view[nav-view="active"] ion-content'); c.scrollTop = 0; })()`);
    console.log(`${lang} ${state}: ${p.title.text}, ${p.cards.length} cards ${p.cards.map((c) => c.parts.filter((x) => x.tag === 'h2').map((x) => x.text).join('')).join(' | ')}`);
}

const openMenu = () => tap('twNation.navicon()', 900);
const menuRow = (click, ms) => tap(`twNation.menuRow(${JSON.stringify(click)})`, ms);
const back = async () => { await tap('twNation.back()'); await expectPage('#/tab/forecast'); };
async function open(click, hash, ms = 2500) {
    await openMenu();
    await menuRow(`clickMenu('${click}')`, ms);
    await expectPage(hash);
}
/** A radio list of the menu or the units page: opens it, taps the row whose text starts with [label], comes back. */
async function choose(open, label) {
    await openMenu();
    await open();
    const rows = await dt.evaluate(`Array.prototype.map.call(document.querySelectorAll('ion-view[nav-view="active"] .list .item'), function (e) { return e.textContent.replace(/\\s+/g, ' ').trim(); })`);
    const i = rows.findIndex((r) => r.startsWith(label));
    if (i < 0) throw new Error(`no row ${label} in ${rows.join(' | ')}`);
    await tap(`twNation.item(${i})`, 3000);
}
async function unit(index, label) {
    await choose(async () => { await menuRow(`clickMenu('units')`); await tap(`twNation.item(${index})`); }, label);
    await tap('twNation.back()');
    await tap('twNation.back()');
    await expectPage('#/tab/forecast');
}
async function theme(label) {
    await choose(() => menuRow(`settingRadio('theme')`), label);
    await tap('twNation.back()');
    await expectPage('#/tab/forecast');
}

const SEOUL = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}};
await step('setup');
await dt.evaluate(`twNation.setup(${JSON.stringify(input('kma-seoul'))}, ${JSON.stringify(SEOUL)})`);
await expectPage('#/tab/forecast');
const TYPES = ['pm2.5', 'pm10', 'o3', 'no2', 'so2', 'co'];

if (process.env.TW_REFERENCE_SIZE) {
    await open('nation', '#/nation');
    await nation('nation-weather');
    await back();
    await open('nation-air', '#/nation-air');
    await nation('nation-air-pm2.5');
    await back();
    await open('kma-special', '#/kma-special');
    await warnings('warnings');
    await back();
    for (const name of ['dark', 'old']) {
        const key = name === 'dark' ? 'LOC_DARK_THEME' : 'LOC_OLD_THEME';
        const label = await dt.evaluate(`angular.element(document.body).injector().get('$translate').instant('${key}')`);
        await theme(label);
        await open('nation-air', '#/nation-air');
        await nation(`nation-air-pm2.5-${name}`);
        await back();
    }
} else if (lang === 'ko-KR') {
    // S10 with a late answer: the loading overlay, then the page.
    await step('open nation (late answer)');
    await answer('nation', 'late');
    await open('nation', '#/nation', 1200);
    const loading = await dt.evaluate('twNation.loading()');
    await record('nation-loading', {loading}, view.height);
    console.log(`${lang} nation-loading: ${JSON.stringify(loading.box && loading.box.rect)}`);
    await sleep(4500);
    await answer('nation', 'ok');
    await nation('nation-weather');
    await step('nation rain');
    await tap('twNation.mode(1)', 800);
    await nation('nation-rain');
    await step('nation wind');
    await tap('twNation.mode(2)', 800);
    await nation('nation-wind');
    await back();

    await step('open nation-air');
    await open('nation-air', '#/nation-air');
    await nation('nation-air-pm2.5');
    for (const [i, type] of TYPES.entries()) {
        if (i === 0) continue;
        if (type === 'co') {
            // The strip is wider than the screen: a swipe to the left brings CO in. It starts well inside the screen,
            // as a swipe from the edge is the system's back gesture.
            await step('swipe the strip');
            const s = await dt.evaluate('twNation.strip()');
            const y = Math.round(origin.y + (s.rect.y + s.rect.h / 2) * dpr);
            adb('shell', 'input', 'swipe', String(Math.round(origin.x + (s.rect.x + s.rect.w * 0.75) * dpr)), String(y),
                String(Math.round(origin.x + (s.rect.x + 60) * dpr)), String(y), '500');
            await sleep(1500);
            const after = await dt.evaluate('twNation.strip()');
            await expectPage('#/nation-air');
            console.log(`${lang} strip: scrolled ${after.scrollLeft} of ${after.scrollWidth - after.clientWidth}`);
        }
        await step(`nation-air ${type}`);
        await tap(`twNation.tab(${i})`, 800);
        await nation(`nation-air-${type}`);
    }
    await back();

    await step('open warnings');
    await open('kma-special', '#/kma-special');
    await warnings('warnings');
    await back();

    await step('failed and empty answers');
    await answer('nation', 'fail');
    await open('nation', '#/nation');
    await nation('nation-weather-failed');
    await back();
    await open('nation-air', '#/nation-air');
    await nation('nation-air-failed');
    await back();
    await answer('nation', 'ok');
    await answer('special', 'empty');
    await open('kma-special', '#/kma-special');
    await record('warnings-empty', await dt.evaluate('twNation.warnings()'), view.height);
    await back();
    await answer('special', 'fail');
    await open('kma-special', '#/kma-special');
    await record('warnings-failed', await dt.evaluate('twNation.warnings()'), view.height);
    await back();
    await answer('special', 'ok');

    // Theme list: photo, light, dark, old.
    for (const [name, label] of [['dark', '어두운'], ['old', '이전']]) {
        await step(`theme ${name}`);
        await theme(label);
        await open('nation', '#/nation');
        await nation(`nation-weather-${name}`);
        await back();
        await open('kma-special', '#/kma-special');
        const p = await dt.evaluate('twNation.warnings()');
        await record(`warnings-${name}`, p, view.height);
        await back();
    }
    await step('theme light');
    await theme('밝은');

    // Units: wind speed in km/h for S10 and the AirNow standard for S11.
    await step('wind speed km/h');
    await unit(1, 'km/h');
    await open('nation', '#/nation');
    await tap('twNation.mode(2)', 800);
    await nation('nation-wind-kph');
    await back();
    await step('air standard airnow');
    await unit(5, '미국');
    await open('nation-air', '#/nation-air');
    await nation('nation-air-pm2.5-airnow');
    await back();
} else {
    await step('open nation');
    await open('nation', '#/nation');
    await nation('nation-weather');
    await back();
    await step('open nation-air');
    await open('nation-air', '#/nation-air');
    await nation('nation-air-pm2.5');
    await back();
    await step('open warnings');
    await open('kma-special', '#/kma-special');
    await warnings('warnings');
    await back();
}

const requests = await dt.evaluate('twServerLog');
fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify({lang, requests}, null, 1) + '\n');
console.log(`${lang}: ${requests.length} requests (${[...new Set(requests.map((r) => r.step))].length} steps)`);
dt.close();
