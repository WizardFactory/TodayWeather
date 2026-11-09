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
    // Temperature, precipitation, wind, pressure (hPa, press) and distance (vis, visibility) fields.
    zero: {set: 0, keys: ['t1h', 't3h', 'pop', 'rn1', 'r06', 's06', 'wsd', 'reh', 'tmn', 'tmx', 'hPa', 'press', 'vis', 'visibility'], onlyPresent: true},
    missing: {delete: true, keys: ['t1h', 't3h', 'pop', 'rn1', 'wsd', 'skyIcon', 'tmn', 'tmx', 'hPa', 'press', 'vis', 'visibility']},
    sentinel: {set: -50, keys: ['t1h', 't3h', 'tmn', 'tmx'], onlyPresent: true, also: {set: -1, keys: ['pop', 'reh', 'wsd', 'hPa', 'press', 'vis', 'visibility'], onlyPresent: true}},
    string: {stringify: true, keys: ['t1h', 't3h', 'pop', 'rn1', 'wsd', 'tmn', 'tmx', 'hPa', 'press', 'vis', 'visibility']},
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
    const air = (airUnit, aqiCode, width, labelWidth = 52) => {
        const $scope = tab(airUnit);
        const context = {
            $scope, console: quiet, Util: {ga: {trackException() {}}}, aqiCode,
            angular: {element: (el) => ({prop: () => el})},
            document: {getElementById: (id) => (id === 'aqistd' ? width : labelWidth)},
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
    // The gauge of a 384 dp screen (376 dp) with labels as wide as S05 draws them: empty (22), "40" (39), "151" (48) and
    // "0.008" (61), as captured from the Cordova build (air-reference).
    for (const airUnit of ['airkorea', 'airnow']) {
        for (const code of ['aqi', 'pm25', 'o3']) {
            for (const labelWidth of [22, 39, 48, 61]) {
                const {$scope} = air(airUnit, code, 376, labelWidth);
                const bp = standards[airUnit].value[code];
                for (let g = 1; g < bp.length; g++) {
                    for (const v of [bp[g - 1], (bp[g - 1] + bp[g]) / 2, bp[g]]) {
                        out.labelPosition.push({args: [airUnit, code, 376, g, v, labelWidth], expected: $scope.getLabelPosition(g, v)});
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
        // The device zone is also the zone in which new Date() reads a local-time string.
        process.env.TZ = timeZone;
        const context = {console: quiet, Util: {ga: {trackException() {}}}, Date: LocaleDate};
        vm.runInNewContext(extract('controller.kma.special.js', 'function parseSpecialData(') + '\nthis.parse = parseSpecialData;', context);
        out.push({args: [locale, timeZone], expected: clone(context.parse(input('special')))});
        const synthetic = [
            '2026-03-08T06:59:00.000Z', '2026-03-08T07:00:00.000Z', '2026-11-01T05:59:59.000Z', '2026-11-01T06:00:00.000Z',
            '2026-12-31T15:00:00.000Z', '2028-02-29T03:30:00.000Z', '2026-11-07T15:00:00Z', 1794067200000, null,
            'not a date', undefined,
            // ISO range rules of new Date(): rollover of day 29-31, 24:00 only at :00, offsets up to 23:59,
            // local time without an offset, and the time value limit.
            '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', '2026-04-31T00:00:00Z', '2026-11-07T24:00:00Z',
            '2026-11-07T24:00:01Z', '2026-11-07T25:00:00Z', '2026-11-07T23:60:00Z', '2026-11-07T23:59:60Z',
            '2026-11-07T10:00:00+24:00', '2026-11-07T10:00:00+23:59', '2026-11-07T10:00:00-09:30', '2026-00-07T00:00:00Z',
            '2026-11-00T00:00:00Z', '2026-11-07', '2026-11-07T10:00', '2026-11-07T10:00:00', '2026-11-07T10:00Z',
            '2026-11-07T10:00:00.1234Z', '+002026-11-07T10:00:00Z', 8640000000000001, -8640000000000001, // beyond the time value limit (far-future DST rules differ by platform)
        ].map((announcement, i) => ({...(announcement === undefined ? {} : {announcement}), comment: `line ${i}\nnext`}));
        out.push({args: [locale, timeZone, 'synthetic'], input: synthetic, expected: clone(context.parse(clone(synthetic)))});
        const failing = [{announcement: '2026-11-07T15:00:00.000Z', comment: 'a\nb'}, {announcement: '2026-11-07T16:00:00.000Z'},
            {announcement: '2026-11-07T17:00:00.000Z', comment: 'c\nd'}];
        out.push({args: [locale, timeZone, 'missing-comment'], input: failing, expected: clone(context.parse(clone(failing)))});
        delete process.env.TZ;
    }
    return out;
}

// Settings (S07, S08), the menu's hand-offs and About (O10), #2891: UnitsCtrl, SettingCtrl, radioList and RadioCtrl run
// with recorders for what they change (storage, the push list, events, each city's load time, navigation, the menu),
// and Util for the mail and store targets. The configuration is a placeholder: the real feedback address is a private
// build input. The trace of each step is what the native settings must do in the same order. Kotlin: SettingLists,
// Handoffs (core-domain), SettingsActions (core-data).
const SETTINGS_CONFIG = {package: 'todayWeather', mailTo: 'feedback@example.com',
    androidStoreUrl: 'market://details?id=net.wizardfactory.todayweather'};
const SETTINGS_UA = 'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64 Build/BP41.250916.012; wv) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36';
const KR_UNITS = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
const KR_SETTINGS = {startupPage: '0', refreshInterval: '0', theme: 'light'};

function settingsApp(lang, {units = KR_UNITS, settingsInfo = KR_SETTINGS, region = 'KR', cities = 3} = {}) {
    const tr = translations(lang);
    const trace = [];
    const reg = {};
    const mod = {factory(n, f) { reg[n] = f; return mod; }, controller(n, f) { reg[n] = f; return mod; }};
    const window = {location: {}, device: {uuid: 'device-uuid'}};
    const cordova = {InAppBrowser: {open: (url, target) => trace.push(['InAppBrowser.open', url, target])}};
    window.cordova = cordova;
    const ionic = {Platform: {isIOS: () => false, isAndroid: () => true, ua: SETTINGS_UA}};
    const context = {angular: {module: () => mod, noop() {}, element: () => ({hasClass: () => false})}, console: quiet,
        clientConfig: SETTINGS_CONFIG, window, cordova, ionic, document: {getElementsByClassName: () => []}};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'client/www/data/theme.js'), 'utf8'), context);
    for (const file of ['service.util.js', 'controller.units.js', 'controller.setting.radio.js', 'controller.settingctrl.js']) {
        vm.runInNewContext(fs.readFileSync(path.join(JS, file), 'utf8'), context);
    }
    const stored = {units: clone(units), settingsInfo: clone(settingsInfo)};
    const TwStorage = {get: (k) => clone(stored[k] ?? null), set: (k, v) => { stored[k] = clone(v); trace.push(['TwStorage.set', k, clone(v)]); }};
    const $translate = (keys) => ({
        then(ok) {
            ok(Array.isArray(keys) ? Object.fromEntries(keys.map((k) => [k, tr[k] ?? k])) : (tr[keys] ?? keys));
            return {finally(fn) { fn(); }};
        },
    });
    const Monetization = {init() {}, screen() {}, track() {}, setCollectionEnabled() {}, getCollectionChoice: () => false};
    const Util = reg.Util({}, Monetization);
    Object.assign(Util, {version: '2.0.0', region, language: lang, uuid: 'device-uuid'});
    const Units = reg.Units(TwStorage, Util);
    Units.loadUnits();
    trace.length = 0; // loadUnits saves repaired or default units; the steps start after the load
    const Push = {updateUnits() { trace.push(['Push.updateUnits', clone(Units.getAllUnits())]); }};
    const $rootScope = {settingsInfo: clone(settingsInfo), title: 'LOC_TODAYWEATHER', state: 'forecast',
        $broadcast: (name, sender) => trace.push(['$broadcast', name, sender ?? null])};
    const radioList = reg.radioList($rootScope, Units, TwStorage, Util, Push);
    const $location = {path: (p) => trace.push(['$location.path', p])};
    const $ionicSideMenuDelegate = {toggleLeft: () => trace.push(['toggleLeft']), isOpen: () => true};
    const $ionicHistory = {goBack: () => trace.push(['goBack'])};
    const $ionicPopup = {alert(options) { trace.push(['$ionicPopup.alert', clone(options)]); return {then() {}}; }};
    const WeatherInfo = {getCityCount: () => cities, reloadCity: (i) => trace.push(['WeatherInfo.reloadCity', i])};
    const scope = () => { const handlers = {}; return {$on: (n, f) => { handlers[n] = f; }, $emit(n) { handlers[n]?.(); }, $evalAsync: (f) => f()}; };
    const menu = scope();
    reg.SettingCtrl(menu, $rootScope, Util, $ionicHistory, $translate, $ionicSideMenuDelegate, $ionicPopup, $location, TwStorage, radioList, Monetization);
    return {
        trace, stored, Units, menu, window,
        unitsPage() {
            const $scope = scope();
            reg.UnitsCtrl($scope, $translate, $ionicHistory, Units, Util, Push, $location, radioList);
            $scope.$emit('$ionicView.enter');
            return $scope;
        },
        // The S08 page RadioCtrl shows for the list radioList holds.
        radioPage() {
            const $scope = scope();
            reg.RadioCtrl($rootScope, $scope, $ionicHistory, Util, radioList, WeatherInfo);
            return $scope;
        },
        text: (key) => (key === undefined || key === null ? '' : tr[key] ?? key),
    };
}

function settingsCases() {
    const take = (app) => app.trace.splice(0);
    const page = (app, $scope) => ({title: $scope.title, value: $scope.data.value,
        items: $scope.list.map((i) => ({label: i.label, value: i.value, ko: app.text(i.label)}))});
    const out = {config: SETTINGS_CONFIG, ua: SETTINGS_UA, version: '2.0.0', uuid: 'device-uuid', cities: 3};

    // S07 rows of each region's default units and of rarer values (the translate filter shows a missing key as itself).
    out.units = [];
    for (const [name, opts] of [['KR', {region: 'KR', units: null}], ['JP', {region: 'JP', units: null}], ['US', {region: 'US', units: null}],
        ['DE', {region: 'DE', units: null}], ['CN', {region: 'CN', units: null}], ['TW', {region: 'TW', units: null}], ['other', {region: 'FR', units: null}],
        ['beaufort-who', {units: {...KR_UNITS, windSpeedUnit: 'bft', pressureUnit: 'mb', airUnit: 'airkorea_who'}}],
        ['knots-aqicn', {units: {...KR_UNITS, windSpeedUnit: 'kt', distanceUnit: 'mi', precipitationUnit: 'in', airUnit: 'aqicn'}}],
        ['aircn', {units: {...KR_UNITS, airUnit: 'aircn'}}], ['partial', {units: {temperatureUnit: 'F'}}]]) {
        for (const lang of ['ko', 'en']) {
            const app = settingsApp(lang, opts);
            const $scope = app.unitsPage();
            out.units.push({name, lang, region: opts.region ?? 'KR', stored: opts.units, units: app.Units.getAllUnits(),
                rows: $scope.units.map((u) => ({name: u.name, nameKey: $scope.getUnitNameStr(u.name), valueKey: $scope.getUnitValueStr(u) ?? null,
                    name_text: app.text($scope.getUnitNameStr(u.name)), value_text: app.text($scope.getUnitValueStr(u))}))});
        }
    }

    // Opening each S08 list and choosing each other value, from KR defaults.
    out.lists = [];
    const UNIT_NAMES = ['temperatureUnit', 'windSpeedUnit', 'pressureUnit', 'distanceUnit', 'precipitationUnit', 'airUnit'];
    for (const name of [...UNIT_NAMES, 'startupPage', 'refreshInterval', 'theme']) {
        const open = (app) => {
            if (UNIT_NAMES.includes(name)) {
                const $scope = app.unitsPage();
                $scope.settingRadio($scope.units.find((u) => u.name === name));
            } else {
                app.menu.settingRadio(name);
            }
        };
        const first = settingsApp('ko');
        open(first);
        const opened = take(first);
        const shown = page(first, first.radioPage());
        const choices = shown.items.filter((i) => i.value !== shown.value).map((item) => {
            const app = settingsApp('ko');
            open(app);
            const $scope = app.radioPage();
            take(app);
            $scope.data.value = item.value;
            $scope.valueChanged($scope.list.find((i) => i.value === item.value));
            return {value: item.value, trace: take(app), stored: app.stored};
        });
        out.lists.push({name, opened, page: shown, en: page(settingsApp('en'), (() => { const a = settingsApp('en'); open(a); return a.radioPage(); })()), choices});
    }

    // The values the menu shows at the right of its rows, every value of each list and one it does not have.
    const labels = settingsApp('ko').menu;
    out.menuValues = {
        startupPage: ['0', '1', '2', '3', '4', '5', ''].map((v) => ({value: v, key: labels.getStartupPageValueStr(v)})),
        refreshInterval: ['0', '30', '60', '180', '360', '720', '15', ''].map((v) => ({value: v, key: labels.getRefreshIntervalValueStr(v)})),
        theme: ['photo', 'light', 'dark', 'old', 'blue', ''].map((v) => ({value: v, key: labels.getThemeValueStr(v)})),
    };

    // The menu's hand-offs and About, in Korean and English; the mail row sets window.location.href (Util.sendMail).
    out.menu = [];
    for (const lang of ['ko', 'en']) {
        for (const row of ['nullschool', 'sendMail', 'openMarket', 'openInfo']) {
            const app = settingsApp(lang);
            take(app);
            app.menu.clickMenu(row);
            out.menu.push({lang, row, trace: take(app), location: app.window.location.href ?? null});
        }
    }
    return out;
}

// Push registration after a start (gate G1, push part): the requests the real Push service sends for a
// first, an unchanged and a changed FCM token, including loadPushInfo's repair and 3 s repost.
const PUSH_CITIES = [
    {currentPosition: true, disable: false, name: '회현동', address: '대한민국 서울특별시 중구 회현동', source: 'KMA',
        location: {lat: 37.56, long: 126.98}},
    {currentPosition: false, disable: false, name: '명동', address: '대한민국 서울특별시 중구 명동', source: 'KMA',
        location: {lat: 37.56, long: 126.98}},
    {currentPosition: false, disable: false, name: 'London', address: 'United Kingdom London', country: 'GB', source: 'VC',
        location: {lat: 51.51, long: -0.13}},
];
const PUSH_LIST = [
    {cityIndex: 0, id: 1, startTime: '2026-11-07T22:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', enable: true, category: 'alert', name: 'stale'},
    {cityIndex: 1, id: 1, startTime: '2026-11-07T22:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', enable: true, category: 'alert',
        name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: {first: '서울특별시', second: '중구', third: '명동'}},
    {cityIndex: 1, id: 2, time: '2026-11-07T22:40:00.000Z', dayOfWeek: [false, true, true, true, true, true, false], enable: true,
        category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: {first: '서울특별시', second: '중구', third: '명동'}},
    {cityIndex: 2, id: 1, startTime: '2026-11-08T03:00:00.000Z', endTime: '2026-11-08T03:00:00.000Z', enable: false, category: 'alert',
        name: 'London', source: 'VC', location: {long: -0.13}},
    {cityIndex: 2, id: 2, time: '2026-11-07T21:00:00.000Z', dayOfWeek: [true, true, true, true, true, true, true], enable: false,
        category: 'alarm', name: 'London', source: 'VC', location: {lat: 51.51, long: -0.13}},
];

// Alerts whose start equals their end: the end moves one minute back in local time (setMinutes), which
// differs from 60 seconds across New York's daylight-saving changes: 01:00 EST becomes 00:59 EDT, 01:30 EST
// becomes the earlier 01:29 (EDT) and 03:00 EDT becomes the skipped 02:59, read with the earlier offset.
const DST_LIST = ['2026-11-01T06:00:00.000Z', '2026-11-01T06:30:00.000Z', '2026-11-01T05:00:00.000Z', '2026-03-08T07:00:00.000Z',
    '2026-03-08T07:30:00.000Z']
    .map((t, i) => ({cityIndex: 2, id: i + 1, startTime: t, endTime: t, enable: true, category: 'alert', name: 'London', source: 'VC',
        location: {lat: 51.51, long: -0.13}}));

function pushRequests(storedToken, newToken, airUnit, zone = 'Asia/Seoul', list = PUSH_LIST) {
    process.env.TZ = zone;
    let factory;
    const timers = [];
    const calls = [];
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }})}, console: quiet, window: {},
        clientConfig: {package: 'todayWeather', serverUrl: 'https://server'}, ionic: {Platform: {isAndroid: () => true, isIOS: () => false}},
        setTimeout: (fn) => timers.push(fn), Date: FixedDate,
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'service.push.js'), 'utf8'), context);
    const $http = (cfg) => { calls.push(clone({method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data})); return {success() { return this; }, error() { return this; }}; };
    const stored = {pushData2: {registrationId: null, type: 'android', category: '', fcmToken: storedToken, pushList: list}};
    const TwStorage = {get: (k) => clone(stored[k] ?? null), set() {}};
    const Util = {ga: {trackEvent() {}, trackException() {}}, uuid: 'device-uuid', language: 'ko-KR', version: '1.1.1'};
    const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit};
    const Units = {getAllUnits: () => clone(units)};
    const WeatherInfo = {getCityOfIndex: (i) => clone(PUSH_CITIES[i])};
    let tokenCallback;
    const Firebase = {init(t) { tokenCallback = t; }, inited: true};
    const push = factory($http, TwStorage, Util, loadWeatherUtil(units), WeatherInfo, Units, {$broadcast() {}}, Firebase);
    push.init();
    if (newToken) tokenCallback(undefined, newToken);
    timers.splice(0).forEach((fn) => fn());
    delete process.env.TZ;
    return calls;
}

// Push.updateUnits after a unit change on S08 (#1845, #2891): the list as loadPushInfo repaired it at the start, posted
// with the new units when there is a list and a token; nothing without either.
function pushUnitsRequests(storedToken, list, newUnits) {
    process.env.TZ = 'Asia/Seoul';
    let factory;
    const timers = [];
    const calls = [];
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }})}, console: quiet, window: {},
        clientConfig: {package: 'todayWeather', serverUrl: 'https://server'}, ionic: {Platform: {isAndroid: () => true, isIOS: () => false}},
        setTimeout: (fn) => timers.push(fn), Date: FixedDate,
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'service.push.js'), 'utf8'), context);
    const $http = (cfg) => { calls.push(clone({method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data})); return {success() { return this; }, error() { return this; }}; };
    const stored = {pushData2: {registrationId: null, type: 'android', category: '', fcmToken: storedToken, pushList: list}};
    const TwStorage = {get: (k) => clone(stored[k] ?? null), set() {}};
    const Util = {ga: {trackEvent() {}, trackException() {}}, uuid: 'device-uuid', language: 'ko-KR', version: '1.1.1'};
    let units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
    const Units = {getAllUnits: () => clone(units)};
    const WeatherInfo = {getCityOfIndex: (i) => clone(PUSH_CITIES[i])};
    const Firebase = {init() {}, inited: true};
    const push = factory($http, TwStorage, Util, loadWeatherUtil(units), WeatherInfo, Units, {$broadcast() {}}, Firebase);
    push.init();
    timers.splice(0).forEach((fn) => fn());
    calls.length = 0;
    units = {...units, ...newUnits};
    push.updateUnits();
    delete process.env.TZ;
    return calls;
}

// Push.updateCityInfo after a place changed (WeatherInfo.updateCity, AN-10): the records of the place take its simple
// info and, when anything changed, only those records are posted (with a token) and the list is saved. The service
// starts with PUSH_CITIES (loadPushInfo repairs the current position's records), then the places become [after].
function pushCityRequests(storedToken, list, after, index) {
    process.env.TZ = 'Asia/Seoul';
    let factory;
    const timers = [];
    const calls = [];
    let saved = null;
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }})}, console: quiet, window: {},
        clientConfig: {package: 'todayWeather', serverUrl: 'https://server'}, ionic: {Platform: {isAndroid: () => true, isIOS: () => false}},
        setTimeout: (fn) => timers.push(fn), Date: FixedDate,
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'service.push.js'), 'utf8'), context);
    const $http = (cfg) => { calls.push(clone({method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data})); return {success() { return this; }, error() { return this; }}; };
    const stored = {pushData2: {registrationId: null, type: 'android', category: '', fcmToken: storedToken, pushList: list}};
    const TwStorage = {get: (k) => clone(stored[k] ?? null), set(k, v) { if (k === 'pushData2') saved = clone(v); }};
    const Util = {ga: {trackEvent() {}, trackException() {}}, uuid: 'device-uuid', language: 'ko-KR', version: '1.1.1'};
    const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
    const Units = {getAllUnits: () => clone(units)};
    let cities = PUSH_CITIES;
    const WeatherInfo = {getCityOfIndex: (i) => clone(cities[i])};
    const Firebase = {init() {}, inited: true};
    const push = factory($http, TwStorage, Util, loadWeatherUtil(units), WeatherInfo, Units, {$broadcast() {}}, Firebase);
    push.init();
    timers.splice(0).forEach((fn) => fn());
    calls.length = 0;
    const before = clone(push.pushData.pushList);
    saved = null;
    cities = after;
    push.updateCityInfo(index);
    delete process.env.TZ;
    return {before, requests: calls, saved: saved && saved.pushList};
}

const MOVED = [{...PUSH_CITIES[0], name: '명동', address: '대한민국 서울특별시 중구 명동', location: {lat: 37.564, long: 126.986}}, ...PUSH_CITIES.slice(1)];
const RESOURCED = [PUSH_CITIES[0], {...PUSH_CITIES[1], source: 'DSF'}, PUSH_CITIES[2]];

function pushCases() {
    return {
        cities: PUSH_CITIES, pushList: PUSH_LIST, deviceId: 'device-uuid', language: 'ko-KR', appVersion: '1.1.1',
        now: FixedDate.now(), zone: 'Asia/Seoul',
        cases: [
            ['first-token', null, 'token-b', 'airkorea'], ['unchanged-token', 'token-a', 'token-a', 'airkorea'],
            ['changed-token', 'token-a', 'token-b', 'airkorea'], ['changed-token-airnow', 'token-a', 'token-b', 'airnow'],
            ['no-token', null, null, 'airkorea'],
        ].map(([name, storedToken, newToken, airUnit]) => ({name, storedToken, newToken, airUnit,
            requests: pushRequests(storedToken, newToken, airUnit)})).concat([
            {name: 'dst-new-york', storedToken: 'token-a', newToken: 'token-a', airUnit: 'airnow', zone: 'America/New_York',
                pushList: DST_LIST, requests: pushRequests('token-a', 'token-a', 'airnow', 'America/New_York', DST_LIST)},
        ]),
        unitsChanged: [
            ['fahrenheit', 'token-a', PUSH_LIST, {temperatureUnit: 'F'}],
            ['airnow', 'token-a', PUSH_LIST, {airUnit: 'airnow', windSpeedUnit: 'mph'}],
            ['no-token', null, PUSH_LIST, {temperatureUnit: 'F'}],
            ['no-list', 'token-a', [], {temperatureUnit: 'F'}],
        ].map(([name, storedToken, pushList, units]) => ({name, storedToken, pushList, units,
            requests: pushUnitsRequests(storedToken, pushList, units)})),
        cityChanged: [
            ['current-moved', 'token-a', MOVED, 0], ['current-unchanged', 'token-a', PUSH_CITIES, 0],
            ['source-changed', 'token-a', RESOURCED, 1], ['moved-no-token', null, MOVED, 0], ['no-records', 'token-a', MOVED, 0, []],
        ].map(([name, storedToken, cities, index, list = PUSH_LIST]) => ({name, storedToken, cities, index,
            ...pushCityRequests(storedToken, list, cities, index)})),
    };
}

// WeatherUtil.loadWeatherPhotos with a $http that answers with synthetic feeds (the feed URL is a private build
// input; the body is a JSON array, docs/rewrite/client-data-contracts.md), then findWeatherPhoto for every
// weather image name with Math.random fixed. Kotlin: WeatherPhotos.
function photoCases() {
    const photo = (id, tags) => ({id, ...(tags === undefined ? {} : {tags}), twUrls: {regular: `https://photos.test.invalid/${id}.jpg`}});
    const feed = [
        photo('sun-1', ['sun']), photo('sun-2', ['sun']), photo('sun-3', ['sun']),
        photo('sun-small-1', ['sun', 'smallcloud']), photo('sun-small-2', ['smallcloud', 'sun']),
        photo('sun-big-1', ['sun', 'bigcloud']),
        photo('moon-1', ['moon']), photo('moon-small-1', ['moon', 'smallcloud']), photo('moon-big-1', ['bigcloud', 'moon']),
        photo('cloud-1', ['cloud']), photo('cloud-2', ['cloud']),
        photo('rain-1', ['rain']), photo('rain-sun-1', ['sun', 'rain']), photo('snow-1', ['snow']),
        photo('lightning-1', ['rain', 'lightning']),
        photo('null-tag-1', [null, 'sun']), photo('fog-1', ['fog']),
        photo('string-tags-1', 'sun'), photo('no-tags-1', undefined), 7,
    ];
    // A null item throws in the grouping loop: the items after it stay out of the groups.
    const broken = [photo('cloud-1', ['cloud']), null, photo('sun-1', ['sun'])];
    let factory;
    const random = {value: 0};
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }}), isArray: Array.isArray},
        console: quiet, clientConfig: {debug: false, weatherPhotosUrl: 'https://photos.test.invalid/list.json'}, window: {},
        setTimeout: () => 0, clearTimeout() {}, random,
    };
    vm.runInNewContext('Math.random = function () { return random.value; };\n' +
        fs.readFileSync(path.join(JS, 'service.weatherutil.js'), 'utf8'), context);
    // A $q whose promises settle at once; the feed request answers without a network.
    const $q = {defer() {
        let state = null, value;
        const waiting = [];
        const settle = (s, v) => {
            if (state) return;
            state = s; value = v;
            waiting.splice(0).forEach(([ok, err]) => (s === 'ok' ? ok : err)?.(v));
        };
        return {resolve: (v) => settle('ok', v), reject: (e) => settle('err', e), promise: {then(ok, err) {
            if (state) (state === 'ok' ? ok : err)?.(value); else waiting.push([ok, err]);
            return this;
        }}};
    }};
    const requests = [];
    let body;
    const $http = (options) => {
        requests.push(options);
        return {success(fn) { fn(clone(body), 200); return {error() {}}; }};
    };
    const util = factory($q, $http, {ga: {trackEvent() {}, trackException() {}}}, {getUnit() {}}, {track() {}});
    const load = (value) => {
        body = value;
        delete context.window.weatherPhotos;
        try { util.loadWeatherPhotos(); } catch (e) { /* a broken item ends the grouping, as on the device */ }
        return Object.fromEntries(Object.entries(context.window.weatherPhotos).map(([k, v]) => [k, v.map((p) => p.id)]));
    };
    const brokenGroups = load(broken);
    const groups = load(feed);
    const icons = fs.readdirSync(path.join(ROOT, 'client/www/img/weather_default')).filter((f) => f.endsWith('.png'))
        .map((f) => f.slice(0, -4)).sort();
    const cases = [];
    for (const skyIcon of [...icons, '', null]) {
        for (const r of [0, 0.5, 0.999]) {
            random.value = r;
            cases.push({skyIcon, random: r, photo: util.findWeatherPhoto(skyIcon === null ? {} : {skyIcon})});
        }
    }
    return {request: {url: requests[0].url, timeout: requests[0].timeout}, feeds: [{name: 'feed', feed, groups},
        {name: 'null-item', feed: broken, groups: brokenGroups}], cases};
}

// WeatherUtil.getWeatherByGeoInfo with a recording $http: the URL each place and unit setting requests, or the
// rejection for a place without coordinates or address. Kotlin: WeatherRequests.url.
function requestCases() {
    let factory;
    const context = {
        angular: {module: () => ({factory: (_, fn) => { factory = fn; }}), isArray: Array.isArray},
        console: quiet, clientConfig: {debug: false, serverUrl: 'https://server.test.invalid'}, window: {},
        setTimeout: () => 0, clearTimeout() {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'service.weatherutil.js'), 'utf8'), context);
    const settle = () => {
        let state = null, value;
        const waiting = [];
        const done = (s, v) => { if (state) return; state = s; value = v; waiting.splice(0).forEach(([ok, err]) => (s === 'ok' ? ok : err)?.(v)); };
        const promise = {then(ok, err) {
            const next = settle();
            const run = (s, v) => {
                try {
                    const f = s === 'ok' ? ok : err;
                    if (f) next.resolve(f(v)); else (s === 'ok' ? next.resolve : next.reject)(v);
                } catch (e) { next.reject(e); }
            };
            if (state) run(state, value); else waiting.push([(v) => run('ok', v), (v) => run('err', v)]);
            return next.promise;
        }};
        return {resolve: (v) => done('ok', v), reject: (e) => done('err', e), promise};
    };
    const $q = {defer: settle, reject: (e) => { const d = settle(); d.reject(e); return d.promise; },
        all: (list) => { const d = settle(); const out = []; let left = list.length;
            list.forEach((p, i) => p.then((v) => { out[i] = v; if (--left === 0) d.resolve(out); }, d.reject)); return d.promise; }};
    let requested = [];
    const $http = (options) => {
        requested.push(options);
        return {success(fn) { fn({}, 200); return {error() {}}; }};
    };
    let units;
    const util = factory($q, $http, {ga: {trackEvent() {}, trackException() {}}}, {getAllUnits: () => units, getUnit: (k) => units[k]},
        {track() {}});
    const KR = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
    const US = {temperatureUnit: 'F', windSpeedUnit: 'mph', pressureUnit: 'inHg', distanceUnit: 'mi', precipitationUnit: 'in', airUnit: 'airnow'};
    const DE = {temperatureUnit: 'C', windSpeedUnit: 'km/h', pressureUnit: 'mb', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'aqicn'};
    const CASES = [
        ['seoul', {location: {lat: 37.5665, long: 126.978}}, KR],
        ['london-us-units', {location: {lat: 51.51, long: -0.13}}, US],
        ['whole-degrees', {location: {lat: 37, long: 127}}, DE],
        ['small-fraction', {location: {lat: 0.0005, long: -0.25}}, KR],
        ['latitude-zero-uses-address', {location: {lat: 0, long: 126.9}, address: '대한민국 서울특별시 중구 명동'}, KR],
        ['address-four-parts', {address: '대한민국 서울특별시 중구 명동'}, KR],
        ['address-without-country', {address: '서울특별시 중구 명동'}, KR],
        ['address-gu', {address: '대한민국 경기도 성남시 분당구'}, KR],
        ['address-five-parts', {address: '대한민국 경기도 성남시 분당구 정자동'}, KR],
        ['address-eup', {address: '대한민국 세종특별자치시 조치원읍'}, KR],
        ['address-region-only', {address: '대한민국 서울특별시'}, KR],
        ['address-free-form', {address: 'United Kingdom London Westminster Abbey Road'}, KR],
        ['address-country-only', {address: '대한민국'}, KR],
        ['no-location-or-address', {}, KR],
        ['empty-address', {address: ''}, KR],
    ];
    return CASES.map(([name, geoInfo, u]) => {
        units = u;
        requested = [];
        let error = null;
        util.getWeatherByGeoInfo(clone(geoInfo)).then(() => {}, (e) => { error = e && e.message ? 'rejected' : String(e); });
        return {name, geoInfo, units: u, ...(requested.length ? {url: requested[0].url, timeout: requested[0].timeout} : {}), ...(error ? {error} : {})};
    });
}

// ForecastCtrl, the controller of S03 ("short", /tab/forecast) and S04 ("mid", /tab/dailyforecast), for one visit of a
// page: the whole controller runs with TabCtrl's initSize, the real WeatherUtil and a WeatherInfo holding the visit's
// places; the first place is applied when the page opens and each later one as a swipe applies it (applyEvent). After
// each apply the case records the scope values the templates read, so values left over from an earlier place (an
// early return, a field assigned only when truthy) are part of the record. A place's record is what the native data
// layer shows (core-data cityRecord): the converted response's truthy weather fields and the saved place's own fields,
// with the case's mutations applied to it. Kotlin: ForecastScope.
const PLACE_WEATHER_FIELDS = ['currentWeather', 'timeTable', 'timeChart', 'dayTable', 'dayChart', 'source', 'airInfo', 'airInfoList'];

function cityRecord(util, place) {
    const converted = util.convertWeatherData([{data: input(place.fixture)}]);
    const city = {};
    PLACE_WEATHER_FIELDS.forEach((f) => { if (converted[f]) city[f] = converted[f]; });
    ['name', 'address', 'country', 'location'].forEach((k) => { if (place.place[k] != null) city[k] = clone(place.place[k]); });
    city.currentPosition = !!place.place.currentPosition;
    if (place.place.photo != null) city.photo = place.place.photo;
    (place.mutations || []).forEach((m) => {
        const parent = m.path.slice(0, -1).reduce((o, k) => o[k], city);
        const key = m.path[m.path.length - 1];
        if (m.op === 'delete') delete parent[key];
        else if (m.op === 'set') parent[key] = clone(m.value);
        else throw new Error(`unknown mutation ${m.op}`);
    });
    return city;
}

function forecastVisit(util, visit) {
    const tr = translations(visit.lang);
    const units = visit.units;
    const handlers = {};
    const $scope = {$on: (name, fn) => { handlers[name] = fn; }, startPopup() { $scope.startPopupCalled = true; }};
    const cities = visit.places.map((p) => cityRecord(util, p));
    let index = 0;
    const WeatherInfo = {
        getCityIndex: () => index, setCityIndex(i) { index = i; }, getCityOfIndex: (i) => (i in cities ? cities[i] : null),
        getEnabledCityCount: () => cities.filter((c) => !c.disable).length, reloadCity() {},
    };
    let controller;
    const context = {
        angular: {module: () => ({controller: (_, fn) => { controller = fn; }}), element: () => ({css() {}})},
        console: quiet, sprintf, clientConfig: {package: 'todayWeather'}, window: {screen: {width: visit.width, height: visit.height}},
        document: {querySelector: () => null, getElementById: () => null}, ionic: {Platform: {isIOS: () => false, isAndroid: () => true}},
        setTimeout: () => 0, $scope,
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'controller.forecastctrl.js'), 'utf8'), context);
    vm.runInContext('$scope.initSize = ' + extract('controller.tabctrl.js', '$scope.initSize = function'), context);
    const $translate = (keys) => ({
        then(ok) {
            ok(Object.fromEntries(keys.map((k) => [k, tr[k]])));
            return {finally(fn) { fn(); }};
        },
    });
    const snapshot = () => {
        const s = $scope;
        const of = (value) => (value === undefined ? undefined : cities.findIndex((c) => PLACE_WEATHER_FIELDS.some((f) => c[f] === value) ||
            (c.dayChart && c.dayChart === value)));
        const record = {
            address: s.address, currentPosition: s.currentPosition, hasPush: s.hasPush, source: s.source, photo: s.photo,
            cityCount: s.cityCount, timeWidth: s.timeWidth, dayWidth: s.dayWidth,
            currentWeatherOf: of(s.currentWeather), timeTableOf: of(s.timeTable), timeChartOf: of(s.timeChart), dayChartOf: of(s.dayChart),
            hourlyAqiForecast: s.hourlyAqiForecast, dailyAqiForecast: s.dailyAqiForecast,
            airForecastPubdate: s.airForecastPubdate, airForecastSource: s.airForecastSource, updateTime: s.updateTime,
            chartShortHeight: s.chartShortHeight, chartShortDetailHeight: s.chartShortDetailHeight, chartMidHeight: s.chartMidHeight,
            showDetailWeather: s.showDetailWeather, summary: s.summary, hasSummaryAir: 'summaryAir' in s, summaryAir: s.summaryAir,
            diffTempStr: s.diffTempStr, headerHeight: s.headerHeight, bigFontSize: s.bigFontSize, bigImageSize: s.bigImageSize,
            smallImageSize: s.smallImageSize, expand: s.expand,
            temp: s.currentWeather ? s.getTemp(s.currentWeather.t1h) : undefined,
            feelsLike: s.currentWeather ? s.getTemp(s.currentWeather.sensorytem) : undefined,
            showHourlyAqiForecast: s.showHourlyAqiForecast(),
        };
        if (visit.type === 'mid') {
            record.hasDustForecast = s.hasDustForecast();
            record.dailyDetail = s.dayChart && s.dayChart[0] ? s.dayChart[0].values.map((d) => s.checkDailyDetailWeather(d)) : undefined;
            record.threeDays = {pop: s.hasPropertyInThreeDays(['pop']), ultrvGrade: s.hasPropertyInThreeDays(['ultrvGrade']),
                rain: s.hasPropertyInThreeDays(['pty', 'rn1', 'r06', 's06'])};
        }
        return clone(record);
    };
    controller($scope, WeatherInfo, util, {ga: {trackEvent() {}, trackException() {}}}, {}, {settingsInfo: {theme: visit.theme}},
        {path: () => (visit.type === 'mid' ? '/tab/dailyforecast' : '/tab/forecast')}, {clearHistory() {}}, $translate,
        {getUnit: (k) => units[k]}, {hasPushInfo: (i) => visit.places[i].hasPush === true},
        {get: () => visit.expandShortChart ?? null, set() {}});
    const applied = [snapshot()];
    for (let i = 1; i < cities.length; i++) {
        index = i;
        handlers.applyEvent({}, 'swipe');
        applied.push(snapshot());
    }
    return {name: visit.name, type: visit.type, lang: visit.lang, theme: visit.theme, width: visit.width, height: visit.height,
        units, expandShortChart: visit.expandShortChart ?? null, places: visit.places, applied};
}

function forecastCases(util) {
    const KR = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
    const F = {...KR, temperatureUnit: 'F'};
    const US = {temperatureUnit: 'F', windSpeedUnit: 'mph', pressureUnit: 'inHg', distanceUnit: 'mi', precipitationUnit: 'in', airUnit: 'airnow'};
    const seoul = {fixture: 'kma-seoul', place: {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR',
        location: {lat: 37.56, long: 126.98}, photo: 'seoul.jpg'}};
    const london = {fixture: 'vc-london', place: {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13}}};
    const at = (place, extra) => ({...place, ...extra, place: {...place.place, ...(extra.place || {})}});
    const hourly = input('kma-seoul').airInfoList[0].pollutants.aqi.hourly;
    const daily = input('kma-seoul').airInfoList[0].pollutants.aqi.daily;
    const sixDays = [0, 1, 2, 3, 4, 5].map((i) => ({...daily[i % daily.length], date: `2026-11-${String(8 + i).padStart(2, '0')}`,
        fromToday: i, dayOfWeek: i % 7}));
    const air = ['airInfoList', 0, 'pollutants', 'aqi'];
    const visits = [
        {name: 'seoul', places: [seoul]},
        {name: 'london', places: [london]},
        {name: 'seoul-then-london', theme: 'photo', places: [seoul, london, seoul]},
        // ForecastCtrl assigns source only when truthy: London without its source keeps the previous attribution.
        {name: 'london-then-no-source', places: [london, at(london, {mutations: [{op: 'delete', path: ['source']}]})]},
        {name: 'seoul-fahrenheit', units: F, places: [at(seoul, {fixture: 'kma-seoul-f'})]},
        {name: 'london-fahrenheit', units: F, places: [at(london, {fixture: 'vc-london-f'})]},
        {name: 'seoul-english', lang: 'en', places: [at(seoul, {fixture: 'kma-seoul-en'})]},
        {name: 'seoul-imperial', lang: 'en', units: US, places: [at(seoul, {fixture: 'kma-seoul-imperial'})]},
        {name: 'seoul-aqicn', units: {...KR, airUnit: 'aqicn', windSpeedUnit: 'kt', pressureUnit: 'mmHg'}, places: [at(seoul, {fixture: 'kma-seoul-aqicn'})]},
        {name: 'seoul-who', units: {...KR, airUnit: 'airkorea_who', windSpeedUnit: 'bft', pressureUnit: 'mb'}, places: [at(seoul, {fixture: 'kma-seoul-who'})]},
        {name: 'tokyo', units: {...KR, windSpeedUnit: 'km/h', airUnit: 'airnow'}, places: [{fixture: 'vc-tokyo', place: {name: '도쿄', address: '일본 도쿄', country: 'JP', location: {lat: 35.68, long: 139.69}}}]},
        {name: 'newyork-sydney', places: [{fixture: 'vc-newyork', place: {name: '뉴욕', address: '미국 뉴욕', country: 'US', location: {lat: 40.71, long: -74.01}}},
            {fixture: 'vc-sydney', place: {name: '시드니', address: '호주 시드니', country: 'AU', location: {lat: -33.87, long: 151.21}}}]},
        {name: 'jeju-current-position', places: [{fixture: 'kma-jeju', hasPush: true, place: {address: '대한민국 제주특별자치도 제주시 연동', currentPosition: true, location: {lat: 33.5, long: 126.53}}}]},
        {name: 'address-title', places: [at(seoul, {place: {name: null, address: '대한민국 경기도 성남시 분당구 정자동'}})]},
        {name: 'one-hourly-aqi', places: [at(seoul, {mutations: [{op: 'set', path: [...air, 'hourly'],
            value: hourly.filter((h) => h.date >= '2026-11-08 00:00').slice(0, 1).concat(hourly.filter((h) => h.date < '2026-11-08 00:00').slice(-3))}]})]},
        {name: 'air-last-missing', places: [at(seoul, {mutations: [{op: 'delete', path: ['airInfoList', 0, 'last']}]})]},
        {name: 'no-air', places: [at(seoul, {mutations: [{op: 'delete', path: ['airInfoList']}, {op: 'delete', path: ['currentWeather', 'arpltn']}]})]},
        {name: 'six-daily-aqi', places: [at(seoul, {mutations: [{op: 'set', path: [...air, 'daily'], value: sixDays}]})]},
        {name: 'six-daily-aqi-narrow', width: 320, height: 568, places: [at(seoul, {mutations: [{op: 'set', path: [...air, 'daily'], value: sixDays}]})]},
        {name: 'tablet', width: 800, height: 1280, places: [seoul, london]},
        {name: 'short-phone', width: 360, height: 592, places: [seoul]},
        {name: 'summary-weather-missing', places: [at(seoul, {mutations: [{op: 'delete', path: ['currentWeather', 'summaryWeather']},
            {op: 'delete', path: ['currentWeather', 'summaryAir']}]})]},
        {name: 'yesterday-missing', places: [at(seoul, {mutations: [{op: 'delete', path: ['currentWeather', 'yesterday']}]})]},
        {name: 'same-as-yesterday', places: [at(seoul, {mutations: [{op: 'set', path: ['currentWeather', 't1h'], value: 5.6},
            {op: 'set', path: ['currentWeather', 'yesterday', 't1h'], value: 5.6}]})]},
        // An early return keeps everything of the previous place; a missing current weather stops after showDetailWeather.
        {name: 'no-day-chart', places: [seoul, at(london, {mutations: [{op: 'delete', path: ['dayChart']}]})]},
        {name: 'no-current-weather', places: [seoul, at(london, {mutations: [{op: 'delete', path: ['currentWeather']}]})]},
        {name: 'no-time-chart', places: [seoul, at(london, {mutations: [{op: 'delete', path: ['timeChart']}]})]},
        {name: 'no-places', places: []},
        {name: 'expanded', expandShortChart: true, places: [seoul]},
    ];
    const cases = [];
    for (const v of visits) {
        for (const type of ['short', 'mid']) {
            cases.push(forecastVisit(util, {lang: 'ko', theme: 'light', width: 384, height: 832, units: KR, ...v, type,
                places: v.places.map((p) => ({hasPush: false, ...p}))}));
        }
    }
    return cases;
}

// AirCtrl, the controller of S05 (/tab/air), for one visit of the page: the whole controller runs with TabCtrl's
// initSize, setAirUnit, grade2Color and getSentimentIcon, the real WeatherUtil and a WeatherInfo holding the visit's
// places. The page opens with the visit's code (the link's `?code=`) on its selected place; then each action runs as on
// the page: ['apply', i] selects place i and fires applyEvent (a swipe or a load: back to the first station),
// ['code', c] taps a detail cell (setMainAqiCode) and ['station', i] a station (setStation). After the opening and each
// action the case records the scope values the template reads, so values an apply did not reach (it stops at the first
// error) keep what an earlier place set. The device zone is the visit's (Asia/Seoul unless given): the hourly chart
// dates a missing slot in it. Kotlin: AirScope.
function airVisit(util, visit) {
    process.env.TZ = visit.zone;
    const units = visit.units;
    const handlers = {};
    let scrolls = 0;
    const $scope = {$on: (name, fn) => { handlers[name] = fn; }};
    const cities = visit.places.map((p) => cityRecord(util, p));
    let index = visit.index ?? 0;
    const WeatherInfo = {
        getCityIndex: () => index, setCityIndex(i) { index = i; }, getCityOfIndex: (i) => (i in cities ? cities[i] : null),
        getEnabledCityCount: () => cities.length,
    };
    let controller;
    const context = {
        angular: {module: () => ({controller: (_, fn) => { controller = fn; }}), element: (el) => ({prop: () => el})},
        console: quiet, clientConfig: {package: 'todayWeather'}, window: {screen: {width: visit.width, height: visit.height}},
        document: {getElementById: () => 0}, ionic: {Platform: {isIOS: () => false, isAndroid: () => true}}, $scope,
        Units: {getUnit: (k) => units[k]}, Util: {ga: {trackEvent() {}, trackException() {}}}, $sce: {trustAsHtml: (v) => v},
        aqiStandard: util.aqiStandard, airUnit: undefined,
    };
    vm.runInNewContext(fs.readFileSync(path.join(JS, 'controller.air.js'), 'utf8'), context);
    vm.runInContext([
        '$scope.initSize = ' + extract('controller.tabctrl.js', '$scope.initSize = function'),
        extract('controller.tabctrl.js', 'function setAirUnit('),
        '$scope.getSentimentIcon = ' + extract('controller.tabctrl.js', '$scope.getSentimentIcon = function'),
        '$scope.grade2Color = ' + extract('controller.tabctrl.js', '$scope.grade2Color = function'),
        'setAirUnit();',
    ].join('\n'), context);
    // Where an object the scope holds comes from: "<place>/airInfoList/<i>/last", "<place>/airInfo/last" or
    // "<place>/currentWeather/arpltn" (the observation), "<place>/currentWeather".
    const of = (value) => {
        if (value === undefined) return undefined;
        for (let p = 0; p < cities.length; p++) {
            const c = cities[p];
            if (c.currentWeather === value) return `${p}/currentWeather`;
            if (c.currentWeather && c.currentWeather.arpltn === value) return `${p}/currentWeather/arpltn`;
            if (c.airInfo && c.airInfo.last === value) return `${p}/airInfo/last`;
            const list = Array.isArray(c.airInfoList) ? c.airInfoList : [];
            for (let i = 0; i < list.length; i++) if (list[i] && list[i].last === value) return `${p}/airInfoList/${i}/last`;
        }
        return 'other';
    };
    const snapshot = (after) => {
        const s = $scope;
        const cell = (o) => o && {...o, face: s.getSentimentIcon(o.grade), color: s.grade2Color(o.grade)};
        return clone({
            after, address: s.address, currentPosition: s.currentPosition, hasPush: s.hasPush, cityCount: s.cityCount,
            aqiCode: s.aqiCode, airCodeName: s.airCodeName, mainName: s.mainName, stnIndex: s.stnIndex,
            airInfoOf: of(s.airInfo), currentWeatherOf: of(s.currentWeather),
            airCodeGrade: s.airCodeGrade, airCodeValue: s.airCodeValue, airCodeStr: s.airCodeStr, mainInfo: s.mainInfo,
            airCodeActionGuide: s.airCodeActionGuide, unit: s.getAirCodeUnit(s.aqiCode),
            mainColor: s.grade2Color(s.airCodeGrade), labelColor: s.grade2Color(s.airCodeGrade, 'white'), face: s.getSentimentIcon(s.airCodeGrade),
            forecastPubdate: s.forecastPubdate, forecastSource: s.forecastSource,
            aqiList: s.aqiList && s.aqiList.map(cell), stnList: s.stnList && s.stnList.map(cell),
            dayForecast: s.dayForecast && s.dayForecast.map((d) => ({...d, face: s.getSentimentIcon(d.grade), color: s.grade2Color(d.grade, 'white')})),
            airChart: s.airChart && {maxValue: s.airChart.maxValue, data: Array.from(s.airChart.data, (d) => (d === undefined ? null : d))},
            hourlyChartTitle: s.hourlyChartTitle, chartAirHeight: s.chartAirHeight, scrolls,
            bodyWidth: s.bodyWidth, headerHeight: s.headerHeight, bigFontSize: s.bigFontSize,
        });
    };
    controller($scope, {code: visit.code}, {trustAsHtml: (v) => v}, WeatherInfo, util, {getUnit: (k) => units[k]},
        {ga: {trackEvent() {}, trackException() {}}}, {scrollTop() { scrolls++; }}, {clearHistory() {}},
        {hasPushInfo: (i) => visit.places[i].hasPush === true}, {path() {}});
    const applied = [snapshot('open')];
    for (const [action, arg] of visit.actions || []) {
        if (action === 'apply') { index = arg; handlers.applyEvent({}, 'swipe'); }
        else if (action === 'code') $scope.setMainAqiCode(arg);
        else if (action === 'station') $scope.setStation(arg);
        else throw new Error(`unknown action ${action}`);
        applied.push(snapshot(`${action} ${arg}`));
    }
    delete process.env.TZ;
    return {name: visit.name, width: visit.width, height: visit.height, zone: visit.zone, units, code: visit.code ?? null,
        index: visit.index ?? 0, places: visit.places, actions: visit.actions || [], applied};
}

function airVisitCases(util) {
    const KR = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea'};
    const US = {temperatureUnit: 'F', windSpeedUnit: 'mph', pressureUnit: 'inHg', distanceUnit: 'mi', precipitationUnit: 'in', airUnit: 'airnow'};
    const seoul = {fixture: 'kma-seoul', place: {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}}};
    const london = {fixture: 'vc-london', place: {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13}}};
    const tokyo = {fixture: 'vc-tokyo', place: {name: '도쿄', address: '일본 도쿄', country: 'JP', location: {lat: 35.68, long: 139.69}}};
    const jeju = {fixture: 'kma-jeju', place: {name: '연동', address: '대한민국 제주특별자치도 제주시 연동', country: 'KR', location: {lat: 33.5, long: 126.53}}};
    const at = (place, extra) => ({...place, ...extra, place: {...place.place, ...(extra.place || {})}});
    const noAir = at(jeju, {mutations: [{op: 'delete', path: ['airInfoList']}, {op: 'delete', path: ['currentWeather', 'arpltn']}]});
    const observationOnly = at(jeju, {mutations: [{op: 'delete', path: ['airInfoList']}]});
    const station = ['airInfoList', 0];
    const daily = input('kma-seoul').airInfoList[0].pollutants.aqi.daily;
    const sixDays = [0, 1, 2, 3, 4, 5].map((i) => ({...daily[i % daily.length], date: `2026-11-${String(8 + i).padStart(2, '0')}`,
        fromToday: i, dayOfWeek: i % 7}));
    // A series that ends at the end of November: the eleven slots after it are dated on 1 December.
    const monthEnd = Array.from({length: 13}, (_, i) => ({date: `2026-11-30 ${String(11 + i).padStart(2, '0')}:00`, val: 30 + i, grade: 1, str: '좋음'}));
    // Only the current hour on the day New York's clocks go forward: the twelve hours before it are dated by moving the
    // clock back, and 02:00, which that day skips, becomes 03:00 (twice).
    const springForward = [{date: '2026-03-08 12:00', val: 40, grade: 1, str: '좋음'}];
    const allCodes = [['code', 'pm25'], ['code', 'pm10'], ['code', 'o3'], ['code', 'no2'], ['code', 'co'], ['code', 'so2'], ['code', 'aqi']];
    const visits = [
        {name: 'seoul', places: [seoul], actions: [['station', 1], ['station', 2], ['code', 'pm25'], ['station', 1], ...allCodes, ['apply', 0]]},
        {name: 'seoul-link-pm25', code: 'pm25', places: [seoul]},
        {name: 'seoul-link-o3', code: 'o3', places: [seoul], actions: [['station', 2]]},
        {name: 'seoul-link-khai', code: 'khai', places: [seoul]},
        {name: 'seoul-link-unknown', code: 'xyz', places: [seoul]},
        {name: 'london', places: [london], actions: allCodes},
        {name: 'tokyo-airnow', units: {...KR, airUnit: 'airnow'}, places: [tokyo], actions: allCodes},
        {name: 'seoul-aqicn', units: {...KR, airUnit: 'aqicn'}, places: [at(seoul, {fixture: 'kma-seoul-aqicn'})], actions: [...allCodes, ['station', 2]]},
        {name: 'seoul-who', units: {...KR, airUnit: 'airkorea_who'}, places: [at(seoul, {fixture: 'kma-seoul-who'})], actions: allCodes},
        {name: 'seoul-airnow', units: US, places: [at(seoul, {fixture: 'kma-seoul-imperial'})], actions: allCodes},
        {name: 'jeju', places: [jeju], actions: [['station', 1], ['code', 'pm10']]},
        // A swipe or a load returns to the first station; the pollutant stays.
        {name: 'seoul-london-seoul', places: [seoul, london], actions: [['code', 'pm25'], ['station', 2], ['apply', 1], ['apply', 0]]},
        // The apply stops at the missing observation: everything but the title stays from the previous place.
        {name: 'seoul-then-no-air', places: [seoul, noAir], actions: [['station', 1], ['apply', 1], ['apply', 0]]},
        // The forecast rows are assigned only for a place with air keys (A16).
        {name: 'seoul-then-observation-only', places: [seoul, observationOnly], actions: [['apply', 1]]},
        {name: 'london-then-observation-only', places: [london, observationOnly], actions: [['apply', 1]]},
        {name: 'no-air', places: [noAir]},
        {name: 'observation-only', places: [observationOnly], actions: [['code', 'pm25']]},
        {name: 'empty-air-list', places: [at(seoul, {mutations: [{op: 'set', path: ['airInfoList'], value: []}]})]},
        {name: 'pollutant-fallback', code: 'pm25', places: [at(seoul, {mutations: [{op: 'set', path: [...station, 'last', 'pm25Value'], value: null},
            {op: 'delete', path: [...station, 'pollutants', 'pm25']}]})]},
        {name: 'pollutant-value-missing', code: 'pm25', places: [at(seoul, {mutations: [{op: 'delete', path: [...station, 'last', 'pm25Value']}]})]},
        {name: 'station-value-zero', code: 'pm25', places: [at(seoul, {mutations: [{op: 'set', path: ['airInfoList', 2, 'last', 'pm25Value'], value: 0},
            {op: 'set', path: [...station, 'last', 'pm25Value'], value: 0}]})], actions: [['station', 2]]},
        {name: 'no-current-hour', places: [at(seoul, {mutations: [{op: 'set', path: [...station, 'last', 'dataTime'], value: '2026-11-10 00:00'}]})]},
        {name: 'station-without-last', places: [at(seoul, {mutations: [{op: 'delete', path: ['airInfoList', 1, 'last']}]})], actions: [['station', 1], ['station', 0]]},
        {name: 'station-out-of-range', places: [seoul], actions: [['station', 5]]},
        {name: 'month-end', places: [at(seoul, {mutations: [{op: 'set', path: [...station, 'pollutants', 'aqi', 'hourly'], value: monthEnd},
            {op: 'set', path: [...station, 'last', 'dataTime'], value: '2026-11-30 23:00'}]})]},
        {name: 'spring-forward-new-york', zone: 'America/New_York', places: [at(seoul, {mutations: [
            {op: 'set', path: [...station, 'pollutants', 'aqi', 'hourly'], value: springForward},
            {op: 'set', path: [...station, 'last', 'dataTime'], value: '2026-03-08 12:00'}]})]},
        {name: 'six-days', places: [at(seoul, {mutations: [{op: 'set', path: [...station, 'pollutants', 'aqi', 'daily'], value: sixDays}]})]},
        {name: 'six-days-narrow', width: 320, height: 568, places: [at(seoul, {mutations: [{op: 'set', path: [...station, 'pollutants', 'aqi', 'daily'], value: sixDays}]})]},
        {name: 'tablet', width: 800, height: 1280, places: [seoul]},
        {name: 'current-position', places: [{...jeju, hasPush: true, place: {address: jeju.place.address, currentPosition: true, location: jeju.place.location}}]},
        {name: 'unknown-standard', units: {...KR, airUnit: 'unknown'}, places: [seoul]},
        {name: 'no-places', places: []},
    ];
    return visits.map((v) => airVisit(util, {width: 384, height: 832, units: KR, zone: 'Asia/Seoul', ...v,
        places: v.places.map((p) => ({hasPush: false, ...p}))}));
}

// TabCtrl's template helpers of S03/S04 and the pollen popup rows (showPollenInfo with a recording $ionicPopup).
function forecastHelperCases() {
    const units = {airUnit: 'airkorea'};
    const $scope = {};
    let popup = null;
    const context = {
        $scope, console: quiet, Units: {getUnit: (k) => units[k], getAirUnitStr: null},
        $translate: {instant: (k) => k}, $ionicPopup: {alert: (o) => { popup = o; return {finally(fn) { fn(); }}; }},
    };
    $scope.$new = () => ({$destroy() {}});
    const code = ['dayToFullString', 'getDayString', 'dayToString', 'convertMMDD', 'convertDD', 'getCurrentAirUnitStr', 'showPollenInfo']
        .map((f) => `$scope.${f} = ` + extract('controller.tabctrl.js', `$scope.${f} = function`))
        .concat(['Units.getAirUnitStr = ' + extract('controller.units.js', 'obj.getAirUnitStr = function')]).join('\n');
    vm.runInNewContext(code, context);
    const days = [-4, -3, -2, -1, 0, 1, 2, 3, 4, '0', '-1', null, 1.5];
    const out = {
        getDayString: days.concat([undefined]).map((d) => ({args: [d ?? null], undefinedArg: d === undefined, expected: $scope.getDayString(d) ?? null})),
        dayToString: [0, 1, 2, 3, 4, 5, 6, 7, -1, '3', null].map((d) => ({args: [d], expected: $scope.dayToString(d) ?? null})),
        dayToFullString: [0, 1, 2, 3, 4, 5, 6, 7, '3', null].map((d) => ({args: [d], expected: $scope.dayToFullString(d) ?? null})),
        convertMMDD: ['2026.11.07 00:00', '2026-11-07', '20261107', '', 20261107, null].map((v) => ({args: [v], expected: $scope.convertMMDD(v)})),
        convertDD: ['2026-11-08', '2026.11.08 00:00', '2026-11', 8, null].map((v) => ({args: [v], expected: $scope.convertDD(v)})),
        currentAirUnitStr: ['airkorea', 'airkorea_who', 'airnow', 'aqicn', 'unknown', null].map((u) => {
            units.airUnit = u;
            return {args: [u], expected: $scope.getCurrentAirUnitStr() ?? null};
        }),
        pollen: [
            {},
            {pollenGrade: 2, pollenStr: '높음', flowerWoodyGrade: 2, flowerWoodyStr: '높음', flowerPineGrade: 0, flowerPineStr: '낮음'},
            {pollenGrade: 1, pollenStr: '보통', flowerWeedsGrade: 1, flowerWeedsStr: '보통'},
            {pollenGrade: 3, pollenStr: '매우높음', flowerWoodyGrade: 3, flowerWoodyStr: '매우높음', flowerPineGrade: 1, flowerPineStr: '보통',
                flowerWeedsGrade: 0, flowerWeedsStr: '낮음'},
            {flowerWoodyGrade: 2, flowerWoodyStr: '높음'},
        ].map((day) => {
            popup = null;
            $scope.showPollenInfo(day);
            return {args: [day], expected: popup && {title: popup.title, okText: popup.okText, cssClass: popup.cssClass,
                rows: clone(popup.scope.pollenTypes)}};
        }),
    };
    return out;
}

// WeatherInfo's selection of the place to show (setFirstCityIndex, setNextCityIndex, setPrevCityIndex,
// getEnabledCityCount) for lists of one to four places with the current position (index 0) on or off, from every
// index. Kotlin: PlaceIndex.
function cityIndexCases(util) {
    const out = [];
    for (const count of [1, 2, 3, 4]) {
        for (const firstDisabled of [false, true]) {
            const {info} = loadWeatherInfo(util);
            for (let i = 0; i < count; i++) {
                info.addCity({address: `대한민국 서울특별시 중구 동${i}`, location: {lat: 37 + i / 100, long: 127}, currentPosition: i === 0});
            }
            if (firstDisabled) info.getCityOfIndex(0).disable = true;
            for (let from = -1; from < count; from++) {
                const run = (op) => {
                    if (from >= 0) info.setCityIndex(from); else info.setCityIndex(0);
                    if (from < 0) { info.setFirstCityIndex(); return info.getCityIndex(); }
                    info[op]();
                    return info.getCityIndex();
                };
                out.push({count, firstDisabled, from, enabled: info.getEnabledCityCount(),
                    first: from < 0 ? run() : undefined,
                    next: from >= 0 ? run('setNextCityIndex') : undefined,
                    previous: from >= 0 ? run('setPrevCityIndex') : undefined});
            }
        }
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
write('air.json', {...airCases(), visits: airVisitCases(util)});
write('nation.json', await nationCases());
write('special.json', specialCases());
write('photos.json', photoCases());
write('requests.json', requestCases());
write('settings.json', settingsCases());
write('forecast.json', {visits: forecastCases(util), helpers: forecastHelperCases(), cityIndex: cityIndexCases(util)});
{
    const file = path.join(ROOT, 'android/core-storage/src/test/resources/corpus/push.json');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify(pushCases(), null, 1) + '\n');
}

const sources = ['service.weatherutil.js', 'service.weatherinfo.js', 'controller.forecastctrl.js', 'controller.tabctrl.js',
    'controller.air.js', 'controller.nation.js', 'controller.nation.air.js', 'controller.kma.special.js', 'service.push.js',
    'controller.units.js', 'controller.setting.radio.js', 'controller.settingctrl.js', 'service.util.js']
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
