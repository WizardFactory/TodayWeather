#!/usr/bin/env node
// Records the Cordova start page of AN-10 (#2889) that the native S01 is compared with: run by capture.sh for each
// language on a new install of the Cordova debug build, offline at 384x832 dp, density 2. As the manual's harness did,
// it waits for the start page and its access notice plus 1.5 s, then closes the notice with a real tap on its OK:
//   access   the access notice O01 over the start page (manual page 1)
//   start    the start page after the notice (manual page 2)
//   app/src/test/resources/start-reference/<lang>/<state>.png and <state>.json (the page's parts with their rects and
//   styles; the popup's parts and its body's line boxes as Chrome broke them)
//   node capture.mjs <emulator-serial> <lang> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {connect, sleep} from '../emulator/devtools.mjs';
import {Screen} from '../emulator/screen.mjs';

const [serial, lang, root] = process.argv.slice(2);
const OUT = path.join(root, 'app/src/test/resources/start-reference', lang);
const screenshots = new Screen(serial);
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]);

const dt = await connect(serial);
await dt.settled();

await dt.evaluate(`window.twStart = (function () {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function visible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function shownAll(sel) { return Array.prototype.filter.call(document.querySelectorAll(sel), visible); }
    function rect(el) { var r = el.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }
    function box(el) { var r = rect(el); return [r.x, r.y, r.w, r.h]; }
    function style(el, pseudo) {
        var cs = getComputedStyle(el, pseudo);
        return {color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
            lineHeight: cs.lineHeight, textAlign: cs.textAlign, padding: cs.padding, margin: cs.margin, opacity: cs.opacity,
            border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, borderRadius: cs.borderTopLeftRadius,
            minHeight: cs.minHeight, boxShadow: cs.boxShadow, whiteSpace: cs.whiteSpace};
    }
    function part(el) { return {text: el.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(el), style: style(el)}; }
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
        return out;
    }
    function page() { return shownAll('ion-view[nav-view="active"] ion-content, ion-content.main-content')[0]; }
    function popups() { return shownAll('.popup-container .popup'); }
    return {
        state: function () {
            return {hash: location.hash, popups: popups().length, body: document.body.className,
                popupTexts: popups().map(function (p) { return p.textContent.replace(/\\s+/g, ' ').trim(); })};
        },
        view: function () {
            return {width: innerWidth, height: innerHeight, dpr: devicePixelRatio, screenHeight: screen.height, language: navigator.language,
                bodyFont: getComputedStyle(document.body).fontFamily};
        },
        popupButton: function (i) { return box(popups()[0].querySelectorAll('.popup-buttons .button')[i]); },
        popup: function () {
            var p = popups()[0];
            var parts = Array.prototype.map.call(p.querySelectorAll('.popup-head, .popup-title, .popup-body, .popup-buttons, .popup-buttons .button'), function (e) {
                return {cls: e.getAttribute('class') || '', tag: e.tagName.toLowerCase(), text: e.textContent.replace(/\\s+/g, ' ').trim(), rect: rect(e), style: style(e)};
            });
            var backdrop = shownAll('.backdrop')[0];
            return {popup: {rect: rect(p), style: style(p)}, parts: parts, lines: lines(p.querySelector('.popup-body')),
                backdrop: backdrop && {rect: rect(backdrop), style: style(backdrop)}};
        },
        start: function () {
            var content = page(), lists = content.querySelectorAll('.list.list-inset');
            var icon = content.querySelector('img.item-center'), search = lists[0].querySelector('.item-input');
            var glyph = search.querySelector('.placeholder-icon'), input = search.querySelector('input');
            var chipItem = lists[0].querySelectorAll('.item')[1], location = lists[1].querySelector('button');
            var placeholder = getComputedStyle(input, '::placeholder');
            return {
                content: {rect: rect(content), style: style(content)},
                wrapper: {rect: rect(content.querySelector('div')), style: style(content.querySelector('div'))},
                icon: {rect: rect(icon), src: icon.getAttribute('src'), natural: [icon.naturalWidth, icon.naturalHeight]},
                lists: Array.prototype.map.call(lists, function (l) { return {rect: rect(l), style: style(l)}; }),
                search: {rect: rect(search), style: style(search)},
                glyph: {rect: rect(glyph), style: style(glyph), before: getComputedStyle(glyph, '::before').content,
                    beforeFont: getComputedStyle(glyph, '::before').fontFamily, beforeSize: getComputedStyle(glyph, '::before').fontSize},
                input: {rect: rect(input), style: style(input), placeholder: input.placeholder,
                    placeholderStyle: {color: placeholder.color, fontSize: placeholder.fontSize}},
                chipItem: {rect: rect(chipItem), style: style(chipItem)},
                chips: Array.prototype.map.call(chipItem.querySelectorAll('button'), function (b) {
                    var p = part(b);
                    p.lines = lines(b);
                    return p;
                }),
                location: (function () { var p = part(location); p.lines = lines(location); return p; })(),
            };
        },
    };
})()`);

const origin = screenshots.webViewOrigin();
const view = await dt.evaluate('twStart.view()');
const dpr = view.dpr;
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
const state = () => dt.evaluate('twStart.state()');

// A new install opens the start page, and its notice follows the translations; the harness waited 1.5 s more.
let s = await state();
for (let i = 0; i < 30 && (s.hash !== '#/start' || s.popups !== 1); i++) {
    await sleep(1000);
    s = await state();
}
if (s.hash !== '#/start' || s.popups !== 1) throw new Error(`no start page with its notice: ${JSON.stringify(s)}`);
await sleep(1500);

const notice = await dt.evaluate('twStart.popup()');
const page = await dt.evaluate('twStart.start()');
fs.writeFileSync(path.join(OUT, 'access.json'), JSON.stringify({state: 'access', lang, view, ...notice, page, clip: cut('access.png')}) + '\n');
console.log(`${lang} access: ${notice.parts.filter((p) => p.tag === 'button').map((p) => p.text).join(' | ')}, ${notice.lines.length} lines`);

await tap('twStart.popupButton(0)', 1500);
s = await state();
if (s.hash !== '#/start' || s.popups !== 0) throw new Error(`after OK: ${JSON.stringify(s)}`);
const start = await dt.evaluate('twStart.start()');
fs.writeFileSync(path.join(OUT, 'start.json'), JSON.stringify({state: 'start', lang, view, ...start, clip: cut('start.png')}) + '\n');
console.log(`${lang} start: ${start.chips.length} chips in ${new Set(start.chips.map((c) => c.rect.y)).size} rows; ${start.location.text}`);
dt.close();
