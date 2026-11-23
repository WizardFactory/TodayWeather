import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const landing = join(root, 'landing');
const pages = readdirSync(landing, {withFileTypes: true})
  .filter((entry) => entry.isDirectory() && existsSync(join(landing, entry.name, 'index.html')))
  .map((entry) => join(landing, entry.name, 'index.html'));

// WOFF2 keeps the cmap table untransformed inside one Brotli stream; its offset is
// the sum of the stored lengths of the tables before it. Known-tag indexes: cmap 0,
// hmtx 3, glyf 10, loca 11 (https://www.w3.org/TR/WOFF2/#table_dir_format).
function woff2Cmap(file) {
  const font = readFileSync(file);
  assert.equal(font.toString('latin1', 0, 4), 'wOF2', 'not a WOFF2 file');
  const tables = font.readUInt16BE(12);
  const compressedSize = font.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = font[at++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('malformed table length');
  };
  let offset = 0;
  let cmap;
  for (let i = 0; i < tables; i += 1) {
    const flags = font[at++];
    const tag = flags & 0x3f;
    const version = flags >> 6;
    if (tag === 63) at += 4;
    const originalLength = base128();
    const transformed = tag === 10 || tag === 11 ? version !== 3 : tag === 3 ? version === 1 : version !== 0;
    const length = transformed ? base128() : originalLength;
    if (tag === 0) cmap = [offset, length];
    offset += length;
  }
  assert.ok(cmap, 'no cmap table');
  const data = brotliDecompressSync(font.subarray(at, at + compressedSize));
  assert.equal(data.length, offset, 'table data does not match the directory');
  const table = data.subarray(cmap[0], cmap[0] + cmap[1]);
  const codes = new Set();
  for (let i = 0; i < table.readUInt16BE(2); i += 1) {
    const platform = table.readUInt16BE(4 + i * 8);
    const encoding = table.readUInt16BE(6 + i * 8);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const sub = table.subarray(table.readUInt32BE(8 + i * 8));
    const format = sub.readUInt16BE(0);
    if (format === 12) {
      for (let g = 0; g < sub.readUInt32BE(12); g += 1) {
        const start = sub.readUInt32BE(16 + g * 12);
        const end = sub.readUInt32BE(20 + g * 12);
        const glyph = sub.readUInt32BE(24 + g * 12);
        for (let code = start; code <= end; code += 1) if (glyph + code - start) codes.add(code);
      }
    } else if (format === 4) {
      const segments = sub.readUInt16BE(6) / 2;
      const ends = 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s += 1) {
        const start = sub.readUInt16BE(starts + s * 2);
        const end = sub.readUInt16BE(ends + s * 2);
        const delta = sub.readUInt16BE(deltas + s * 2);
        const range = sub.readUInt16BE(ranges + s * 2);
        for (let code = start; code <= end && code < 0xffff; code += 1) {
          let glyph = code;
          if (range) {
            glyph = sub.readUInt16BE(ranges + s * 2 + range + (code - start) * 2);
            if (!glyph) continue;
          }
          if ((glyph + delta) & 0xffff) codes.add(code);
        }
      }
    }
  }
  return codes;
}

// The text a browser renders in the body. Only the four basic character references
// are allowed, so a reference cannot hide a character from the coverage check.
function renderedCharacters(html, page) {
  const body = html.split(/<body[^>]*>/)[1].replace(/<[^>]*>/g, '');
  const references = body.match(/&[#\w]+;/g) ?? [];
  const other = references.filter((reference) => !['&amp;', '&lt;', '&gt;', '&quot;'].includes(reference));
  assert.deepEqual(other, [], `${page}: write the character itself instead of a reference`);
  const text = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  return new Set(text.replace(/\s/g, ''));
}

function attribute(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

test('the landing has at least one page', () => {
  assert.ok(pages.length > 0);
});

test('the subset font has a glyph for every character the pages render', () => {
  const covered = woff2Cmap(join(landing, 'assets/landing-sans.woff2'));
  assert.ok(covered.size > 0);
  for (const page of pages) {
    const missing = [...renderedCharacters(readFileSync(page, 'utf8'), page)]
      .filter((char) => !covered.has(char.codePointAt(0)));
    assert.deepEqual(missing, [], `${page}: rerun scripts/landing-font-subset.py`);
  }
});

test('the font ships with its license', () => {
  assert.deepEqual(
    readFileSync(join(landing, 'assets/landing-sans-OFL.txt')),
    readFileSync(join(root, 'web/src/assets/Pretendard-OFL.txt')),
  );
});

test('every local file a page references exists', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const references = [
      ...attribute(html, /\s(?:src|href)="([^"]+)"/g),
      ...attribute(html, /\ssrcset="([^"]+)"/g)
        .flatMap((value) => value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0])),
    ].filter((value) => !/^(?:https?:|mailto:|#)/.test(value));
    assert.ok(references.length > 0);
    for (const reference of references) {
      assert.ok(existsSync(resolve(dirname(page), reference)), `${page}: ${reference}`);
    }
  }
});

test('the stylesheet loads the subset font beside it', () => {
  const css = readFileSync(join(landing, 'landing.css'), 'utf8');
  assert.deepEqual(attribute(css, /url\("([^"]+)"\)/g), ['assets/landing-sans.woff2']);
});

test('the native summaries link straight to their stores', () => {
  const expected = new Map([
    ['iPhone 앱', 'https://apps.apple.com/kr/app/id1041700694'],
    ['Android 앱', 'https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather'],
  ]);
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const links = [...html.matchAll(/<h3><a href="([^"]+)">([^<]+)</g)]
      .map((match) => [match[2].trim(), match[1].replace(/&amp;/g, '&')]);
    assert.deepEqual(new Map(links), expected, page);
    assert.doesNotMatch(html, /name="apple-itunes-app"/, `${page}: no Smart App Banner on the landing`);
  }
});

test('the desktop store QR is the WebApp QR for the store fallback link', () => {
  const source = readFileSync(join(root, 'web/src/AppQrCode.tsx'), 'utf8');
  assert.match(source, /encoding https:\/\/link\.todayweather\.ai\/open\?fallback=store\n/);
  const viewBox = /APP_QR_VIEWBOX = "([^"]+)"/.exec(source)[1];
  const path = [...source.slice(source.indexOf('APP_QR_PATH ='), source.indexOf('export function')).matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]).join('');
  const svg = readFileSync(join(landing, 'assets/store-qr.svg'), 'utf8');
  assert.equal(/viewBox="([^"]+)"/.exec(svg)[1], viewBox);
  assert.equal(/<path d="([^"]+)"/.exec(svg)[1], path);
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const items = html.slice(html.indexOf('<ul class="platforms">'), html.indexOf('</ul>', html.indexOf('<ul class="platforms">')))
      .match(/<li[^>]*>/g);
    assert.deepEqual(items, ['<li>', '<li>', '<li>', '<li class="scan">'], `${page}: the QR is the fourth summary item`);
    assert.match(html, /<li class="scan">.*src="\.\.\/assets\/store-qr\.svg"/, page);
  }
  // Shown only on wide windows with a mouse or trackpad; hidden everywhere else.
  const css = readFileSync(join(landing, 'landing.css'), 'utf8');
  const shows = [...css.matchAll(/\.scan \{ display: block; \}/g)];
  assert.match(css, /^\.scan \{ display: none; \}$/m);
  assert.equal(shows.length, 1);
  const query = css.lastIndexOf('@media', shows[0].index);
  assert.equal(css.slice(query, css.indexOf('{', query)).trim(), '@media (min-width: 64rem) and (hover: hover) and (pointer: fine)');
  let depth = 0;
  let end = css.indexOf('{', query);
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}' && --depth === 0) break;
  }
  assert.ok(shows[0].index < end, 'the display rule sits inside that media query');
});

test('every open action uses the plain /open link', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const actions = attribute(html, /<a class="primary" href="([^"]+)">/g);
    assert.ok(actions.length >= 1, page);
    assert.deepEqual([...new Set(actions)], ['https://link.todayweather.ai/open'], page);
    assert.match(html, /<li><h3>웹앱<\/h3>/, `${page}: the WebApp summary title stays unlinked`);
  }
});

test('the share image, touch icon and root files are present', () => {
  const site = 'https://todayweather.ai/';
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const image = attribute(html, /<meta property="og:image" content="([^"]+)">/g);
    const icon = attribute(html, /<link rel="apple-touch-icon" href="([^"]+)">/g);
    assert.equal(image.length, 1, `${page}: og:image`);
    assert.equal(icon.length, 1, `${page}: apple-touch-icon`);
    for (const url of [...image, ...icon]) {
      assert.ok(url.startsWith(site), url);
      assert.ok(existsSync(join(landing, 'root', url.slice(site.length))), url);
    }
  }
  for (const name of ['robots.txt', 'sitemap.xml', 'favicon.ico']) {
    assert.ok(existsSync(join(landing, 'root', name)), name);
  }
});

// Messengers such as KakaoTalk cache link previews by image URL, so a changed
// share image must get a new name: the name carries its content hash.
test('the share image name carries its content hash', () => {
  for (const page of pages) {
    const [url] = attribute(readFileSync(page, 'utf8'), /<meta property="og:image" content="([^"]+)">/g);
    const match = /\/og\/[a-z-]+-([0-9a-f]{8})\.png$/.exec(url);
    assert.ok(match, `${page}: og:image ${url} has no content hash`);
    const file = join(landing, 'root', new URL(url).pathname.slice(1));
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8), match[1], `${page}: rename ${url} after changing the image`);
  }
});
