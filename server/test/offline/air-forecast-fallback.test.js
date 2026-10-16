'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {harness, airInfo, row} = require('./air-forecast-fallback-harness');
const future = info => info.pollutants.pm10.hourly.filter(r => r.date > info.last.dataTime);
test('valid future KAQ stays selected, even zero and old publication', async () => {
    const h = harness([row({val: 0, pubDate: '2019-01-01 00:00'})], [row({val: 90})]);
    const info = airInfo();
    assert.ifError((await h.get(info)).error);
    assert.equal(info.forecastSource, 'kaq');
    assert.equal(future(info)[0].val, 0);
    assert.equal(h.calls.length, 1);
});
const unavailable = [undefined, [], [null], [row({dataTime: '2019-01-01 10:00'})],
    [row({dataTime: '2026-09-24 09:00'})], [row({dataTime: '2026-09-24 09:10'})],
    [row({dataTime: '2026-09-25 09:01'})], [row({dataTime: '2026-02-30 10:00'})],
    [row({dataTime: '2026-09-24 25:00'})], [row({code: 'unknown'})],
    ...[-1, null, undefined, '', '30', NaN, Infinity].map(val => [row({val})]), new Error('KAQ unavailable')];
unavailable.forEach((rows, i) => test('unusable KAQ falls back: ' + i, async () => {
    const h = harness(rows, [row({val: 47, pubDate: '2026-09-24 07:00'})]);
    const info = airInfo();
    const observation = JSON.stringify(info.last);
    assert.ifError((await h.get(info)).error);
    assert.equal(info.forecastSource, 'airkorea');
    assert.equal(info.forecastPubDate, '2026-09-24 07:00');
    assert.equal(future(info)[0].val, 47);
    assert.equal(future(info)[0].pubDate, info.forecastPubDate);
    assert.equal(JSON.stringify(info.last), observation);
    assert.deepEqual(h.calls, [{source: 'kaq', station: '중구'}, {source: 'airkorea', station: '중구'}]);
}));
test('availability respects observation cutoff, inclusive +24h and 24:00 normalization', async () => {
    const info = airInfo();
    info.last.dataTime = '2026-09-24 11:00';
    info.pollutants.pm10.hourly[0].date = info.last.dataTime;
    const h = harness([row()], [row({dataTime: '2026-09-24 24:00'}), row({dataTime: '2026-09-25 11:00'})]);
    assert.ifError((await h.get(info)).error);
    assert.equal(info.forecastSource, 'airkorea');
    assert.deepEqual(future(info).map(x => x.date), ['2026-09-25 00:00','2026-09-25 11:00']);
});
test('missing pollutant observations still insert first valid forecast; partial KAQ stays', async () => {
    const info = airInfo();
    const h = harness([row({code: 'pm25', val: 12})], [row()]);
    assert.ifError((await h.get(info)).error);
    assert.equal(info.forecastSource, 'kaq');
    assert.equal(info.pollutants.pm25.hourly.find(x => x.date === '2026-09-24 10:00').val, 12);
    assert.equal(h.calls.length, 1);
});
test('mixed invalid and valid KAQ rows retain only usable values', async () => {
    const info = airInfo();
    const h = harness([row(), row({dataTime: '2026-09-24 11:00', val: -1}), null], []);
    assert.ifError((await h.get(info)).error);
    assert.equal(info.forecastSource, 'kaq');
    assert.equal(future(info).length, 1);
    assert.equal(info.forecastPubDate, row().pubDate);
});
for (const rows of [[], [row({val: -1})], [row({dataTime: '2019-01-01 10:00'})]]) {
    test('neither source usable preserves observations without forecast metadata', async () => {
        const info = airInfo(), before = JSON.stringify(info);
        assert.ifError((await harness([], rows).get(info)).error);
        assert.equal(JSON.stringify(info), before);
    });
}
test('explicit AirKorea reads only AirKorea and keeps its source', async () => {
    const info = airInfo(), h = harness([row({val: 99})], [row({val: 45})]);
    assert.ifError((await h.get(info, 'airkorea')).error);
    assert.equal(info.forecastSource, 'airkorea');
    assert.equal(future(info)[0].val, 45);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].source, 'airkorea');
});
test('non-AirKorea observations skip station forecasts; store failure is reported safely', async () => {
    const info = airInfo(); info.source = 'google';
    const h = harness([], new Error('store unavailable'));
    assert.ifError((await h.get(info)).error);
    assert.equal(h.calls.length, 0);
    const result = await h.get(airInfo());
    assert.match(result.error.message, /store unavailable/);
});
