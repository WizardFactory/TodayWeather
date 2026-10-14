'use strict';
// Zone refresh through the real request library and a real mongod (#2739). A loopback gateway
// stands in for data.go.kr; no provider, configuration file or application startup is involved.
const assert = require('assert');
const http = require('http');
const request = require('request');
const zoneMongo = require('./forecast-zone-mongo-harness');

const keys = ['ZONE_SMOKE_A%2B' + 'x'.repeat(32), 'ZONE_SMOKE_B%2F' + 'y'.repeat(32)];
const guide = [['11B10101', '서울'], ['11F20501', '광주'], ['11B20702', '광주'], ['11D20402', '고성'],
    ['11H20404', '고성'], ['11H10701', '대구'], ['11H10707', '군위'], ['11A00102', '연평도']];
const items = guide.map(([regId, regName]) => ({regId, regName, regSp: 'C', regUp: regId.slice(0, 5) + '000',
    lat: 36.5, lon: 127.5, regEn: '', seq: 1, stnF3: 0, tmEd: 210012310000, tmSt: 199001010000}));
for (let i = 0; items.length < 1005; i++) {
    items.push({regId: '12Z' + String(i).padStart(5, '0'), regName: '해상' + i, regSp: 'H', regUp: '12Z00000',
        lat: 0, lon: 0, regEn: '', seq: 1, stnF3: 0, tmEd: 210012310000, tmSt: 199001010000});
}
let mode = 'redirect';
const calls = [];
const gateway = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    calls.push({path: u.pathname, key: u.searchParams.get('serviceKey'), pageNo: u.searchParams.get('pageNo')});
    assert.equal(u.pathname, '/1360000/FcstZoneInfoService/getFcstZoneCd');
    if (mode === 'redirect') {
        res.writeHead(307, {location: '/503.html'});
        return res.end();
    }
    if (mode === 'bad-seq' || mode === 'bad-lon') {
        // Reviews Z-R1-001/Z-R2-001: one storable row and one that Mongoose or the 2d index rejects.
        const list = [items[0], Object.assign({}, items[1], mode === 'bad-seq' ? {seq: 'bad number'} : {lon: '9'.repeat(400)})];
        res.writeHead(200, {'content-type': 'application/json;charset=UTF-8'});
        return res.end(JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
            body: {dataType: 'JSON', items: {item: list}, pageNo: 1, numOfRows: 1000, totalCount: list.length}}}));
    }
    if (u.searchParams.get('serviceKey') === decodeURIComponent(keys[0])) {
        res.writeHead(403, {'content-type': 'application/json'});
        return res.end(JSON.stringify({OpenAPI_ServiceResponse: {cmmMsgHeader: {errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnReasonCode: '30'}}}));
    }
    const pageNo = Number(u.searchParams.get('pageNo')), rows = Number(u.searchParams.get('numOfRows'));
    const list = items.slice((pageNo - 1) * rows, pageNo * rows);
    res.writeHead(200, {'content-type': 'application/json;charset=UTF-8'});
    res.end(JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
        body: {dataType: 'JSON', items: {item: list}, pageNo, numOfRows: rows, totalCount: list.length}}}));
});

async function main() {
    await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + gateway.address().port;
    // Only the destination changes; URL building, redirect handling and parsing are the real ones.
    const transport = (url, options, cb) => {
        const u = new URL(url);
        assert.equal(u.protocol, 'https:');
        return request(origin + u.pathname + u.search, Object.assign({}, options, {proxy: null}), cb);
    };
    const logs = [];
    const db = await zoneMongo.start(transport, logs);
    try {
        await db.Model.collection.insertMany(zoneMongo.legacyRows.map(row => Object.assign({}, row)));
        const ctrl = new db.Controller(keys);

        // 1. The retired-host behavior: a 307 is a failure, is not followed and writes nothing.
        await assert.rejects(ctrl.getFromKma(), /status=307/);
        assert.deepEqual(calls.map(c => c.path), ['/1360000/FcstZoneInfoService/getFcstZoneCd']);
        assert.equal(await db.Model.count({}), 1);
        assert.equal((await db.Model.findOne({regId: '11H10603'}).lean()).retired, undefined);

        // 1b. A row that Mongoose cannot store fails the whole refresh before any write.
        mode = 'bad-seq'; calls.length = 0;
        await assert.rejects(ctrl.getFromKma(), /check=item/);
        assert.equal(await db.Model.count({}), 1);
        assert.equal(await db.Model.count({regId: items[0].regId}), 0);
        mode = 'bad-lon';
        await assert.rejects(ctrl.getFromKma(), /check=item/);
        assert.equal(await db.Model.count({}), 1);
        assert.equal(await db.Model.count({regId: items[0].regId}), 0);

        // 2. Key 1 rejected, key 2 pages 1000 + 5 items; the stored 11H10603 is retired.
        mode = 'serve'; calls.length = 0;
        await ctrl.getFromKma();
        assert.deepEqual(calls.map(c => [c.key === decodeURIComponent(keys[0]) ? 'A' : 'B', c.pageNo]), [['A', '1'], ['B', '1'], ['B', '2']]);
        assert.equal(await db.Model.count({retired: {$ne: true}}), 1005);
        const old = await db.Model.findOne({regId: '11H10603'}).lean();
        assert.equal(old.retired, true);
        assert(old.retiredAt instanceof Date);
        assert.deepEqual((await db.Model.findOne({regId: '11H10707'}).lean()).geo, [127.5, 36.5]);
        assert.equal((await db.Model.findOne({regId: '12Z00000'}).lean()).geo, undefined);

        for (const [region, city, expected] of zoneMongo.townCases) {
            assert.deepEqual(await db.zones(ctrl, region, city), [expected], region + ' ' + city);
        }
        assert.deepEqual((await db.exec(ctrl.findForecastZoneCode({regName: '군위'}))).map(r => r.regId), ['11H10707']);
        const mid = (await db.midTempZones(ctrl)).map(r => r.regId).sort();
        assert.deepEqual(mid, ['11B10101', '11B20702', '11D20402', '11F20501', '11H10701', '11H10707', '11H20404']);

        assert(logs.every(line => keys.every(key => !line.includes(key) && !line.includes(decodeURIComponent(key)))));
        assert(logs.every(line => !line.includes(origin) && !/serviceKey=/i.test(line)));
        console.log('PASS forecast-zone smoke: 307 not followed and no writes; unstorable seq and overflowing lon fail before writes; key rotation; 1000+5 pages stored in mongod; ' +
            '11H10603 retired; town mapping for ' + zoneMongo.townCases.length + ' cases; mid-temp zones ' + mid.length + '; sanitized logs');
    } finally {
        await db.stop();
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => gateway.close());
