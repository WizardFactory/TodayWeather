#!/usr/bin/env node
// Golden corpus generator for the Kotlin weather core (#2881, gate G3 of #2877).
//
// Runs the current Cordova client code (client/www/js) under Node and writes its outputs to
// android/core-domain/src/test/resources/corpus/. Only this tool reads client/; the Android
// build reads the generated files. Usage, from the repository root:
//   node android/tools/corpus/generate.mjs
// The output is deterministic: running it again without source or input changes changes nothing.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const JS = path.join(ROOT, 'client/www/js');
const LOCALES = path.join(ROOT, 'client/www/locales');
const OUT = path.join(ROOT, 'android/core-domain/src/test/resources/corpus');
const INPUTS = path.join(OUT, 'inputs');
const quiet = {log() {}, warn() {}, error() {}, info() {}};

// ---------------------------------------------------------------- Cordova code under Node
function loadWeatherUtil(units) {
    let factory;
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }})},
        console: quiet, clientConfig: {debug: false}, window: {}, alert() {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'service.weatherutil.js'), 'utf8'), context);
    const Util = {ga: {trackEvent() {}, trackException() {}}};
    const Units = {getUnit: (name) => units[name]};
    const Monetization = {track() {}};
    return factory({}, () => { throw new Error('no network in corpus'); }, Util, Units, Monetization);
}

// Extracts one named function from a controller source, by brace matching.
function extract(file, signature) {
    const src = fs.readFileSync(path.join(JS, file), 'utf8');
    const start = src.indexOf(signature);
    if (start < 0) throw new Error(`${signature} not found in ${file}`);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(src.indexOf('function', start), i + 1);
}

function translations(lang) {
    return JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8'));
}

// sprintf.js is installed at build time (not tracked); the code only uses one %s.
const sprintf = (format, value) => format.replace('%s', value);

function forecastFunctions(lang, tempUnit) {
    const tr = translations(lang);
    const $scope = {};
    const context = {
        $scope, console: quiet, sprintf,
        Units: {getUnit: () => tempUnit},
        Util: {ga: {trackException() {}}},
        $translate: (keys) => ({
            then(ok) {
                ok(Object.fromEntries(keys.map((k) => [k, tr[k]])));
                return {finally(fn) { fn(); }};
            },
        }),
    };
    const code = [
        extract('controller.forecastctrl.js', 'function _makeRainSnowFallValueStr('),
        extract('controller.forecastctrl.js', 'function _diffTodayYesterday('),
        extract('controller.forecastctrl.js', 'function getTodayPosition('),
        '$scope.getRainSnowFallSymbol = ' + extract('controller.forecastctrl.js', '$scope.getRainSnowFallSymbol = function'),
        '$scope.getRainSnowFall = ' + extract('controller.forecastctrl.js', '$scope.getRainSnowFall = function'),
        'this.diff = _diffTodayYesterday; this.position = getTodayPosition;',
    ].join('\n');
    vm.runInNewContext(code, context);
    return {
        diff(current, yesterday) { context.diff(current, yesterday); return $scope.diffTempStr; },
        rainSnowFall: (v) => $scope.getRainSnowFall(v),
        rainSnowFallSymbol: (v) => $scope.getRainSnowFallSymbol(v),
        todayPosition(chartType, state) {
            Object.assign($scope, state);
            vm.runInNewContext(`colWidth = ${state.colWidth}`, context);
            return context.position(chartType);
        },
    };
}

// WeatherInfo with the Cordova storage and push hooks replaced by recorders.
function loadWeatherInfo(weatherUtil) {
    let factory;
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }})},
        console: quiet, clientConfig: {debug: false}, window: {}, Date: FixedDate,
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'service.weatherinfo.js'), 'utf8'), context);
    const saved = {};
    const TwStorage = {set(k, v) { saved[k] = JSON.parse(JSON.stringify(v)); }, get: (k) => saved[k]};
    const info = factory({$broadcast() {}}, weatherUtil, TwStorage,
        {ga: {trackEvent() {}, trackException() {}}}, {track() {}});
    info._getPhoto = () => null; // random photo choice; the theme work owns it
    return {info, saved};
}

class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.UTC(2026, 10, 7, 3, 0, 0)])); }
    static now() { return Date.UTC(2026, 10, 7, 3, 0, 0); }
}

// ---------------------------------------------------------------- cases
const clone = (v) => JSON.parse(JSON.stringify(v));
const input = (name) => JSON.parse(fs.readFileSync(path.join(INPUTS, `${name}.json`), 'utf8'));
const each = (list, fn) => (Array.isArray(list) ? list.forEach(fn) : undefined);

// Each case: [name, input file, verification-matrix rows, mutation]
const CONVERSION = [
    ['kma-seoul', 'kma-seoul', 'V07', null],
    ['kma-seoul-en', 'kma-seoul-en', 'V07,V24', null],
    ['kma-seoul-fahrenheit', 'kma-seoul-f', 'V05', null],
    ['kma-jeju', 'kma-jeju', 'V07', null],
    ['vc-london', 'vc-london', 'V07', null],
    ['vc-london-fahrenheit', 'vc-london-f', 'V05', null],
    ['vc-newyork', 'vc-newyork', 'V04', null],
    ['vc-sydney', 'vc-sydney', 'V04', null],
    ['kma-no-current-index', 'kma-seoul', 'V04', (d) => each(d.short, (s) => { delete s.currentIndex; })],
    ['kma-current-index-first', 'kma-seoul', 'V04', (d) => each(d.short, (s, i) => { s.currentIndex = i === 0; })],
    ['kma-midnight-today-first-day', 'kma-seoul', 'V04', (d) => each(d.midData.dailyData, (s, i) => { s.fromToday = i - 0; })],
    ['kma-zero-precipitation', 'kma-seoul', 'V05', (d) => {
        each(d.short, (s) => { s.pop = 0; s.rn1 = 0; s.r06 = 0; s.s06 = 0; });
        each(d.midData.dailyData, (s) => { s.pop = 0; s.rn1 = 0; s.r06 = 0; s.s06 = 0; });
    }],
    ['kma-rain-everywhere', 'kma-seoul', 'V05', (d) => {
        each(d.short, (s) => { s.pop = 80; s.rn1 = 2.5; });
        each(d.midData.dailyData, (s) => { s.pop = 70; s.r06 = 12; s.skyAm = 'Rain'; s.skyPm = 'Cloud'; });
    }],
    ['kma-sentinels', 'kma-seoul', 'V05', (d) => {
        d.current.t1h = -50; d.current.reh = -1;
        each(d.short, (s, i) => { if (i % 3 === 0) { s.pop = -1; s.t3h = -50; } });
    }],
    ['kma-string-values', 'kma-seoul', 'V05', (d) => {
        each(d.short, (s) => { if (s.pop !== undefined) s.pop = String(s.pop); if (s.rn1 !== undefined) s.rn1 = String(s.rn1); });
        each(d.midData.dailyData, (s) => { if (s.pop !== undefined) s.pop = String(s.pop); });
    }],
    ['kma-missing-short', 'kma-seoul', 'V07', (d) => { delete d.short; }],
    ['kma-missing-mid', 'kma-seoul', 'V07', (d) => { delete d.midData; }],
    ['kma-missing-current', 'kma-seoul', 'V07', (d) => { delete d.current; }],
    ['kma-no-air', 'kma-seoul', 'V10', (d) => { delete d.airInfoList; delete d.airInfo; }],
    ['kma-empty-air-list', 'kma-seoul', 'V10', (d) => { d.airInfoList = []; }],
    ['kma-address-only', 'kma-seoul', 'V06', (d) => { delete d.location; delete d.name; }],
    ['vc-no-current-index', 'vc-london', 'V04', (d) => each(d.hourly, (s) => { delete s.currentIndex; })],
    ['vc-no-pubdate', 'vc-london', 'V07', (d) => { delete d.pubDate; }],
    ['vc-no-units', 'vc-london', 'V07', (d) => { delete d.units; }],
    ['unknown-source', 'vc-london', 'V07', (d) => { d.source = 'XYZ'; }],
    ['world-missing-daily', 'vc-london', 'V07', (d) => { delete d.daily; }],
    ['world-missing-thistime', 'vc-london', 'V07', (d) => { delete d.thisTime; }],
    ['html-error-body', null, 'V07', () => '<html><body>502 Bad Gateway</body></html>'],
    ['empty-object', null, 'V07', () => ({})],
];

function conversionCases(util) {
    const cases = [];
    for (const [name, file, rows, mutate] of CONVERSION) {
        let data = file ? input(file) : undefined;
        if (mutate) data = mutate(data) ?? data;
        let expected, error;
        try {
            const converted = util.convertWeatherData([{data: clone(data)}]);
            expected = converted === undefined ? null : clone(converted);
        } catch (e) {
            error = e.constructor.name;
        }
        cases.push({name, rows: rows.split(','), ...(mutate || !file ? {input: data} : {inputFile: `inputs/${file}.json`}),
            ...(error ? {error} : {expected: expected ?? null})});
    }
    return cases;
}

function functionCases(util) {
    const out = {};
    const addresses = [
        '대한민국 서울특별시 중구 명동', '대한민국 서울특별시 중구', '대한민국 서울특별시',
        '대한민국 경기도 성남시 분당구 정자동', '대한민국 경기도 성남시 분당구', '대한민국 경기도 수원시',
        '대한민국 제주특별자치도 제주시 연동', '대한민국 제주특별자치도 서귀포시', '대한민국 세종특별자치시 조치원읍',
        '대한민국 부산광역시 해운대구 우동', '대한민국 경상남도 남해군 남해읍', '대한민국 강원도 강릉시 교동',
        '대한민국 인천광역시 강화군 강화읍 관청리', '대한민국', '', 'London, UK', 'United Kingdom London Westminster Abbey Road 1',
    ];
    out.shortenAddress = addresses.map((a) => ({args: [a], expected: util.getShortenAddress(a)}));
    out.addressArray = addresses.map((a) => ({args: [a], expected: util.convertAddressArray(a)}));
    out.townFromAddress = addresses.map((a) => ({args: [a], expected: clone(util.getTownFromFullAddress(util.convertAddressArray(a)))}));
    const icons = ['Sun', 'Moon', 'SunSmallCloud', 'MoonBigCloud', 'Cloud', 'CloudRain', 'CloudSnow', 'CloudRainSnow',
        'CloudLightning', 'SunBigCloudRainLightning', 'sun', 'cloud', 'rainsnow', 'Fog', ''];
    out.weatherEmoji = icons.map((i) => ({args: [i], expected: util.getWeatherEmoji(i)}));
    const coords = [[37.5665, 126.978], [10.7626638, 106.6296638], [-33.86785, 151.20732], [0, 0], [51.50735, -0.12776], [37.5664999, 126.9785001]];
    out.geolocationNormalize = coords.map(([lat, long]) => ({args: [{lat, long}], expected: util.geolocationNormalize({lat, long})}));

    out.diffTodayYesterday = [];
    const pairs = [[15, 12], [12, 15], [10, 10], [10.04, 10], [10.06, 10], [-0.3, 0.2], [20.55, 18.1], [7, undefined],
        [undefined, 7], [-50, 12], ['12', '10'], [3.14159, 1]];
    for (const lang of ['ko', 'en']) {
        for (const unit of ['C', 'F']) {
            const f = forecastFunctions(lang, unit);
            for (const [t, y] of pairs) {
                const current = t === undefined ? {} : {t1h: t};
                const yesterday = y === undefined ? undefined : {t1h: y};
                out.diffTodayYesterday.push({args: [lang, unit, current, yesterday ?? null], expected: f.diff(current, yesterday)});
            }
        }
    }
    const f = forecastFunctions('en', 'C');
    const rains = [{}, {rn1: 3.2}, {rn1: 12.6, pty: 3}, {rn1: 0, s06: 1.5}, {s06: 14.4}, {r06: 0.3}, {r06: 27.5, rn1: 0},
        {rn1: -1}, {pty: 1}, {rn1: '5', pty: 3}, {rn1: 9.99}, {rn1: 10}];
    out.rainSnowFall = rains.map((v) => ({args: [v], expected: f.rainSnowFall(clone(v))}));
    out.rainSnowFallSymbol = rains.map((v) => ({args: [v], expected: f.rainSnowFallSymbol(clone(v))}));

    out.todayPosition = [];
    for (const name of ['kma-seoul', 'vc-london']) {
        const city = util.convertWeatherData([{data: input(name)}]);
        for (const bodyWidth of [320, 360, 412, 700]) {
            for (const chartType of ['short', 'mid']) {
                const colWidth = Math.min(bodyWidth / 7, 60);
                const state = {colWidth, bodyWidth, tabletWidth: 640, timeChart: city.timeChart,
                    dayChart: city.dayChart, currentWeather: city.currentWeather};
                out.todayPosition.push({args: [name, chartType, bodyWidth], expected: f.todayPosition(chartType, state)});
            }
        }
    }
    return out;
}

// V09: a weather request for place A completes after the user selected place B (anomaly A01).
function lateResponseCase(util) {
    const {info} = loadWeatherInfo(util);
    info.loadCities = () => {};
    info.addCity({address: '대한민국 서울특별시 중구 명동', location: {lat: 37.56, long: 126.98}, currentPosition: false});
    info.addCity({address: 'United Kingdom London', location: {lat: 51.51, long: -0.13}, currentPosition: false});
    info.setCityIndex(0);
    const requestedFor = info.getCityIndex();
    info.setCityIndex(1); // the user swipes to London while Seoul's request is outstanding
    const seoul = util.convertWeatherData([{data: input('kma-seoul')}]);
    info.updateCity(info.getCityIndex(), seoul); // TabCtrl applies it to the completion-time selection
    return {
        name: 'late-response-after-switch', rows: ['V09'], anomaly: 'A01',
        requestedForIndex: requestedFor, appliedToIndex: info.getCityIndex(),
        cities: [0, 1].map((i) => ({index: i, address: info.getCityOfIndex(i).address,
            source: info.getCityOfIndex(i).source ?? null,
            t1h: info.getCityOfIndex(i).currentWeather ? info.getCityOfIndex(i).currentWeather.t1h : null})),
    };
}

// ---------------------------------------------------------------- write
const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km',
    precipitationUnit: 'mm', airUnit: 'airkorea'};
const util = loadWeatherUtil(units);
const write = (rel, value) => {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    // Conversion cases are large; keep them compact. Everything else stays readable.
    fs.writeFileSync(file, (rel.startsWith('conversion/') ? JSON.stringify(value) : JSON.stringify(value, null, 1)) + '\n');
};
fs.rmSync(path.join(OUT, 'conversion'), {recursive: true, force: true});
for (const c of conversionCases(util)) write(`conversion/${c.name}.json`, c);
write('functions.json', functionCases(util));
write('weather-info.json', [lateResponseCase(util)]);

const sources = ['service.weatherutil.js', 'service.weatherinfo.js', 'controller.forecastctrl.js']
    .map((f) => `client/www/js/${f}`).concat(['client/www/locales/ko.json', 'client/www/locales/en.json']);
write('source.json', {
    generator: 'android/tools/corpus/generate.mjs',
    sources: sources.map((p) => ({
        path: p,
        commit: execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%H', '--', p]).toString().trim(),
        sha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex'),
    })),
});
console.log(`corpus written to ${path.relative(ROOT, OUT)}`);
