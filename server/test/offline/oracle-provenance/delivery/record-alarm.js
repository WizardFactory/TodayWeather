/* S18b-1 alarm worker oracle driver (task evidence, not a repository tool). Runs the legacy
 * `ControllerPush.sendNotification` and `sendPush` with firebase-admin 5.13.1 over an HTTPS double
 * and records weather requests, OAuth/FCM HTTP requests, store calls and outcomes. No network.
 * Run: node.sh record-alarm.js <out.json> */
'use strict';
const L = require('./legacy2');
const fs = require('fs');
const assert = require('assert');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC' || process.env.NODE_ENV !== 'production') throw new Error('TZ=UTC NODE_ENV=production required');
assert.strictEqual(require('firebase-admin/package.json').version, '5.13.1');
const S = require('./alarm-scenarios');
const ControllerPush = L.load('controllers/controllerPush.js');
const co = new ControllerPush();

const token = {status: 200, headers: {'content-type': 'application/json; charset=utf-8'},
    body: '{"access_token":"ya29.oracle-token","expires_in":3599,"token_type":"Bearer"}'};
const ok = {status: 200, headers: {'content-type': 'application/json; charset=UTF-8'}, body: '{"name":"projects/oracle/messages/1"}'};
const wrap = v => v === undefined ? {error: 'no response'} : (v.status !== undefined || v.error ? v : {status: 200, body: v});
const revive = rec => {
    const r = JSON.parse(JSON.stringify(rec));
    if (rec.updatedAt instanceof L.RealDate) r.updatedAt = new Date(rec.updatedAt.getTime());
    return r;
};
function route(c) {
    const fcm = (c.fcm || []).slice();
    L.ctl.http = url => {
        if (url.startsWith('http://api.test/geocode/')) return wrap(c.geo);
        if (url.includes('/kma/')) return wrap(c.kma);
        if (url.includes('/dsf/')) return wrap(c.dsf);
        return {error: 'unrouted'};
    };
    L.ctl.https = rec => rec.host === 'accounts.google.com' ? (c.token || token) : (fcm.shift() || ok);
}
const settle = () => new Promise(r => setTimeout(r, 30));
(async () => {
    const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, 'firebase-admin': '5.13.1', mongoose: '5.1.2'},
        defaults: {token, fcm: ok}, cases: [], schedule: null};
    const base = L.RealDate.parse('2026-10-15T00:00:00.000Z');
    let i = 0;
    for (const [id, pushInfo, c] of S.cases) {
        L.clock.now = base + (++i) * 1000 + (c.advance || 0);
        L.ctl.calls.length = 0;
        route(c);
        const outcome = await new Promise(resolve => {
            co.sendNotification(revive(pushInfo), (err, result) => resolve(err ? {error: String(err.message || err)} : {result: result === undefined ? null : result}));
        });
        await settle();
        out.cases.push({id, at: new L.RealDate(L.clock.now).toISOString(), pushInfo: JSON.parse(JSON.stringify(pushInfo)),
            weather: {kma: c.kma === undefined ? null : wrap(c.kma), dsf: c.dsf === undefined ? null : wrap(c.dsf), geo: c.geo === undefined ? null : wrap(c.geo)},
            token: c.token || null, fcm: c.fcm || null, calls: JSON.parse(JSON.stringify(L.ctl.calls)), outcome});
    }
    // One scheduled minute.
    L.clock.now = L.RealDate.parse(S.schedule.now);
    L.ctl.calls.length = 0;
    route({kma: S.cases[0][2].kma, geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: '서울특별시', name2: '중구'}, location: {lat: 37.56, long: 126.98}}}});
    L.ctl.store = {getAlarmsByTime: () => S.scheduled.map(revive), removeDuplicateAlarms: () => 'NONE'};
    const result = await new Promise(resolve => co.sendPush(S.schedule.time, (err, r) => resolve(err ? {error: String(err.message || err)} : {result: r})));
    await settle();
    out.schedule = {at: S.schedule.now, time: S.schedule.time, records: JSON.parse(JSON.stringify(S.scheduled)),
        weather: {kma: wrap(S.cases[0][2].kma)}, calls: JSON.parse(JSON.stringify(L.ctl.calls)), outcome: result};
    out.source = {revision: process.env.TW_REVISION || null, files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
