// TEST ONLY (S15b-4b-1): records `Date.parse` of the pinned legacy runtime (Node.js v16.20.2,
// TZ=UTC) over a deterministic corpus, for `tests/domestic/v8_date.rs`.
// Usage: TZ=UTC node v8_date_corpus.js | gzip -9n > v8-date-parse.json.gz
'use strict';
if (process.version !== 'v16.20.2' || process.env.TZ !== 'UTC') {
    throw new Error('record with Node.js v16.20.2 and TZ=UTC');
}
// mulberry32: a fixed seed gives the same corpus on every run.
let seed = 0x2742b41;
function rand() {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (n) => Math.floor(rand() * n);
const digits = (n) => Array.from({length: n}, () => String(int(10))).join('');

// Pieces the parser distinguishes: numerals of every length class, separators, signs, words
// (months, am/pm, zones, `T`, garbage, non-ASCII), parentheses, whitespace and control units.
const NUMBERS = () => digits(1 + int(pick([2, 4, 6, 10, 12])));
const WORDS = ['Jan', 'feb', 'MARCH', 'apr', 'May', 'jun', 'July', 'aug', 'Sep', 'oct', 'nov',
    'December', 'am', 'PM', 'a.m.', 'UT', 'UTC', 'utc', 'Z', 'z', 'GMT', 'CDT', 'cst', 'EDT',
    'EST', 'MDT', 'MST', 'PDT', 'pst', 'T', 't', 'KST', 'Mon', 'Tuesday', 'x', 'janx', 'juni',
    '오전', '시', 'été', '[', '_', '`', '{', '~', ' ', '﻿', '　'];
const SYMBOLS = [':', '::', '-', '+', '.', ')', '(', '(c)', '((x)', '/', ',', ' ', '  ', '\t',
    '\n', '\r', '\u000b', ' ', '\u0000', '\ud800', '\udc00', '#', '*', '='];
function piece() {
    const r = rand();
    if (r < 0.45) return NUMBERS();
    if (r < 0.65) return pick(WORDS);
    return pick(SYMBOLS);
}
function random() {
    const n = 1 + int(9);
    let s = '';
    for (let i = 0; i < n; i++) s += piece();
    return s;
}
function pad(n, w) {
    return String(n).padStart(w, '0');
}
// Structured forms near the ES5 ISO grammar and the KMA page forms, with out-of-range fields.
function structured() {
    const y = pick([pad(int(10000), 4), pad(int(100), 4), digits(pick([1, 2, 3, 5, 6])),
        '+' + pad(int(1000000), 6), '-' + pad(int(1000000), 6), '-000000']);
    const mo = pick([pad(1 + int(12), 2), pad(int(14), 2), String(1 + int(12)), '00', '13']);
    const d = pick([pad(1 + int(31), 2), pad(int(33), 2), String(1 + int(31)), '00', '32']);
    const h = pick([pad(int(24), 2), '24', '25', String(int(24))]);
    const mi = pick([pad(int(60), 2), '60', String(int(60))]);
    const se = pick([pad(int(60), 2), '60']);
    const ms = pick(['', '.' + digits(1 + int(10))]);
    const zone = pick(['', 'Z', 'z', '+09:00', '-0930', '+24:00', '+0960', ' GMT+9', ' UTC',
        ' +0900', ' (KST)', 'GMT-08', ' PST', '-8']);
    const sep = pick(['-', '.', '/', ' ']);
    const tsep = pick(['T', 't', ' ', '.', '']);
    const date = pick([y, y + sep + mo, y + sep + mo + sep + d, mo + sep + d + sep + y,
        d + ' ' + pick(['Jan', 'Sep', 'Dec']) + ' ' + y]);
    const time = pick(['', h + ':' + mi, h + ':' + mi + ':' + se + ms, h + 'h', h + '::',
        h + ':' + mi + ' ' + pick(['am', 'pm', 'PM'])]);
    return date + (time ? tsep + time : '') + zone;
}
const corpus = [
    '0001-09-24 09:03', '2026-09-24 09:03', '2026.09.24.09:00', '2026.9.24 9:3', '0001.09.26 09:03',
    '2026-09-24T09:03:00.000Z', '2026-09-24T24:00', '2026-09-24T24:01', 'Thu Sep 24 2026 09:03:00 GMT+0900 (KST)',
    '', ' ', 'x', '1', '12', '123', '1234', '12345', '123456', '1234567', '12345678901234',
    '24:00', '1/2/3', '1/2/3/4', 'Sep 24', '24 Sep', 'Sep 2026 24', '2026 Sep 24', '12 pm', '12 am 1:00',
    '1:00 pm', '13:00 pm', '1:2:3.4567', '1:2:3.', '1::', '1::2', '(1) 2026-01-01', '2026-01-01 (', ')1',
    '2026-01-01 +', 'UTC+', 'UTC+0900', 'UTC-12345', 'GMT+9:30', '2026-01-01 1:00 +09:30',
    '\u00002026', '2026\u0000-01-01', '\ud800 2026', '2026-01-01 ',
];
// TimeClip boundaries (|t| <= 8.64e15 ms) in each grammar, adjacent milliseconds and offsets
// that move an instant across them, and zone offsets whose minute arithmetic wraps 32 bits.
const EDGES = [
    ['+275760', '09', '13', 'Sep 13 275760'],
    ['-271821', '04', '20', 'Apr 20 -271821'],
    ['+275760', '09', '12', 'Sep 12 275760'],
    ['-271821', '04', '19', 'Apr 19 -271821'],
];
for (const [y, mo, d, legacy] of EDGES) {
    for (const t of ['00:00:00.000', '00:00:00.001', '23:59:59.999', '24:00', '00:00']) {
        for (const z of ['Z', '+00:00', '+00:01', '-00:01', '+23:59', '-23:59', '']) {
            corpus.push(`${y}-${mo}-${d}T${t}${z}`);
        }
        for (const z of ['GMT', 'GMT+0001', 'GMT-0001', 'UTC+1', 'UTC-1', '']) {
            corpus.push(`${legacy} ${t} ${z}`.trim());
        }
    }
}
for (const off of ['1193046:28', '1193046:29', '1193047:00', '35791394:08', '35791394:07',
    '2147483647', '2147483648', '4294967295', '4294967296', '99999:99', '999999999', '0:2147483647']) {
    for (const sign of ['+', '-']) {
        corpus.push(`UTC${sign}${off}`, `2026-01-01 00:00 GMT${sign}${off}`, `Jan 1 2026 UTC${sign}${off}`);
    }
}
for (const ms of ['8640000000000000', '8640000000000001', '-8640000000000000', '-8640000000000001']) {
    corpus.push(ms, `${ms} GMT`);
}
for (let i = 0; i < 6000; i++) corpus.push(random());
for (let i = 0; i < 14000; i++) corpus.push(structured());
const units = (s) => Array.from({length: s.length}, (_, i) => s.charCodeAt(i));
const out = corpus.map((s) => {
    const v = Date.parse(s);
    return [units(s), Number.isNaN(v) ? null : v];
});
process.stdout.write(JSON.stringify({runtime: process.version, tz: process.env.TZ, cases: out}));
