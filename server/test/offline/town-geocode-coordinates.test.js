'use strict';
const assert = require('assert');
const f = require('./town-geocode-harness');
async function main() {
    assert.strictEqual(require('mongoose').version, '5.1.2');
    for (const version of ['v000901', 'v000902', 'v000903']) {
        const env = f.fixture();
        const server = await f.listen(f.responseApp(env.controller, params => f.lookup(env.controller, env.list, params)));
        try {
            const first = f.location(await f.get(f.weatherUrl(server.url, version)));
            const row = env.list[1];
            assert.strictEqual(typeof row.gCoord.lat, 'number');
            assert.strictEqual(typeof row.gCoord.lon, 'number');
            assert.strictEqual(row.gCoord.lat, Number(f.coordinates.lat), 'keep precision until response rounding');
            assert.strictEqual(row.areaNo, env.list[0].areaNo);
            assert.strictEqual(await f.lookup(env.controller, env.list), row, 'hot cache returns same plain object');
            assert.deepStrictEqual(f.location(await f.get(f.weatherUrl(server.url, version))), first);
            assert.strictEqual(env.counts().saveFinished, 0, 'first and hot responses do not await save');
            await env.flush();
            assert.deepStrictEqual(f.location(await f.get(f.weatherUrl(server.url, version))), first);
            const reloaded = await env.Town.find({}).lean().exec();
            assert.strictEqual(typeof reloaded[0].gCoord.lat, 'number');
            env.list.splice(0, env.list.length, ...reloaded);
            assert.deepStrictEqual(f.location(await f.get(f.weatherUrl(server.url, version))), first);
            assert.deepStrictEqual(env.counts(), {geocodes: 1, writes: 1, saveFinished: 1});
        } finally { await server.close(); }
    }
    const numeric = f.fixture({coordinates: {lat: 37.56649, lon: 126.97851, mx: 61, my: 128}});
    const resolved = await f.lookup(numeric.controller, numeric.list);
    assert.deepStrictEqual(f.clone(resolved.gCoord), {lat: 37.56649, lon: 126.97851});
    assert.strictEqual(resolved.areaNo, numeric.list[0].areaNo, 'city fallback when grid differs');
    await numeric.flush();
    const existing = f.fixture();
    const original = existing.list[0];
    assert.strictEqual(await f.lookup(existing.controller, existing.list, {region: original.town.first,
        city: original.town.second, town: original.town.third}), original);
    assert.deepStrictEqual(existing.counts(), {geocodes: 0, writes: 0, saveFinished: 0});
    for (const options of [{list: []}, {geocodeError: new Error('synthetic provider failure')}]) {
        const env = f.fixture(options);
        await assert.rejects(f.lookup(env.controller, env.list), options.list ? /list length is zero/ : /can not find Town/);
        await env.flush();
        assert.strictEqual(env.counts().writes, 0);
        assert.strictEqual(env.counts().geocodes, options.list ? 0 : 1);
    }
    // Preserve the existing uncached/unsaved out-of-area return, including invalid inputs.
    for (const coord of [{lat: 'invalid', lon: '126.978'}, {lat: '', lon: '126.978'},
        {lat: null, lon: '126.978'}, {lat: '37.566', lon: 'bad'}, {lat: '35', lon: '139'},
        {lat: '37.566', lon: '126.978trailing'}, {lat: 'Infinity', lon: '126.978'}]) {
        const env = f.fixture({coordinates: Object.assign({mx: 60, my: 127}, coord)});
        const row = await f.lookup(env.controller, env.list);
        assert.deepStrictEqual(f.clone(row.gCoord), coord);
        await env.flush();
        assert.strictEqual(env.list.length, 1);
        assert.strictEqual(env.counts().writes, 0);
    }
    const failure = f.fixture({saveError: new Error('synthetic save failure')});
    const server = await f.listen(f.responseApp(failure.controller, params => f.lookup(failure.controller, failure.list, params)));
    try {
        f.location(await f.get(f.weatherUrl(server.url)));
        await failure.flush();
        f.location(await f.get(f.weatherUrl(server.url)));
        assert.strictEqual(failure.rows.length, 0);
        assert.deepStrictEqual(failure.counts(), {geocodes: 1, writes: 1, saveFinished: 1});
    } finally { await server.close(); }
    console.log('PASS town coordinates: first/hot/lean reload on v000901/2/3; numeric, areaNo, invalid, geocode/save failure');
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
