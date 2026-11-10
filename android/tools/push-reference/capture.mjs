#!/usr/bin/env node
// Records the Cordova notification settings S09 of AN-14 (#2893) that the native page is compared with: run by
// capture.sh for each language while the Cordova debug build runs offline at 384x832 dp, density 2. The page talks to a
// stand-in server inside the WebView (XMLHttpRequest replaced for the server's URLs): weather requests get the AN-02
// corpus fixture kma-seoul, push requests 200. 서울 is added through the app's own WeatherInfo with the converted
// fixture and selected, and the push service gets a token (`capture-token`) as a started app would have. States:
//   settings    S09 of 서울 without records: the defaults (manual page 21)
//   picker      the time picker after a real tap on the add row HH:MM (page 22)
//   confirm     the save confirmation O12 after a real tap on Cancel (page 23)
//   equal       O13 after a real tap on Save with a stored alert from 09 to 09
//   permission  O11 after a real tap on Save while the push service reports notifications off
//   intro       O06 over Hourly (TabCtrl's showAlertInfoEvent)
//   foreground  O07 over Hourly (TabCtrl's notificationEvent with a title and a message)
//   app/src/test/resources/push-reference/<lang>/<state>.png and <state>.json
//   node capture.mjs <emulator-serial> <lang> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {Screen} from '../emulator/screen.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(root, 'app/src/test/resources/push-reference', lang);
const inputs = path.join(root, 'core-domain/src/test/resources/corpus/inputs');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(inputs, `${name}.json`), 'utf8'));
const screenshots = new Screen(serial);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);

const dt = await connect(serial);
await dt.settled();

// The stand-in server: the weather of 서울 for any coordinates, 200 for push requests (recorded without the token).
await dt.evaluate(`(function (seoul) {
    var Real = window.XMLHttpRequest;
    window.twRequests = [];
    function local(url) { return !/^https?:/.test(url) || /^https?:\\/\\/localhost\\//.test(url); }
    function answer(method, url) {
        if (method === 'GET' && /\\/weather\\/v000903\\/coord\\//.test(url)) return {status: 200, body: seoul};
        if (/\\/push(-list)?$/.test(url)) return {status: 200, body: '{}'};
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
            if (/\\/push(-list)?$/.test(self._url)) {
                window.twRequests.push({method: self._method, path: self._url.replace(/^https?:\\/\\/[^/]+/, ''), body: String(data || '').replace(/capture-token/g, '<token>')});
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
})(${JSON.stringify(JSON.stringify(fixture('kma-seoul')))})`);

await dt.evaluate(`window.twPush = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil'), $state = inj.get('$state'), Push = inj.get('Push');
    var $rootScope = inj.get('$rootScope');
    var hasPermission = Push.hasPermission;
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    }
    function shownAll(sel, rootEl) { return Array.prototype.filter.call((rootEl || document).querySelectorAll(sel), visible); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function box(el) { var r = rect(el); return [r.x, r.y, r.w, r.h]; }
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo);
        return {color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
            lineHeight: cs.lineHeight, textAlign: cs.textAlign, padding: cs.padding, margin: cs.margin, opacity: cs.opacity,
            border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, borderBottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle + ' ' + cs.borderBottomColor,
            borderRadius: cs.borderTopLeftRadius, boxShadow: cs.boxShadow, minHeight: cs.minHeight, whiteSpace: cs.whiteSpace,
            backgroundImage: cs.backgroundImage, backgroundPosition: cs.backgroundPosition, content: pseudo ? cs.content : undefined};
    }
    function part(el) { return el ? {text: el.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(el), style: style(el), cls: el.getAttribute('class')} : null; }
    /** Each line box of an element's text nodes, as Chrome broke them. */
    function lines(el) {
        var out = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node;
        while ((node = walker.nextNode())) {
            for (var i = 0; i < node.textContent.length; i++) {
                range.setStart(node, i); range.setEnd(node, i + 1);
                var r = range.getClientRects()[0];
                if (!r) continue;
                var last = out[out.length - 1];
                if (!last || Math.abs(last.y - r.top) > 2) out.push({y: r.top, h: r.height, x: r.left, w: r.width, text: node.textContent[i]});
                else { last.text += node.textContent[i]; last.w = r.left + r.width - last.x; }
            }
        }
        return out.filter(function (l) { return l.text.trim() !== ''; });
    }
    function textPart(el) { var p = part(el); if (p) p.lines = lines(el); return p; }
    function glyph(el) { return el ? {rect: rect(el), cls: el.getAttribute('class'), style: style(el, '::before')} : null; }
    function view() { return shownAll('ion-view').filter(function (v) { return v.querySelector('.buttons-bottom'); })[0]; }
    // The nav bar keeps a block per view; the shown page's is the active one.
    function navBar() { return shownAll('.nav-bar-block[nav-bar="active"] ion-header-bar')[0] || shownAll('ion-header-bar')[0]; }
    function popups() { return shownAll('.popup-container .popup'); }
    function tapBox(sel, i) { var all = shownAll(sel); return all.length ? box(all[i || 0]) : null; }
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
    function add(data, info) {
        var converted = WeatherUtil.convertWeatherData([{data: data}]);
        var city = {};
        Object.keys(converted || {}).forEach(function (k) { city[k] = converted[k]; });
        city.name = info.name; city.address = info.address; city.country = info.country; city.location = info.location;
        city.currentPosition = false;
        return {added: WeatherInfo.addCity(city), cities: WeatherInfo.getCityCount()};
    }
    function popupRecord() {
        var p = popups()[0];
        if (!p) return null;
        var buttons = shownAll('.popup-buttons .button', p);
        return {popup: part(p), container: part(p.closest('.popup-container')), head: part(p.querySelector('.popup-head')),
            title: textPart(p.querySelector('.popup-title')), body: textPart(p.querySelector('.popup-body')),
            buttonBar: part(p.querySelector('.popup-buttons')), buttons: buttons.map(textPart),
            heading: textPart(p.querySelector('.heading')), boxes: shownAll('.time_picker_box_text', p).map(textPart),
            colons: shownAll('.time_picker_colon', p).map(textPart), arrows: shownAll('.time_picker_arrows', p).map(function (a) {
                return {rect: rect(a), icon: glyph(a.querySelector('.icon'))}; }),
            backdrop: part(document.querySelector('.backdrop.visible') || document.querySelector('.backdrop'))};
    }
    return {
        add: add,
        /** Records for 서울 (index 1): an alert with [start, end] hours and one alarm at 07:40 Mon–Fri, or none. */
        seed: function (start, end) {
            Push.pushData.fcmToken = 'capture-token';
            Push.pushData.pushList = start === null ? [] : [Push.newPushAlert(1, 1, start, end),
                Push.newPushAlarm(2, 1, 7 * 3600 + 40 * 60, [false, true, true, true, true, true, false])];
            Push.savePushInfo();
            return Push.pushData.pushList.length;
        },
        open: function (fav) {
            Push.hasPermission = hasPermission;
            // S09 initializes its bar by element id: the page opens from Favorites, so no earlier S09 view is still there.
            return closePopups().then(function () { return $state.go('tab.search', {}, {reload: true}); }).then(function () { return wait(1500); })
                .then(function () { return $state.go('setting-push', {fav: fav}, {reload: true}); })
                .then(function () { return wait(2500); }).then(closePopups).then(function () { return location.hash; });
        },
        hourly: function () {
            return closePopups().then(function () { return $state.go('tab.forecast', {}, {reload: true}); })
                .then(function () { return wait(3000); }).then(function () { return location.hash; });
        },
        permissionOff: function () { Push.hasPermission = function (cb) { cb({isEnabled: false}); }; return true; },
        intro: function () { $rootScope.$broadcast('showAlertInfoEvent'); return wait(1200); },
        foreground: function (title, message) { $rootScope.$broadcast('notificationEvent', {title: title, message: message}); return wait(1200); },
        state: function () { return {hash: location.hash, popups: popups().length, requests: window.twRequests.length}; },
        addRow: function () { var rows = shownAll('.item-icon-right', view()); return box(rows[rows.length - 1]); },
        cancel: function () { return tapBox('.buttons-bottom .button', 0); },
        saveButton: function () { return tapBox('.buttons-bottom .button', 1); },
        popupButton: function (i) { var p = popups()[0]; return p ? box(shownAll('.popup-buttons .button', p)[i]) : null; },
        requests: function () { return window.twRequests; },
        record: function () {
            var v = view(), bar = navBar();
            var header = bar && {bar: part(bar), back: glyph(bar.querySelector('.button-icon, .back-button')),
                backButton: part(bar.querySelector('.button')), title: textPart(bar.querySelector('.title'))};
            var page = v && {
                content: part(v.querySelector('ion-content')),
                cards: shownAll('.list.card', v).map(part),
                items: shownAll('.item', v).map(textPart),
                descriptions: shownAll('.item-desc', v).map(textPart),
                toggle: (function (t) { return t && {toggle: part(t), track: part(t.querySelector('.track')), handle: part(t.querySelector('.handle')),
                    checked: t.querySelector('input').checked}; })(shownAll('.toggle', v)[0]),
                slider: (function (s) {
                    if (!s) return null;
                    var one = function (sel) { return part(s.querySelector(sel)); };
                    return {irs: one('.irs'), line: one('.irs-line'), lineParts: shownAll('.irs-line > span', s).map(part), bar: one('.irs-bar'),
                        from: one('.irs-from'), to: one('.irs-to'), single: one('.irs-single'), handles: shownAll('.irs-slider', s).map(part),
                        pols: shownAll('.irs-grid-pol', s).map(part), texts: shownAll('.irs-grid-text', s).map(part)};
                })(shownAll('.irs', v)[0] && shownAll('.irs', v)[0].parentNode),
                days: shownAll('.day-button', v).map(textPart),
                icons: shownAll('.item i.icon', v).map(glyph),
                buttons: shownAll('.buttons-bottom .button', v).map(textPart),
            };
            return {header: header, page: page, popup: popupRecord(),
                view: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio, language: navigator.language}};
        },
    };
})()`);

const origin = screenshots.webViewOrigin();
const view = await dt.evaluate('({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})');
const dpr = view.dpr;
fs.mkdirSync(OUT, {recursive: true});

async function tap(expression, ms = 1500) {
    const b = await dt.evaluate(expression);
    if (!b) throw new Error(`nothing to tap: ${expression}`);
    const [x, y, w, h] = b;
    adb('shell', 'input', 'tap', String(Math.round(origin.x + (x + w / 2) * dpr)), String(Math.round(origin.y + (y + h / 2) * dpr)));
    await sleep(ms);
}
function cut(file) {
    fs.writeFileSync(path.join(OUT, file), screenshots.png(screenshots.screen(), {x: origin.x, y: origin.y,
        width: Math.round(view.width * dpr), height: Math.round(view.height * dpr)}));
    return {screen: {x: origin.x, y: origin.y}, size: {width: Math.round(view.width * dpr), height: Math.round(view.height * dpr)}};
}
const state = () => dt.evaluate('twPush.state()');
async function capture(name, check) {
    const s = await state();
    check(s);
    const data = await dt.evaluate('twPush.record()');
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({state: name, lang, mode: s, ...data, clip: cut(`${name}.png`)}) + '\n');
    const title = data.header && data.header.title ? data.header.title.text : '';
    console.log(`${lang} ${name}: ${title} | popup ${data.popup ? (data.popup.title && data.popup.title.text) || (data.popup.heading && data.popup.heading.text) || data.popup.body.text : '-'}`);
}
const fail = (what, s) => { throw new Error(`${what}: ${JSON.stringify(s)}`); };

const SEOUL = {name: '서울', address: '대한민국 서울특별시', country: 'KR', location: {lat: 37.567, long: 126.978}};
const added = await dt.evaluate(`twPush.add(${JSON.stringify(fixture('kma-seoul'))}, ${JSON.stringify(SEOUL)})`);
if (!added.added) fail('add 서울', added);

// Page 21: the defaults of a place without records.
await dt.evaluate('twPush.seed(null, null)');
if ((await dt.evaluate('twPush.open(1)')) !== '#/setting-push?fav=1') fail('open', await state());
await capture('settings', (s) => { if (s.popups) fail('settings', s); });

// Page 22: the picker on the add row; its Close.
await tap('twPush.addRow()', 1200);
await capture('picker', (s) => { if (s.popups !== 1) fail('picker', s); });
await tap('twPush.popupButton(2)', 1000);

// Page 23: Cancel with the defaults (edits) opens O12; its Close goes back.
await tap('twPush.cancel()', 1200);
await capture('confirm', (s) => { if (s.popups !== 1) fail('confirm', s); });
await tap('twPush.popupButton(0)', 1500);

// O13: a stored alert from 09 to 09, then Save.
await dt.evaluate('twPush.seed(9, 9)');
await dt.evaluate('twPush.open(1)');
await tap('twPush.saveButton()', 1200);
await capture('equal', (s) => { if (s.popups !== 1) fail('equal', s); });
await tap('twPush.popupButton(0)', 1000);

// O11: the stored 07–22 alert, then Save while the push service reports notifications off.
await dt.evaluate('twPush.seed(7, 22)');
await dt.evaluate('twPush.open(1)');
await dt.evaluate('twPush.permissionOff()');
await tap('twPush.saveButton()', 1200);
await capture('permission', (s) => { if (s.popups !== 1) fail('permission', s); });
await tap('twPush.popupButton(0)', 1000);

// O06 and O07 over Hourly.
if ((await dt.evaluate('twPush.hourly()')) !== '#/tab/forecast') fail('hourly', await state());
await dt.evaluate('twPush.intro()');
await capture('intro', (s) => { if (s.popups !== 1) fail('intro', s); });
await tap('twPush.popupButton(0)', 1000);
await dt.evaluate(`twPush.foreground('서울 맑음 3˚', '내일 아침 -1˚, 낮 9˚')`);
await capture('foreground', (s) => { if (s.popups !== 1) fail('foreground', s); });
await tap('twPush.popupButton(0)', 1000);
fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(await dt.evaluate('twPush.requests()'), null, 1) + '\n');
dt.close();
