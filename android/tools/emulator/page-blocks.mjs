// Cuts a Cordova page into its blocks for the page reference tools (forecast-reference, air-reference): the header
// block, then each card or other child of the page under it, each cut from the screen (screencap) with its rect and
// the text, image and style of every element in it. BLOCKS defines window.twBlocks in the Cordova page; cutBlocks
// drives it over WebView DevTools.
import fs from 'node:fs';
import path from 'node:path';
import {sleep} from './devtools.mjs';

/** In-page helpers (`window.twBlocks`), evaluated in the Cordova page after it settled. */
export const BLOCKS = `window.twBlocks = (function () {
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
    function content() { return shown('ion-content.main-content'); }
    // The blocks of the shown page in order: the header block, the other children of its card, and each card under it.
    function blocks() {
        var scroll = content().querySelector('.scroll') || content();
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
        wait: wait, closePopups: closePopups, shown: shown, content: content, blocks: blocks,
        // Brings block i between the bars and describes it. The header block (i = 0) starts under the header bar by
        // design (its top padding is the bar's height): it is cut at the top of the page, with the bar over it.
        block: function (i) {
            var el = blocks()[i];
            var b = bars();
            var r = el.getBoundingClientRect();
            if (i === 0) {
                content().scrollTop = 0;
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
            var el = blocks()[i], c = content();
            if (by === 0) c.scrollTop += el.getBoundingClientRect().top - bars().top; else c.scrollTop += by;
            return wait(400).then(function () { return {rect: rect(el), bars: bars(), scrollTop: c.scrollTop}; });
        },
    };
})()`;

/**
 * Cuts the [count] blocks of the shown page into `<dir>/<page>-<i>.png` and returns their records (rect, elements,
 * the pieces a block taller than the screen was stitched from, and the CSS px it leaves under the tab bar).
 */
export async function cutBlocks(dt, {screen, png, pngStack}, origin, dpr, dir, page, count, where) {
    fs.mkdirSync(dir, {recursive: true});
    const records = [];
    for (let i = 0; i < count; i++) {
        const b = await dt.evaluate(`twBlocks.block(${i})`);
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
            throw new Error(`${where} block ${i} (${b.cls}) does not fit between the bars: ${JSON.stringify({rect: b.rect, bars: b.bars})}`);
        } else {
            // Top under the header bar, then a screen at a time; each piece continues where the last one ended.
            const stack = [];
            let done = 0; // CSS px of the block captured
            let at = await dt.evaluate(`twBlocks.scroll(${i}, 0)`);
            while (done < b.rect.h - 0.5) {
                const from = at.rect.y + done, to = Math.min(at.rect.y + at.rect.h, at.bars.bottom);
                if (to <= from + 0.5) {
                    if (b.rect.h - done <= 2) { b.hidden = b.rect.h - done; break; }
                    throw new Error(`${where} block ${i}: no progress at ${done}`);
                }
                const y0 = Math.round(from * dpr), y1 = Math.round(to * dpr);
                stack.push({shot: screen(), area: {x: origin.x + x, y: origin.y + y0, width, height: y1 - y0}});
                done = to - at.rect.y;
                if (done < b.rect.h - 0.5) at = await dt.evaluate(`twBlocks.scroll(${i}, ${to - at.bars.top})`);
            }
            image = pngStack(stack);
            size = {width, height: stack.reduce((h, p) => h + p.area.height, 0)};
            pieces = stack.length;
        }
        fs.writeFileSync(path.join(dir, `${page}-${i}.png`), image);
        records.push({index: i, ...b, pieces, clip: {offset: {x: 0, y: 0}, size}});
        await sleep(100);
    }
    return records;
}
