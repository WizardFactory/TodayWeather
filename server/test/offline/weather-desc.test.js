/* Run with Node >=16.17: node server/test/offline/weather-desc.test.js (#2576).
 * Loads the real description, station-weather and summary modules in a VM with
 * stubbed dependencies. No app startup, providers, credentials or Mongo connection.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const noop = function () {};
const log = Object.fromEntries(['info','warn','error','debug','verbose','silly'].map(k => [k,noop]));
const ko = JSON.parse(fs.readFileSync(path.join(root, 'locales/ko.json'), 'utf8'));
const ts = {__: k => (k in ko ? ko[k] : k)};
const sprintf = (fmt, ...args) => args.reduce((s, v) => s.replace('%s', v), fmt);

// Unlisted dependencies resolve to an inert constructor; only listed ones are real.
function load(relative, dependencies) {
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), {
        module, exports: module.exports, console, log,
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : function Stub() {}
    }, {filename: relative});
    return module.exports;
}
const Desc = load('controllers/controller.weather.desc.js', {});
const StnWeather = load('controllers/controllerKmaStnWeather.js', {'./controller.weather.desc': Desc});
const Town = load('controllers/controllerTown.js', {sprintf, './controller.weather.desc': Desc,
    '../controllers/controllerKmaStnWeather': StnWeather, '../config/config': {}});
const Town24h = load('controllers/controllerTown24h.js', {'../controllers/controllerTown': Town, '../config/config': {}});

test('modern KMA currentweather.jsp wording maps to legacy weather types', () => {
    const cases = [
        // observed on the service host 2026-09-25
        ['비끝', 28, '비끝'], ['약한비연속적', 19, '약한비'], ['약한비단속적', 18, '약한비단속'],
        ['약한비', 19, '약한비'], ['구름적음', 1, '구름적음'],
        // same suffix family
        ['비연속적', 21, '비'], ['강한비단속적', 22, '강한비단속'], ['비단속', 20, '비단속'],
        ['눈끝', 41, '눈끝'], ['약한눈단속적', 32, '약한눈단속'], ['강한눈', 37, '강한눈'],
        ['이슬비연속적', 15, '이슬비'], ['약한이슬비단속적', 14, '약한이슬비'],
        ['약한진눈깨비연속적', 29, '약진눈깨비'], ['강한진눈깨비', 30, '강진눈깨비'],
        ['소나기', 25, '소나기'], ['안개', 6, '안개'],
        // legacy, English and KMA AWS wording is unchanged
        ['비끝남', 28, '비끝'], ['약한비계속', 19, '약한비'], ['보통비계속', 21, '비'], ['약진눈깨비', 29, '약진눈깨비'],
        ['진눈깨비', 64, '진눈깨비'], ['비', 65, '비'], ['눈', 66, '눈'], ['흐림', 3, '흐림'],
        ['Cloudy', 3, '흐림'], ['Rain', 21, '비'], ['light rain and breezy', 19, '약한비'],
    ];
    for (const [str, type, text] of cases) {
        assert.equal(Desc.makeWeatherType(str), type, 'makeWeatherType(' + str + ')');
        assert.equal(Desc.getWeatherStr(type, ts), text, 'getWeatherStr(' + str + ')');
    }
    assert.equal(Desc.makeWeatherType('없는문자열'), -1);
});

test('getWeatherStr never returns undefined', () => {
    for (const type of [undefined, -1, 999]) {
        assert.equal(Desc.getWeatherStr(type, ts), '');
    }
});

test('updateWeather falls back to sky/pty when the KMA text is unmapped', () => {
    const noRain = {pty: 0, sky: 3, weatherType: -1};
    StnWeather.updateWeather(noRain);
    assert.deepEqual([noRain.weatherType, noRain.weather], [2, '구름많음']);

    const rain = {pty: 1, sky: 4, weatherType: -1};
    StnWeather.updateWeather(rain);
    assert.deepEqual([rain.weatherType, rain.weather], [65, '비']);

    const unknownSky = {pty: 0, sky: 9, weatherType: -1};
    StnWeather.updateWeather(unknownSky);
    assert.equal(unknownSky.weatherType, -1);
});

test('updateWeather maps KMA PTY 4-7 (short-term showers, nowcast drops/flurries)', () => {
    for (const [pty, type, text] of [[4, 25, '소나기'], [5, 19, '약한비'], [6, 29, '약진눈깨비'], [7, 33, '약한눈']]) {
        for (const start of [-1, undefined, 0]) {
            const cur = {pty, sky: 1, weatherType: start};
            StnWeather.updateWeather(cur);
            assert.deepEqual([cur.weatherType, cur.weather], [type, text], 'pty ' + pty + ' from ' + start);
            assert.equal(Desc.getWeatherStr(cur.weatherType, ts), text);
        }
    }
});

test('summaries skip missing weather text instead of printing undefined', () => {
    const ctrl = new Town24h();
    const yesterday = {t1h: 13};
    const units = {precipitationUnit: 'mm'};
    for (const fn of ['makeSummaryWeather', 'makeSummary']) {
        for (const current of [{t1h: 10, weatherType: -1}, {t1h: 10, weatherType: -1, weather: ''},
            {t1h: 10, weatherType: 2}, {t1h: 10, weatherType: 3, weather: ''}, {t1h: 10, weatherType: -1, weather: '비'}]) {
            assert.equal(ctrl[fn](current, yesterday, units, ts), '어제보다 -3˚', fn + ' ' + JSON.stringify(current));
        }
        assert.equal(ctrl[fn]({t1h: 10, weatherType: 28, weather: '비끝'}, yesterday, units, ts),
            '어제보다 -3˚, 비끝', fn);
    }
});
