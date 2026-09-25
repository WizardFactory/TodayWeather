'use strict';
// Offline test for KmaScraper._decodeKmaHtml / _parseCityWeatherHtml against the modern
// city-obs.do page and the legacy table_develop3 layout, plus the hourly waterfall's
// city-unavailable branch. Needs cheerio/iconv from a server node_modules; no network, no DB.
// Usage: node server/test/offline/test.city.parser.js <server dir> <fixture city-obs.html>
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const serverDir = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const fixture = process.argv[3] || path.join(__dirname, 'fixtures/city-obs-2026-09-25.html');
const src = fs.readFileSync(path.join(serverDir, 'lib/kmaScraper.js'), 'utf8');

function slice(startMarker, endMarker) {
    const s = src.indexOf(startMarker); assert(s >= 0, 'marker not found: ' + startMarker);
    const e = src.indexOf(endMarker, s + startMarker.length); assert(e > s, 'end marker not found: ' + endMarker);
    return src.slice(s, e + endMarker.length);
}

const cheerio = require(path.join(serverDir, 'node_modules/cheerio'));
const Iconv = require(path.join(serverDir, 'node_modules/iconv')).Iconv;

const logs = { warn: [], error: [], debug: [] };
function KmaScraper() {}
const ctx = {
    KmaScraper, cheerio, Iconv, Buffer, Date, Array, RegExp, isNaN, parseInt, parseFloat, String, Error,
    log: { warn: m => logs.warn.push(String(m)), error: (...a) => logs.error.push(a.join(' ')), debug: m => logs.debug.push(m), info: () => {} }
};
vm.runInNewContext(
    slice('KmaScraper.prototype._decodeKmaHtml =', '\n};') + '\n' +
    slice('KmaScraper.prototype._parseCityWeatherHtml =', '\n    return cityWeatherList;\n};') + '\n' +
    slice('KmaScraper.prototype._convertKrToEng =', '\n};'), ctx);
const scraper = new KmaScraper();

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

test('_decodeKmaHtml: utf-8 by content-type; utf-8 by meta; euc-kr otherwise', () => {
    const utf = Buffer.from('<html><head><meta charset="utf-8"></head>서울</html>', 'utf8');
    assert(scraper._decodeKmaHtml(utf, { headers: { 'content-type': 'text/html;charset=UTF-8' } }).indexOf('서울') > 0);
    assert(scraper._decodeKmaHtml(utf, { headers: {} }).indexOf('서울') > 0, 'meta charset detection');
    const euc = new Iconv('UTF8', 'euc-kr').convert(Buffer.from('<html>서울</html>', 'utf8'));
    assert(scraper._decodeKmaHtml(euc, { headers: { 'content-type': 'text/html' } }).indexOf('서울') > 0, 'euc-kr path');
    assert(scraper._decodeKmaHtml(euc.toString('binary'), { headers: {} }).indexOf('서울') > 0, 'binary string body accepted');
});

test('modern city-obs.do fixture parses 97 stations with expected fields', () => {
    const html = fs.readFileSync(fixture, 'utf8');
    const r = scraper._parseCityWeatherHtml(html, undefined);
    assert(!(r instanceof Error), r && r.message);
    assert.match(r.pubDate, /^\d{4}\.\d{2}\.\d{2}\.\d{2}:\d{2}$/);
    assert(r.cityList.length >= 90, 'rows=' + r.cityList.length);
    const seoul = r.cityList.find(c => c.stnId === '108');
    assert(seoul, 'seoul row');
    assert.strictEqual(seoul.stnName, '서울');
    assert.strictEqual(typeof seoul.t1h, 'number');
    assert.strictEqual(typeof seoul.reh, 'number');
    assert.strictEqual(typeof seoul.wsd, 'number', 'wsd extracted from writeWindSpeed script');
    assert.strictEqual(typeof seoul.hPa, 'number');
    assert.strictEqual(typeof seoul.dpt, 'number');
    assert.strictEqual(typeof seoul.sensoryTem, 'number');
    assert(typeof seoul.wdd === 'string' && /^[NEWS]+$/.test(seoul.wdd), 'wdd=' + seoul.wdd);
    assert(seoul.date instanceof Date && !isNaN(seoul.date.getTime()));
    assert.strictEqual(seoul.date.getTime(), new Date(r.pubDate).getTime());
    assert(!('unknown' in seoul));
    const baengnyeong = r.cityList.find(c => c.stnName === '백령');
    assert(baengnyeong, '백령도 → 백령 rename');
    assert.strictEqual(logs.error.filter(m => /unknown city weather property/.test(m)).length, 0, logs.error.join('|'));
    // wsd must never be the script text
    r.cityList.forEach(c => { if ('wsd' in c) assert.strictEqual(typeof c.wsd, 'number'); });
    // sentinel/blank cells are omitted rather than NaN
    r.cityList.forEach(c => Object.keys(c).forEach(k => { if (typeof c[k] === 'number') assert(!isNaN(c[k]), k); }));
});

test('page older than requested pubDate → Error (caller retries)', () => {
    const html = fs.readFileSync(fixture, 'utf8');
    const r = scraper._parseCityWeatherHtml(html, '2099.01.01.00:00');
    assert(r instanceof Error);
    assert.match(r.message, /not updated/);
});

test('legacy table_develop3 layout still parses', () => {
    const legacy = '<html><head><meta charset="euc-kr"></head><body>' +
        '<div class="table_topinfo">기상실황표 2020.01.01.10:00</div>' +
        '<table class="table_develop3"><thead><tr id="table_header2">' +
        '<th>지점</th><th>현재일기</th><th>현재기온</th><th>습도%</th><th>풍향</th><th>풍속m/s</th></tr></thead>' +
        '<tbody><tr><td><a href="currentweather.jsp?tm=x&stn=108">서울</a></td><td>맑음</td><td>-3.2</td><td>40</td><td>북서</td><td>2.5</td></tr>' +
        '<tr><td><a href="currentweather.jsp?stn=102">백령도</a></td><td></td><td>1.0</td><td>-</td><td>서</td><td>-</td></tr></tbody></table></body></html>';
    const r = scraper._parseCityWeatherHtml(legacy, '2020.01.01.10:00');
    assert(!(r instanceof Error), r && r.message);
    assert.strictEqual(r.pubDate, '2020.01.01.10:00');
    assert.strictEqual(r.cityList.map(c => c.stnId).join(','), '108,102');
    assert.strictEqual(r.cityList[0].t1h, -3.2);
    assert.strictEqual(r.cityList[0].wdd, 'NW');
    assert.strictEqual(r.cityList[0].wsd, 2.5);
    assert.strictEqual(r.cityList[1].stnName, '백령');
    assert.strictEqual(r.cityList[1].reh, undefined, "'-' omitted");
    assert.strictEqual(r.cityList[1].weather, '');
});

test('missing header / bad pubDate → Error, never throws', () => {
    assert(scraper._parseCityWeatherHtml('<html></html>') instanceof Error);
    assert(scraper._parseCityWeatherHtml('<div class="cmp-table-topinfo">기상실황표2026.09.25.20:00</div>') instanceof Error);
});

// ---------- getStnHourlyWeather: city-unavailable branch ----------
const stepSrc = slice('function (awsWeatherList, cb) {\n            async.retry({times:10, interval:1000},', '\n        },').replace(/,\s*$/, '');
function runStep(cityResult) {
    let out; const errs = [];
    const step = vm.runInNewContext('(' + stepSrc + ')', {
        async: { retry: (opts, fn, done) => fn((e, r) => done(e, r)) },
        self: { getCityWeather: (pd, cb) => cb(cityResult.err, cityResult.list), _mergeAWSandCity: (a, c) => a.concat(c.map(x => Object.assign({ merged: true }, x))) },
        pubDate: '2026.09.25.20:00', log: { error: m => errs.push(String(m)), info: () => {} }, Array
    });
    step({ pubDate: '2026.09.25.20:00', stnList: [{ stnId: '108', t1h: 20 }] }, (e, r) => { out = { e, r }; });
    return { out, errs };
}

test('hourly waterfall: city unavailable → AWS-only list, no throw', () => {
    const r = runStep({ err: new Error('Illegal character sequence.') });
    assert.strictEqual(r.out.e, null);
    assert.strictEqual(JSON.stringify(r.out.r), JSON.stringify({ pubDate: '2026.09.25.20:00', stnList: [{ stnId: '108', t1h: 20 }] }));
    assert(r.errs.some(m => /saving AWS hourly only/.test(m)));
    const r2 = runStep({ err: null, list: undefined });
    assert.strictEqual(r2.out.e, null); assert.strictEqual(r2.out.r.stnList.length, 1);
});

test('hourly waterfall: city available → merged', () => {
    const r = runStep({ err: null, list: { pubDate: '2026.09.25.20:00', cityList: [{ stnId: '108', weather: '맑음' }] } });
    assert.strictEqual(r.out.e, null);
    assert.strictEqual(r.out.r.stnList.length, 2);
    assert.strictEqual(r.out.r.stnList[1].merged, true);
});

// ---------- _saveStnInfo: geocode unavailable must not abort ----------
const saveStnSrc = slice('KmaScraper.prototype._saveStnInfo =', '\n    return this;\n};');
function runSaveStnInfo(opts) {
    const logs = { warn: [], error: [], info: [] };
    let out = 'unset';
    const ctx = {
        KmaScraper: function () {}, JSON, Date, log: { warn: m => logs.warn.push(String(m)), error: m => logs.error.push(JSON.stringify(m)), info: () => {}, debug: () => {} },
        KmaStnInfo: Object.assign(function (doc) { this.doc = doc; this.toString = () => JSON.stringify(doc); this.save = cb => cb(opts.saveErr || null); }, { find: (q, cb) => cb(null, opts.found || []) })
    };
    vm.runInNewContext(saveStnSrc, ctx);
    const inst = new ctx.KmaScraper();
    inst._recursiveConvertGeoCode = opts.geo;
    inst._saveStnInfo({ stnId: '42', stnName: '군산오식도', addr: '전북 군산시', isCityWeather: false, altitude: 2 }, (err, id) => { out = { err, id }; });
    return { out, logs };
}
test('_saveStnInfo: geocode throws synchronously (missing kakao key) → callback() without error', () => {
    const r = runSaveStnInfo({ geo: () => { throw new SyntaxError('Unexpected token u in JSON at position 0'); } });
    assert.strictEqual(r.out.err, undefined);
    assert.strictEqual(r.out.id, undefined);
    assert(r.logs.warn.some(m => /skip stnInfo/.test(m) && /Unexpected token u/.test(m)), r.logs.warn.join('|'));
});
test('_saveStnInfo: geocode async error → callback() without error', () => {
    const r = runSaveStnInfo({ geo: (a, n, cb) => cb(new Error('Fail to recursive convert geo code')) });
    assert.strictEqual(r.out.err, undefined);
    assert.strictEqual(r.logs.warn.length, 1);
});
test('_saveStnInfo: geocode ok → new stnInfo saved, id returned', () => {
    const r = runSaveStnInfo({ geo: (a, n, cb) => cb(null, { lat: 35.9, lon: 126.6 }) });
    assert.strictEqual(r.out.err, null);
    assert.strictEqual(r.out.id, '42');
});
test('_saveStnInfo: already known station → id returned, no geocode', () => {
    const r = runSaveStnInfo({ found: [{ stnId: '42', isCityWeather: false }], geo: () => { throw new Error('must not geocode'); } });
    assert.strictEqual(r.out.id, '42');
});

console.log('# ' + passed + ' tests passed');
