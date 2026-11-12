#!/usr/bin/env node
// Records the Cordova saved places S02 of AN-11 (#2890) that the native page is compared with: run by capture.sh for
// each language while the Cordova debug build runs offline at 384x832 dp, density 2. The page talks to a stand-in server
// inside the WebView (XMLHttpRequest replaced for the server's URLs): weather requests get the AN-02 corpus fixtures
// (kma-seoul, vc-london for London), the coordinates geocode gets geocode-seoul, push requests 200. Places are added
// through the app's own WeatherInfo with converted fixtures, as the manual's run had added them. Modes change through
// SearchCtrl's handlers (a focus without the soft keyboard, the search word set as typing sets it) and real taps:
//   favorites   the list with 서울 (manual page 13)
//   search      the search for 부산: 현재위치로 지역찾기, ten towns and "powered by TodayWeather" (page 14)
//   edit        edit mode with 현재위치, 서울, 부산광역시 and London (page 18)
//   location    the find-by-location result after a real tap on 현재위치로 지역찾기 (page 19)
//   app/src/test/resources/places-reference/<lang>/<state>.png and <state>.json
//   node capture.mjs <emulator-serial> <lang> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {Screen} from '../emulator/screen.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(root, 'app/src/test/resources/places-reference', lang);
const inputs = path.join(root, 'core-domain/src/test/resources/corpus/inputs');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(inputs, `${name}.json`), 'utf8'));
const screenshots = new Screen(serial);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);

const dt = await connect(serial);
await dt.settled();

// The stand-in server (the privacy reference's, with the geocode).
await dt.evaluate(`(function (seoul, london, geocode) {
    var Real = window.XMLHttpRequest;
    function local(url) { return !/^https?:/.test(url) || /^https?:\\/\\/localhost\\//.test(url); }
    function answer(method, url) {
        if (method === 'GET' && /\\/weather\\/v000903\\/coord\\/51\\./.test(url)) return {status: 200, body: london};
        if (method === 'GET' && /\\/weather\\/v000903\\/coord\\//.test(url)) return {status: 200, body: seoul};
        if (method === 'GET' && /\\/geocode\\/v000903\\/coord\\//.test(url)) return {status: 200, body: geocode};
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
})(${JSON.stringify(JSON.stringify(fixture('kma-seoul')))}, ${JSON.stringify(JSON.stringify(fixture('vc-london')))},
   ${JSON.stringify(JSON.stringify(fixture('geocode-seoul')))})`);

await dt.evaluate(`window.twPlaces = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil'), $state = inj.get('$state');
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shownAll(sel, rootEl) { return Array.prototype.filter.call((rootEl || document).querySelectorAll(sel), visible); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function box(el) { var r = rect(el); return [r.x, r.y, r.w, r.h]; }
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo);
        return {color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
            lineHeight: cs.lineHeight, textAlign: cs.textAlign, padding: cs.padding, margin: cs.margin, opacity: cs.opacity,
            border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, borderRadius: cs.borderTopLeftRadius,
            minHeight: cs.minHeight, whiteSpace: cs.whiteSpace};
    }
    function part(el) { return el ? {text: el.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(el), style: style(el)} : null; }
    /** Each line box of an element's text nodes, as Chrome broke them. */
    function lines(el) {
        var out = [], range = document.createRange(), walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node;
        while ((node = walker.nextNode())) {
            for (var i = 0; i < node.textContent.length; i++) {
                range.setStart(node, i); range.setEnd(node, i + 1);
                var r = range.getClientRects()[0];
                if (!r) continue;
                var last = out[out.length - 1];
                if (!last || Math.abs(last.y - r.top) > 2) out.push({y: r.top, h: r.height, x: r.left, text: node.textContent[i]});
                else last.text += node.textContent[i];
            }
        }
        return out.filter(function (l) { return l.text.trim() !== ''; });
    }
    // The search field is in the nav bar (ion-nav-title), the list in the view's content.
    function input() { return shownAll('#searchInput')[0]; }
    function view() { return shownAll('ion-content[delegate-handle="cityList"]')[0].closest('ion-view'); }
    function scope() { return angular.element(input()).scope(); }
    function popups() { return shownAll('.popup-container .popup'); }
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
        // The converted answer names its own place; the added place keeps its own name, address and location.
        var city = {};
        Object.keys(converted || {}).forEach(function (k) { city[k] = converted[k]; });
        city.name = info.name; city.address = info.address; city.country = info.country; city.location = info.location;
        city.currentPosition = false;
        return {added: WeatherInfo.addCity(city), converted: !!converted, cities: WeatherInfo.getCityCount()};
    }
    return {
        add: add,
        open: function () {
            WeatherInfo.setCityIndex(1);
            return closePopups().then(function () { return $state.go('tab.search', {}, {reload: true}); }).then(function () { return wait(2500); })
                .then(closePopups).then(function () { return location.hash; });
        },
        state: function () {
            var s = scope();
            return {hash: location.hash, popups: popups().length, editing: s.isEditing, searching: s.isSearching, word: s.search && s.search.word,
                towns: (s.searchResults || []).length, results: (s.searchResults2 || []).length, cities: WeatherInfo.getCityCount()};
        },
        search: function (word) {
            var s = scope();
            s.OnFocusInput();
            s.search.word = word;
            s.OnChangeSearchWord();
            s.$apply();
            return wait(1500);
        },
        focus: function () { var s = scope(); s.OnFocusInput(); s.$apply(); return wait(800); },
        modeButton: function () { return box(input().closest('.search-header').querySelector('.button')); },
        findButton: function () { return box(shownAll('.button', view()).filter(function (b) { return b.getAttribute('ng-click') === 'OnSearchCurrentPosition()'; })[0]); },
        record: function () {
            var v = view();
            var header = input().closest('.search-header');
            var rows = shownAll('.list .item', v).map(function (item) {
                var name = item.querySelector('.search-name');
                var img = item.querySelector('.search-item img');
                var temp = shownAll('.search-item span', item);
                var bell = shownAll('.last-item a.icon', item)[0];
                var toggle = shownAll('.toggle', item)[0];
                return {item: part(item), name: name && part(name), lines: name ? lines(name) : [], image: img && visible(img) ? {rect: rect(img), src: img.getAttribute('src')} : null,
                    temperature: temp.map(part), bell: bell ? {rect: rect(bell), cls: bell.getAttribute('class'), style: style(bell, '::before')} : null,
                    toggle: toggle ? {rect: rect(toggle), checked: toggle.querySelector('input').checked, track: part(toggle.querySelector('.track')),
                        handle: part(toggle.querySelector('.handle'))} : null};
            });
            var find = shownAll('.button', v).filter(function (b) { return b.getAttribute('ng-click') === 'OnSearchCurrentPosition()'; })[0];
            var dividers = shownAll('.item-divider', v).map(part);
            var glyph = header && header.querySelector('.icon');
            var field = input();
            return {
                header: header && {rect: rect(header), style: style(header), glyph: glyph && {rect: rect(glyph), style: style(glyph, '::before'), content: getComputedStyle(glyph, '::before').content},
                    input: {rect: rect(field), style: style(field), value: field.value, placeholder: field.placeholder,
                        placeholderStyle: {color: getComputedStyle(field, '::placeholder').color, fontSize: getComputedStyle(field, '::placeholder').fontSize}},
                    mode: part(header.querySelector('.button'))},
                content: part(v.querySelector('ion-content')),
                list: part(shownAll('.list', v)[0]),
                rows: rows, find: part(find), dividers: dividers,
                view: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio, language: navigator.language},
            };
        },
    };
})()`);

const origin = screenshots.webViewOrigin();
const view = await dt.evaluate('({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})');
const dpr = view.dpr;
fs.mkdirSync(OUT, {recursive: true});

async function tap(expression, ms = 1500) {
    const [x, y, w, h] = await dt.evaluate(expression);
    adb('shell', 'input', 'tap', String(Math.round(origin.x + (x + w / 2) * dpr)), String(Math.round(origin.y + (y + h / 2) * dpr)));
    await sleep(ms);
}
function cut(file) {
    fs.writeFileSync(path.join(OUT, file), screenshots.png(screenshots.screen(), {x: origin.x, y: origin.y,
        width: Math.round(view.width * dpr), height: Math.round(view.height * dpr)}));
    return {screen: {x: origin.x, y: origin.y}, size: {width: Math.round(view.width * dpr), height: Math.round(view.height * dpr)}};
}
const state = () => dt.evaluate('twPlaces.state()');
async function capture(name, check) {
    const s = await state();
    check(s);
    const data = await dt.evaluate('twPlaces.record()');
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({state: name, lang, mode: s, ...data, clip: cut(`${name}.png`)}) + '\n');
    console.log(`${lang} ${name}: ${data.rows.map((r) => r.lines.map((l) => l.text).join('/')).join(' | ')}`);
}
const fail = (what, s) => { throw new Error(`${what}: ${JSON.stringify(s)}`); };

const SEOUL = {name: '서울', address: '대한민국 서울특별시', country: 'KR', location: {lat: 37.567, long: 126.978}};
const BUSAN = {name: '부산광역시', address: '대한민국 부산광역시', country: 'KR', location: {lat: 35.18, long: 129.08}};
const LONDON = {name: 'London', address: 'London, UK', country: 'GB', location: {lat: 51.51, long: -0.13}};

await dt.evaluate(`twPlaces.add(${JSON.stringify(fixture('kma-seoul'))}, ${JSON.stringify(SEOUL)})`);
const hash = await dt.evaluate('twPlaces.open()');
if (hash !== '#/tab/search') fail('open', hash);
await capture('favorites', (s) => { if (s.editing || s.searching || s.popups) fail('favorites', s); });

await dt.evaluate(`twPlaces.search('부산')`);
await capture('search', (s) => { if (!s.searching || s.towns !== 10) fail('search', s); });

// Cancel, then the places of page 18, and the page again (cache: false).
await tap('twPlaces.modeButton()', 1000);
for (const [data, info] of [[fixture('kma-seoul'), BUSAN], [fixture('vc-london'), LONDON]]) {
    const added = await dt.evaluate(`twPlaces.add(${JSON.stringify(data)}, ${JSON.stringify(info)})`);
    if (!added.added) fail(`add ${info.name}`, added);
}
await dt.evaluate('twPlaces.open()');
await tap('twPlaces.modeButton()', 1000);
await capture('edit', (s) => { if (!s.editing || s.cities !== 4) fail('edit', s); });

// 확인 leaves edit mode; a focus enters search mode; a real tap finds by location.
await tap('twPlaces.modeButton()', 1000);
await dt.evaluate('twPlaces.focus()');
await tap('twPlaces.findButton()', 6000);
await capture('location', (s) => { if (!s.searching || s.results !== 1 || s.popups) fail('location', s); });
dt.close();
