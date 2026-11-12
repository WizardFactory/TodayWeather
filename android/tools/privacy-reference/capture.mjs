#!/usr/bin/env node
// Records the Cordova menu rows of AN-15 (#2894) that the native app is compared with: run by capture.sh for each
// language while the Cordova debug build runs offline at 384x832 dp, density 2. The page talks to a stand-in server
// inside the WebView (XMLHttpRequest replaced for the server's URLs): a weather request gets the AN-02 corpus fixture
// kma-seoul. The place is 회현동 (kma-seoul). Every step is a real tap on the screen (adb input tap at the element's
// center) or the Android back key, as a user does it:
//   menu-off            the menu scrolled to its end, 선택적 이용 통계 · 꺼짐
//   analytics-popup     the usage analytics popup over that menu (manual page 37)
//   menu-allowed        the menu after 동의 (opt-in)
//   actions.json        navigator.language and Util.language; the choice after back, 동의 and 거부 / 철회 and what the
//                       app stored; the URLs 개인정보처리방침 and 이용약관 open (cordova.InAppBrowser.open is recorded and
//                       not run); what 광고 개인정보 선택 did (the plugin's callbacks and the popups shown)
//   app/src/test/resources/privacy-reference/<lang>/<state>.png and <state>.json
//   node capture.mjs <emulator-serial> <lang> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {Screen} from '../emulator/screen.mjs';
import {referenceRoot, recordView} from '../emulator/reference-view.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(referenceRoot(root, 'privacy'), lang);
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const fixture = fs.readFileSync(path.join(corpus, 'inputs', 'kma-seoul.json'), 'utf8');
const screenshots = new Screen(serial);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);

const dt = await connect(serial);
await dt.settled();
await recordView(dt, new Screen(serial), OUT);

// The stand-in server: requests to http(s) URLs other than the app's own pages are answered here (the weather fixture
// for the coordinates route, 200 for the push list, 404 otherwise).
await dt.evaluate(`(function (body) {
    var Real = window.XMLHttpRequest;
    function local(url) { return !/^https?:/.test(url) || /^https?:\\/\\/localhost\\//.test(url); }
    function answer(method, url) {
        if (method === 'GET' && /\\/weather\\/v000903\\/coord\\//.test(url)) return {status: 200, body: body};
        if (method === 'POST' && /\\/push-list$/.test(url)) return {status: 200, body: '{}'};
        return {status: 404, body: ''};
    }
    function Server() {
        var self = this, real = null;
        self.readyState = 0; self.status = 0; self.statusText = ''; self.response = ''; self.responseText = '';
        self.open = function (method, url) {
            self._method = method; self._url = url;
            if (local(url)) { real = new Real(); real.open.apply(real, arguments); }
            self.readyState = 1;
        };
        self.setRequestHeader = function (k, v) { if (real) real.setRequestHeader(k, v); };
        self.getAllResponseHeaders = function () { return real ? real.getAllResponseHeaders() : 'content-type: application/json\\r\\n'; };
        self.getResponseHeader = function (k) { return real ? real.getResponseHeader(k) : (/content-type/i.test(k) ? 'application/json' : null); };
        self.addEventListener = function () {};
        self.upload = {addEventListener: function () {}};
        self.abort = function () { if (real) real.abort(); };
        self.send = function (data) {
            if (real) {
                ['withCredentials', 'responseType', 'timeout'].forEach(function (k) { if (self[k] !== undefined) real[k] = self[k]; });
                real.onload = function () {
                    ['readyState', 'status', 'statusText', 'response', 'responseText'].forEach(function (k) { try { self[k] = real[k]; } catch (e) {} });
                    if (self.onload) self.onload();
                };
                real.onerror = function () { if (self.onerror) self.onerror(); };
                return real.send(data);
            }
            var a = answer(self._method, self._url);
            setTimeout(function () {
                self.readyState = 4; self.status = a.status; self.statusText = a.status === 200 ? 'OK' : 'Error';
                self.response = self.responseText = a.body;
                if (self.onreadystatechange) self.onreadystatechange();
                if (self.onload) self.onload();
            }, 30);
        };
    }
    window.XMLHttpRequest = Server;
})(${JSON.stringify(fixture)})`);

await dt.evaluate(`window.twPrivacy = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil'), Monetization = inj.get('Monetization');
    var Util = inj.get('Util'), $state = inj.get('$state');
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shownAll(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function box(el) { var r = rect(el); return [r.x, r.y, r.w, r.h]; }
    function style(el) {
        var cs = getComputedStyle(el);
        return {color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
            lineHeight: cs.lineHeight, textAlign: cs.textAlign, padding: cs.padding, margin: cs.margin, opacity: cs.opacity,
            border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, borderRadius: cs.borderTopLeftRadius,
            minHeight: cs.minHeight, boxShadow: cs.boxShadow};
    }
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
    // What the rows open: the system browser is recorded instead of opened; the ad privacy form's callbacks are recorded.
    var opened = [], adPrivacy = [];
    function record(via) { return function (url, target) { opened.push({via: via, url: url, target: target}); }; }
    if (window.cordova && cordova.InAppBrowser) cordova.InAppBrowser.open = record('InAppBrowser');
    window.open = record('window.open');
    var plugin = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
    if (plugin && plugin.showPrivacyOptionsForm) {
        var show = plugin.showPrivacyOptionsForm;
        plugin.showPrivacyOptionsForm = function (ok, fail) {
            adPrivacy.push('called');
            return show.call(plugin, function () { adPrivacy.push('success'); if (ok) ok.apply(this, arguments); },
                function () { adPrivacy.push('error'); if (fail) fail.apply(this, arguments); });
        };
    } else adPrivacy.push('no plugin');
    return {
        setup: function (data, info) {
            var converted = WeatherUtil.convertWeatherData([{data: data}]);
            var city = {name: info.name, address: info.address, country: info.country, location: info.location, currentPosition: false};
            Object.keys(converted).forEach(function (k) { city[k] = converted[k]; });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            // The notices of a first start (push, location) are closed as a user closes them.
            return closePopups().then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(2500); })
                .then(closePopups).then(function () { return location.hash; });
        },
        state: function () {
            var stored = null;
            try { stored = localStorage.getItem('twAnalyticsConsentV1'); } catch (e) {}
            return {page: location.hash, popups: popups().length, menu: inj.get('$ionicSideMenuDelegate').isOpenLeft(),
                choice: Monetization.getCollectionChoice(), stored: stored, opened: opened.slice(), adPrivacy: adPrivacy.slice(),
                popupTexts: popups().map(function (p) { return p.textContent.replace(/\\s+/g, ' ').trim(); })};
        },
        languages: function () { return {navigator: navigator.language, util: Util.language}; },
        navicon: function () { return box(shownAll('.button.ion-navicon, .ion-navicon')[0]); },
        menuToEnd: function () {
            var c = document.querySelector('ion-side-menu ion-content');
            c.scrollTop = c.scrollHeight;
            return wait(400).then(function () { return {scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, height: c.clientHeight}; });
        },
        row: function (click) { return box(document.querySelector('ion-side-menu [ng-click="' + click + '"]')); },
        rows: function () {
            return ["chooseAnalytics()", "openAdPrivacy()", "openPolicy('privacy')", "openPolicy('terms')"].map(function (click) {
                var e = document.querySelector('ion-side-menu [ng-click="' + click + '"]');
                return {click: click, text: e.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(e), style: style(e)};
            });
        },
        popupButton: function (i) { return box(popups()[0].querySelectorAll('.popup-buttons .button')[i]); },
        popup: function () {
            var p = popups()[0];
            var parts = Array.prototype.map.call(p.querySelectorAll('.popup-head, .popup-title, .popup-body, .popup-body span, .popup-buttons, .popup-buttons .button'), function (e) {
                return {cls: e.getAttribute('class') || '', tag: e.tagName.toLowerCase(), text: e.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(e), style: style(e)};
            });
            // Each line box of the body's text, as Chrome broke it.
            var span = p.querySelector('.popup-body span') || p.querySelector('.popup-body'), lines = [];
            var range = document.createRange(), node = span.firstChild, text = node ? node.textContent : '';
            for (var i = 0; i < text.length; i++) {
                range.setStart(node, i); range.setEnd(node, i + 1);
                var r = range.getClientRects()[0];
                if (!r) continue;
                var last = lines[lines.length - 1];
                if (!last || Math.abs(last.y - r.top) > 2) lines.push({y: r.top, h: r.height, text: text[i]});
                else last.text += text[i];
            }
            var backdrop = shownAll('.backdrop')[0];
            return {popup: {rect: rect(p), style: style(p)}, parts: parts, lines: lines,
                backdrop: backdrop && {rect: rect(backdrop), style: style(backdrop)}};
        },
    };
})()`);

const origin = screenshots.webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
const view = await dt.evaluate('({width: innerWidth, height: innerHeight})');
if (!process.env.TW_REFERENCE_SIZE && (view.width !== 384 || view.height !== 762)) throw new Error(`the WebView is ${view.width}x${view.height}, not the tests' 384x762`);
fs.mkdirSync(OUT, {recursive: true});

/** A real tap at the center of the rect [x, y, w, h] (CSS px) the expression gives, then a wait. */
async function tap(expression, ms = 1500) {
    const [x, y, w, h] = await dt.evaluate(expression);
    adb('shell', 'input', 'tap', String(Math.round(origin.x + (x + w / 2) * dpr)), String(Math.round(origin.y + (y + h / 2) * dpr)));
    await sleep(ms);
}
/** The whole WebView, cut from the screen. */
function cut(file) {
    fs.writeFileSync(path.join(OUT, file), screenshots.png(screenshots.screen(), {x: origin.x, y: origin.y,
        width: Math.round(view.width * dpr), height: Math.round(view.height * dpr)}));
    return {screen: {x: origin.x, y: origin.y}, size: {width: Math.round(view.width * dpr), height: Math.round(view.height * dpr)}};
}
const state = () => dt.evaluate('twPrivacy.state()');
async function menu(file) {
    const scroll = await dt.evaluate('twPrivacy.menuToEnd()');
    const rows = await dt.evaluate('twPrivacy.rows()');
    const clip = cut(`${file}.png`);
    fs.writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify({state: file, lang, scroll, rows, clip}) + '\n');
    console.log(`${lang} ${file}: ${rows.map((r) => r.text).join(' | ')}`);
}
const openPopup = () => tap(`twPrivacy.row("chooseAnalytics()")`, 1500);

const SEOUL = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}};
const hash = await dt.evaluate(`twPrivacy.setup(${JSON.stringify(JSON.parse(fixture))}, ${JSON.stringify(SEOUL)})`);
if (hash !== '#/tab/forecast') throw new Error(`setup ended on ${hash}`);
const before = await state();
if (before.popups || before.menu) throw new Error(`setup left ${JSON.stringify(before)}`);
const steps = [];
const record = async (step) => { const s = await state(); steps.push({step, ...s}); return s; };

await tap('twPrivacy.navicon()', 900);
await record('menu');
await menu('menu-off');

await openPopup();
const popup = await dt.evaluate('twPrivacy.popup()');
const clip = cut('analytics-popup.png');
fs.writeFileSync(path.join(OUT, 'analytics-popup.json'), JSON.stringify({state: 'analytics-popup', lang, ...popup, clip}) + '\n');
console.log(`${lang} analytics-popup: ${popup.parts.filter((p) => /button/.test(p.cls) && p.tag === 'button').map((p) => p.text).join(' | ')}, ${popup.lines.length} lines`);
await record('popup');

// Android back on the popup: recorded as it happens (the popup and the menu), then the menu is opened again.
async function back(step) {
    adb('shell', 'input', 'keyevent', '4');
    await sleep(300);
    const early = await state();
    await sleep(900);
    const s = await record(step);
    s.early = {popups: early.popups, menu: early.menu};
    steps[steps.length - 1].early = s.early;
    if (!s.menu) {
        await tap('twPrivacy.navicon()', 900);
        await dt.evaluate('twPrivacy.menuToEnd()');
    }
    return s;
}
const afterBack = await back('back');
if (afterBack.popups || afterBack.choice !== false) throw new Error(`back: ${JSON.stringify(afterBack)}`);

await openPopup();
await tap('twPrivacy.popupButton(1)', 2000);
const allowed = await record('allow');
if (allowed.choice !== true || allowed.stored !== 'true' || allowed.popups) throw new Error(`allow: ${JSON.stringify(allowed)}`);
await menu('menu-allowed');

await openPopup();
await tap('twPrivacy.popupButton(0)', 2000);
const denied = await record('deny');
if (denied.choice !== false || denied.stored !== 'false' || denied.popups) throw new Error(`deny: ${JSON.stringify(denied)}`);

await dt.evaluate('twPrivacy.menuToEnd()');
await tap(`twPrivacy.row("openPolicy('privacy')")`, 1000);
await record('privacy policy');
await tap(`twPrivacy.row("openPolicy('terms')")`, 1000);
await record('terms');
await tap(`twPrivacy.row("openAdPrivacy()")`, 2500);
const ad = await record('ad privacy');
if (!ad.menu) throw new Error('the menu closed');

// The About popup over the menu with Android back, for comparison with the analytics popup.
await tap(`twPrivacy.row("clickMenu('openInfo')")`, 1500);
await record('about');
await back('about back');

const languages = await dt.evaluate('twPrivacy.languages()');
fs.writeFileSync(path.join(OUT, 'actions.json'), JSON.stringify({lang, languages, steps}, null, 1) + '\n');
console.log(`${lang}: language ${languages.navigator} (Util ${languages.util}); opened ${ad.opened.map((o) => o.url).join(', ')}; ad privacy ${ad.adPrivacy.join(',')}, popups ${ad.popups}`);
dt.close();
