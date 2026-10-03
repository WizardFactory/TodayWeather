'use strict';
// Real HTTP/router/controller and mongoose 5.1.2 queries; fixture exec only, no Mongo socket.
const assert = require('assert');
const http = require('http');
const express = require('express');
const route = require('./rss-response-smoke');
const queries = require('./kma-query-fixture');
function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let body = '';
            res.on('data', chunk => {body += chunk;});
            res.on('end', () => {try {assert.strictEqual(res.statusCode, 200); resolve(JSON.parse(body));} catch (e) {reject(e);}});
        }).on('error', reject);
    });
}
async function scenario(version, failure) {
    const f = route.makeFixture(route.locations[0], 'newer');
    f.current = f.current.filter(r => !(r.date === '20260923' && r.time === '0900'));
    const fixtures = queries.create({
        modelKmaStnInfo: [{stnId: '108', isCityWeather: true, geo: [126.978, 37.5665]}],
        // Legacy BSON encodes KST wall clock as UTC components; not a UTC measurement instant.
        modelKmaStnHourly2: [{stnId: 108, date: new Date('2026-09-23T09:00:00Z'), t1h: 22.7}]
    }, failure ? new Error('fixture station storage unavailable') : undefined);
    const harness = route.createHarness(version, f, {stationModels: fixtures.models, realStationHistory: true});
    const app = express();
    app.use((req, res, next) => {req.sessionID = 'isolated-query-smoke'; res.__ = text => text; next();});
    app.use('/v000903/kma', harness.router);
    const server = http.createServer(app);
    try {
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        const town = f.place.town;
        const url = 'http://127.0.0.1:' + server.address().port + '/v000903/kma/addr/' +
            [town.first, town.second, town.third].map(encodeURIComponent).join('/') + '?temperatureUnit=C&windSpeedUnit=m/s';
        const body = await get(url);
        const slot = body.short.find(r => r.date === '20260923' && Number(r.time) === 9);
        assert(slot, 'Historical response hour is present');
        if (failure) {
            assert.strictEqual(fixtures.queries.length, 1, 'Station DB failure must not start hourly query');
            assert(!body.current.yesterday.fieldObservations || !body.current.yesterday.fieldObservations.t1h, 'No observation provenance invented on DB failure');
        } else {
            assert.strictEqual(fixtures.queries.length, 2, 'Actual station metadata and hourly queries ran');
            assert.strictEqual(slot.t3h, 22.7, 'Station enrichment survives query construction');
            assert.strictEqual(body.current.yesterday.fieldObservations.t1h.source, 'KMA_STATION_HOURLY');
            assert.strictEqual(body.current.yesterday.fieldObservations.t1h.stationId, '108');
            assert.strictEqual(body.current.yesterday.fieldObservations.t1h.key, '202609230900');
        }
        assert(!harness.logs.some(entry => entry.args.some(value => /TypeError|maxTimeMS is not a function/.test(String(value)))));
        assert(!JSON.stringify(body.current.yesterday).includes('-50'));
        return {version, failure, queries: fixtures.queries.length, temperature: slot.t3h,
            provenance: body.current.yesterday.fieldObservations && body.current.yesterday.fieldObservations.t1h};
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}
async function main() {
    const scenarios = [];
    for (const version of ['1.0', '2.0']) for (const failure of [false, true]) scenarios.push(await scenario(version, failure));
    console.log(JSON.stringify({outcome: 'passed', node: process.version, mongoose: queries.mongoose.version,
        transport: 'real loopback HTTP', persistence: 'fixture exec, real query construction', scenarios}, null, 2));
}
main().catch(e => {console.error(e.stack); process.exitCode = 1;});
