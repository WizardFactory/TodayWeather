/* #2635: actual provider guard -> shared middleware -> real HTTP loopback -> gateway.
 * No app startup, external provider or database. Run with express/cors/async on NODE_PATH.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const cors = require('cors');
const async = require('async');
const {createGatewayRouter} = require('../../routes/gateway');
const transport = require('../../lib/geocoder/transport');
const unavailable = require('../../lib/weatherUnavailable');
const root = path.resolve(__dirname, '../..');
function section(file, start, end) {
    const s = fs.readFileSync(path.join(root, file), 'utf8');
    const a = s.indexOf(start), b = s.indexOf(end, a);
    assert(a >= 0 && b > a, file);
    return s.slice(a, b);
}
let scenario, retryAt, hits = 0;
const now = Date.parse('2026-09-29T23:59:20Z');
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const guardContext = {
    Date: Clock, PROVIDER_KEY: '~provider', config: {vc: {dailyRecordLimit: 49}},
    vcFetchLock: {findById(key, cb) { cb(null, scenario === 'marker' ? {expireAt: retryAt} : null); }},
    vcUsage: {findById(day, cb) { cb(null, {records: scenario === 'budget' ? 49 : 0}); }}
};
vm.createContext(guardContext);
vm.runInContext('this.Guard = class { _usageDay(){ return new Date().toISOString().slice(0,10); } ' +
    section('controllers/worldWeather/dsf.controller.js', '    _checkProvider(range, callback){', '    _markProviderDown(err){') + '};', guardContext);
function Dsf() {}
Dsf.prototype.getDsfData = (req, date, cb) => {
    hits++;
    if (scenario === 'unknown') return cb(new Error('unclassified weather failure'));
    new guardContext.Guard()._checkProvider('combined', cb);
};
const middlewareContext = {
    self: {isValidCategory: () => true, getCode(req) { req.geocode = {lat: 35, lon: 139}; }, getCountry() {}, getCity() {}, _getAirFromChain(req, date, cb) { cb(); }},
    async, Date: Clock, log: {info() {}, warn() {}, error() {}},
    require(name) {
        if (name === './dsf.controller') return Dsf;
        if (name === '../../lib/weatherUnavailable') return unavailable;
        throw new Error('Unexpected dependency ' + name);
    }
};
vm.createContext(middlewareContext);
vm.runInContext(section('controllers/worldWeather/controllerWorldWeather.js', '    self.queryTwoDaysWeatherNewForm = ', '\n    /**\n     *\n     * @param req'), middlewareContext);

(async () => {
    const app = express();
    let port;
    app.use(cors());
    app.use(createGatewayRouter({
        geocoder: () => ({coord: () => Promise.resolve({country: 'JP', location: {lat: 35, long: 139}})}),
        loopback: (p, headers, timeoutMs, signal) => transport.getJson('http://127.0.0.1:' + port + p, {headers, timeoutMs, signal}),
        log: {info() {}, warn() {}}
    }));
    app.get('/v000903/dsf/coord/:loc', (req, res, next) => {
        req.validVersion = true;
        middlewareContext.self.queryTwoDaysWeatherNewForm(req, res, next);
    }, (req, res) => res.json({ok: true}));
    app.use((err, req, res, next) => res.status(500).send('unclassified'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    // Both guard and delay projection share a deterministic clock, HTTP/timers remain real.
    const originalNow = Date.now;
    Date.now = () => now;
    try {
        for (const [name, deadline, expected] of [
            ['marker', now + 75000, 75], ['marker', now + 8000000, 3600],
            ['marker', now + 500, 1], ['budget', Date.parse('2026-09-30T00:00:00Z'), 40]
        ]) {
            scenario = name; retryAt = deadline; hits = 0;
            const r = await transport.getJson('http://127.0.0.1:' + port + '/weather/v000903/coord/35,139', {timeoutMs: 2000});
            assert.equal(r.status, 503);
            assert.equal(r.headers['retry-after'], String(expected));
            assert.equal(r.headers['access-control-allow-origin'], '*');
            assert.equal(r.headers['cache-control'], 'no-store');
            assert.equal(r.text, 'Service Unavailable');
            assert.equal(hits, 1);
            console.log(name + ': 503 Retry-After=' + expected + ', CORS, no-store, one backend call');
        }
        scenario = 'unknown'; hits = 0;
        let r = await transport.getJson('http://127.0.0.1:' + port + '/weather/v000903/coord/35,139', {timeoutMs: 2000});
        assert.equal(r.status, 501); assert.equal(hits, 3);
        r = await transport.getJson('http://127.0.0.1:' + port + '/weather/v000903/coord/0,0', {timeoutMs: 2000});
        assert.equal(r.status, 404);
        console.log('unknown: 501 with existing three attempts; zero coordinate: 404');
    } finally {
        Date.now = originalNow;
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(err => { console.error(err); process.exitCode = 1; });
