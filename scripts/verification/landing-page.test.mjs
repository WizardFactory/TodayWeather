import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const landing = join(root, 'landing');
const pages = readdirSync(landing, {withFileTypes: true})
  .filter((entry) => entry.isDirectory() && existsSync(join(landing, entry.name, 'index.html')))
  .map((entry) => join(landing, entry.name, 'index.html'));

test('the landing has at least one page', () => {
  assert.ok(pages.length > 0);
});

test('the subset font covers every character the pages render', () => {
  const covered = new Set(readFileSync(join(landing, 'assets/landing-sans.chars.txt'), 'utf8'));
  for (const page of pages) {
    const body = readFileSync(page, 'utf8').split(/<body[^>]*>/)[1];
    const text = body.replace(/<[^>]*>/g, '').replace(/\s/g, '');
    const missing = [...new Set(text)].filter((char) => !covered.has(char));
    assert.deepEqual(missing, [], `${page}: rerun scripts/landing-font-subset.py`);
  }
});

test('every local file a page references exists', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const references = [...html.matchAll(/\s(?:src|href|srcset)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((value) => !/^(?:https?:|mailto:|#)/.test(value));
    assert.ok(references.length > 0);
    for (const reference of references) {
      assert.ok(existsSync(resolve(dirname(page), reference)), `${page}: ${reference}`);
    }
  }
});

test('the stylesheet loads the subset font beside it', () => {
  const css = readFileSync(join(landing, 'landing.css'), 'utf8');
  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(urls, ['assets/landing-sans.woff2']);
  assert.ok(existsSync(join(landing, urls[0])));
});

test('the share image and root files the page points at are present', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const absolute = [...html.matchAll(/content="https:\/\/todayweather\.ai\/([^"]+\.png)"|href="https:\/\/todayweather\.ai\/([^"]+\.png)"/g)]
      .map((match) => match[1] ?? match[2]);
    assert.ok(absolute.length >= 2);
    for (const path of absolute) assert.ok(existsSync(join(landing, 'root', path)), path);
  }
  for (const name of ['robots.txt', 'sitemap.xml', 'favicon.ico']) {
    assert.ok(existsSync(join(landing, 'root', name)), name);
  }
});
