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
    ['kma-seoul-imperial', 'kma-seoul-imperial', 'V05,V32', null],
    ['kma-seoul-aqicn', 'kma-seoul-aqicn', 'V05,V32', null],
    ['kma-seoul-who', 'kma-seoul-who', 'V05,V32', null],
    ['vc-tokyo', 'vc-tokyo', 'V04,V32', null],
    ['kma-null-short-row', 'kma-seoul', 'V07', (d) => { d.short[3] = null; }],
    ['kma-null-daily-row', 'kma-seoul', 'V07', (d) => { d.midData.dailyData[2] = null; }],
    ['vc-null-hourly-row', 'vc-london', 'V07', (d) => { d.hourly[5] = null; }],
    ['vc-null-daily-row', 'vc-london', 'V07', (d) => { d.daily[1] = null; }],
    ['kma-number-row', 'kma-seoul', 'V07', (d) => { d.short[4] = 7; }],
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

// Every captured unit variant with zero, missing, sentinel and string values (V05). The mutations are
// declarative so the Kotlin test applies the same ones; the expected output is stored as the SHA-256
// of its canonical JSON (sorted keys) to keep the corpus small.
const VALUE_MUTATIONS = {
    zero: {set: 0, keys: ['t1h', 't3h', 'pop', 'rn1', 'r06', 's06', 'wsd', 'reh', 'tmn', 'tmx'], onlyPresent: true},
    missing: {delete: true, keys: ['t1h', 't3h', 'pop', 'rn1', 'wsd', 'skyIcon', 'tmn', 'tmx']},
    sentinel: {set: -50, keys: ['t1h', 't3h', 'tmn', 'tmx'], onlyPresent: true, also: {set: -1, keys: ['pop', 'reh', 'wsd']}},
    string: {stringify: true, keys: ['t1h', 't3h', 'pop', 'rn1', 'wsd', 'tmn', 'tmx']},
};
function applyValueMutation(d, m) {
    const rows = d.source === 'KMA'
        ? [d.current, ...(d.short || []), ...((d.midData && d.midData.dailyData) || [])]
        : [...(d.thisTime || []), ...(d.hourly || []), ...(d.daily || [])];
    const apply = (spec, r) => {
        for (const k of spec.keys) {
            if (spec.delete) delete r[k];
            else if (spec.stringify) { if (typeof r[k] === 'number') r[k] = String(r[k]); }
            else if (!spec.onlyPresent || k in r) r[k] = spec.set;
        }
        if (spec.also) apply(spec.also, r);
    };
    rows.filter((r) => r && typeof r === 'object').forEach((r) => apply(m, r));
}
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v));
const UNIT_FILES = ['kma-seoul', 'kma-seoul-f', 'kma-seoul-imperial', 'kma-seoul-aqicn', 'kma-seoul-who', 'vc-london', 'vc-london-f', 'vc-tokyo'];

function unitCases(util) {
    const out = [];
    for (const file of UNIT_FILES) {
        for (const [kind, mutation] of Object.entries(VALUE_MUTATIONS)) {
            const data = input(file);
            applyValueMutation(data, mutation);
            const converted = util.convertWeatherData([{data}]);
            out.push({name: `${file}-${kind}`, rows: ['V05'], inputFile: `inputs/${file}.json`, mutation: kind,
                expectedSha256: converted == null ? null : createHash('sha256').update(canonical(JSON.parse(JSON.stringify(converted)))).digest('hex')});
        }
    }
    return {mutations: VALUE_MUTATIONS, cases: out};
}

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
        [undefined, 7], [-50, 12], ['12', '10'], [3.14159, 1], [0, 0], [0, -0.04], [-50, -50], [null, 5], ['', '1'],
        ['abc', 1], [99.95, 0], [-0.05, 0], [0.05, 0], [32, 31.5], [-40, -39.5]];
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

    // The update time shown under the current weather (applyWeatherData's updateTime IIFE).
    const src = fs.readFileSync(path.join(JS, 'controller.forecastctrl.js'), 'utf8');
    const start = src.indexOf('$scope.updateTime = (function () {') + '$scope.updateTime = '.length;
    const end = src.indexOf('})();', start) + 2;
    const updateTimeContext = {console: quiet, Util: {ga: {trackEvent() {}, trackException() {}}}, Date};
    vm.runInNewContext(`this.updateTime = function (cityData) { return ${src.slice(start, end)}(); };`, updateTimeContext);
    const times = [{stnDateTime: '2026-11-07 23:00'}, {date: '20261107', time: '2300'}, {date: '20261231', time: '2400'},
        {date: '20280229', time: '0000'}, {date: '20261107', time: 23}, {date: '2026', time: '1'}, {stnDateTime: '', date: '20261107', time: '0900'},
        {date: 20261107, time: '0900'}, {}, null];
    out.updateTime = times.map((cw) => ({args: [cw], expected: updateTimeContext.updateTime({currentWeather: cw}) ?? null}));

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

// V09: the real TabCtrl.updateWeatherData completes for place A after the user selected place B (A01).
async function lateResponseCase(util) {
    const {info} = loadWeatherInfo(util);
    info.addCity({address: '대한민국 서울특별시 중구 명동', location: {lat: 37.56, long: 126.98}, currentPosition: false});
    info.addCity({address: 'United Kingdom London', location: {lat: 51.51, long: -0.13}, currentPosition: false});
    let respond;
    const pending = new Promise((resolve) => { respond = resolve; });
    const weatherUtil = Object.create(util);
    weatherUtil.getWeatherByGeoInfo = () => pending; // the request for Seoul stays outstanding
    const context = {
        console: quiet, WeatherUtil: weatherUtil, WeatherInfo: info, Monetization: {track() {}},
        strFailToGetWeatherInfo: 'fail', Date,
        $q: {defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); return {promise, resolve, reject}; }},
    };
    vm.runInNewContext(extract('controller.tabctrl.js', 'function updateWeatherData(') + '\nthis.update = updateWeatherData;', context);
    info.setCityIndex(0);
    const done = context.update(info.getCityOfIndex(0));
    info.setCityIndex(1); // the user swipes to London
    respond([{data: input('kma-seoul')}]);
    await done;
    return {
        name: 'late-response-after-switch', rows: ['V09'], anomaly: 'A01', requestedForIndex: 0,
        appliedToIndex: [0, 1].find((i) => info.getCityOfIndex(i).source === 'KMA') ?? null,
        cities: [0, 1].map((i) => ({index: i, address: info.getCityOfIndex(i).address,
            source: info.getCityOfIndex(i).source ?? null,
            t1h: info.getCityOfIndex(i).currentWeather ? info.getCityOfIndex(i).currentWeather.t1h : null})),
    };
}

// Air quality display (V10, V32): standards, grade colors and icons, the gauge label, pollutant lists.
function airCases() {
    const airUnits = ['airkorea', 'airkorea_who', 'airnow', 'aqicn', undefined, null, 'unknown'];
    const out = {standards: [], gradeColor: [], sentimentIcon: [], labelPosition: [], aqiList: [], dustForecast: [], hourlyForecast: [], airCodeUnit: []};
    const tab = (airUnit) => {
        const $scope = {};
        const context = {
            $scope, console: quiet, Util: {ga: {trackEvent() {}, trackException() {}}},
            Units: {getUnit: () => airUnit}, $sce: {trustAsHtml: (s) => s},
            aqiStandard: loadWeatherUtil({}).aqiStandard, airUnit: undefined,
        };
        vm.runInNewContext([
            extract('controller.tabctrl.js', 'function setAirUnit('),
            '$scope.getSentimentIcon = ' + extract('controller.tabctrl.js', '$scope.getSentimentIcon = function'),
            '$scope.grade2Color = ' + extract('controller.tabctrl.js', '$scope.grade2Color = function'),
            '$scope.airkoreaGrade2Color = ' + extract('controller.tabctrl.js', '$scope.airkoreaGrade2Color = function'),
            'setAirUnit();',
        ].join('\n'), context);
        return $scope;
    };
    const grades = [undefined, 0, 1, 2, 3, 4, 5, 6, 7, '2'];
    for (const airUnit of airUnits) {
        const $scope = tab(airUnit);
        out.standards.push({args: [airUnit ?? null], expected: {list: clone($scope.aqiStandard ?? null), maxValue: clone($scope.aqiMaxValue ?? null)}});
        for (const g of grades) {
            out.gradeColor.push({args: [airUnit ?? null, g ?? null, null], expected: $scope.grade2Color(g)});
            out.gradeColor.push({args: [airUnit ?? null, g ?? null, '#888'], expected: $scope.grade2Color(g, '#888')});
            out.sentimentIcon.push({args: [airUnit ?? null, g ?? null], expected: $scope.getSentimentIcon(g)});
        }
        if (airUnit === 'airkorea') {
            out.airkoreaGradeColor = grades.map((g) => ({args: [g ?? null], expected: $scope.airkoreaGrade2Color(g)}));
        }
    }
    // Gauge label: x of the value marker over the standard's grade bands.
    const air = (airUnit, aqiCode, width) => {
        const $scope = tab(airUnit);
        const context = {
            $scope, console: quiet, Util: {ga: {trackException() {}}}, aqiCode,
            angular: {element: (el) => ({prop: () => el})},
            document: {getElementById: (id) => (id === 'aqistd' ? width : 52)},
        };
        vm.runInNewContext('$scope.getLabelPosition = ' + extract('controller.air.js', '$scope.getLabelPosition = function') +
            '\n$scope.getAirCodeUnit = ' + extract('controller.air.js', '$scope.getAirCodeUnit = function') +
            '\n' + extract('controller.air.js', 'function _getAQIname(') + '\n' + extract('controller.air.js', 'function _getAQIList(') +
            '\n' + extract('controller.air.js', 'function _getDustForecast(') + '\n' + extract('controller.air.js', 'function _getHourlyForecast(') +
            '\nthis.aqiList = _getAQIList; this.dust = _getDustForecast; this.hourly = _getHourlyForecast;', context);
        return {$scope, context};
    };
    const standards = loadWeatherUtil({}).aqiStandard;
    for (const airUnit of ['airkorea', 'airkorea_who', 'airnow', 'aqicn']) {
        for (const code of ['aqi', 'pm25', 'pm10', 'o3', 'no2', 'co', 'so2']) {
            for (const width of [300, 360]) {
                const {$scope} = air(airUnit, code, width);
                const bp = standards[airUnit].value[code];
                for (let g = 1; g < bp.length; g++) {
                    for (const v of [bp[g - 1], bp[g], bp[g] + 0.001]) {
                        out.labelPosition.push({args: [airUnit, code, width, g, v], expected: $scope.getLabelPosition(g, v)});
                    }
                }
            }
        }
    }
    const {$scope, context} = air('airkorea', 'pm25', 360);
    for (const code of ['aqi', 'pm25', 'pm10', 'o3', 'no2', 'co', 'so2', 'xyz']) {
        out.airCodeUnit.push({args: [code], expected: $scope.getAirCodeUnit(code)});
    }
    for (const name of ['kma-seoul', 'kma-seoul-aqicn', 'vc-london', 'vc-tokyo']) {
        const data = input(name);
        const stations = data.airInfoList || (data.airInfo ? [data.airInfo] : []);
        stations.forEach((station, i) => {
            const last = station.last || {};
            out.aqiList.push({args: [name, i], expected: clone(context.aqiList(last, station.pollutants))});
            if (station.pollutants && station.pollutants.aqi && station.pollutants.aqi.hourly && last.dataTime) {
                out.hourlyForecast.push({args: [name, i, last.dataTime], expected: clone(context.hourly(last.dataTime, clone(station.pollutants.aqi.hourly)))});
            }
        });
        const days = data.midData ? data.midData.dailyData : data.daily;
        for (const code of ['aqi', 'pm25', 'pm10', 'o3']) {
            context.aqiCode = code;
            out.dustForecast.push({args: [name, code], expected: clone(context.dust(clone(days)) ?? null)});
        }
    }
    out.aqiList.push({args: ['missing-air', 0], expected: clone(context.aqiList({}, undefined))});
    // Time boundaries (V04): midnight written as 24:00 and 00:00, month and year ends, a leap day.
    const rows = ['2026-11-07 22:00', '2026-11-07 23:00', '2026-11-07 24:00', '2026-11-08 00:00', '2026-11-08 01:00',
        '2026-11-30 24:00', '2026-12-01 00:00', '2026-12-31 23:00', '2027-01-01 00:00', '2028-02-28 24:00', '2028-02-29 00:00',
        '2028-03-01 00:00', '2026-11-08 5:00', 'bad'].map((date, i) => ({date, val: i, grade: 1 + (i % 4)}));
    for (const current of ['2026-11-07 23:00', '2026-11-07 24:00', '2026-11-30 24:00', '2026-12-31 23:00', '2028-02-28 24:00', '']) {
        out.hourlyForecast.push({args: ['synthetic', 0, current], input: clone(rows), expected: clone(context.hourly(current, clone(rows)))});
    }
    return out;
}

// Nationwide weather and air (S10, S11) and weather warnings (S12) from captured responses.
async function nationCases() {
    const nation = input('nation');
    const make = (file, ctrl, airUnit) => {
        let controller;
        const context = {angular: {module: () => ({controller: (_, fn) => { controller = fn; }})}, console: quiet};
        vm.runInNewContext(fs.readFileSync(path.join(JS, file), 'utf8'), context);
        const $scope = {};
        const WeatherUtil = Object.create(loadWeatherUtil({}));
        let loaded;
        const ready = new Promise((r) => { loaded = r; });
        WeatherUtil.getNationWeather = () => ({then(ok) { ok(clone(nation)); loaded(); return {finally(f) { f(); }}; }});
        controller($scope, {region: 'KR', ga: {trackException() {}}}, WeatherUtil, {}, {show() {}, hide() {}},
            {getUnit: (u) => (u === 'airUnit' ? airUnit : {precipitationUnit: 'mm', windSpeedUnit: 'm/s'}[u])});
        return {$scope, ready};
    };
    const weather = make('controller.nation.js');
    const out = {weather: [], air: []};
    for (const type of [0, 1, 2]) {
        weather.$scope.changeWeatherType(type);
        for (const city of weather.$scope.cityList) {
            out.weather.push({args: [type, city.name], expected: {icon: weather.$scope.getIcon(city.name) ?? null,
                text1: weather.$scope.getText1(city.name) ?? null, text2: weather.$scope.getText2(city.name) ?? null,
                text1Unit: weather.$scope.getText1Unit() ?? null, text2Unit: weather.$scope.getText2Unit() ?? null}});
        }
    }
    out.weatherCities = clone(weather.$scope.cityList);
    for (const airUnit of ['airkorea', 'airnow']) {
        const air = make('controller.nation.air.js', 'controller.nation.air', airUnit);
        for (const type of air.$scope.airTypeList) {
            air.$scope.changeAirType(type);
            for (const city of air.$scope.cityList) {
                out.air.push({args: [airUnit, type, city.name], expected: {text1: air.$scope.getText1(city.name) ?? null, color: air.$scope.grade2Color(city.name)}});
            }
        }
        out.airCities = clone(air.$scope.cityList);
    }
    return out;
}

function specialCases() {
    const out = [];
    for (const [locale, timeZone] of [['ko-KR', 'Asia/Seoul'], ['en-US', 'Asia/Seoul'], ['ja-JP', 'Asia/Seoul'], ['de-DE', 'Asia/Seoul'], ['zh-CN', 'Asia/Seoul'], ['zh-TW', 'Asia/Seoul'], ['en-US', 'America/New_York']]) {
        class LocaleDate extends Date {
            toLocaleDateString() { return super.toLocaleDateString(locale, {timeZone}); }
            toLocaleTimeString() { return super.toLocaleTimeString(locale, {timeZone}); }
        }
        const context = {console: quiet, Util: {ga: {trackException() {}}}, Date: LocaleDate};
        vm.runInNewContext(extract('controller.kma.special.js', 'function parseSpecialData(') + '\nthis.parse = parseSpecialData;', context);
        out.push({args: [locale, timeZone], expected: clone(context.parse(input('special')))});
        const synthetic = [
            '2026-03-08T06:59:00.000Z', '2026-03-08T07:00:00.000Z', '2026-11-01T05:59:59.000Z', '2026-11-01T06:00:00.000Z',
            '2026-12-31T15:00:00.000Z', '2028-02-29T03:30:00.000Z', '2026-11-07T15:00:00Z', 1794067200000, null,
            'not a date', undefined,
        ].map((announcement, i) => ({...(announcement === undefined ? {} : {announcement}), comment: `line ${i}\nnext`}));
        out.push({args: [locale, timeZone, 'synthetic'], input: synthetic, expected: clone(context.parse(clone(synthetic)))});
        const failing = [{announcement: '2026-11-07T15:00:00.000Z', comment: 'a\nb'}, {announcement: '2026-11-07T16:00:00.000Z'},
            {announcement: '2026-11-07T17:00:00.000Z', comment: 'c\nd'}];
        out.push({args: [locale, timeZone, 'missing-comment'], input: failing, expected: clone(context.parse(clone(failing)))});
    }
    return out;
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
write('units.json', unitCases(util));
write('weather-info.json', [await lateResponseCase(util)]);
write('air.json', airCases());
write('nation.json', await nationCases());
write('special.json', specialCases());

const sources = ['service.weatherutil.js', 'service.weatherinfo.js', 'controller.forecastctrl.js', 'controller.tabctrl.js',
    'controller.air.js', 'controller.nation.js', 'controller.nation.air.js', 'controller.kma.special.js']
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
