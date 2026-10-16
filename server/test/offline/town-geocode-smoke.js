'use strict';
// Node16 + pinned Mongoose5.1.2 against a task-owned compatible Mongo4.4.
// TW_MONGOD must name a local binary; production startup/config is never loaded.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const {spawn} = require('child_process');
const mongoose = require('mongoose');
const h = require('./harness');
const f = require('./town-geocode-harness');
async function unusedPort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function main() {
    assert.strictEqual(mongoose.version, '5.1.2');
    assert(process.env.TW_MONGOD, 'TW_MONGOD is required: local Mongo4.4 binary');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-town-geocode-'));
    const port = await unusedPort();
    const mongo = spawn(process.env.TW_MONGOD, ['--dbpath', dir, '--port', String(port),
        '--bind_ip', '127.0.0.1', '--nounixsocket', '--quiet'], {stdio: ['ignore', 'pipe', 'pipe']});
    let startupError, output = '', closed = false;
    mongo.on('error', err => { startupError = err; });
    const exited = new Promise(resolve => mongo.on('close', () => { closed = true; resolve(); }));
    mongo.stdout.on('data', chunk => { output += chunk; });
    mongo.stderr.on('data', chunk => { output += chunk; });
    const instance = new mongoose.Mongoose();
    let provider, api;
    try {
        for (let i = 0; i < 200; i++) {
            if (startupError) throw startupError;
            if (closed) throw new Error('Temporary Mongo exited: ' + output);
            const open = await new Promise(resolve => {
                const socket = net.connect(port, '127.0.0.1');
                socket.once('connect', () => { socket.destroy(); resolve(true); });
                socket.once('error', () => resolve(false));
            });
            if (open) break;
            if (i === 199) throw new Error('Temporary Mongo startup timeout: ' + output);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        await instance.connect('mongodb://127.0.0.1:' + port + '/town_geocode_isolated', {autoIndex: false});
        const Town = f.TownModel(instance);
        await Town.create(f.seed());
        let geocodes = 0;
        const providerApp = require('express')();
        providerApp.get('/v2/local/search/address.json', (req, res) => {
            geocodes++;
            assert.strictEqual(req.query.query, f.address.region + f.address.city + f.address.town);
            res.json({meta: {total_count: 1}, documents: [{y: f.coordinates.lat, x: f.coordinates.lon}]});
        });
        provider = await f.listen(providerApp);
        // Execute real Kakao parsing, grid conversion and key selection with only URL redirected.
        const convert = h.load('utils/convertGeocode.js', {events: require('events'), request: {},
            xml2js: require('xml2js'), './coordinate2xy': require('../../utils/coordinate2xy'),
            '../config/config': {keyString: {kakao_keys: '["local-fixture-only"]'}},
            axios: {get: (url, options) => {
                assert(url.startsWith('https://dapi.kakao.com/v2/local/search/address.json?'));
                return require('axios').get(provider.url + url.slice('https://dapi.kakao.com'.length),
                    {headers: options.headers, proxy: false});
            }}}, {log: h.logger([])});
        let list = await Town.find({}).lean().exec();
        const controller = f.controllers(Town, convert);
        api = await f.listen(f.responseApp(controller, params => f.lookup(controller, list, params)));
        const results = [];
        for (const version of ['v000901', 'v000902', 'v000903']) {
            for (const phase of ['first-or-hot', 'same-process']) {
                results.push({version, phase, location: f.location(await f.get(f.weatherUrl(api.url, version)))});
            }
        }
        const admitted = list[1];
        assert.deepStrictEqual(f.clone(admitted.mCoord), {mx: 60, my: 127});
        assert.strictEqual(admitted.areaNo, f.seed().areaNo);
        for (let i = 0; i < 100; i++) {
            if (await Town.count({}).exec() === 2) break;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        list = await Town.find({}).lean().exec();
        assert.strictEqual(list.length, 2, 'actual saved town must exist');
        for (const version of ['v000901', 'v000902', 'v000903']) {
            results.push({version, phase: 'mongo-lean-reload', location: f.location(await f.get(f.weatherUrl(api.url, version)))});
        }
        assert.strictEqual(geocodes, 1, 'hot and reloaded towns must not call provider again');
        console.log(JSON.stringify({outcome: 'passed', node: process.version, mongoose: mongoose.version,
            integration: 'loopback Kakao HTTP -> real convertGeocode/grid -> _findTown -> Mongo save/lean -> makeResult -> HTTP',
            providerRequests: geocodes, persistedTowns: list.length, results}, null, 2));
    } finally {
        if (api) await api.close();
        if (provider) await provider.close();
        await instance.disconnect();
        if (!closed && !startupError) { mongo.kill('SIGTERM'); await exited; }
        fs.rmSync(dir, {recursive: true, force: true});
    }
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
