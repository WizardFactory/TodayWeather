/**
 * Offline check: KMA city-weather strings (currentweather.jsp, 2021+ wording)
 * map to a weatherType and getWeatherStr never yields undefined.
 * Run: node test/offline/test.weather.desc.js
 */
'use strict';

global.log = {error() {}, warn() {}, info() {}, debug() {}};
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../../controllers/controller.weather.desc');

const ko = JSON.parse(fs.readFileSync(path.join(__dirname, '../../locales/ko.json'), 'utf8'));
const ts = {__: (k) => (k in ko ? ko[k] : k)};

const cases = [
    ['비끝', 28, '비끝'],
    ['약한비연속적', 19, '약한비'],
    ['약한비단속적', 18, '약한비단속'],
    ['약한비계속', 19, '약한비'],
    ['보통비계속', 21, '비'],
    ['비', 65, '비'],
    ['흐림', 3, '흐림'],
    ['약한비', 19, '약한비'],
    ['눈끝', 41, '눈끝'],
    ['Cloudy', 3, '흐림'],
    ['Rain', 21, '비'],
];
for (const [w, type, str] of cases) {
    const t = D.makeWeatherType(w);
    assert.strictEqual(t, type, `makeWeatherType(${w})`);
    assert.strictEqual(D.getWeatherStr(t, ts), str, `getWeatherStr(${w})`);
}
assert.strictEqual(D.makeWeatherType('없는문자열'), -1);
assert.strictEqual(D.getWeatherStr(-1, ts), '');
assert.strictEqual(D.getWeatherStr(999, ts), '');
assert.strictEqual(D.getWeatherStr(undefined, ts), '');
console.log('ok', cases.length + 4, 'assertions');
