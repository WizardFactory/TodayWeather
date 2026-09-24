'use strict';
process.env.TW_SMOKE_NOW = '2026-09-24T07:27:00.000Z';
const assert = require('node:assert/strict'),
    http = require('node:http'),
    fs = require('node:fs'),
    vm = require('node:vm');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { MongoClient } = require('mongodb');
const Store = require('../../lib/history/store'),
    Provider = require('../../lib/history/provider'),
    Recovery = require('../../lib/history/recovery'),
    p = require('../../lib/history/policy');
const route = require('./rss-response-smoke');
const now = Date.parse(process.env.TW_SMOKE_NOW);
let mongo,
    client,
    server,
    requests = 0,
    mode = 'valid';
const summaries = [];
function items(kind, query) {
    const start = query.get('startDt') + (kind === 'hourly' ? query.get('startHh') + '00' : '');
    const end = query.get('endDt') + (kind === 'hourly' ? query.get('endHh') + '00' : '');
    let rows = [];
    for (let t = p.instant(start); t <= p.instant(end); t += kind === 'hourly' ? 3600000 : 86400000) {
        const k = p.key(t, kind === 'daily');
        rows.push({
            stnId: query.get('stnIds'),
            tm:
                k.slice(0, 4) +
                '-' +
                k.slice(4, 6) +
                '-' +
                k.slice(6, 8) +
                (kind === 'hourly' ? ' ' + k.slice(8, 10) + ':00' : ''),
            ta: '21',
            taQcflag: '0',
            hm: '70',
            rn: '0',
            ws: '2',
            wd: '180',
            dc10Tca: '4',
            minTa: '12',
            maxTa: '26',
            avgTa: '20',
            avgRhm: '65',
            avgWs: '2',
            sumRn: '0'
        });
    }
    return rows;
}
function clientParser(name) {
    const source = fs.readFileSync('client/www/js/service.weatherutil.js', 'utf8');
    const start = source.indexOf('function ' + name + '('),
        end = source.indexOf('\n        function', start + 10);
    return vm.runInNewContext('(' + source.slice(start, end).trim() + ')');
}
(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14' }, instance: { ip: '127.0.0.1' } });
    client = await MongoClient.connect(mongo.getUri());
    const db = client.db('history_isolated_smoke');
    const store = new Store(db.collection('asos_history'), db.collection('asos_history_leases'));
    server = http.createServer((req, res) => {
        requests++;
        const url = new URL(req.url, 'http://127.0.0.1');
        if (mode === 'error') {
            res.writeHead(503);
            return res.end('unavailable');
        }
        const kind = url.pathname.includes('Hourly') ? 'hourly' : 'daily',
            all = items(kind, url.searchParams);
        const page = Number(url.searchParams.get('pageNo')),
            size = Number(url.searchParams.get('numOfRows'));
        const rows = all.slice((page - 1) * size, page * size);
        if (mode === 'wrong-date')
            rows.forEach((r) => (r.tm = '2026-09-24' + (kind === 'hourly' ? ' 12:00' : '')));
        res.setHeader('Content-Type', 'application/json');
        res.end(
            JSON.stringify({
                response: {
                    header: { resultCode: '00' },
                    body: { pageNo: page, numOfRows: size, totalCount: all.length, items: { item: rows } }
                }
            })
        );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const provider = new Provider({
        key: 'synthetic+key=',
        transport: http,
        base: 'http://127.0.0.1:' + server.address().port + '/',
        sleep: async () => {}
    });
    provider.pageSize = 50;
    const recovery = new Recovery(store, provider);
    let report = await recovery.run('108', '20260917', '20260923', now);
    assert(report.complete);
    assert.equal(await db.collection('asos_history').countDocuments(), 175);
    assert.equal(requests, 5);
    let hourly = await store.read('hourly', '108', '202609170000', '202609232300'),
        daily = await store.read('daily', '108', '20260917', '20260923');
    assert(hourly[0].date instanceof Date);
    assert.equal(hourly[0].date.toISOString(), '2026-09-16T15:00:00.000Z');
    const before = requests;
    report = await recovery.run('108', '20260917', '20260923', now);
    assert(report.complete);
    assert.equal(requests, before);
    await Promise.all([
        store.save({ ...hourly[0], values: { t1h: 30 } }),
        store.save({ ...hourly[0], values: { t1h: 35 } })
    ]);
    assert.equal((await store.read('hourly', '108', hourly[0].key, hourly[0].key))[0].values.t1h, 21);
    assert.equal(await db.collection('asos_history').countDocuments(), 175);
    const lock = await store.acquire('108');
    assert(lock);
    assert.equal(await store.acquire('108'), null);
    await store.release('108', 'wrong-token');
    assert.equal(await store.acquire('108'), null);
    await store.release('108', lock);
    summaries.push({ check: 'real-http-mongo-recovery-readback-idempotency-lease', records: 175, requests });
    const parseHour = clientParser('_parseShortTownWeather'),
        parseDay = clientParser('_parseMidTownWeather');
    const station = { stnId: '108', stnName: 'Seoul', isCityWeather: true, geo: [126.97, 37.57] };
    for (const version of ['1.0', '2.0'])
        for (const units of ['C', 'F'])
            for (const scenario of ['both', 'daily-only', 'hourly-only', 'no-data']) {
                await db.collection('asos_history').deleteMany({});
                const keep =
                    scenario === 'daily-only'
                        ? daily
                        : scenario === 'hourly-only'
                          ? hourly
                          : scenario === 'no-data'
                            ? []
                            : hourly.concat(daily);
                if (keep.length) await db.collection('asos_history').insertMany(keep);
                const f = route.makeFixture(route.locations[0], 'newer');
                f.current = f.current.filter((r) => r.date === '20260924');
                const historyOptions = {
                    config: { readEnabled: true, stations: ['108'] },
                    stations: [station],
                    db
                };
                const result = await route
                    .createHarness(version, f, historyOptions)
                    .request({ temperatureUnit: units, windSpeedUnit: 'm/s' });
                const body = result.body;
                assert.deepEqual(result.traces, route.createHarness(version, f, historyOptions).methods);
                assert.equal(body.historyStatus.mapping.stationId, '108');
                assert.equal(body.historyStatus.startDate, '20260917');
                const day23 = body.midData.dailyData.find((r) => r.date === '20260923');
                if (scenario === 'both' || scenario === 'hourly-only') {
                    assert.equal(body.historyStatus.missingHourlySlots.length, 0);
                    assert.equal(body.current.yesterday.t1h, units === 'C' ? 21 : 69);
                    const display = parseHour(body.short);
                    assert(
                        display.timeTable.some(
                            (r) => r.date === '20260923' && r.t3h === (units === 'C' ? 21 : 69)
                        ),
                        'hourly client sees yesterday'
                    );
                } else {
                    assert.equal(body.historyStatus.missingHourlySlots.length, 168);
                }
                if (scenario === 'both' || scenario === 'daily-only') {
                    assert(day23, 'yesterday daily exists');
                    assert.equal(body.historyStatus.missingDailyDates.length, 0);
                    const display = parseDay(body.midData);
                    assert(display.dayTable.some((r) => r.date === '20260917'));
                    if (scenario === 'daily-only') {
                        assert.equal(day23.tmn, units === 'C' ? 12 : 53);
                        assert.equal(day23.tmx, units === 'C' ? 26 : 78);
                    }
                }
                if (scenario === 'no-data') assert(body.historyStatus.missingDailyDates.includes('20260923'));
                assert.equal(body.short.length, 41, 'existing public three-hour list');
                assert(!body.short.some((r) => r.date < '20260921'));
                assert(body.midData.dailyData.some((r) => r.date === '20260928'));
                assert.equal(requests, before, 'no provider fetch during any API request');
                const exceptions = result.logs.filter((x) =>
                    x.args.some((a) => /TypeError|ReferenceError/.test(String(a)))
                );
                assert.deepEqual(exceptions, []);
                summaries.push({
                    check: 'actual-route-client',
                    version,
                    units,
                    scenario,
                    shortCount: body.short.length,
                    dailyCount: body.midData.dailyData.length,
                    hourlyGaps: body.historyStatus.missingHourlySlots.length
                });
            }
    mode = 'wrong-date';
    report = await recovery.run('108', '20260923', '20260923', now);
    assert.equal(report.complete, false);
    assert(report.rejected > 0);
    assert.equal(await db.collection('asos_history').countDocuments(), 0);
    mode = 'error';
    const count = requests;
    await assert.rejects(
        provider.fetch('hourly', '108', { start: '202609230000', end: '202609232300' }),
        /ASOS_HTTP_503/
    );
    assert.equal(requests - count, 3);
    summaries.push({ check: 'wrong-date-and-bounded-retries', attempts: 3 });
    console.log(JSON.stringify({ outcome: 'passed', summaries }, null, 2));
})()
    .catch((err) => {
        console.error(err.stack);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (client) await client.close();
        if (mongo) await mongo.stop();
    });
