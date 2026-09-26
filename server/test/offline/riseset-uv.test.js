/* Sunrise/sunset and UV collection regressions (#2587).
 * Run with Node >=16.20.2 and async on NODE_PATH:
 *   TZ=UTC NODE_PATH=/tmp/tw-2587/node_modules node server/test/offline/riseset-uv.test.js
 * Loads production modules in an isolated VM. HTTP, models and config are stubs;
 * no app startup, provider call, Mongo or timer is reachable.
 * fixtures/uv-idx-v5.json is a live getUVIdxV5 response recorded on 2026-09-26
 * (areaNo='' numOfRows=3 time=2026092612: the first three of 3,851 areas; no key in the body).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const async = require('async');
const root = path.resolve(__dirname, '../..');
const noop = function () {};
const logs = [];
const log = Object.fromEntries(['info','warn','error','debug','verbose','silly'].map(k => [k, (...args) => logs.push({level: k, args})]));
// Dummy keys at data.go.kr length; the collectors skip short unset defaults such as "key1".
const pad = name => name + 'x'.repeat(40);
const FORECAST_KEY = pad('FORECAST%2FKEY');
// As deployed on 2026-09-26: the forecast list repeats the test_normal key and adds the approved key.
const KEYS = {normal: pad('NORMAL%2BKEY'), test_normal: pad('TEST+NORMAL'), cert_key: pad('CERT%2FKEY'), test_cert: pad('TEST_CERT'),
    dongnae_forecast_keys: JSON.stringify([pad('TEST+NORMAL'), FORECAST_KEY])};

function Stub() {}
function load(relative, dependencies = {}) {
    const module = {exports: {}};
    const sandbox = {module, exports: module.exports, console, log, Date, setTimeout, clearTimeout, setImmediate,
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : Stub};
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}

const kmaTimeLib = load('lib/kmaTimeLib.js');
const sunRiseSet = load('lib/sunRiseSet.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/uv-idx-v5.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
// The recorded page reports all 3,851 areas; tests that mean a single page set totalCount to its items.
const onePage = () => { const body = clone(fixture); body.response.body.totalCount = body.response.body.items.item.length; return body; };
// VM results carry the sandbox realm's prototypes; compare them as plain JSON values.
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));

// Request stub: handler(url) returns {statusCode, body} or an Error.
function fakeRequest(handler) {
    const calls = [];
    const request = (url, opts, cb) => {
        calls.push(url);
        const result = handler(url, calls.length);
        setImmediate(() => result instanceof Error ? cb(result) : cb(null, {statusCode: result.statusCode || 200}, result.body));
    };
    request.calls = calls;
    return request;
}

test('computed sunrise/sunset match KASI reference values in every host time zone', () => {
    // KASI getLCRiseSetInfo sample in models/modelKasiRiseSet.js: sunrise 051016, sunset 195516.
    assert.deepEqual(plain(sunRiseSet.compute(37.5666667, 126.9833333, '20170616')), {sunrise: '2017.06.16 05:10', sunset: '2017.06.16 19:55'});
    // KASI Seoul winter solstice 2024: 07:43 / 17:17.
    assert.deepEqual(plain(sunRiseSet.compute(37.5665, 126.978, '20241221')), {sunrise: '2024.12.21 07:43', sunset: '2024.12.21 17:17'});
    for (const tz of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
        const out = require('node:child_process').execFileSync(process.execPath, ['-e',
            'console.log(JSON.stringify(require(process.argv[1]).compute(37.567,126.978,"20260926")))', path.join(root, 'lib/sunRiseSet.js')],
            {env: Object.assign({}, process.env, {TZ: tz})}).toString().trim();
        assert.deepEqual(JSON.parse(out), {sunrise: '2026.09.26 06:22', sunset: '2026.09.26 18:23'}, tz);
    }
    assert.equal(sunRiseSet.compute(37.5, 127, '20260230'), undefined, 'invalid date');
    assert.equal(sunRiseSet.compute(undefined, 127, '20260926'), undefined, 'missing latitude');
    assert.equal(sunRiseSet.compute(89.9, 0, '20261221'), undefined, 'polar night');
});

function loadTown(riseSetList) {
    const Town = load('controllers/controllerTown.js', {
        'async': async,
        '../lib/sunRiseSet': sunRiseSet,
        '../lib/kmaTimeLib': kmaTimeLib,
        '../controllers/kasi.riseset.controller': {getRiseSetList: riseSetList},
        '../models/town': {find: () => ({limit: () => ({lean: () => ({exec: cb => cb(null, [])})})})}
    });
    return new Town();
}

function runRiseSet(town, req) {
    return new Promise(resolve => town.getRiseSetInfo(req, {}, resolve));
}

function days() {
    return ['20260925', '20260926', '20260927'].map(date => ({date, taMax: 25, taMin: 15, skyAm: 1}));
}

test('getRiseSetInfo keeps KASI rows and computes the missing days', async () => {
    const town = loadTown((geo, dates, cb) => cb(null, [{date: '20260926', locationName: '서울', sunrise: '2026.09.26 06:21', sunset: '2026.09.26 18:22'}]));
    const req = {params: {}, geocode: {lat: 37.567, lon: 126.978}, midData: {dailyData: days()}};
    await runRiseSet(town, req);
    const [d25, d26, d27] = req.midData.dailyData;
    assert.equal(d26.sunrise, '2026.09.26 06:21', 'KASI value kept');
    assert.equal(d26.locationName, '서울');
    assert.equal(d25.sunrise, sunRiseSet.compute(37.567, 126.978, '20260925').sunrise);
    assert.equal(d27.sunset, sunRiseSet.compute(37.567, 126.978, '20260927').sunset);
    for (const day of req.midData.dailyData) {
        assert.match(day.sunrise, /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/);
        assert.match(day.sunset, /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/);
        assert.equal(day.taMax, 25, 'other fields unchanged');
    }
});

test('getRiseSetInfo store failure: next called once, computed values, other fields unchanged', async () => {
    logs.length = 0;
    const town = loadTown((geo, dates, cb) => cb(new Error('Fail to find kasi rise set')));
    let calls = 0;
    const req = {params: {}, geocode: {lat: 35.1796, lon: 129.0756}, midData: {dailyData: days()}};
    await new Promise(resolve => town.getRiseSetInfo(req, {}, () => { calls++; setImmediate(resolve); }));
    assert.equal(calls, 1);
    assert.deepEqual(req.midData.dailyData.map(d => [d.sunrise, d.sunset]),
        ['20260925', '20260926', '20260927'].map(date => { const r = sunRiseSet.compute(35.1796, 129.0756, date); return [r.sunrise, r.sunset]; }));
    assert.deepEqual(req.midData.dailyData.map(d => ({date: d.date, taMax: d.taMax, taMin: d.taMin, skyAm: d.skyAm})),
        days().map(d => ({date: d.date, taMax: d.taMax, taMin: d.taMin, skyAm: d.skyAm})));
    assert(logs.some(l => l.level === 'error' && /Fail to find kasi rise set/.test(String(l.args[0] && l.args[0].message))));
    assert(!logs.some(l => l.args.some(a => /ReferenceError|TypeError/.test(String(a && a.stack || a)))));
});

test('getRiseSetInfo town lookup failure falls back to the request coordinate', async () => {
    const town = loadTown((geo, dates, cb) => cb(new Error('unexpected store call')));
    const req = {params: {region: '서울특별시', city: '종로구', town: '청운효자동'}, gCoord: {lat: 37.5665, lon: 126.978}, midData: {dailyData: days()}};
    await runRiseSet(town, req);
    assert.equal(req.midData.dailyData[1].sunrise, sunRiseSet.compute(37.5665, 126.978, '20260926').sunrise);
    const noGeo = {params: {}, midData: {dailyData: days()}};
    await runRiseSet(town, noGeo);
    assert.equal(noGeo.midData.dailyData[0].sunrise, undefined, 'no coordinate, no guess');
});

function loadKasi(request, updates = []) {
    const Kasi = load('controllers/kasi.riseset.controller.js', {
        'async': async, 'request': request, 'dnscache': () => ({}),
        '../config/config': {keyString: KEYS}, '../lib/kmaTimeLib': kmaTimeLib,
        '../models/modelKasiRiseSet': {
            getDataPropertyList: () => ['sunrise', 'suntransit', 'sunset', 'moonrise', 'moontransit', 'moonset', 'civilm', 'civile', 'nautm', 'naute', 'astm', 'aste'],
            getAreaList: () => ['강릉', '서울', '부산'],
            find: () => ({limit: () => ({lean: () => ({exec: cb => cb(null, [])})})}),
            update: (query, doc, opts, cb) => { updates.push(doc); cb(null); }
        }
    });
    return Kasi;
}

function kasiItem(url) {
    const locdate = /locdate=(\d{8})/.exec(url)[1];
    return {response: {header: {resultCode: '00', resultMsg: 'NORMAL SERVICE.'}, body: {items: {item: {
        location: decodeURIComponent(/location=([^&]*)/.exec(url)[1]), locdate: Number(locdate), latitudeNum: 37.56, longitudeNum: 126.98,
        sunrise: '0621  ', sunset: '1822  ', suntransit: '1221  ', moonrise: '------', moonset: '0512  ', moontransit: '2330  ',
        civilm: '0555  ', civile: '1848  ', nautm: '0525  ', naute: '1918  ', astm: '0454  ', aste: '1949  '}}}}};
}

test('KASI gather rotates an expired key and keeps keys out of errors', async () => {
    const request = fakeRequest(url => url.includes('ServiceKey=' + KEYS.normal) ?
        {statusCode: 401, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnAuthMsg: 'DEADLINE_HAS_EXPIRED_ERROR', returnReasonCode: '31'}}}} :
        {body: kasiItem(url)});
    const updates = [];
    const Kasi = loadKasi(request, updates);
    const result = await new Promise((resolve, reject) => Kasi.updateAreaRiseSetFromApi('서울', '20260926', (err, res) => err ? reject(err) : resolve(res)));
    assert.equal(result.result, 'ok');
    assert.equal(request.calls.length, 2, 'one retry with the next key');
    assert(request.calls[1].includes('ServiceKey=' + KEYS.test_normal));
    assert.equal(updates.length, 1);
    // The chosen key stays for later requests.
    await new Promise(resolve => Kasi.updateAreaRiseSetFromApi('부산', '20260926', resolve));
    assert(request.calls[2].includes('ServiceKey=' + KEYS.test_normal));

    const failing = loadKasi(fakeRequest(() => ({statusCode: 500, body: 'Unexpected errors'})));
    failing._getAreaRiseSetFromApi = function (area, date, cb) {
        this._requestWithKeyRotation(() => this._makeAreaApiUrl(area, date), cb);
    };
    const err = await new Promise(resolve => failing.updateAreaRiseSetFromApi('서울', '20260926', resolve));
    assert(err && typeof err.message === 'string', 'error returned');
    assert.match(err.message, /getAreaRiseSetInfo/);
    for (const key of Object.values(KEYS)) assert(!err.message.includes(key), 'no key in error');
});

test('KASI gather continues after one failing area and fails only when all fail', async () => {
    const Kasi = loadKasi(fakeRequest(() => ({})));
    const seen = [];
    Kasi.updateAreaRiseSetListFromApi = (area, dateList, cb) => {
        seen.push(area);
        setImmediate(() => area === '강릉' ? cb(new Error('statusCode=401')) : cb(null, [{area, result: 'ok'}]));
    };
    const results = await new Promise((resolve, reject) => Kasi.gatherAreaRiseSetFromApi((err, res) => err ? reject(err) : resolve(res)));
    assert.deepEqual(seen, ['강릉', '서울', '부산']);
    assert.equal(results[0].error, 'statusCode=401');
    Kasi.updateAreaRiseSetListFromApi = (area, dateList, cb) => setImmediate(() => cb(new Error('down')));
    const err = await new Promise(resolve => Kasi.gatherAreaRiseSetFromApi(resolve));
    assert.equal(err && err.message, 'down');
});

function loadRequester(request, saved = []) {
    const LifeIndexKma2 = {
        update: (query, doc, opts, cb) => { saved.push(doc); setImmediate(cb); },
        remove: (query, cb) => cb && cb(null)
    };
    const Requester = load('lib/lifeIndexKmaRequester.js', {
        'request': request, 'async': async, '../lib/kmaTimeLib': kmaTimeLib,
        '../models/kma/kma.lifeindex.model': LifeIndexKma2
    });
    const service = new Requester();
    service.setServiceKey(KEYS.cert_key, KEYS);
    service.setNextGetTime('ultrv', new Date(0));
    return {service, LifeIndexKma2};
}

function runUltrv(service, now) {
    return new Promise(resolve => service.taskLifeIndex2('ultrv', (err, count) => resolve({err, count})));
}

test('V5 fixture becomes daily ultrv for the requested area and appendData2 adds ultrvGrade', async () => {
    const saved = [];
    const request = fakeRequest(url => ({body: clone(fixture)}));
    const {service} = loadRequester(request, saved);
    const records = service.convertUvItemsV5(clone(fixture).response.body.items.item);
    const seoul = records.filter(r => r.areaNo === 1100000000).map(r => [kmaTimeLib.convertDateToYYYYMMDD(r.date), r.index, r.lastUpdateDate]);
    // Issued 12 KST: 26th has 12:00-21:00 (max 4); 27th and 28th are full days; h60-h75 (29th) are empty.
    assert.deepEqual(plain(seoul), [['20260926', 4, '2026092612'], ['20260927', 7, '2026092612'], ['20260928', 6, '2026092612']]);
    assert.deepEqual(plain(records.filter(r => r.areaNo === 1111051500).map(r => r.index)), [4, 6, 6]);
    assert.equal(records.length, 9, 'three recorded areas, three days each');
    assert(records.every(r => r.indexType === 'ultrv'));

    // Read path: records stored in lifeIndexKma2 → appendData2 → ultrv/ultrvGrade on the day.
    const Controller = load('controllers/lifeIndexKmaController.js', {
        'async': async, '../lib/kmaTimeLib': kmaTimeLib,
        '../models/kma/kma.lifeindex.model': {find: query => ({batchSize: () => ({lean: () => ({exec: cb => cb(null, records.filter(r => r.areaNo === query.areaNo))})})})}
    });
    const midList = [{date: '20260925'}, {date: '20260926', taMax: 25}, {date: '20260927'}];
    await new Promise((resolve, reject) => Controller.appendData2('1100000000', midList, err => err ? reject(err) : resolve()));
    assert.equal(midList[0].ultrv, undefined);
    assert.equal(midList[1].ultrv, 4); assert.equal(midList[1].ultrvGrade, 1); assert.equal(midList[1].taMax, 25);
    assert.equal(Controller.ultrvStr(midList[1].ultrvGrade, {__: s => s}), 'LOC_NORMAL');
    assert.equal(midList[2].ultrv, 7); assert.equal(midList[2].ultrvGrade, 2);
    assert.equal(Controller.ultrvStr(midList[2].ultrvGrade, {__: s => s}), 'LOC_HIGH');
});

test('V5 request uses all areas, the latest issued slot and pages through totalCount', async () => {
    const saved = [];
    const page = (pageNo, count) => ({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'}, body: {dataType: 'JSON', pageNo, numOfRows: 1000, totalCount: 1002,
        items: {item: Array.from({length: count}, (_, i) => Object.assign(clone(fixture.response.body.items.item[0]), {areaNo: String(1100000000 + (pageNo - 1) * 1000 + i)}))}}}});
    const request = fakeRequest(url => {
        const time = /time=(\d{10})/.exec(url)[1];
        if (time !== '2026092606') return {body: {response: {header: {resultCode: '03', resultMsg: 'NO_DATA'}}}};
        return {body: /pageNo=2/.test(url) ? page(2, 2) : page(1, 1000)};
    });
    const {service} = loadRequester(request, saved);
    const now = new Date('2026-09-26T02:10:00Z'); // 11:10 KST
    assert.deepEqual(plain(service.getUvTimeSlotsV5(now)), ['2026092609', '2026092606', '2026092603', '2026092600', '2026092521']);
    const result = await new Promise(resolve => service.taskUltrvV5(now, (err, count) => resolve({err, count})));
    assert.ifError(result.err);
    assert.equal(result.count, 1002 * 3);
    assert.deepEqual(request.calls.map(u => [/time=(\d+)/.exec(u)[1], /pageNo=(\d+)/.exec(u)[1]]), [['2026092609', '1'], ['2026092606', '1'], ['2026092606', '2']]);
    const url = new URL(request.calls[0]);
    assert.equal(url.origin + url.pathname, 'http://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5');
    assert.equal(url.searchParams.get('areaNo'), '');
    assert.equal(url.searchParams.get('dataType'), 'JSON');
    assert.equal(url.searchParams.get('numOfRows'), '1000');
    assert.equal(url.searchParams.get('serviceKey'), decodeURIComponent(KEYS.cert_key), 'key encoded once');

    // Same issuance an hour later: no second save.
    const again = await new Promise(resolve => service.taskUltrvV5(new Date('2026-09-26T03:10:00Z'), (err, count) => resolve({err, count})));
    assert.equal(again.count, 0);
    assert.equal(saved.length, 1002 * 3);
});

test('V5 rotates keys on authorization errors and saves nothing on a failed page', async () => {
    const saved = [];
    const request = fakeRequest(url => {
        if (url.includes('serviceKey=' + encodeURIComponent(decodeURIComponent(KEYS.cert_key)))) {
            return {statusCode: 401, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnReasonCode: '30'}}}};
        }
        if (url.includes('serviceKey=' + encodeURIComponent(KEYS.test_cert))) {
            return {body: {response: {header: {resultCode: '22', resultMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'}}}};
        }
        if (/pageNo=2/.test(url)) return new Error('ETIMEDOUT');
        const body = clone(fixture); body.response.body.totalCount = 1500; return {body};
    });
    const {service} = loadRequester(request, saved);
    const result = await new Promise(resolve => service.taskUltrvV5(new Date('2026-09-25T21:30:00Z'), (err, count) => resolve({err, count})));
    assert(result.err, 'page 2 failure fails the run');
    assert.equal(saved.length, 0, 'no partial save');
    assert(request.calls[2].includes('serviceKey=' + encodeURIComponent(decodeURIComponent(KEYS.normal))), 'third key after two authorization failures');
    for (const key of Object.values(KEYS)) assert(!result.err.message.includes(key));

    const denied = loadRequester(fakeRequest(() => ({statusCode: 401, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnReasonCode: '30'}}}})));
    const deniedResult = await new Promise(resolve => denied.service.taskUltrvV5(new Date('2026-09-26T02:10:00Z'), (err) => resolve(err)));
    assert(deniedResult && deniedResult.isAuthError, 'authorization failure with every key stops without trying older slots');
});

test('V5 parser handles single items, empty items and gateway errors', () => {
    const {service} = loadRequester(fakeRequest(() => ({})));
    const single = clone(fixture); single.response.body.items.item = single.response.body.items.item[0]; single.response.body.totalCount = 1;
    assert.equal(service.parseUvIdxV5(single).items.length, 1);
    assert.equal(service.parseUvIdxV5(JSON.stringify(single)).items.length, 1);
    assert.deepEqual(plain(service.parseUvIdxV5({response: {header: {resultCode: '00'}, body: {items: ''}}})), {noData: true});
    assert.deepEqual(plain(service.parseUvIdxV5({response: {header: {resultCode: '03', resultMsg: 'NO_DATA'}}})), {noData: true});
    assert.equal(service.parseUvIdxV5({OpenAPI_ServiceResponse: {cmmMsgHeader: {returnReasonCode: '12', errMsg: 'NO_OPENAPI_SERVICE_ERROR'}}}).error.returnCode, '12');
    assert(service.parseUvIdxV5('<xml/>').error);
    assert.deepEqual(plain(service.convertUvItemsV5([{areaNo: 'x', date: '2026092606', h0: '1'}, {areaNo: '1100000000', date: '20260926', h6: '3'}])), []);
});

const XML_DENIED = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>' +
    '<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';

test('XML gateway errors with HTTP 200 still rotate keys (V5 and KASI)', async () => {
    const saved = [];
    const request = fakeRequest(url => url.includes('serviceKey=' + encodeURIComponent(decodeURIComponent(KEYS.cert_key))) ?
        {body: XML_DENIED} : {body: onePage()});
    const {service} = loadRequester(request, saved);
    const result = await new Promise(resolve => service.taskUltrvV5(new Date('2026-09-25T21:30:00Z'), (err, count) => resolve({err, count})));
    assert.ifError(result.err);
    assert.equal(request.calls.length, 2, 'rotated once, then saved');
    assert(saved.length > 0);

    const kasiRequest = fakeRequest(url => url.includes('ServiceKey=' + KEYS.normal) ? {body: XML_DENIED} : {body: kasiItem(url)});
    const Kasi = loadKasi(kasiRequest);
    const kasi = await new Promise(resolve => Kasi.updateAreaRiseSetFromApi('서울', '20260926', (err, res) => resolve({err, res})));
    assert.ifError(kasi.err);
    assert.equal(kasiRequest.calls.length, 2);
    assert(kasiRequest.calls[1].includes('ServiceKey=' + KEYS.test_normal));
});

test('a transient failure on the newest slot never saves an older issuance', async () => {
    const saved = [];
    let failNewest = false;
    const issued = time => { const body = clone(fixture); body.response.body.items.item.forEach(item => { item.date = time; }); return body; };
    const request = fakeRequest(url => {
        const time = /time=(\d{10})/.exec(url)[1];
        if (time === '2026092612') return failNewest ? new Error('ETIMEDOUT') : {body: issued(time)};
        return {body: issued(time)};
    });
    const {service} = loadRequester(request, saved);
    const now = new Date('2026-09-26T04:10:00Z'); // 13:10 KST, newest slot 12
    const first = await new Promise(resolve => service.taskUltrvV5(now, (err, count) => resolve({err, count})));
    assert.ifError(first.err);
    const savedAfterFirst = saved.length;
    assert(saved.every(r => r.lastUpdateDate === '2026092612'));

    failNewest = true;
    const second = await new Promise(resolve => service.taskUltrvV5(now, (err, count) => resolve({err, count})));
    assert(second.err, 'transport failure fails the run');
    assert.equal(saved.length, savedAfterFirst, 'no older issuance saved');
    assert.equal(request.calls.filter(u => !/time=2026092612/.test(u)).length, 0, 'no fallback to older slots on transport failure');

    // Provider error code (not an auth code) on the newest slot: older slot is tried but not saved over a newer save.
    const coded = loadRequester(fakeRequest(url => /time=2026092612/.test(url) ?
        {body: {response: {header: {resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR'}}}} : {body: issued(/time=(\d{10})/.exec(url)[1])}), []);
    coded.service.ultrv.lastIssued = '2026092612';
    const third = await new Promise(resolve => coded.service.taskUltrvV5(now, (err, count) => resolve({err, count})));
    assert.ifError(third.err);
    assert.equal(third.count, 0, 'older slot skipped');
});

test('the approved forecast key is reached for KASI and V5 as deployed on 2026-09-26', async () => {
    const approved = url => url.includes('ServiceKey=' + FORECAST_KEY) || url.includes('serviceKey=' + FORECAST_KEY);
    // Recorded gateway answers: expired (31) for the old KASI key, unregistered (30) for keys without a subscription.
    const expired = {statusCode: 401, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnAuthMsg: 'DEADLINE_HAS_EXPIRED_ERROR', returnReasonCode: '31'}}}};
    const unregistered = {statusCode: 403, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnAuthMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnReasonCode: '30'}}}};

    const kasiRequest = fakeRequest(url => approved(url) ? {body: kasiItem(url)} : expired);
    const Kasi = loadKasi(kasiRequest);
    const kasi = await new Promise(resolve => Kasi.updateAreaRiseSetFromApi('서울', '20260926', (err, res) => resolve({err, res})));
    assert.ifError(kasi.err);
    assert.equal(kasiRequest.calls.length, 3, 'normal, test_normal, forecast key (duplicate skipped)');

    const uvRequest = fakeRequest(url => approved(url) ? {body: onePage()} : unregistered);
    const {service} = loadRequester(uvRequest, []);
    const uv = await new Promise(resolve => service.taskUltrvV5(new Date('2026-09-26T03:55:00Z'), (err, count) => resolve({err, count})));
    assert.ifError(uv.err);
    assert.equal(uv.count, 9, 'nine recorded area-days saved');
    assert.equal(uvRequest.calls.filter(u => !approved(u)).length, 4, 'cert, test_cert, normal, test_normal before the forecast key');
});

test('review: UV waits for the next three-hour slot after saving, retries after failure, runs year-round', async () => {
    const saved = [];
    let fail = false;
    const request = fakeRequest(url => fail ? new Error('ETIMEDOUT') : {body: onePage()});
    const {service} = loadRequester(request, saved);
    // 12:55 KST: the current slot 12 is published (recorded fixture issuance 2026092612).
    const first = await new Promise(resolve => service.taskLifeIndex2('ultrv', (err, count) => resolve({err, count})));
    assert.equal(first.err, null);
    const now = new Date();
    const nextKst = new Date(service.ultrv.nextTime.getTime() + 9 * 3600e3);
    assert(service.ultrv.nextTime > now, 'next get time moved forward');
    assert.equal(nextKst.getUTCHours() % 3, 0, 'next get time on a three-hour KST slot');
    assert.equal(nextKst.getUTCMinutes(), 10);
    const calls = request.calls.length;
    const skipped = await new Promise(resolve => service.taskLifeIndex2('ultrv', (err, count) => resolve({err, count})));
    assert.equal(request.calls.length, calls, 'no request before the next slot');
    assert.equal(skipped.count, undefined);

    // A failed run keeps nextTime, so the next manager tick retries.
    const failing = loadRequester(fakeRequest(() => new Error('ETIMEDOUT')), []).service;
    const before = failing.ultrv.nextTime.getTime();
    await new Promise(resolve => failing.taskUltrvV5(new Date('2026-09-26T03:55:00Z'), resolve));
    assert.equal(failing.ultrv.nextTime.getTime(), before);

    // The current slot not yet published: the latest older issuance is returned; nextTime stays.
    const early = loadRequester(fakeRequest(() => ({body: onePage()})), []).service; // issued 2026092612
    const at1510 = new Date('2026-09-26T06:10:00Z'); // 15:10 KST, slot 15
    const e1 = await new Promise(resolve => early.taskUltrvV5(at1510, (err, count) => resolve({err, count})));
    assert.equal(e1.count, 9);
    assert.equal(early.ultrv.lastIssued, '2026092612', 'issuance from the items, not the requested slot');
    const kept = early.ultrv.nextTime.getTime();
    const e2 = await new Promise(resolve => early.taskUltrvV5(at1510, (err, count) => resolve({err, count})));
    assert.equal(e2.count, 0, 'same issuance not saved again');
    assert.equal(early.ultrv.nextTime.getTime(), kept, 'retry next tick until slot 15 is published');

    // Year-round: a January schedule stays in January.
    early.ultrv.nextTime = new Date('2027-01-15T04:00:00Z');
    early.setNextGetTime('ultrv');
    assert.equal(early.ultrv.nextTime.toISOString(), '2027-01-15T06:10:00.000Z');
});

test('review: unset default keys are skipped', () => {
    const Kasi = loadKasi(fakeRequest(() => ({})));
    const defaults = {normal: 'You have to set key of data.go.kr', test_normal: 'You have to set key of data.go.kr',
        cert_key: 'You have to set key of data.go.kr', test_cert: 'You have to set key of data.go.kr', dongnae_forecast_keys: '["key1","key2"]'};
    const KasiDefaults = load('controllers/kasi.riseset.controller.js', {'async': async, 'request': fakeRequest(() => ({})), 'dnscache': () => ({}),
        '../config/config': {keyString: defaults}, '../lib/kmaTimeLib': kmaTimeLib, '../models/modelKasiRiseSet': {}});
    assert.equal(KasiDefaults._getServiceKeys().length, 0);
    assert.equal(Kasi._getServiceKeys().length, 3, 'normal, test_normal, forecast key');
    const Requester = load('lib/lifeIndexKmaRequester.js', {'request': fakeRequest(() => ({})), 'async': async, '../lib/kmaTimeLib': kmaTimeLib});
    const service = new Requester();
    service.setServiceKey(defaults.cert_key, defaults);
    assert.equal(plain(service.serviceKeyList).length, 1, 'only the legacy first key remains');
});

test('review: when every key is rejected the chosen key is kept and KASI does not retry', async () => {
    const rejected = {statusCode: 401, body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE ERROR', returnReasonCode: '31'}}}};
    const kasiRequest = fakeRequest(() => rejected);
    const Kasi = loadKasi(kasiRequest);
    Kasi._keyIndex = 1;
    const result = await new Promise(resolve => Kasi.updateAreaRiseSetFromApi('서울', '20260926', resolve));
    assert(result && result.allKeysRejected, 'error marks all keys rejected');
    assert.equal(kasiRequest.calls.length, 3, 'each key once; async.retry stops (no 3 x 3 calls)');
    assert.equal(Kasi._keyIndex, 1, 'previous key choice kept');

    const uvRequest = fakeRequest(() => rejected);
    const {service} = loadRequester(uvRequest, []);
    service._useServiceKeyV5(2);
    const err = await new Promise(resolve => service.taskUltrvV5(new Date('2026-09-26T03:55:00Z'), resolve));
    assert(err && err.isAuthError);
    assert.equal(uvRequest.calls.length, 5, 'each of the five distinct keys once (cert, test cert, normal, test normal, forecast)');
    assert.equal(service.serviceKeyIndex, 2, 'previous key choice kept');
});
