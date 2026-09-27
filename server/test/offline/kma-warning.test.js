/* KMA warning collection regressions (#2609).
 * Run with Node >=16.20.2 and async on NODE_PATH:
 *   TZ=UTC NODE_PATH=/tmp/tw-2609/node_modules node server/test/offline/kma-warning.test.js
 * Loads production modules in an isolated VM. HTTP, models and config are stubs;
 * no app startup, provider call, Mongo or timer is reachable.
 * fixtures/kma-warning/*.json are live WthrWrnInfoService responses recorded on 2026-09-27
 * (no key in any body). pwn-cd-0921-0927.json is the getPwnCd window 2026-09-21..27 in the
 * provider's newest-first order; pwn-cd-daily-excerpt.json holds every 2026-07-30..09-27 row of
 * 합천군서북부, 김천시북부, 김천시남부, 부산서부 and 상주시, fetched one KST day per request (multi-page
 * windows dropped release rows at page boundaries).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const async = require('async');
const root = path.resolve(__dirname, '../..');
const logs = [];
const log = Object.fromEntries(['info','warn','error','debug','verbose','silly'].map(k => [k, (...args) => logs.push({level: k, args})]));
const pad = name => name + 'x'.repeat(40);
// Stored keys are percent-encoded; the requester must not encode them twice.
const APPROVED = pad('APPROVED%2BKEY%3D%3D');
const REJECTED = pad('REJECTED%2FKEY');

function Stub() {}
function load(relative, dependencies = {}, clock = Date) {
    const module = {exports: {}};
    const sandbox = {module, exports: module.exports, console, log, Date: clock, setTimeout, clearTimeout, setImmediate, __dirname: path.dirname(path.join(root, relative)),
        require: name => Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : Stub};
    sandbox.global = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, {filename: relative});
    return module.exports;
}
function fixedClock(iso) {
    const fixed = new Date(iso).getTime();
    return class FixedDate extends Date {
        constructor(...args) { if (args.length) { super(...args); } else { super(fixed); } }
        static now() { return fixed; }
    };
}
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/kma-warning', name + '.json'), 'utf8'));
const itemsOf = body => body.response.body.items.item;
const page = (items, extra = {}) => ({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
    body: Object.assign({dataType: 'JSON', items: {item: items}, pageNo: 1, numOfRows: 10, totalCount: items.length}, extra)}});
const NODATA = {response: {header: {resultCode: '03', resultMsg: 'NODATA_ERROR'}}};

// Minimal mongoose stand-in: the model file only defines a schema, statics and indexes.
const fakeMongoose = {
    Schema: function (definition) { this.definition = definition; this.statics = {}; this.index = function () {}; },
    model: (name, schema) => { const M = function () {}; Object.assign(M, schema.statics); M.modelName = name; M.schema = schema; return M; }
};
fakeMongoose.Schema.Types = {Mixed: Object};
// A missing module fails only the tests that use it (intended Red before implementation).
const tryLoad = (...args) => { try { return load(...args); } catch (err) { return {loadError: err}; } };
const Situation = tryLoad('models/modelKmaSpecialWeatherSituation.js', {mongoose: fakeMongoose});
const ZoneModelDef = tryLoad('models/modelKmaSpecialWeatherZone.js', {mongoose: fakeMongoose});
const zones = tryLoad('lib/kmaWarningZones.js', {fs, path});
const situationStatics = () => ({parseSpecialText: Situation.parseSpecialText, parsePreliminaryText: Situation.parsePreliminaryText,
    TYPE_SPECIAL: 1, TYPE_PRELIMINARY_SPECIAL: 2, TYPE_WEATHER_INFORMATION: 3, TYPE_WEATHER_FLASH: 4});

// In-memory collection with the chained mongoose calls the production code uses.
function memoryModel(statics = {}) {
    const docs = [];
    const matches = (doc, query) => Object.keys(query).every(key => {
        const cond = query[key];
        const value = doc[key];
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            if ('$in' in cond) { return cond.$in.indexOf(value) !== -1; }
            if ('$ne' in cond) { return value !== cond.$ne; }
            if ('$gt' in cond) { return value > cond.$gt; }
        }
        if (cond instanceof Date || value instanceof Date) { return new Date(cond).getTime() === new Date(value).getTime(); }
        return value === cond;
    });
    const model = Object.assign({
        docs, calls: [],
        find(query) {
            model.calls.push(['find', query]);
            let result = docs.filter(doc => matches(doc, query));
            const chain = {
                sort(spec) { const key = Object.keys(spec)[0]; result = result.slice().sort((a, b) => (a[key] > b[key] ? 1 : -1) * spec[key]); return chain; },
                limit(n) { result = result.slice(0, n); return chain; },
                lean() { return chain; },
                exec(cb) { const out = plain(result).map(doc => { Object.keys(doc).forEach(k => { if (/^\d{4}-\d\d-\d\dT/.test(doc[k])) { doc[k] = new Date(doc[k]); } }); return doc; }); setImmediate(() => model.failFind ? cb(new Error('find failed')) : cb(null, out)); }
            };
            return chain;
        },
        update(query, doc, options, cb) {
            model.calls.push(['update', query]);
            if (model.failUpdate) { return setImmediate(() => cb(new Error('update failed'))); }
            const existing = docs.find(d => matches(d, query));
            if (existing) { Object.assign(existing, plain(doc)); } else { docs.push(Object.assign(plain(query), plain(doc))); }
            setImmediate(() => cb(null));
        }
    }, statics);
    return model;
}

// Provider stub: routes by operation; handler(operation, params) returns {statusCode, body} or an Error.
function fakeProvider(handler) {
    const calls = [];
    const request = (url, opts, cb) => {
        const parsed = new URL(url);
        const operation = parsed.pathname.split('/').pop();
        const params = Object.fromEntries(parsed.searchParams.entries());
        const rawKey = /serviceKey=([^&]*)/.exec(url)[1];
        calls.push({operation, params, rawKey, url});
        const result = handler(operation, params, rawKey, calls.length);
        setImmediate(() => result instanceof Error ? cb(result) : cb(null, {statusCode: result.statusCode || 200},
            typeof result.body === 'string' ? result.body : JSON.parse(JSON.stringify(result.body))));
    };
    request.calls = calls;
    return request;
}

const keyBox = {normal: 'You have to set key of data.go.kr', test_normal: 'You have to set key of data.go.kr', dongnae_forecast_keys: JSON.stringify([REJECTED, APPROVED])};
const Requester = tryLoad('lib/kmaWarningRequester.js', {request: Stub, '../config/config': {keyString: keyBox}});

function makeCollector({handler, clock = fixedClock('2026-09-26T02:35:00Z'), situationModel, zoneModel, keys = [APPROVED]}) {
    const request = fakeProvider(handler);
    const Collector = load('lib/kmaWarningCollector.js', {
        async, './kmaWarningRequester': Requester, './kmaWarningZones': zones,
        '../models/modelKmaSpecialWeatherSituation': situationModel, '../models/modelKmaSpecialWeatherZone': zoneModel
    }, clock);
    const collector = new Collector({requester: new Requester({keys, request})});
    return {collector, request};
}
const gather = collector => new Promise(resolve => collector.gather(err => resolve(err)));

// 2026-09-26 11:30 KST announcement (tmSeq 128): getPwnStatus reports the same t6/t7/other as the
// matching getWthrWrnMsg item (checked on the recorded tmSeq 130 pair).
const wrnMsgDay = itemsOf(fixture('wrn-msg-0926'));
const statusFor = seq => { const m = wrnMsgDay.find(i => i.tmSeq === seq); return page([{other: m.other, t6: m.t6, t7: m.t7, tmEf: String(m.t5), tmFc: m.tmFc, tmSeq: m.tmSeq}]); };
const pwnCdRows = itemsOf(fixture('pwn-cd-0921-0927'));
const pwnCdUntil = seq => pwnCdRows.filter(r => r.tmFc < 202609261200 && (r.tmFc < 202609260000 || r.tmSeq <= seq || r.tmSeq > 200));
function routes(overrides = {}) {
    return (operation, params) => {
        if (overrides[operation]) { return overrides[operation](params); }
        switch (operation) {
        case 'getPwnStatus': return {body: statusFor(128)};
        case 'getWthrWrnMsg': return {body: page(wrnMsgDay)};
        case 'getPwnCd': return {body: page(pwnCdUntil(128), {numOfRows: 1000, totalCount: 104})};
        case 'getWthrPwn': return {body: fixture('wthr-pwn')};
        case 'getWthrInfo': return {body: fixture('wthr-info')};
        case 'getWthrBrkNews': return {body: fixture('brk-news')};
        default: throw new Error('unexpected operation ' + operation);
        }
    };
}

// ---------------------------------------------------------------------------------------------
test('situation codes: 폭풍해일/지진해일 reachable, 열대야 and 중대경보 added (A31, decision 9)', () => {
    const legacy = plain(Situation.strArray2SituationList(['폭풍해일주의보:부산', '지진해일경보:울산', '열대야주의보:서울', '폭염중대경보:대구']));
    assert.deepEqual(legacy.map(s => [s.weather, s.level]), [[7, 1], [8, 2], [13, 1], [12, 4]]);
    const list = plain(Situation.parseSpecialText('o 폭풍해일주의보 : 부산\r\no 지진해일경보 : 울산\r\no 해일주의보 : 인천\r\no 열대야주의보 : 서울\r\no 폭염중대경보 : 대구'));
    assert.deepEqual(list.map(s => [s.weather, s.weatherStr, s.level, s.levelStr]),
        [[7, '폭풍해일', 1, '주의보'], [8, '지진해일', 2, '경보'], [6, '해일', 1, '주의보'], [13, '열대야', 1, '주의보'], [12, '폭염', 4, '중대경보']]);
    assert.deepEqual(plain(Situation.parseSpecialText('o 없 음')), [{weather: 0, weatherStr: '없음', level: 0, levelStr: '', info: []}]);
    assert.deepEqual(plain(zones.weatherOf(5)), {weather: 7, weatherStr: '폭풍해일'});
    assert.deepEqual(plain(zones.weatherOf(13)), {weather: 13, weatherStr: '열대야'});
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13].map(v => zones.weatherOf(v).weather), [1, 3, 9, 5, 7, 2, 10, 4, 11, 12, 13]);
    assert.deepEqual([0, 1, 2].map(s => plain(zones.levelOf(s))), [{level: 1, levelStr: '주의보'}, {level: 2, levelStr: '경보'}, {level: 4, levelStr: '중대경보'}]);
    assert.ok(ZoneModelDef.schema, 'zone model defined');
});

test('t6 and preliminary texts keep readable locations', () => {
    const t6 = wrnMsgDay.find(i => i.tmSeq === 128).t6;
    const list = plain(Situation.parseSpecialText(t6));
    assert.deepEqual(list.map(s => s.weatherStr + s.levelStr), ['강풍주의보', '호우경보', '호우주의보']);
    assert.equal(list[2].info[0].location, '제주도(제주시동부, 서귀포시남부, 서귀포시동부, 서귀포시중산간)');
    const exclusion = plain(Situation.parseSpecialText(wrnMsgDay.find(i => i.tmSeq === 125).t6));
    assert.equal(exclusion[0].info[0].location, '전라남도(거문도.초도), 제주도(추자도, 서귀포시남부 제외)');
    const pwn = plain(Situation.parsePreliminaryText('(1) 강풍 예비특보\r\no 06월 07일 아침 : 울릉도.독도\r\n(2) 풍랑 예비특보\r\no 06월 07일 아침 : 동해중부전해상\r\no 06월 07일 낮 : 동해남부먼바다'));
    assert.deepEqual(pwn.map(s => [s.weatherStr, s.levelStr, s.level]), [['강풍', '예비특보', 3], ['풍랑', '예비특보', 3]]);
    assert.deepEqual(pwn[1].info, [{timeStr: '06월 07일 아침', location: '동해중부전해상'}, {timeStr: '06월 07일 낮', location: '동해남부먼바다'}]);
    assert.deepEqual(plain(Situation.parsePreliminaryText('o 없음')), [{weather: 0, weatherStr: '없음', level: 0, levelStr: '', info: []}]);
});

// ---------------------------------------------------------------------------------------------
test('requester: stored key sent once-encoded, auth rotation, error classes (AC9)', async () => {
    const call = (requester, op, params) => new Promise(resolve => requester.get(op, params, (err, res) => resolve({err, res})));
    let request = fakeProvider((op, params, rawKey) => rawKey === APPROVED ? {body: fixture('pwn-status')} : {statusCode: 403, body: fixture('err-30')});
    let requester = new Requester({request});
    assert.deepEqual(plain(requester.keys), [REJECTED, APPROVED], 'unset defaults skipped, forecast keys kept');
    let out = await call(requester, 'getPwnStatus', {numOfRows: 10});
    assert.equal(out.err, null);
    assert.equal(out.res.items[0].tmSeq, 130);
    assert.deepEqual(request.calls.map(c => c.rawKey), [REJECTED, APPROVED], 'rotates once on code 30, no double encoding');
    assert.equal(request.calls[0].params.dataType, 'JSON');
    out = await call(requester, 'getPwnStatus', {});
    assert.equal(request.calls[2].rawKey, APPROVED, 'keeps the working key');

    const cases = [
        [{statusCode: 403, body: fixture('err-30')}, e => e.isAuthError && e.returnCode === '30'],
        [{statusCode: 429, body: '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'}, e => e.isQuotaError && e.returnCode === '22'],
        [{body: {OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', returnReasonCode: '22'}}}}, e => e.isQuotaError],
        [{body: fixture('err-99')}, e => e.returnCode === '99' && !e.isAuthError && !e.isQuotaError],
        [{statusCode: 500, body: 'Internal'}, e => e.statusCode === 500],
        [new Error('socket hang up'), e => /socket hang up/.test(e.message)]
    ];
    for (const [result, check] of cases) {
        request = fakeProvider(() => result);
        requester = new Requester({keys: [APPROVED, pad('SECOND')], request});
        out = await call(requester, 'getWthrInfo', {stnId: 108});
        assert.ok(out.err && check(out.err), JSON.stringify(result).slice(0, 80) + ' -> ' + (out.err && out.err.message));
        assert.equal(request.calls.length, out.err.isAuthError ? 2 : 1, 'quota and other errors are not retried');
        assert.ok(out.err.message.indexOf('APPROVED') === -1 && out.err.message.indexOf('SECOND') === -1, 'no key in message');
    }
    request = fakeProvider(() => ({body: NODATA}));
    out = await call(new Requester({keys: [APPROVED], request}), 'getWthrBrkNews', {});
    assert.equal(out.err, null);
    assert.equal(out.res.noData, true);
});

test('requester: pages until a short page, ignoring totalCount', async () => {
    const rows = Array.from({length: 2500}, (_, i) => ({areaCode: 'L' + i, tmFc: 202609260000 + i}));
    const request = fakeProvider((op, params) => {
        const n = Number(params.numOfRows); const p = Number(params.pageNo);
        return {body: page(rows.slice((p - 1) * n, p * n), {numOfRows: n, pageNo: p, totalCount: 104})};
    });
    const requester = new Requester({keys: [APPROVED], request});
    const all = await new Promise((resolve, reject) => requester.getAll('getPwnCd', {fromTmFc: '20260729'}, (err, items) => err ? reject(err) : resolve(items)));
    assert.equal(all.length, 2500);
    assert.deepEqual(request.calls.map(c => c.params.pageNo), ['1', '2', '3']);
});

// ---------------------------------------------------------------------------------------------
test('replay: per-type releases over day-by-day rows (AC5, re-review 1)', () => {
    const rows = itemsOf(fixture('pwn-cd-daily-excerpt'));
    const activeAt = until => {
        const state = {};
        zones.applyEvents(state, zones.prepareEvents(rows.filter(r => r.tmFc <= until)));
        return Object.values(state).filter(e => e.active && e.warnVar > 0).map(e => e.areaCode + ':' + e.warnVar + '/' + e.warnStress).sort();
    };
    assert.deepEqual(plain(activeAt(202609271200)), [], 'no active zone on 2026-09-27, as t6 "o 없 음"');
    // A release with a nonzero allEndTime ends only its own type: 부산서부 폭염 outlives the 열대야 release.
    assert.deepEqual(plain(activeAt(202609021500)).filter(k => k.indexOf('L1082700:') === 0), ['L1082700:12/0', 'L1082700:13/0']);
    assert.deepEqual(plain(activeAt(202609030300)).filter(k => k.indexOf('L1082700:') === 0), ['L1082700:12/0']);
    assert.deepEqual(plain(activeAt(202608090300)).filter(k => k.indexOf('L1071200:') === 0), ['L1071200:12/1'], '상주시 폭염경보 still active');
});

test('replay: order, dedupe, cancel, change-issue, idempotence and late rows (AC5)', () => {
    const row = (tmFc, tmSeq, command, extra = {}) => Object.assign({areaCode: 'L1091430', areaName: '서귀포시동부', warnVar: 2, warnStress: 0, command: String(command), cancel: '0',
        tmFc, tmSeq, startTime: 0, endTime: 0, allEndTime: 0, stnId: '108'}, extra);
    const issue = row(202609260600, 117, 1);
    const change = row(202609261100, 127, 7, {warnStress: 1});
    const cancelled = row(202609261110, 128, 2, {cancel: '1'});
    const release = row(202609261140, 129, 2, {endTime: 202609261140});
    // Unordered and duplicated, as consecutive provider pages repeat boundary rows.
    let events = zones.prepareEvents([change, issue, change, cancelled]);
    assert.equal(events.length, 2, 'duplicate removed, cancelled ignored');
    const state = {};
    let changed = zones.applyEvents(state, events);
    const key = zones.stateKey('L1091430', 2);
    assert.deepEqual(plain(changed), [key]);
    assert.deepEqual([state[key].active, state[key].warnStress, state[key].eventTmSeq], [true, 1, 127]);
    changed = zones.applyEvents(state, zones.prepareEvents([issue, change]));
    assert.deepEqual(plain(changed), [], 'replaying the overlap changes nothing');
    zones.applyEvents(state, zones.prepareEvents([release]));
    assert.equal(state[key].active, false);
    changed = zones.applyEvents(state, zones.prepareEvents([change]));
    assert.deepEqual(plain(changed), [], 'an older late row cannot reactivate');
    // Same announcement: release of 주의보 and issue of 경보 for one warnVar → releases first.
    const s2 = {};
    zones.applyEvents(s2, zones.prepareEvents([row(202609261000, 125, 1, {warnStress: 1}), row(202609261000, 125, 2)]));
    assert.deepEqual([s2[key].active, s2[key].warnStress], [true, 1]);
    // Releasing one type leaves the zone's other types active.
    const s3 = {};
    zones.applyEvents(s3, zones.prepareEvents([row(202609010000, 1, 1, {warnVar: 13}), row(202609010000, 1, 1, {warnVar: 12}),
        row(202609020000, 2, 2, {warnVar: 13, allEndTime: 202609020000})]));
    assert.deepEqual([s3[zones.stateKey('L1091430', 13)].active, s3[zones.stateKey('L1091430', 12)].active], [false, true]);
});

// ---------------------------------------------------------------------------------------------
test('town mapping: zone table, islands, metropolitan cities and split parents (decision 8)', () => {
    const names = town => plain(zones.zonesForTown(town).map(code => zones.zoneName(code))).sort();
    const seogwipo = names({first: '제주특별자치도', second: '서귀포시', third: '성산읍'});
    assert.deepEqual(seogwipo, ['서귀포시(산지 제외)', '서귀포시남부', '서귀포시동부', '서귀포시서부', '서귀포시중산간', '전국', '제주도', '제주도산지'].sort());
    // AK decision (2026-09-27, verification F2): the shared mountain zone reaches both cities.
    assert.ok(names({first: '제주특별자치도', second: '제주시', third: '노형동'}).indexOf('제주도산지') !== -1);
    assert.ok(names({first: '제주특별자치도', second: '제주시', third: '노형동'}).indexOf('서귀포시동부') === -1);
    assert.deepEqual(names({first: '제주특별자치도', second: '제주시', third: '추자면'}), ['전국', '제주도', '추자도']);
    assert.ok(names({first: '경기도', second: '수원시장안구', third: '파장동'}).indexOf('수원시') !== -1);
    assert.deepEqual(names({first: '경기도', second: '파주시', third: '문산읍'}).filter(n => n.indexOf('파주') === 0), ['파주시', '파주시남부', '파주시동북부', '파주시서북부']);
    assert.deepEqual(names({first: '서울특별시', second: '강남구', third: '역삼동'}).filter(n => n.indexOf('서울') === 0), ['서울동남권', '서울동북권', '서울서남권', '서울서북권', '서울특별시']);
    const incheon = names({first: '인천광역시', second: '남동구', third: '구월동'});
    assert.ok(incheon.indexOf('강화군') === -1 && incheon.indexOf('옹진군') === -1 && incheon.indexOf('인천광역시') !== -1);
    assert.ok(names({first: '인천광역시', second: '강화군', third: ''}).indexOf('강화군') !== -1);
    assert.ok(names({first: '인천광역시', second: '옹진군', third: '백령면'}).indexOf('백령도.대청도') !== -1);
    const daegu = names({first: '대구광역시', second: '중구', third: ''});
    assert.ok(daegu.indexOf('대구중부') !== -1 && daegu.indexOf('군위군') === -1 && daegu.indexOf('달성군') === -1);
    assert.ok(names({first: '대구광역시', second: '군위군', third: ''}).indexOf('군위군') !== -1);
    assert.ok(names({first: '경상북도', second: '울릉군', third: '울릉읍'}).indexOf('울릉도.독도') !== -1);
    assert.ok(names({first: '전라남도', second: '신안군', third: '흑산면'}).indexOf('흑산도.홍도') !== -1);
    assert.ok(names({first: '전라남도', second: '여수시', third: '삼산면'}).indexOf('거문도.초도') !== -1);
    assert.ok(names({first: '강원특별자치도', second: '강릉시', third: ''}).indexOf('강릉시산지') !== -1);
    assert.ok(names({first: '전북특별자치도', second: '군산시', third: ''}).indexOf('군산어청도') !== -1);
    assert.ok(names({first: '경상남도', second: '', third: ''}).indexOf('창원시') !== -1, 'region-level request covers the province');
    assert.deepEqual(plain(zones.zonesForTown({first: '', second: '', third: ''})), []);
    // Legacy town names in base.csv/town.js (independent verification F1): no province-wide fallback.
    assert.deepEqual(names({first: '경상북도', second: '군위군', third: '군위읍'}), ['군위군', '대구광역시', '전국'], '군위군 moved to 대구 in 2023');
    assert.ok(names({first: '충청북도', second: '청원군', third: ''}).indexOf('청주시') !== -1, '청원군 merged into 청주시');
    assert.ok(names({first: '충청북도', second: '청원군', third: ''}).indexOf('충주시') === -1);
    assert.deepEqual(names({first: '경상북도', second: '없는군', third: ''}), ['경상북도', '전국'], 'unknown city: province-level zones only');
});

test('specialInfo from active zones (AC6, AC7)', () => {
    const entry = (areaCode, areaName, warnVar, warnStress) => ({areaCode, areaName, warnVar, warnStress, active: true});
    const active = [entry('L1091430', '서귀포시동부', 2, 1), entry('L1090500', '제주도산지', 2, 1), entry('L1091420', '서귀포시남부', 13, 0),
        entry('L1091410', '서귀포시서부', 2, 2), entry('L1091420', '서귀포시남부', 2, 1)];
    const town = {first: '제주특별자치도', second: '서귀포시', third: '성산읍'};
    const info = plain(zones.specialInfoFor(active, zones.zonesForTown(town)));
    assert.deepEqual(info, [
        {weather: 13, weatherStr: '열대야', level: 1, levelStr: '주의보', locationName: '서귀포시남부'},
        {weather: 3, weatherStr: '호우', level: 4, levelStr: '중대경보', locationName: '서귀포시서부'},
        {weather: 3, weatherStr: '호우', level: 2, levelStr: '경보', locationName: '서귀포시남부'},
        {weather: 3, weatherStr: '호우', level: 2, levelStr: '경보', locationName: '서귀포시동부'},
        {weather: 3, weatherStr: '호우', level: 2, levelStr: '경보', locationName: '제주도산지'}]);
    assert.equal(plain(zones.specialInfoFor([entry('L1091430', '서귀\ufffd\ufffd동부', 2, 0)], zones.zonesForTown(town)))[0].locationName, '서귀포시동부', 'zone table name over a garbled provider name');
    const jeju = plain(zones.specialInfoFor(active, zones.zonesForTown({first: '제주특별자치도', second: '제주시', third: '노형동'})));
    assert.deepEqual(jeju, [{weather: 3, weatherStr: '호우', level: 2, levelStr: '경보', locationName: '제주도산지'}], '서귀포 sub-zones do not reach 제주시; the mountain zone does');
});

// ---------------------------------------------------------------------------------------------
test('collector: stores types 1-4, applies zone state, skips repeats (AC1, AC2, AC4)', async () => {
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    const {collector, request} = makeCollector({handler: routes(), situationModel: situations, zoneModel: zoneStore});
    assert.equal(await gather(collector), undefined);
    const byType = t => plain(situations.docs.find(d => d.type === t));
    const t1 = byType(1);
    assert.equal(new Date(t1.announcement).toISOString(), '2026-09-26T11:30:00.000Z', 'KST wall clock stored as UTC');
    assert.deepEqual(t1.situationList.map(s => s.weatherStr + s.levelStr), ['강풍주의보', '호우경보', '호우주의보']);
    assert.equal(t1.comment, wrnMsgDay.find(i => i.tmSeq === 128).other.replace(/\r/g, '').trim());
    const msg = wrnMsgDay.find(i => i.tmSeq === 128);
    assert.deepEqual(t1.bulletin, {title: msg.t1, areas: msg.t2.replace(/\r/g, ''), effectiveTimes: msg.t3.replace(/\r/g, ''), releaseOutlook: msg.t4.replace(/\r/g, '')});
    assert.equal(t1.imageUrl, undefined);
    const t2 = byType(2);
    assert.deepEqual(t2.situationList.map(s => s.weatherStr), ['없음']);
    assert.ok(t2.comment.indexOf('<예비특보 추가 발표 현황>') === 0);
    assert.equal(byType(3).comment, itemsOf(fixture('wthr-info'))[0].t1.replace(/\r/g, '').trim());
    assert.equal(new Date(byType(4).announcement).toISOString(), '2026-09-27T09:10:00.000Z', 'latest flash by tmFc');
    assert.ok(byType(4).comment.indexOf('<') === 0);
    // Zone state at 11:30: 서귀포시동부 has 강풍주의보 and 호우주의보.
    const active = zoneStore.docs.filter(d => d.active && d.warnVar > 0 && d.areaCode === 'L1091430').map(d => d.warnVar + '/' + d.warnStress).sort();
    assert.deepEqual(active, ['1/0', '2/0']);
    const days = request.calls.filter(c => c.operation === 'getPwnCd');
    assert.equal(days.length, 60, 'empty state bootstraps 60 days, one KST day per request');
    assert.deepEqual([days[0].params.fromTmFc, days[0].params.toTmFc, days[59].params.fromTmFc, days[59].params.toTmFc], ['20260729', '20260729', '20260926', '20260926']);
    // A single page per day (re-review 2): numOfRows 10000 returned all 4,499 rows of 60 days in one page.
    assert.ok(days.every(c => c.params.numOfRows === '10000' && c.params.pageNo === '1'));
    const msgCall = request.calls.find(c => c.operation === 'getWthrWrnMsg');
    assert.deepEqual([msgCall.params.stnId, msgCall.params.fromTmFc, msgCall.params.toTmFc], ['108', '20260926', '20260926']);
    assert.deepEqual(request.calls.map(c => c.operation).filter(op => op !== 'getPwnCd'), ['getPwnStatus', 'getWthrWrnMsg', 'getWthrPwn', 'getWthrInfo', 'getWthrBrkNews']);

    const count = situations.docs.length;
    request.calls.length = 0;
    assert.equal(await gather(collector), 'skip');
    assert.deepEqual(request.calls.map(c => c.operation), ['getPwnStatus', 'getWthrPwn', 'getWthrInfo', 'getWthrBrkNews'], 'no bulletin or zone call without a change');
    assert.equal(situations.docs.length, count);
});

test('collector: a lagging announcement stays pending and is retried (AC4, decision 6)', async () => {
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    let msgReady = false; let cdReady = false;
    const handler = routes({
        getWthrWrnMsg: () => ({body: page(wrnMsgDay.filter(i => msgReady || i.tmSeq !== 128))}),
        getPwnCd: () => ({body: page(pwnCdUntil(cdReady ? 128 : 127), {numOfRows: 1000})})
    });
    const clock = {now: Date.parse('2026-09-26T02:35:00Z')};
    const Clock = class extends Date { constructor(...a) { if (a.length) { super(...a); } else { super(clock.now); } } static now() { return clock.now; } };
    const {collector, request} = makeCollector({handler, clock: Clock, situationModel: situations, zoneModel: zoneStore});
    await gather(collector);
    assert.equal(situations.docs.filter(d => d.type === 1).length, 0, 'bulletin missing: not processed');
    msgReady = true; clock.now += 3 * 60000;
    await gather(collector);
    assert.equal(situations.docs.filter(d => d.type === 1).length, 0, 'zone rows missing: not processed');
    const windows = request.calls.filter(c => c.operation === 'getPwnCd').map(c => c.params.fromTmFc);
    assert.deepEqual(windows.slice(60), ['20260925', '20260926'], 'incremental sync overlaps the previous sync by a day');
    cdReady = true; clock.now += 3 * 60000;
    await gather(collector);
    assert.equal(situations.docs.filter(d => d.type === 1).length, 1, 'processed once both operations reflect it');
    // Early or late announcements need no schedule: a new tmSeq is picked up on the next poll.
    request.calls.length = 0; clock.now += 60000;
    await gather(collector);
    assert.ok(request.calls.every(c => c.operation !== 'getPwnCd'), 'no resync within the hour');
    clock.now += 61 * 60000;
    request.calls.length = 0;
    await gather(collector);
    assert.equal(request.calls.filter(c => c.operation === 'getPwnCd').length, 2, 'hourly resync without a change (yesterday and today)');
});

test('collector: bulletin permanently missing is stored without it after the retry budget', async () => {
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    const handler = routes({getWthrWrnMsg: () => ({body: NODATA})});
    const {collector} = makeCollector({handler, situationModel: situations, zoneModel: zoneStore});
    for (let i = 0; i < 19; i++) { await gather(collector); }
    assert.equal(situations.docs.filter(d => d.type === 1).length, 0);
    await gather(collector);
    const t1 = situations.docs.find(d => d.type === 1);
    assert.ok(t1 && t1.bulletin === undefined);
    assert.ok(logs.some(l => l.level === 'warn' && /without bulletin/.test(l.args.join(' '))));
});

test('collector: errors leave documents and state unchanged (AC9)', async () => {
    const errorBodies = {
        auth: {statusCode: 403, body: fixture('err-30')},
        quota: {statusCode: 429, body: '<returnReasonCode>22</returnReasonCode>'},
        range: {body: fixture('err-99')},
        nodata: {body: NODATA}
    };
    for (const [name, result] of Object.entries(errorBodies)) {
        const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
        const handler = () => result;
        const {collector, request} = makeCollector({handler, situationModel: situations, zoneModel: zoneStore});
        const err = await gather(collector);
        assert.equal(situations.docs.length, 0, name);
        assert.equal(zoneStore.docs.filter(d => d.areaCode !== '_sync').length, 0, name);
        if (name === 'nodata') { assert.equal(err, 'skip'); } else { assert.ok(err && err !== 'skip', name); }
        if (name === 'quota') { assert.equal(request.calls.length, 1, 'quota stops the cycle'); }
        if (name === 'auth') { assert.equal(request.calls.filter(c => c.operation === 'getPwnStatus').length, 1, 'single key: no retry'); }
    }
    // A failed zone write stores no type 1 document.
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    zoneStore.failUpdate = true;
    const {collector} = makeCollector({handler: routes(), situationModel: situations, zoneModel: zoneStore});
    const err = await gather(collector);
    assert.ok(err && err !== 'skip');
    assert.equal(situations.docs.filter(d => d.type === 1).length, 0);
});

test('collector: drift between zone state and t6 is logged', async () => {
    logs.length = 0;
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    const handler = routes({getPwnStatus: () => ({body: fixture('pwn-status')}), getWthrWrnMsg: () => ({body: page(wrnMsgDay)})});
    const {collector} = makeCollector({handler, situationModel: situations, zoneModel: zoneStore});
    await gather(collector);
    assert.ok(logs.some(l => l.level === 'warn' && /t6/.test(l.args.join(' '))), 'state at tmSeq 128 is active while t6 is none');
});

// ---------------------------------------------------------------------------------------------
function loadController(situationModel, zoneModel, clock = Date) {
    return load('controllers/kma.specialweather.controller.js', {async, '../models/modelKmaSpecialWeatherSituation': situationModel,
        '../models/modelKmaSpecialWeatherZone': zoneModel, '../lib/kmaWarningZones': zones}, clock);
}
const trans = {__: key => key};

test('controller getCurrent: announcement instant, bulletin, missing comment (AC3)', async () => {
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    const {collector} = makeCollector({handler: routes(), situationModel: situations, zoneModel: zoneStore});
    await gather(collector);
    situations.docs.find(d => d.type === 2).comment = undefined;
    const Controller = loadController(situations, zoneStore, fixedClock('2026-09-27T01:00:00Z'));
    const list = plain(await new Promise((resolve, reject) => new Controller().getCurrent(trans, (err, l) => err ? reject(err) : resolve(l))));
    assert.deepEqual(list.map(s => s.type), [4, 1, 2, 3]);
    const t1 = list.find(s => s.type === 1);
    assert.equal(t1.announcement, '2026-09-26T02:30:00.000Z', 'tmFc 202609261130 KST');
    assert.equal(t1.bulletin.title, '강풍주의보·호우주의보 해제');
    assert.equal(list.find(s => s.type === 2).comment, '');
    assert.equal(list.find(s => s.type === 4).announcement, '2026-09-27T00:10:00.000Z');
});

test('controller keeps hazard, level and zone order for long lists (independent verification F3)', () => {
    const Controller = loadController(memoryModel(situationStatics()), memoryModel());
    const list = [];
    for (let i = 0; i < 24; i++) { list.push({weather: 3, weatherStr: '호우', level: i % 3 === 0 ? 2 : 1, levelStr: '', locationName: 'Z' + String(100 - i)}); }
    const sorted = plain(new Controller()._sort(list));
    assert.equal(sorted[0].level, 2, 'a 경보 leads the summary');
    for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        assert.ok(a.weather > b.weather || (a.weather === b.weather && (a.level > b.level || (a.level === b.level && a.locationName <= b.locationName))), 'order at ' + i);
    }
});

test('controller getSpecialInfo reads active zones for the town (AC6, AC8)', async () => {
    const situations = memoryModel(situationStatics()); const zoneStore = memoryModel();
    const {collector} = makeCollector({handler: routes(), situationModel: situations, zoneModel: zoneStore});
    await gather(collector);
    const Controller = loadController(situations, zoneStore);
    const info = town => new Promise((resolve, reject) => new Controller().getSpecialInfo(town, '서귀포', (err, l) => err ? reject(err) : resolve(plain(l))));
    const seogwipo = await info({first: '제주특별자치도', second: '서귀포시', third: '성산읍'});
    assert.deepEqual(seogwipo.map(s => s.weatherStr + s.levelStr + '@' + s.locationName),
        ['호우경보@제주도산지', '호우주의보@서귀포시남부', '호우주의보@서귀포시동부', '호우주의보@서귀포시중산간', '강풍주의보@서귀포시동부', '강풍주의보@서귀포시중산간', '강풍주의보@제주도산지']);
    assert.deepEqual(await info({first: '서울특별시', second: '강남구', third: '역삼동'}), []);
    // After the 12:00 release (t6 "o 없 음") the state is empty.
    const later = makeCollector({handler: routes({getPwnStatus: () => ({body: fixture('pwn-status')}),
        getPwnCd: () => ({body: page(pwnCdRows, {numOfRows: 1000})})}), clock: fixedClock('2026-09-26T04:40:00Z'), situationModel: situations, zoneModel: zoneStore});
    await gather(later.collector);
    assert.deepEqual(await info({first: '제주특별자치도', second: '서귀포시', third: '성산읍'}), []);
    await assert.rejects(new Promise((resolve, reject) => new Controller().getSpecialInfo(undefined, '', (err, l) => err ? reject(err) : resolve(l))));
});

test('scraper delegates to the collector and no longer scrapes status.jsp (AC10)', () => {
    const source = fs.readFileSync(path.join(root, 'lib/kmaScraper.js'), 'utf8');
    assert.equal(source.indexOf('weather/warning/status.jsp'), -1);
    assert.ok(/require\('\.\/kmaWarningCollector'\)/.test(source));
});
