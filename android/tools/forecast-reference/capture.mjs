#!/usr/bin/env node
// Records the Cordova weather screens S03 (Hourly) and S04 (Daily) that the native screens are compared with (AN-08,
// #2887): run by capture.sh while the Cordova debug build runs offline at 384x832 dp, density 2, in ko-KR. The places
// are AN-02 corpus fixtures shown through the app's own services: 회현동 (kma-seoul) alone, then London (vc-london)
// added and selected, so its pages show the arrows of more than one place. For each place and page it cuts every block
// of the page (the header block, then each card and the attribution) from the screen, with its rect and the text,
// image and style of every element inside it:
//   app/src/test/resources/forecast-reference/<place>/<page>-<n>.png and <place>/<page>.json
//   node capture.mjs <emulator-serial> <android-dir>
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {Screen} from '../emulator/screen.mjs';

const [serial, root] = process.argv.slice(2);
const OUT = path.join(root, 'app/src/test/resources/forecast-reference');
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const input = (name) => JSON.parse(fs.readFileSync(path.join(corpus, 'inputs', `${name}.json`), 'utf8'));
const {screen, webViewOrigin, png, pngStack} = new Screen(serial);

const dt = await connect(serial);
await dt.settled();
await dt.evaluate(`window.twForecast = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope');
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
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
            .map(function (n) { return n.textContent; }).join('').replace(/\\s+/g, ' ').trim();
    }
    // Every element of a block with its own text or an image, as the native layout is measured against them.
    // Rects are relative to the block's top left, so they do not depend on where the page was scrolled.
    function elements(block) {
        var b = block.getBoundingClientRect();
        return Array.prototype.filter.call(block.querySelectorAll('*'), function (e) {
            var r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' &&
                (ownText(e) !== '' || e.tagName === 'IMG' || e.tagName === 'I' || e.tagName === 'svg');
        }).map(function (e) {
            var cs = getComputedStyle(e), r = e.getBoundingClientRect();
            return {tag: e.tagName.toLowerCase(), cls: e.getAttribute('class') || '', text: ownText(e), src: e.getAttribute('src') || undefined,
                rect: {x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height}, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                lineHeight: cs.lineHeight, color: cs.color, background: cs.backgroundColor, opacity: cs.opacity};
        });
    }
    // The blocks of the shown page in order: the header block and each card or attribution under it.
    function blocks() {
        var content = shown('ion-content.main-content');
        var scroll = content.querySelector('.scroll') || content;
        var list = [];
        Array.prototype.forEach.call(scroll.children, function (child) {
            if (!visible(child)) return;
            var header = child.querySelector('[md-page-header]');
            if (header) list.push(header);
            if (header) {
                Array.prototype.forEach.call(child.children, function (c) { if (c !== header && visible(c)) list.push(c); });
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
    return {
        place: function (data, info) {
            var converted = WeatherUtil.convertWeatherData([{data: data}]);
            var city = {name: info.name, address: info.address, country: info.country, location: info.location, currentPosition: false};
            Object.keys(converted).forEach(function (k) { city[k] = converted[k]; });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            return closePopups();
        },
        // Opens a page afresh (ForecastCtrl initializes on every entry: cityCount, sizes, scroll).
        page: function (state) {
            // A native chain, so its steps run after Angular's digests ($apply inside a digest throws).
            return wait(0).then(function () { return $state.go('tab.search'); }).then(function () { return wait(600); })
                .then(function () { return $state.go(state); }).then(function () { return wait(1200); }).then(closePopups)
                .then(function () { $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply(); return wait(1500); })
                .then(closePopups).then(function () {
                    shown('ion-content.main-content').scrollTop = 0;
                    return wait(400);
                }).then(function () { return {count: blocks().length, body: document.body.className}; });
        },
        // Brings block i between the bars and describes it. The header block (i = 0) starts under the header bar by
        // design (its top padding is the bar's height): it is cut at the top of the page, with the bar over it.
        block: function (i) {
            var el = blocks()[i];
            var b = bars();
            var r = el.getBoundingClientRect();
            if (i === 0) {
                shown('ion-content.main-content').scrollTop = 0;
            } else if (r.top < b.top || r.bottom > b.bottom) {
                el.scrollIntoView({block: 'center'});
            }
            return wait(500).then(function () {
                var r2 = el.getBoundingClientRect(), b2 = bars(), top = i === 0 ? 0 : b2.top;
                return {cls: el.getAttribute('class') || '', rect: rect(el), tall: r2.height > b2.bottom - top + 0.5,
                    clipped: r2.top < top - 0.5 || r2.bottom > b2.bottom + 0.5, bars: b2,
                    background: getComputedStyle(el).backgroundColor, elements: elements(el)};
            });
        },
        // A block taller than the space between the bars: scrolls by [by] CSS px (0 puts its top under the header bar).
        scroll: function (i, by) {
            var el = blocks()[i], content = shown('ion-content.main-content');
            if (by === 0) content.scrollTop += el.getBoundingClientRect().top - bars().top; else content.scrollTop += by;
            return wait(400).then(function () { return {rect: rect(el), bars: bars(), scrollTop: content.scrollTop}; });
        },
    };
})()`);

const PLACES = [
    {key: 'kma-seoul', fixture: 'kma-seoul', info: {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}}},
    {key: 'vc-london', fixture: 'vc-london', info: {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13}}},
];
const origin = webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
for (const place of PLACES) {
    await dt.evaluate(`twForecast.place(${JSON.stringify(input(place.fixture))}, ${JSON.stringify(place.info)})`);
    fs.mkdirSync(path.join(OUT, place.key), {recursive: true});
    for (const [page, state] of [['hourly', 'tab.forecast'], ['daily', 'tab.dailyforecast']]) {
        const shown = await dt.evaluate(`twForecast.page(${JSON.stringify(state)})`);
        const record = {place: place.key, page, body: shown.body, blocks: []};
        for (let i = 0; i < shown.count; i++) {
            const b = await dt.evaluate(`twForecast.block(${i})`);
            const x = Math.round(b.rect.x * dpr);
            const width = Math.round((b.rect.x + b.rect.w) * dpr) - x;
            let image, size, pieces = 1;
            // The page ends a pixel under the tab bar's top, so its last block cannot scroll clear of it: up to 2 CSS px
            // under the tab bar are left out of the image and recorded as `hidden`.
            const hidden = Math.max(0, b.rect.y + b.rect.h - b.bars.bottom);
            if (!b.tall && (!b.clipped || (hidden <= 2 && b.rect.y >= (i === 0 ? 0 : b.bars.top) - 0.5))) {
                const y = Math.round(b.rect.y * dpr);
                size = {width, height: Math.round((b.rect.y + b.rect.h - hidden) * dpr) - y};
                image = png(screen(), {x: origin.x + x, y: origin.y + y, ...size});
                if (hidden > 0) b.hidden = hidden;
            } else if (!b.tall) {
                throw new Error(`${place.key} ${page} block ${i} (${b.cls}) does not fit between the bars: ${JSON.stringify({rect: b.rect, bars: b.bars})}`);
            } else {
                // Top under the header bar, then a screen at a time; each piece continues where the last one ended.
                const stack = [];
                let done = 0; // CSS px of the block captured
                let at = await dt.evaluate(`twForecast.scroll(${i}, 0)`);
                while (done < b.rect.h - 0.5) {
                    const from = at.rect.y + done, to = Math.min(at.rect.y + at.rect.h, at.bars.bottom);
                    if (to <= from + 0.5) {
                        if (b.rect.h - done <= 2) { b.hidden = b.rect.h - done; break; }
                        throw new Error(`${place.key} ${page} block ${i}: no progress at ${done}`);
                    }
                    const y0 = Math.round(from * dpr), y1 = Math.round(to * dpr);
                    stack.push({shot: screen(), area: {x: origin.x + x, y: origin.y + y0, width, height: y1 - y0}});
                    done = to - at.rect.y;
                    if (done < b.rect.h - 0.5) at = await dt.evaluate(`twForecast.scroll(${i}, ${to - at.bars.top})`);
                }
                image = pngStack(stack);
                size = {width, height: stack.reduce((h, p) => h + p.area.height, 0)};
                pieces = stack.length;
            }
            fs.writeFileSync(path.join(OUT, place.key, `${page}-${i}.png`), image);
            record.blocks.push({index: i, ...b, pieces, clip: {offset: {x: 0, y: 0}, size}});
            await sleep(100);
        }
        fs.writeFileSync(path.join(OUT, place.key, `${page}.json`), JSON.stringify(record) + '\n');
        console.log(`${place.key} ${page}: ${record.blocks.length} blocks (${record.blocks.map((b) => b.cls.split(' ')[0] || '-').join(', ')})`);
    }
}
dt.close();
