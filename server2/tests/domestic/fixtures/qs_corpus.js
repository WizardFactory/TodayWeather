// TEST ONLY (S15b-4b-1): records `req.query` of the legacy Express 4.13.4 query parser (`qs`
// 4.0.0 through `lib/utils.js` `compileQueryParser('extended')`) on Node.js v16.20.2 over a
// deterministic corpus, for `tests/domestic/qs.rs`.
// Usage: EXPRESS_DIR=<express 4.13.4 package dir> node qs_corpus.js | gzip -9n > qs-parse.json.gz
'use strict';
const path = require('path');
if (process.version !== 'v16.20.2') {
    throw new Error('record with Node.js v16.20.2');
}
const expressDir = process.env.EXPRESS_DIR;
const pkg = require(path.join(expressDir, 'package.json'));
const qsPkg = require(path.join(expressDir, 'node_modules', 'qs', 'package.json'));
if (pkg.version !== '4.13.4' || qsPkg.version !== '4.0.0') {
    throw new Error('express 4.13.4 with qs 4.0.0 required');
}
const parse = require(path.join(expressDir, 'lib', 'utils.js')).compileQueryParser('extended');
let seed = 0x2742b42;
function rand() {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (n) => Math.floor(rand() * n);
const NAMES = ['temperatureUnit', 'airForecastSource', 'airUnit', 'a', 'x', '__proto__',
    'hasOwnProperty', 'constructor', 'toString', 'valueOf', '0', '1', '20', '21', '-1', '01',
    '', '%5B', '%5D', 'a%5Bb%5D', 'a.b', '%E2%82%AC', '%F4%8F%A0%80', '%ED%A0%80'];
const BRACKETS = ['[]', '[0]', '[1]', '[2]', '[20]', '[21]', '[x]', '[__proto__]', '[toString]',
    '[a][b]', '[', ']', '[[x]]', '][', '[0][1][2][3][4][5][6]', '[ ]', '[-1]', '[01]', '[a.b]'];
const VALUES = ['C', 'F', 'airkorea', 'kaq', '(null)', '', 'a+b', 'a%20b', '%ZZ', '%E0%A4%A',
    '%C3%28', '%F0%9F%98%80', '%ED%A0%80', 'x=y', '[1]', 'true', '0'];
function field() {
    let key = pick(NAMES);
    const n = int(4);
    for (let i = 0; i < n; i++) key += pick(BRACKETS);
    const r = rand();
    if (r < 0.15) return key;
    if (r < 0.2) return key + '=';
    return key + '=' + pick(VALUES);
}
function query() {
    const n = 1 + int(6);
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(rand() < 0.08 ? '' : field());
    return parts.join('&');
}
const PROBES = ['temperatureUnit', 'airForecastSource', 'airUnit', 'a', 'x', 'toString',
    'hasOwnProperty', 'constructor', '0'];
const corpus = [
    '', 'a', 'a=', 'a=1&a=2', 'a[]=1&a[]=2', 'a[1]=b&a[0]=c', 'a[21]=x', 'a[20]=x', 'a=b&a[x]=c',
    'a[x]=c&a=b', 'a[0]=b&a[x]=c', '__proto__[x]=1', 'a[__proto__][x]=1', 'hasOwnProperty=1',
    'toString=1&x=2', 'a[b][c][d][e][f][g][h]=1', ']=1', 'a]=1', 'a[=1', '[]=1', '=1',
    'temperatureUnit=F+%ZZ', 'x[y]=1', 'airForecastSource[x]=kaq', 'airForecastSource[]=(null)',
];
for (let i = 0; i < 8000; i++) corpus.push(query());
const cases = corpus.map((raw) => {
    const q = parse(raw);
    const probes = PROBES.map((k) => {
        const v = q[k];
        return v === undefined ? null : JSON.stringify(v);
    });
    return [raw, JSON.stringify(q), probes];
});
process.stdout.write(JSON.stringify({runtime: process.version, express: pkg.version,
    qs: qsPkg.version, probes: PROBES, cases}));
