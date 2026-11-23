import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
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
