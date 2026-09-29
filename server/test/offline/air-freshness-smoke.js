'use strict';
// Distinct local HTTP smoke: actual Express, controller, converter and serialization.
// Synthetic rows only; no startup, Mongo, providers or writes. Closes loopback listener.
const assert = require('assert');
const http = require('http');
const express = require('express');
const {harness, observation} = require('./air-freshness-harness');
const {detail, keco, town} = harness('2026-09-29T05:00:00Z');
const app = express();
app.get('/air/:mode', (req, res, next) => {
    const stamp = req.params.mode === 'fresh' ? '2026-09-29 07:00' : '2026-09-29 05:00';
    const row = observation(stamp, req.params.mode);
    req.current = {};
    req.arpltnList = [row]; req.arpltnStnList = [[row]];
    next();
}, detail.makeAirInfo, detail.makeAirInfoList, (req, res) => res.json({airInfo: req.airInfo, airInfoList: req.airInfoList}));
town._getTownInfo = (r, c, t, cb) => setImmediate(() => cb(null, {gCoord: {lat: 37.5665, lon: 126.978}}));
keco.getArpLtnInfo = (info, at, cb) => setImmediate(() => cb(new Error('synthetic DB failure')));
app.get('/failed-store', (req, res, next) => { req.current = {}; next(); }, town.getKeco, (req, res) => res.json({continued: true}));
function get(port, path) {
    return new Promise((resolve, reject) => http.get({hostname: '127.0.0.1', port, path}, res => {
        let body = ''; res.on('data', b => body += b); res.on('end', () => {
            try { assert.equal(res.statusCode, 200); resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
    }).on('error', reject));
}
(async () => {
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const port = server.address().port;
        const good = await get(port, '/air/fresh');
        assert.equal(good.airInfo.last.pm10Value, 20);
        assert.equal(good.airInfoList[0].last.stationName, 'fresh');
        assert.deepEqual(await get(port, '/air/stale'), {});
        assert.deepEqual(await get(port, '/failed-store'), {continued: true});
        console.log('PASS real loopback HTTP: fresh detail served, stale detail omitted, asynchronous store error continued. TZ=' + process.env.TZ + ' Node=' + process.version);
    } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
