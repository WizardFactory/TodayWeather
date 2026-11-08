#!/usr/bin/env node
// Records the Cordova shell for one language (AN-07, #2886): run by capture.sh while the Cordova debug build
// runs offline at 384x832 dp, density 2. For each theme on the Hourly tab of a saved place (the kma-seoul
// fixture of the AN-02 corpus) it captures the tab bar, the header bar and the open side menu, with element
// rects, texts and computed colors:
//   app/src/test/resources/shell-reference/<lang>/<theme>-{tabs,header,menu}.png and <theme>.json
//   node capture.mjs <emulator-serial> <lang> <android-dir>
// The images are cut from the screen (screencap), not taken through DevTools: on 2026-11-08 DevTools
// screenshots of the English menu drew its rows 2.5 dp shorter than the page's layout and the screen.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {connect, sleep} from '../emulator/devtools.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(root, 'app/src/test/resources/shell-reference', lang);
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const fixture = JSON.parse(fs.readFileSync(path.join(corpus, 'inputs/kma-seoul.json'), 'utf8'));
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], {maxBuffer: 256 << 20});

/** The screen in RGBA (screencap without -p: width, height, format and, from Android 10, a color space word). */
function screen() {
    const raw = adb('exec-out', 'screencap');
    const width = raw.readUInt32LE(0), height = raw.readUInt32LE(4);
    if (raw.readUInt32LE(8) !== 1) throw new Error('screencap is not RGBA_8888');
    return {width, height, rgba: raw.subarray(raw.length - width * height * 4)};
}

/** Where the WebView is on the screen, in device pixels. */
function webViewOrigin() {
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/tw-window.xml');
    const xml = adb('exec-out', 'cat', '/data/local/tmp/tw-window.xml').toString();
    adb('shell', 'rm', '/data/local/tmp/tw-window.xml');
    const m = /class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]/.exec(xml);
    if (!m) throw new Error('no WebView in the window dump');
    return {x: Number(m[1]), y: Number(m[2])};
}

/** An RGB PNG of a device-pixel area of a screen. */
function png(shot, area) {
    const stride = area.width * 3 + 1;
    const rows = Buffer.alloc(stride * area.height);
    for (let y = 0; y < area.height; y++) {
        for (let x = 0; x < area.width; x++) {
            const from = ((area.y + y) * shot.width + area.x + x) * 4;
            shot.rgba.copy(rows, y * stride + 1 + x * 3, from, from + 3);
        }
    }
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'latin1');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
        return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(area.width, 0);
    ihdr.writeUInt32BE(area.height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

const dt = await connect(serial);
await dt.settled();
await dt.evaluate(`window.twShell = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil'), TwStorage = inj.get('TwStorage');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope');
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function closePopups() {
        document.querySelectorAll('.popup-container .popup-buttons button').forEach(function (b) { b.click(); });
        return wait(400).then(function () {
            document.querySelectorAll('.popup-container, .backdrop').forEach(function (e) { e.remove(); });
            document.body.classList.remove('popup-open');
        });
    }
    // On screen: the closed side menu sits at left -100% and does not count.
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shown(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible)[0]; }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function style(el) { var cs = getComputedStyle(el); return {color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontFamily: cs.fontFamily}; }
    var cityIndex = null;
    return {
        place: function (data) {
            var converted = WeatherUtil.convertWeatherData([{data: data}]);
            var city = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}, currentPosition: false};
            Object.keys(converted).forEach(function (k) { city[k] = converted[k]; });
            WeatherInfo.addCity(city);
            cityIndex = WeatherInfo.getCityCount() - 1;
            WeatherInfo.setCityIndex(cityIndex);
            return closePopups().then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(800); })
                .then(function () { $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply(); return wait(1500); }).then(closePopups);
        },
        theme: function (theme) {
            $rootScope.settingsInfo.theme = theme;
            TwStorage.set('settingsInfo', $rootScope.settingsInfo);
            $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply();
            return wait(1200).then(closePopups).then(function () { return {body: document.body.className, language: inj.get('$translate').use()}; });
        },
        tabs: function () {
            var tabs = shown('.tabs');
            return {rect: rect(tabs), style: style(tabs),
                items: Array.prototype.map.call(tabs.querySelectorAll('.tab-item'), function (e) {
                    return {text: e.textContent.trim(), rect: rect(e), active: e.classList.contains('tab-item-active'), style: style(e)};
                })};
        },
        header: function () {
            var bar = shown('ion-side-menu-content .bar-header');
            return {rect: rect(bar), style: style(bar), title: (bar.querySelector('.title') || bar).textContent.trim()};
        },
        openMenu: function () {
            shown('.button.ion-navicon, .ion-navicon').click();
            return wait(700).then(function () {
                var menu = shown('ion-side-menu') || document.querySelector('ion-side-menu');
                return {rect: rect(menu), style: style(menu),
                    rows: Array.prototype.filter.call(menu.querySelectorAll('.list .item'), visible).map(function (e) {
                        return {text: e.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(e), style: style(e)};
                    })};
            });
        },
        closeMenu: function () {
            var back = shown('ion-side-menu .button');
            if (back) back.click();
            return wait(700);
        },
    };
})()`);

fs.mkdirSync(OUT, {recursive: true});
await dt.evaluate(`twShell.place(${JSON.stringify(fixture)})`);
const origin = webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
for (const theme of ['light', 'dark', 'photo', 'old']) {
    const info = await dt.evaluate(`twShell.theme(${JSON.stringify(theme)})`);
    const record = {theme, lang, info};
    for (const part of ['tabs', 'header', 'menu']) {
        const r = part === 'menu' ? await dt.evaluate('twShell.openMenu()') : await dt.evaluate(`twShell.${part}()`);
        // The element's device pixels; the whole image is the element (offset 0).
        const x = Math.round(r.rect.x * dpr), y = Math.round(r.rect.y * dpr);
        const size = {width: Math.round((r.rect.x + r.rect.w) * dpr) - x, height: Math.round((r.rect.y + r.rect.h) * dpr) - y};
        const area = {x: origin.x + x, y: origin.y + y, ...size};
        fs.writeFileSync(path.join(OUT, `${theme}-${part}.png`), png(screen(), area));
        record[part] = {...r, clip: {screen: area, offset: {x: 0, y: 0}, size}};
        if (part === 'menu') await dt.evaluate('twShell.closeMenu()');
    }
    fs.writeFileSync(path.join(OUT, `${theme}.json`), JSON.stringify(record) + '\n');
    console.log(`${lang} ${theme}: ${info.language}, tabs ${record.tabs.items.map((i) => i.text).join('|')}, menu rows ${record.menu.rows.length}`);
}
dt.close();
