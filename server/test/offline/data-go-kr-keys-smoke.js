'use strict';
// Real HTTP/request integration against a loopback-only synthetic gateway.
// No app startup, production config, provider call, DNS initialization or DB.
const assert = require('assert');
const http = require('http');
const request = require('request');
const async = require('async');
const h = require('./harness');
const keys = ['SMOKE_A%2B' + 'x'.repeat(32), 'SMOKE_B%2F' + 'y'.repeat(32)];
const helpers = require('../../lib/dataGoKrKeys');
const rejection = require('../../lib/dataGoKrRejection');
const time = require('../../lib/kmaTimeLib');
const logLines = [], log = h.logger(logLines), calls = [];
let denyAll = false;
const gateway = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const key = u.searchParams.get('serviceKey') || u.searchParams.get('ServiceKey');
    calls.push({path: u.pathname, key});
    assert(keys.map(decodeURIComponent).includes(key));
    if (denyAll || key === decodeURIComponent(keys[0])) {
        res.writeHead(200, {'content-type': 'application/xml'});
        return res.end('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>');
    }
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'OK'},
        body: {pageNo: 1, totalCount: 1, items: {item: [{areaNo: '1100000000', date: '2026100309', h3: '4'}]}}}}));
});
async function main() {
    await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + gateway.address().port;
    // Only the transport destination is replaced; real production URL building,
    // key encoding, HTTP library and response classification/rotation execute.
    const transport = (url, options, cb) => {
        const u = new URL(url);
        return request(origin + u.pathname + u.search, Object.assign({}, options, {proxy: null}), cb);
    };
    const dependencies = {request: transport, async, './dataGoKrKeys': helpers,
        './dataGoKrRejection': rejection, '../lib/dataGoKrKeys': helpers,
        '../lib/dataGoKrRejection': rejection, '../../lib/dataGoKrKeys': helpers,
        '../../lib/dataGoKrRejection': rejection, '../lib/kmaTimeLib': time,
        '../config/config': {keyString: {dongnae_forecast_keys: JSON.stringify(keys)}},
        '../models/town': {}, '../models/lifeIndexKma': {}, '../models/kma/kma.lifeindex.model': {},
        '../models/modelKasiRiseSet': {}, '../../models/kma/kma.forecast.zone.model': {}, dnscache: () => {}};
    const Life = h.load('lib/lifeIndexKmaRequester.js', dependencies, {log});
    const Warning = h.load('lib/kmaWarningRequester.js', dependencies, {log});
    const Zone = h.load('controllers/kma/kma.forecast.zone.controller.js', dependencies, {log});
    const Kasi = h.load('controllers/kasi.riseset.controller.js', dependencies, {log});
    const callbackRun = fn => new Promise((resolve, reject) => fn((err, result) => err ? reject(err) : resolve(result)));
    const scenarios = {
        uv: () => {const s = new Life(); s.setServiceKey(keys); return callbackRun(cb => s._requestUvPageV5('2026100309', 1, cb));},
        pollen: () => {const s = new Life(); s.setServiceKey(keys); return callbackRun(cb => s._requestPollenPageV3('flowerWeeds', '2026100309', 1, cb));},
        warnings: () => callbackRun(cb => new Warning().get('getPwnStatus', {}, cb)),
        kasi: () => {Kasi._keyIndex = 0; return callbackRun(cb => Kasi._requestWithKeyRotation(() => Kasi._makeAreaApiUrl('서울', '20261003'), cb));},
        zone: () => {const s = new Zone(keys); return s._request(s._getKmaApiUrl());}
    };
    for (const [name, run] of Object.entries(scenarios)) {
        for (const rejected of [false, true]) {
            denyAll = rejected; const before = calls.length;
            let result, error; try {result = await run();} catch (err) {error = err;}
            assert.equal(calls.length - before, 2, name + ' each key exactly once');
            assert.deepEqual(calls.slice(before).map(c => c.key), keys.map(decodeURIComponent));
            if (rejected) {assert(error, name + ' exhaustion errors');}
            else {assert.ifError(error); assert(result.items || result.response, name + ' retains response');}
        }
    }
    assert(logLines.every(line => keys.every(key => !line.includes(key) && !line.includes(decodeURIComponent(key)))));
    console.log('PASS unified-list HTTP smoke: UV, pollen, KASI, warnings, zone; quota rotation/success/exhaustion, exact URI encoding, sanitized logs (20 loopback requests)');
}
main().catch(err => {console.error(err); process.exitCode = 1;}).finally(() => gateway.close());
