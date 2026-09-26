'use strict';
// All provider data in this suite is SYNTHETIC, not a captured live response.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./harness');
var KEY = 'OFFLINE_ONLY_SERVICE_KEY_2555';
var routes = {
    TOWN_CURRENT: ['VilageFcstInfoService_2.0/getUltraSrtNcst', 'organizeCurrentData'],
    TOWN_SHORTEST: ['VilageFcstInfoService_2.0/getUltraSrtFcst', 'organizeShortestData'],
    TOWN_SHORT: ['VilageFcstInfoService_2.0/getVilageFcst', 'organizeShortData'],
    MID_FORECAST: ['MidFcstInfoService/getMidFcst', 'organizeForecastData'],
    MID_LAND: ['MidFcstInfoService/getMidLandFcst', 'organizeLandData'],
    MID_TEMP: ['MidFcstInfoService/getMidTa', 'organizeTempData'],
    MID_SEA: ['MidFcstInfoService/getMidSeaFcst', 'organizeSeaData']
};
function source(file) { return fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'); }
function receive(body, status, error, done) {
    var logs = [];
    var c = h.prepare(h.collector({get: function (url, options, cb) {
        cb(error, status === null ? undefined : {statusCode: status || 200}, body);
    }}, logs));
    var type = c.DATA_TYPE.TOWN_SHORT;
    var url = c.getUrl(type, KEY, '20260924', '0800', {mx: 60, my: 127});
    c.resultList[0].url = url;
    var count = 0;
    c.getData(0, type, url, {}, function (err) { count++; done(err, c, logs); });
    assert.strictEqual(count, 1, 'exactly one completion callback');
}
describe('gather drift: synthetic offline compatibility', function () {
    Object.keys(routes).forEach(function (name) {
        it('builds migrated ' + name + ' URL without HTTP', function () {
            var c = h.collector();
            var u = new URL(c.getUrl(c.DATA_TYPE[name], KEY, '20260924', '0600', {mx: 60, my: 127, code: '11B00000'}));
            assert.strictEqual(u.origin + u.pathname, 'http://apis.data.go.kr/1360000/' + routes[name][0]);
            assert.strictEqual(u.searchParams.get('serviceKey'), KEY);
            if (name.indexOf('TOWN_') === 0) {
                assert.strictEqual(u.searchParams.get('base_date'), '20260924');
                assert.strictEqual(u.searchParams.get('base_time'), '0600');
                assert.strictEqual(u.searchParams.get('nx'), '60');
                assert.strictEqual(u.searchParams.get('ny'), '127');
            } else {
                assert.strictEqual(u.searchParams.get('tmFc'), '202609240600');
                assert.strictEqual(u.searchParams.get(name === 'MID_FORECAST' ? 'stnId' : 'regId'), '11B00000');
            }
        });
        it('dispatches 00 to ' + routes[name][1], function () {
            var called = 0;
            var c = h.prepare(h.collector({get: function (url, options, cb) {
                cb(null, {statusCode: 200}, h.xml(h.response(h.shortItems())));
            }}));
            Object.keys(routes).forEach(function (other) { c[routes[other][1]] = function () {
                assert.strictEqual(other, name); called++;
            }; });
            c.getData(0, c.DATA_TYPE[name], 'http://offline.invalid/?serviceKey=' + KEY, {});
            assert.strictEqual(called, 1);
        });
    });
    var invalid = {
        'non-success': function (r) { r.response.header[0].resultCode = ['22']; },
        'legacy success': function (r) { r.response.header[0].resultCode = ['0000']; },
        'zero count': function (r) { r.response.body[0].totalCount = ['0']; },
        'bad count': function (r) { r.response.body[0].totalCount = ['2oops']; },
        'missing count': function (r) { delete r.response.body[0].totalCount; },
        'empty items': function (r) { r.response.body[0].items = [{}]; },
        'missing header': function (r) { delete r.response.header; },
        'missing envelope': function (r) { delete r.response; r.other = 'no data'; }
    };
    Object.keys(invalid).forEach(function (name) {
        it('fails safely on ' + name, function () {
            var r = h.response(h.shortItems()); invalid[name](r);
            receive(h.xml(r), 200, null, function (err, c, logs) {
                assert(err, 'failure callback must carry an error');
                assert.strictEqual(c.recvFailed, true);
                assert.strictEqual(c.resultList[0].isCompleted, false);
                assert(!logs.join('\n').includes(KEY));
                assert(!logs.join('\n').includes('serviceKey='));
            });
        });
    });
    it('fails safely on malformed XML without reflecting raw text', function () {
        receive('<response><' + KEY, 200, null, function (err, c, logs) {
            assert(err); assert(c.recvFailed); assert(!logs.join('\n').includes(KEY));
        });
    });
    [403, 404, 500, 302, null].forEach(function (status) {
        it('rejects HTTP status/response ' + status, function () {
            receive(h.xml(h.response(h.shortItems())), status, null, function (err, c) {
                assert(err); assert(c.recvFailed); assert(!c.resultList[0].isCompleted);
            });
        });
    });
    it('does not log transport errors containing the request URL', function () {
        var error = new Error('http://offline.invalid/?serviceKey=' + KEY); error.code = 'ETIMEDOUT';
        receive('', 200, error, function (err, c, logs) {
            assert(err); assert(c.recvFailed); assert(!logs.join('\n').includes(KEY));
        });
    });
    it('maps the specified short fixture and publication/grid fields', function () {
        var r = h.organize('organizeShortData', h.shortItems()); assert(r.isCompleted);
        var v = r.data[0];
        Object.keys({t3h: 12.5, r06: 0, s06: 0, sky: 1, reh: 60, pty: 0, date: '20260924', time: '0900', pubDate: '202609240800', mx: 60, my: 127}).forEach(function (key) {
            var expected = {t3h: 12.5, r06: 0, s06: 0, sky: 1, reh: 60, pty: 0, date: '20260924', time: '0900', pubDate: '202609240800', mx: 60, my: 127};
            assert.strictEqual(v[key], expected[key], key);
        });
    });
    [['1.5', '0.5'], [' 1.5 mm ', '0.5cm']].forEach(function (values) {
        it('parses complete quantities ' + values.join('/'), function () {
            var v = h.organize('organizeShortData', h.shortItems({PCP: values[0], SNO: values[1]})).data[0];
            assert.strictEqual(v.r06, 1.5); assert.strictEqual(v.s06, 0.5);
        });
    });
    ['', ' ', 'unknown', 'Infinity', 'NaN', '-1', '-999', '1e999', '1.2junk'].forEach(function (value) {
        it('keeps unsupported precipitation missing: ' + JSON.stringify(value), function () {
            var v = h.organize('organizeShortData', h.shortItems({PCP: value, SNO: value})).data[0];
            assert.strictEqual(v.r06, -1); assert.strictEqual(v.s06, -1);
            assert.strictEqual(v.r06Text, undefined); assert.strictEqual(v.s06Text, undefined);
        });
    });
    // #2583: categories keep a representative amount plus the provider text for their bounds.
    [['1~4', 2.5], ['1.0mm 미만', 0.5], ['50mm 이상', 50]].forEach(function (pair) {
        it('stores precipitation category ' + JSON.stringify(pair[0]) + ' as an approximate amount', function () {
            var v = h.organize('organizeShortData', h.shortItems({PCP: pair[0]})).data[0];
            assert.strictEqual(v.r06, pair[1]); assert.strictEqual(v.r06Text, pair[0]);
        });
    });
    it('retains legacy categories and forecast grouping', function () {
        var items = h.shortItems().filter(function (v) { return !['TMP', 'PCP', 'SNO'].includes(v.category[0]); });
        items = items.concat([h.item('T3H', '-2.5'), h.item('R06', '3'), h.item('S06', '2'), h.item('TMN', '-4'), h.item('TMX', '8'), h.item('WAV', '1')]);
        var r = h.organize('organizeShortData', h.shortItems({}, '1200').concat(items));
        assert(r.isCompleted); assert.strictEqual(r.data.length, 2);
        assert.strictEqual(r.data[0].time, '0900'); assert.strictEqual(r.data[0].t3h, -2.5);
        assert.strictEqual(r.data[0].r06, 3); assert.strictEqual(r.data[0].s06, 2);
        assert.strictEqual(r.data[0].tmn, -4); assert.strictEqual(r.data[0].tmx, 8); assert.strictEqual(r.data[0].wav, 1);
    });
    ['', 'NaN', 'Infinity', '12bad'].forEach(function (value) {
        it('rejects invalid TMP ' + JSON.stringify(value), function () {
            assert(!h.organize('organizeShortData', h.shortItems({TMP: value})).isCompleted);
        });
    });
    [0, 1.5, undefined, '', 'bad', 'Infinity', 'NaN', -1, -999].forEach(function (value) {
        it('normalizes shortest RN1 ' + JSON.stringify(value), function () {
            var items = h.shortItems().filter(function (i) { return !['TMP', 'PCP', 'SNO'].includes(i.category[0]); });
            items.push(h.item('T1H', '12.5'), h.item('LGT', '0'));
            var rn = h.item('RN1', value); if (value === undefined) delete rn.fcstValue;
            items.push(rn);
            var r = h.organize('organizeShortestData', items); assert(r.isCompleted);
            assert.strictEqual(r.data[0].rn1, typeof value === 'number' && value >= 0 ? value : -1);
            assert.strictEqual(r.data[0].pty, 0);
        });
    });
    it('does not leak keys for empty request lists or callback exceptions', function () {
        var logs = []; var c = h.collector(undefined, logs);
        c.requestData([], c.DATA_TYPE.TOWN_SHORT, KEY, '20260924', '0800');
        assert(!logs.join('\n').includes(KEY));
    });
    it('preserves upstream current validation and Kakao initialization/API', function () {
        var manager = source('controllers/controllerManager.js');
        ['rn1', 'reh', 'pty', 'lgt'].forEach(function (k) { assert(manager.includes('newItem.' + k + ' >= 0')); });
        assert(manager.includes('keco.setKakaoApiKeys(JSON.parse(config.keyString.kakao_keys))'));
        var keco = source('lib/kecoRequester.js');
        assert(keco.includes('Keco.prototype.setKakaoApiKeys')); assert(keco.includes('Keco.prototype.getKakaoApiKey'));
        assert(keco.includes('https://dapi.kakao.com/v2/local/geo/transcoord.json'));
    });
    it('preserves protective logger catch with a throwing transport', function () {
        var messages = [];
        var logger = h.load('lib/log.js', {le_node: {}, '../config/config': {mode: 'test', logToken: {test: 'DUMMY'}},
            winston: {transports: {Console: function (o) { assert.strictEqual(o.level, 'error'); },
                Logentries: function () { throw new Error('synthetic transport failure'); }},
                Logger: function (o) { this.transports = o.transports; }}
        }, {process: {env: {NODE_ENV: 'production'}}, console: {log: function (e) { messages.push(e.message); }}});
        assert.strictEqual(logger().transports.length, 1); assert.strictEqual(messages.length, 1);
    });
    it('preserves upstream operational defaults and inclusive request cutoffs', function () {
        var manager = source('controllers/controllerManager.js');
        assert.strictEqual((manager.match(/self\._recursiveRequestData\([^;]*?, 70,/g) || []).length, 8);
        assert(manager.includes('key, dateString, 50, undefined'));
        assert(manager.includes('self.checkTimeAndRequestTask(true);'));
        assert(source('lib/PastConditionGather.js').includes('self.updateList, 10,'));
        var c = h.collector(); var sent = [];
        c.getData = function (i) { sent.push(i); };
        c.requestData(Array.from({length: 103}, function () { return {mx: 60, my: 127}; }), c.DATA_TYPE.TOWN_SHORT, KEY, '20260924', '0800');
        assert.strictEqual(sent.length, 101); assert.strictEqual(sent[100], 100);
        sent = [];
        c.requestDataByBaseTimeList({mx: 60, my: 127}, c.DATA_TYPE.TOWN_CURRENT, KEY, Array.from({length: 202}, function () { return {date: '20260924', time: '0800'}; }));
        assert.strictEqual(sent.length, 200); assert.strictEqual(sent[199], 199);
    });
});

describe('upstream storage and period-contract characterization', function () {
    it('merges existing current fields without overwriting a new valid zero', function (done) {
        var saved;
        var time = h.load('lib/kmaTimeLib.js', {});
        var model = {
            find: function () { return {lean: function () { return {exec: function (cb) {
                cb(null, [{currentData: {sky: 3, lgt: 2, rn1: 8, reh: 70}}]);
            }}; }}; },
            update: function (query, doc, options, cb) { saved = doc; cb(); }
        };
        var Current = h.load('controllers/kma/kma.town.current.controller.js', {
            async: require('async'), '../../models/kma/kma.town.current.model.js': model, '../../lib/kmaTimeLib': time
        }, {log: h.logger([])});
        new Current().saveCurrent([{mx: 60, my: 127, date: '20260924', time: '0900', pubDate: '202609240800', rn1: 0, t1h: 12.5}], function (err) {
            assert.ifError(err); assert.strictEqual(saved.currentData.rn1, 0);
            assert.strictEqual(saved.currentData.reh, 70); assert.strictEqual(saved.currentData.sky, 3);
            assert.strictEqual(saved.currentData.lgt, 2); done();
        });
    });
    it('retains current reh/lgt sentinel template contract', function () {
        var items = [h.item('T1H', 12), h.item('RN1', 0), h.item('PTY', 0)];
        items.forEach(function (item) { item.obsrValue = item.fcstValue; });
        var r = h.organize('organizeCurrentData', items); assert(r.isCompleted);
        assert.strictEqual(r.data[0].reh, -1); assert.strictEqual(r.data[0].lgt, -1);
    });
    it('keeps each slot amount in 24h adjustShort instead of splitting it (#2583)', function () {
        function Base() {}
        Base.prototype._createOrGetDaySummaryList = function (list, date) {
            if (!list.length) list.push({date: date}); return list[0];
        };
        var deps = {async: require('async'), request: {}, '../controllers/controllerTown': Base,
            '../lib/kmaTimeLib': h.load('lib/kmaTimeLib.js', {}), '../config/config': {},
            '../lib/kmaPrecipitation': h.optional('../../lib/kmaPrecipitation')};
        ['../lib/unitConverter', '../lib/aqi.converter', '../controllers/kecoController',
            '../controllers/airkorea.hourly.forecast.controller', '../controllers/kaq.hourly.forecast.controller',
            '../controllers/kma.specialweather.controller'].forEach(function (name) { deps[name] = function () {}; });
        var Town = h.load('controllers/controllerTown24h.js', deps, {log: h.logger([])});
        var rows = ['0600', '0900', '1200'].map(function (t, i) {
            return {date: '20260924', time: t, pty: 2, reh: 60, t3h: 10 + i, tmn: -50, tmx: -50, r06: 1.5, s06: 0.5};
        });
        var called = 0;
        new Town().adjustShort({params: {}, short: rows}, {}, function () { called++; });
        assert.strictEqual(called, 1);
        rows.forEach(function (row) {
            assert.strictEqual(row.r06, 1.5); assert.strictEqual(row.s06, 0.5);
        });
        assert.strictEqual(rows[2].t3h, 12);
    });
});

describe('independent-review regressions: malformed organized output', function () {
    ['MID_FORECAST', 'MID_TEMP', 'MID_LAND', 'MID_SEA'].forEach(function (type) {
        it('rejects malformed ' + type + ' without reflecting provider text', function () {
            var logs = [];
            var c = h.prepare(h.collector({get: function (url, opts, cb) {
                cb(null, {statusCode: 200}, h.xml(h.response([{bogus: ['http://offline.invalid/?serviceKey=' + KEY]}])));
            }}, logs));
            var callbackError;
            c.getData(0, c.DATA_TYPE[type], 'http://offline.invalid/?serviceKey=' + KEY,
                {date: '20260924', time: '0600', code: '11B00000'}, function (err) { callbackError = err; });
            assert(c.recvFailed); assert(!c.resultList[0].isCompleted); assert(callbackError);
            assert(!logs.join('\n').includes(KEY)); assert(!logs.join('\n').includes('serviceKey='));
        });
    });
    it('reports organizer rejection to the callback', function () {
        receive(h.xml(h.response(h.shortItems({TMP: 'broken'}))), 200, null, function (err, c) {
            assert(c.recvFailed); assert(err);
        });
    });
    ['TMP', 'SKY', 'REH', 'PTY'].forEach(function (field) {
        it('rejects invalid ' + field + ' in later forecast groups', function () {
            var values = {}; values[field] = 'broken';
            var r = h.organize('organizeShortData', h.shortItems().concat(h.shortItems(values, '1000')));
            assert(!r.isCompleted);
        });
    });
});

describe('real mid organizers with synthetic fixtures', function () {
    function midItem(type) {
        if (type === 'MID_FORECAST') return {wfSv: ['Synthetic outlook']};
        var item = {regId: ['11B00000']};
        if (type === 'MID_TEMP') {
            for (var d = 3; d <= 10; d++) { item['taMin' + d] = ['0']; item['taMax' + d] = ['12.5']; }
        } else {
            ['3Am', '3Pm', '4Am', '4Pm', '5Am', '5Pm', '6Am', '6Pm', '7Am', '7Pm', '8', '9', '10'].forEach(function (suffix) { item['wf' + suffix] = [type === 'MID_LAND' ? '맑음' : 'Clear']; });
            ['3AAm', '3APm', '3BAm', '3BPm', '4AAm', '4APm', '4BAm', '4BPm', '5AAm', '5APm', '5BAm', '5BPm', '6AAm', '6APm', '6BAm', '6BPm', '7AAm', '7APm', '7BAm', '7BPm', '8A', '8B', '9A', '9B', '10A', '10B'].forEach(function (suffix) { item['wh' + suffix] = [String(0.5 + Object.keys(item).filter(function (key) { return key.indexOf('wh') === 0; }).length / 10)]; });
        }
        return item;
    }
    ['MID_FORECAST', 'MID_TEMP', 'MID_LAND', 'MID_SEA'].forEach(function (type) {
        it('collects nonempty valid ' + type, function () {
            var c = h.prepare(h.collector({get: function (url, opts, cb) {
                cb(null, {statusCode: 200}, h.xml(h.response([midItem(type)])));
            }}));
            var called = 0;
            c.getData(0, c.DATA_TYPE[type], 'http://offline.invalid', {date: '20260924', time: '0600', code: '11B00000'}, function (err) {
                assert.ifError(err); called++;
            });
            assert.strictEqual(called, 1); assert(c.resultList[0].isCompleted);
            assert.strictEqual(c.resultList[0].data.length, 1);
            assert.strictEqual(c.resultList[0].data[0].pubDate, '202609240600');
            if (type === 'MID_SEA') {
                var expected = midItem(type);
                Object.keys(expected).filter(function (key) { return key.indexOf('wh') === 0; }).forEach(function (key) {
                    assert.strictEqual(c.resultList[0].data[0][key], Number(expected[key][0]), key);
                });
            }
        });
    });

    ['4AAm', '5APm', '6BAm', '7BPm'].forEach(function (suffix) {
        it('rejects a nonfinite day-specific sea height ' + suffix, function () {
            var item = midItem('MID_SEA'); item['wh' + suffix] = ['NaN'];
            var c = h.prepare(h.collector());
            c.organizeSeaData(0, h.response([item]), {date: '20260924', time: '0600'});
            assert(c.recvFailed); assert(!c.resultList[0].isCompleted);
        });
    });
    it('does not reuse missing temperature fields from a previous region', function () {
        var first = midItem('MID_TEMP');
        var second = {regId: ['11D00000'], taMin3: ['4']};
        var c = h.prepare(h.collector());
        c.organizeTempData(0, h.response([first, second]), {date: '20260924', time: '0600'});
        assert(c.resultList[0].isCompleted);
        assert.strictEqual(c.resultList[0].data[1].taMin3, 4);
        assert.strictEqual(c.resultList[0].data[1].taMax3, undefined);
    });
    it('rejects non-finite sea values before JSON serialization can hide them', function () {
        var item = midItem('MID_SEA'); item.wh3AAm = ['NaN'];
        var c = h.prepare(h.collector());
        c.organizeSeaData(0, h.response([item]), {date: '20260924', time: '0600'});
        assert(c.recvFailed); assert(!c.resultList[0].isCompleted);
    });
});

describe('mid forecast text completeness', function () {
    ['', '   ', {unexpected: ['text']}].forEach(function (text) {
        it('rejects empty/malformed land forecast text ' + JSON.stringify(text), function () {
            var item = {regId: ['11B00000']};
            ['3Am', '3Pm', '4Am', '4Pm', '5Am', '5Pm', '6Am', '6Pm', '7Am', '7Pm', '8', '9', '10'].forEach(function (suffix) { item['wf' + suffix] = [text]; });
            var c = h.prepare(h.collector({get: function (url, opts, cb) {
                cb(null, {statusCode: 200}, h.xml(h.response([item])));
            }}));
            c.getData(0, c.DATA_TYPE.MID_LAND, 'http://offline.invalid', {date: '20260924', time: '0600'}, function (err) { assert(err); });
            assert(c.recvFailed); assert(!c.resultList[0].isCompleted);
        });
    });
});


describe('review corrections: complete responses and key representation', function () {
    [1, 10, 12, 999, 1000].forEach(function (count) {
        it('rejects count/item mismatch ' + count + ' before organization', function () {
            var r = h.response(h.shortItems()); r.response.body[0].totalCount = [String(count)];
            receive(h.xml(r), 200, null, function (err, c) {
                assert(err); assert(c.recvFailed); assert(!c.resultList[0].isCompleted);
            });
        });
    });
    ['DUMMY+a/b=', 'DUMMY%2Ba%2Fb%3D', 'DUMMY%2ba%2fb%3d'].forEach(function (key) {
        it('normalizes raw or once-encoded dummy key ' + key, function () {
            var c = h.collector();
            Object.keys(routes).forEach(function (name) {
                var u = new URL(c.getUrl(c.DATA_TYPE[name], key, '20260924', '0600', {mx: 60, my: 127, code: '11B00000'}));
                assert.strictEqual(u.searchParams.get('serviceKey'), 'DUMMY+a/b=');
                assert(u.search.includes('serviceKey=DUMMY%2Ba%2Fb%3D&'));
            });
        });
    });
    [undefined, '', 'DUMMY%badEscape', 'DUMMY%2', 'DUMMY%GG'].forEach(function (key) {
        it('rejects missing/malformed encoded key without diagnostics leaking it: ' + key, function () {
            var logs = []; var c = h.collector(undefined, logs);
            assert.strictEqual(c.getUrl(c.DATA_TYPE.TOWN_SHORT, key, '20260924', '0800', {mx: 60, my: 127}), '');
            assert(!logs.join(' ').includes('DUMMY')); assert(!logs.join(' ').includes('serviceKey='));
        });
    });
    it('does not reflect raw/encoded dummy keys on transport failure', function () {
        var key = 'DUMMY+a/b='; var logs = [];
        var c = h.prepare(h.collector({get: function (url, opts, cb) { cb(new Error(url)); }}, logs));
        var url = c.getUrl(c.DATA_TYPE.TOWN_SHORT, key, '20260924', '0800', {mx: 60, my: 127});
        c.getData(0, c.DATA_TYPE.TOWN_SHORT, url, {}, function (err) { assert(err); });
        assert(!logs.join(' ').includes(key)); assert(!logs.join(' ').includes(encodeURIComponent(key)));
        assert(!logs.join(' ').includes('serviceKey='));
    });
});

describe('pagination before the completeness check (#2590)', function () {
    var product = h.shortProduct();
    function collect(items, mutate, options) {
        options = options || {};
        var requests = [], logs = [], calls = [], failures = 0;
        var c = h.prepare(h.collector(h.pagedHttp(items, requests, mutate, options.echo), logs));
        c.on('recvFail', function () { failures++; });
        var type = c.DATA_TYPE[options.type || 'TOWN_SHORT'];
        var url = options.url || c.getUrl(type, KEY, '20260924', '0500', {mx: 60, my: 127});
        c.getData(0, type, url, {}, function (err) { calls.push(err); });
        assert.strictEqual(calls.length, 1, 'exactly one completion callback');
        assert(!logs.join('\n').includes(KEY)); assert(!logs.join('\n').includes('serviceKey='));
        return {c: c, err: calls[0], requests: requests, failures: failures, logs: logs};
    }
    function withoutPage(url) { var u = new URL(url); u.searchParams.delete('pageNo'); return u.toString(); }
    // tag: [page, check] expected in the static warning diagnostic (#2593 review).
    function assertFailed(r, requestCount, reason, tag) {
        assert(r.err, 'failure callback must carry an error');
        assert.strictEqual(r.err.message, reason || 'KMA incomplete or inconsistent response');
        if (tag) {
            var warning = r.logs.filter(function (line) { return line.indexOf(r.err.message) === 0; });
            assert.strictEqual(warning.length, 1, 'one warning');
            assert(warning[0].replace(/\s+/g, ' ').includes("page: " + tag[0] + ", check: '" + tag[1] + "'"), warning[0]);
        }
        assert.strictEqual(r.failures, 1); assert.strictEqual(r.c.recvFailed, true);
        assert.strictEqual(r.c.resultList[0].isCompleted, false);
        assert.strictEqual(r.requests.length, requestCount);
    }
    [false, true].forEach(function (echo) {
        it('collects the 1,016-row short product from pages 1 and 2' + (echo ? ' with echoed paging' : ''), function () {
            var r = collect(product, null, {echo: echo});
            assert.ifError(r.err); assert.strictEqual(r.failures, 0);
            assert.deepStrictEqual(r.requests.map(function (u) { return new URL(u).searchParams.get('pageNo'); }), ['1', '2']);
            assert.strictEqual(withoutPage(r.requests[0]), withoutPage(r.requests[1]));
            assert.strictEqual(new URL(r.requests[1]).searchParams.get('numOfRows'), '999');
            var data = r.c.resultList[0].data;
            assert(r.c.resultList[0].isCompleted); assert.strictEqual(data.length, 84);
            var last = data[data.length - 1];
            assert.strictEqual(last.date + last.time, '202609271700');
            assert.strictEqual(last.t3h, 13); assert.strictEqual(last.sky, 1); assert.strictEqual(last.wsd, 0);
            var split = data[data.length - 2];
            assert.strictEqual(split.date + split.time, '202609271600');
            assert.strictEqual(split.t3h, 12); assert.strictEqual(split.wsd, 0); assert.strictEqual(split.reh, 60);
        });
    });
    it('keeps a single complete page to one request with identical organized data', function () {
        var items = h.shortItems();
        var r = collect(items);
        assert.ifError(r.err); assert.strictEqual(r.requests.length, 1);
        assert.strictEqual(JSON.stringify(r.c.resultList[0].data), JSON.stringify(h.organize('organizeShortData', items).data));
    });
    it('paginates shortest data with the same contract', function () {
        var items = [];
        ['0600', '0700', '0800', '0900', '1000', '1100'].forEach(function (time) {
            ['T1H', 'RN1', 'SKY', 'UUU', 'VVV', 'REH', 'PTY', 'LGT', 'VEC', 'WSD'].forEach(function (category) {
                items.push(h.item(category, {RN1: '강수없음', SKY: '1', T1H: '11', REH: '50'}[category] || '0', time));
            });
        });
        var r = collect(items, null, {type: 'TOWN_SHORTEST',
            url: 'http://offline.invalid/?serviceKey=' + KEY + '&pageNo=1&numOfRows=25'});
        assert.ifError(r.err); assert.strictEqual(r.requests.length, 3);
        assert.strictEqual(r.c.resultList[0].data.length, 6);
        assert.strictEqual(r.c.resultList[0].data[5].time, '1100');
    });
    [12, 999, 1000].forEach(function (count) {
        it('fails a short first page with totalCount ' + count + ' without continuation', function () {
            assertFailed(collect(h.shortItems(), function (page, r) { r.response.body[0].totalCount = [String(count)]; }), 1, null, [1, 'rows']);
        });
    });
    it('fails a first page shorter than numOfRows', function () {
        assertFailed(collect(product, function (page, r) {
            if (page === 1) { r.response.body[0].items[0].item.pop(); }
        }), 1, null, [1, 'rows']);
    });
    var SMALL = 'http://offline.invalid/?serviceKey=' + KEY + '&pageNo=1&numOfRows=3';
    // Distinct rows: the 11 hourly categories plus WAV/TMN/TMX/R06/S06 for the same hour.
    var extra = ['WAV', 'TMN', 'TMX', 'R06', 'S06'].map(function (category) { return h.item(category, '0'); });
    it('accepts exactly five pages', function () {
        var r = collect(h.shortItems().concat(extra.slice(0, 4)), null, {url: SMALL});
        assert.ifError(r.err); assert.strictEqual(r.requests.length, 5);
        assert.deepStrictEqual(r.requests.map(function (u) { return new URL(u).searchParams.get('pageNo'); }), ['1', '2', '3', '4', '5']);
    });
    it('fails when the page limit would be exceeded, without continuation', function () {
        assertFailed(collect(h.shortItems().concat(extra), null, {url: SMALL}), 1, null, [1, 'limit']);
    });
    it('does not paginate a URL without paging parameters', function () {
        assertFailed(collect(product, null, {url: 'http://offline.invalid/?serviceKey=' + KEY + '&numOfRows=999'}), 1, null, [1, 'pageNo']);
    });
    var continuation = {
        'changed totalCount': function (r) { r.response.body[0].totalCount = ['1017']; },
        'short final page': function (r) { r.response.body[0].items[0].item.pop(); },
        'extra final item': function (r) { r.response.body[0].items[0].item.push(h.item('TMP', '1', '1800')); },
        'echoed pageNo mismatch': function (r) { r.response.body[0].pageNo = ['1']; },
        'echoed numOfRows mismatch': function (r) { r.response.body[0].numOfRows = ['17']; },
        'provider error': function (r) { r.response.header[0].resultCode = ['22']; },
        'empty items': function (r) { r.response.body[0].items = [{}]; },
        'rows repeating the end of page 1': function (r) {
            r.response.body[0].items[0].item = product.slice(999 - 17, 999);
        }
    };
    var reasons = {'provider error': 'KMA invalid or empty response', 'empty items': 'KMA invalid or empty response'};
    var checks = {'changed totalCount': 'totalCount', 'short final page': 'rows', 'extra final item': 'rows',
        'echoed pageNo mismatch': 'echo', 'echoed numOfRows mismatch': 'echo', 'provider error': 'response',
        'empty items': 'response', 'rows repeating the end of page 1': 'duplicate'};
    Object.keys(continuation).forEach(function (name) {
        it('fails the whole grid on page-2 ' + name, function () {
            assertFailed(collect(product, function (page, r) { if (page === 2) { continuation[name](r); } }, {echo: true}), 2, reasons[name], [2, checks[name]]);
        });
    });
    it('fails on a repeated page', function () {
        var doubled = product.slice(0, 999).concat(product.slice(0, 999));
        assertFailed(collect(doubled), 2, null, [2, 'duplicate']);
    });
    it('fails on echoed pageNo mismatch on page 1 when paginating', function () {
        assertFailed(collect(product, function (page, r) { r.response.body[0].pageNo = ['2']; }, {echo: true}), 1, null, [1, 'echo']);
    });
    function failingSecondPage(respond, reason) {
        var requests = [], logs = [], calls = [], failures = 0;
        var first = h.pagedHttp(product, requests);
        var c = h.prepare(h.collector({get: function (url, options, cb) {
            if (requests.length === 0) { return first.get(url, options, cb); }
            requests.push(url); respond(url, cb);
        }}, logs));
        c.on('recvFail', function () { failures++; });
        var url = c.getUrl(c.DATA_TYPE.TOWN_SHORT, KEY, '20260924', '0500', {mx: 60, my: 127});
        c.getData(0, c.DATA_TYPE.TOWN_SHORT, url, {}, function (err) { calls.push(err); });
        assert.strictEqual(calls.length, 1);
        assert(!logs.join('\n').includes(KEY)); assert(!logs.join('\n').includes('serviceKey='));
        assertFailed({c: c, err: calls[0], requests: requests, failures: failures, logs: logs}, 2, reason, [2, 'response']);
    }
    it('fails on page-2 transport error without logging its URL', function () {
        failingSecondPage(function (url, cb) { cb(new Error(url)); }, 'KMA transport failure');
    });
    it('fails on page-2 HTTP 500', function () {
        failingSecondPage(function (url, cb) { cb(null, {statusCode: 500}, ''); }, 'KMA HTTP failure');
    });
    it('fails on page-2 malformed XML', function () {
        failingSecondPage(function (url, cb) { cb(null, {statusCode: 200}, '<response><' + KEY); }, 'KMA invalid or empty response');
    });
});
