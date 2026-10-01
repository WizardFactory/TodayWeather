/* #2633: real localhost HTTP gateway -> full overseas middleware.
 * Provider responses, geocoding and persistence are synthetic; no production access.
 * Run: TZ=UTC NODE_PATH=/path/to/isolated/node_modules node server/test/offline/vc-budget-smoke.js
 */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');
const {createHarness, getNow, syntheticProvider} = require('./vc-weather-smoke');
const gateway = require('../../routes/gateway');
const transport = require('../../lib/geocoder/transport');

async function main() {
    const now = getNow();
    const h = createHarness(params => {
        const body = syntheticProvider('America/Sao_Paulo')(params);
        body.queryCost = params.range === 'forecast' ? 1 : 49;
        return body;
    }, {dailyRecordLimit: 1000});
    h.usage.set(new Date(now).toISOString().slice(0, 10), {records: 976});
    const app = express();
    let port;
    app.use((req, res, next) => { res.__ = s => s; req.sessionID = 'budget-smoke'; next(); });
    app.use(gateway.createGatewayRouter({
        geocoder: () => ({coord: loc => Promise.resolve({country: 'BR', name: 'Brasília',
            location: {lat: loc[0], long: loc[1]}})}),
        loopback: (route, headers, timeoutMs, signal) => transport.getJson('http://127.0.0.1:' + port + route,
            {headers, timeoutMs, signal}),
        log: {info() {}, warn() {}}
    }));
    app.use('/v000903/dsf/coord', h.load(path.resolve(__dirname, '../../routes/v000903/route.dsf.coord.v000903.js')));
    app.use((err, req, res, next) => res.status(500).json({error: err.message}));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    try {
        for (const coord of ['-15.794,-47.882', '-15.78,-47.93']) {
            const r = await transport.getJson('http://127.0.0.1:' + port + '/weather/v000903/coord/' + coord, {timeoutMs: 10000});
            assert.equal(r.status, 200, JSON.stringify(r.body));
            assert.equal(r.body.source, 'VC');
            assert.equal(typeof r.body.thisTime[1].t1h, 'number');
            assert(Number.isFinite(r.body.thisTime[1].t1h));
            console.log(JSON.stringify({coord, status: r.status, source: r.body.source, temperature: r.body.thisTime[1].t1h}));
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(h.providerCalls.map(c => c.range), ['forecast', 'forecast']);
        assert.equal(h.usage.get(new Date(now).toISOString().slice(0, 10)).records, 978);
        console.log('PASS: both public paths use forecast within the unchanged daily budget');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
