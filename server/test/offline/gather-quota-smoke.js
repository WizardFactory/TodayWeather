'use strict';
// #2604 functional smoke: the real Manager recursion, the real collector and the real
// `request` library talk HTTP to a local fake data.go.kr (the collector's fixed
// http://apis.data.go.kr URLs reach it through HTTP_PROXY). Responses are SYNTHETIC.
// Models are in-memory; no provider, database or production configuration is used.
// Usage: NODE_PATH=<deps>/node_modules node server/test/offline/gather-quota-smoke.js
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const util = require('util');
const vm = require('vm');
const h = require('./harness');
const gather = require('../../config/gather');

const root = path.resolve(__dirname, '../..');
const KEY_A = 'SMOKE_KEY_A_2604_xxxxxxxxxxxxxxxx';
const KEY_B = 'SMOKE_KEY_B_2604_yyyyyyyyyyyyyyyy';
const GRIDS = 2032;
const QUOTA_BODY = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>' +
    '<returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg>' +
    '<returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
function okBody(nx, ny) {
    const items = h.shortItems();
    items.forEach(item => { item.nx = [nx]; item.ny = [ny]; });
    return h.xml(h.response(items));
}

// Fake gateway: per key, answer 429/code 22 once `limit` requests were served.
const server = {limits: {}, served: {}, inFlight: 0, maxInFlight: 0, foreign: 0};
function handler(req, res) {
    const url = new URL(req.url);
    const key = url.searchParams.get('serviceKey');
    if (url.host !== 'apis.data.go.kr' || !url.pathname.startsWith('/1360000/VilageFcstInfoService_2.0/') ||
        !Object.prototype.hasOwnProperty.call(server.limits, key)) {
        server.foreign++;
        res.writeHead(400); return res.end();
    }
    server.served[key] = (server.served[key] || 0) + 1;
    server.inFlight++;
    server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
    const over = server.served[key] > server.limits[key];
    setTimeout(() => {
        server.inFlight--;
        res.writeHead(over ? 429 : 200, {'Content-Type': 'text/xml'});
        res.end(over ? QUOTA_BODY : okBody(url.searchParams.get('nx'), url.searchParams.get('ny')));
    }, 2);
}

function loadManager(lines) {
    const level = name => function () { lines.push({level: name, text: util.format.apply(util, arguments)}); };
    const log = {debug: level('debug'), info: level('info'), warn: level('warn'), error: level('error'), verbose: level('verbose'), silly: level('silly')};
    const Collector = h.load('lib/collectTownForecast.js', {
        './midForecastPolicy': require('../../lib/midForecastPolicy'),
        './kmaPrecipitation': require('../../lib/kmaPrecipitation'),
        './dataGoKrRejection': require('../../lib/dataGoKrRejection'),
        events: require('events'), xml2js: require('xml2js'), dnscache: function () {},
        request: require('request')
    }, {log});
    const filename = path.join(root, 'controllers/controllerManager.js');
    const code = fs.readFileSync(filename, 'utf8');
    const deps = {};
    for (const m of code.matchAll(/require\('([^']+)'\)/g)) {
        deps[m[1]] = function Unexpected() { throw new Error('Unexpected collaborator ' + m[1]); };
        if (/^\.\/kma\/kma\.town\.|midRssKmaRequester|kecoRequester|lifeIndexKmaRequester/.test(m[1])) {
            deps[m[1]] = function Inert() { this.remove = () => {}; };
        }
    }
    Object.assign(deps, {
        '../config/config': {db: {version: '2.0'}, keyString: {dongnae_forecast_keys: JSON.stringify([KEY_A, KEY_B])}, history: {enabled: false}},
        '../config/gather': gather.load({GATHER_TOWN_RETRY: '3'}), async: require('async'),
        '../lib/collectTownForecast': Collector, '../lib/forecastTraffic': require('../../lib/forecastTraffic')
    });
    const module = {exports: {}};
    vm.runInNewContext(code, {module, exports: module.exports, Date, JSON, Math, Promise, Error, setTimeout, log,
        require: name => {
            if (!Object.prototype.hasOwnProperty.call(deps, name)) { throw new Error('Unstubbed dependency: ' + name); }
            return deps[name];
        }}, {filename});
    const m = Object.create(module.exports.prototype);
    m.saved = new Set();
    m.getDataTypeName = () => 'TOWN_SHORT';
    m.getSaveFunc = () => function (data, cb) { m.saved.add(data[0].mx + ':' + data[0].my + ':' + data.length); cb(); };
    return m;
}

function cycle(m, list) {
    return new Promise(resolve => {
        let calls = 0;
        m._recursiveRequestData(list, m.DATA_TYPE.TOWN_SHORT, 'unused', {date: '20260926', time: '0800'}, 3, undefined, err => {
            calls++;
            setTimeout(() => resolve({err, calls}), 50);
        });
    });
}

async function main() {
    delete process.env.NO_PROXY; delete process.env.no_proxy;
    const proxy = http.createServer(handler);
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    process.env.HTTP_PROXY = 'http://127.0.0.1:' + proxy.address().port;
    const lines = [];
    const m = loadManager(lines);
    // Distinct grids so every saved record is identifiable.
    const list = Array.from({length: GRIDS}, (v, i) => ({mx: i % 149, my: Math.floor(i / 149)}));
    const report = {};
    try {
        // S1: key A runs out after 300 requests; key B completes the remaining grids.
        server.limits = {[KEY_A]: 300, [KEY_B]: 1e9};
        const s1 = await cycle(m, list);
        assert.strictEqual(s1.calls, 1);
        assert.ifError(s1.err);
        report.s1 = {served: Object.assign({}, server.served), maxInFlight: server.maxInFlight, saved: m.saved.size};
        assert(server.served[KEY_A] >= 301 && server.served[KEY_A] <= 401, 'key A stops within one in-flight window');
        assert.strictEqual(server.served[KEY_B], GRIDS - 300, 'key B gets only the uncollected grids');
        assert(server.maxInFlight <= 101, 'at most 101 requests in flight');
        assert.strictEqual(m.saved.size, GRIDS, 'every grid saved once');
        assert.strictEqual(lines.filter(l => l.level === 'warn').length, 1, 'one warning for the stop');

        // S2: both keys exhausted; the cycle starts with the sticky key B and ends with an error.
        server.served = {}; server.maxInFlight = 0; lines.length = 0; m.saved.clear();
        server.limits = {[KEY_A]: 0, [KEY_B]: 0};
        const s2 = await cycle(m, list);
        report.s2 = {served: Object.assign({}, server.served), error: s2.err && s2.err.message, warns: lines.filter(l => l.level === 'warn').length};
        assert.strictEqual(s2.calls, 1);
        assert(s2.err && /quota/.test(s2.err.message));
        assert(server.served[KEY_B] <= 101 && server.served[KEY_A] <= 101, 'one in-flight window per key, no retry pass');
        assert.strictEqual(m.saved.size, 0);
        assert.strictEqual(lines.filter(l => l.level === 'warn').length, 2);
        assert.strictEqual(server.foreign, 0, 'every request carried a configured key to the forecast service');
        const text = lines.map(l => l.text).join('\n');
        assert(!text.includes(KEY_A) && !text.includes(KEY_B), 'no key in logs');
        report.result = 'passed';
    }
    finally {
        proxy.close();
        console.log(JSON.stringify(report));
    }
}

main().catch(err => { console.error(err.stack); process.exit(1); });
