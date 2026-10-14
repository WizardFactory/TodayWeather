'use strict';
// Real getFcstZoneCd refresh into an isolated mongod (#2739). Read-only provider use: one
// request per page with the DONGNAE_SECRET_KEYS list from the environment; nothing is
// written outside the temporary database. Keys and request URLs are never printed.
const assert = require('assert');
const request = require('request');
const zoneMongo = require('./forecast-zone-mongo-harness');

async function main() {
    const keys = process.env.DONGNAE_SECRET_KEYS;
    assert(keys, 'DONGNAE_SECRET_KEYS must hold the data.go.kr key list');
    const logs = [];
    const db = await zoneMongo.start(request, logs);
    try {
        await db.Model.collection.insertMany(zoneMongo.legacyRows.map(row => Object.assign({}, row)));
        const ctrl = new db.Controller(keys);
        await ctrl.getFromKma();
        const stored = Number(/stored=(\d+)/.exec(logs.join('\n'))[1]);
        const active = await db.Model.count({retired: {$ne: true}});
        assert.equal(active, stored, 'every fetched zone is stored and active');
        const city = await db.Model.count({retired: {$ne: true}, regSp: 'C'});
        const old = await db.Model.findOne({regId: '11H10603'}).lean();
        assert.equal(old.retired, true, '11H10603 retired');
        assert.deepEqual((await db.exec(ctrl.findForecastZoneCode({regId: '11H10603'}))), []);
        for (const [region, city, expected] of zoneMongo.townCases) {
            assert.deepEqual(await db.zones(ctrl, region, city), [expected], region + ' ' + city);
        }
        const mid = await db.midTempZones(ctrl);
        assert.equal(mid.length, db.Controller.landZoneIds().size, 'every listed land zone is an active city zone');
        const secrets = JSON.parse(keys).reduce((all, key) => all.concat([key, decodeURIComponent(key)]), []);
        assert(logs.every(line => secrets.every(key => !line.includes(key)) && !/serviceKey=|apis\.data\.go\.kr/i.test(line)));
        console.log(JSON.stringify({result: 'passed', checkedAt: new Date().toISOString(), storedZones: stored,
            activeCityZones: city, retired: ['11H10603'], townCases: zoneMongo.townCases.map(c => c.join(' ')),
            midTempZones: mid.length, requests: logs.filter(line => /^request forecast zone code/.test(line)).length}));
    } finally {
        await db.stop();
    }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
