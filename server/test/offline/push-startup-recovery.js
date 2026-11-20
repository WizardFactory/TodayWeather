'use strict';
// Rehearse the actual CLI, scheduler and Unix IPC. Only storage, provider calls, runtime config
// and the duration of the startup waits are replaced. All HTTP traffic stays on loopback.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { once } = require('events');
const ipc = require('../../lib/pushCoordinator/ipc');
const { Registry } = require('../../lib/pushCoordinator/registry');
const harness = require('./push-harness');

function row(n) {
    return { type: 'ios', fcmToken: 'fixture-' + n, cityIndex: n, id: 0,
        location: { lat: n, long: 127 }, pushTime: 0, enable: true };
}

function installFixture() {
    const dir = process.env.FIXTURE_DIR;
    const origin = 'http://127.0.0.1:' + process.env.FIXTURE_PORT;
    const objects = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'store.json'))));
    const store = {
        list: async prefix => Array.from(objects.keys()).filter(key => key.startsWith(prefix)),
        get: async key => objects.has(key) ? JSON.parse(objects.get(key)) : null,
        put: async (key, value) => objects.set(key, JSON.stringify(value))
    };
    const runtime = {
        resolve: (location, record) => require('../../lib/pushCoordinator/region').resolveRegion(origin, location, record, 250),
        alarm: async () => ({ title: 'Fixture', text: 'Due now' }),
        send: async () => { process.send('send'); }
    };
    const startup = require('../../lib/pushCoordinator/startup');
    harness.stubModules({
        '../config/env': {}, '../config/config': { serviceServer: { url: origin } },
        '../lib/pushCoordinator/storage': { create: () => store },
        '../lib/pushCoordinator/runtime': { create: () => runtime },
        '../lib/pushCoordinator/startup': {
            restoreAndStart: (url, registry, engine) => {
                // Both restored alarms are due, even across midnight on the host.
                engine.now = engine.dispatcher.now = () => Date.UTC(2026, 10, 20);
                return startup.restoreAndStart(url, registry, engine,
                    () => new Promise(resolve => setTimeout(resolve, 50)));
            }
        }
    });
}

function health(socket) {
    return new Promise((resolve, reject) => {
        http.get({ socketPath: socket, path: '/health' }, response => {
            let body = '';
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve([response.statusCode, JSON.parse(body).ready]));
        }).on('error', reject);
    });
}

async function until(test) {
    const deadline = Date.now() + 10000;
    while (!(await test())) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for startup transition');
        await new Promise(resolve => setTimeout(resolve, 15));
    }
}

async function rehearse(mode) {
    const delayed = mode === 'delayed';
    const forbidden = mode === 'forbidden';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw3066-'));
    const socket = path.join(dir, 'push.sock');
    const saved = new Map();
    const seed = new Registry({ storage: { list: async () => [],
        put: async (key, value) => saved.set(key, JSON.stringify(value)) },
        resolve: async () => ({ zones: [] }) });
    await seed.init();
    await seed.upsert([row(1), row(2)]);
    await seed.settled();
    fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify(Array.from(saved)));
    let originReady = !delayed, regionsReady = !delayed, probes = 0, goodLookups = 0, badLookups = 0, sends = 0;
    let dripChunks = 0, dripClosed = false;
    const origin = http.createServer((req, res) => {
        if (req.url === '/health') {
            probes++;
            res.statusCode = originReady ? 200 : 503;
            res.end(originReady ? 'OK' : 'waiting');
        } else if (req.url.endsWith('/2,127') && forbidden) {
            badLookups++;
            res.writeHead(403).end('sensitive upstream detail'.repeat(60000));
        } else if (req.url.endsWith('/2,127') && !regionsReady) {
            badLookups++;
            if (badLookups === 1) {
                res.end(JSON.stringify({ country: 'KR' })); // Missing domestic address.
            } else if (badLookups === 2) {
                res.writeHead(200);
                const timer = setInterval(() => { res.write(' '); dripChunks++; }, 20);
                res.on('close', () => { clearInterval(timer); dripClosed = true; });
            } else {
                res.writeHead(503).end();
            }
        } else {
            if (req.url.endsWith('/1,127')) goodLookups++;
            res.end(JSON.stringify(req.url.endsWith('/1,127') ? { country: 'US' } :
                { country: 'KR', kmaAddress: { name1: '서울특별시', name2: '강남구' } }));
        }
    });
    origin.listen(0, '127.0.0.1');
    await once(origin, 'listening');
    const child = fork(path.resolve(__dirname, '../../bin/push-coordinator'), [], {
        execArgv: ['--require', __filename], silent: true,
        env: Object.assign({}, process.env, { FIXTURE_DIR: dir, FIXTURE_PORT: origin.address().port,
            PUSH_STORE: 's3', PUSH_SOCKET_PATH: socket, WARNING_PUSH_ENABLED: 'false' })
    });
    const exited = once(child, 'exit');
    child.on('message', event => { if (event === 'send') sends++; });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => { output += chunk; });
    try {
        if (forbidden) {
            await until(() => child.exitCode !== null);
            assert.equal(badLookups, 1);
            assert.equal(sends, 0);
            assert(!output.includes('push-coordinator-ready'));
            assert(!output.includes('push-restore-pending'));
            assert(!output.includes('sensitive upstream detail'));
            assert(output.includes('Push region lookup failed: http-403'));
            assert(!fs.existsSync(socket));
            console.log('Permanent upstream 403: sanitized fatal reason, one lookup, zero sends, socket released');
            return;
        }
        if (delayed) {
            await until(() => probes >= 2);
            assert.deepEqual(await health(socket), [503, false]);
            assert.equal(goodLookups + badLookups, 0);
            originReady = true;
            await until(() => badLookups >= 3);
            assert.deepEqual(await health(socket), [503, false]);
            await assert.rejects(ipc.request(socket, { op: 'upsert', rows: [row(3)] }), /not ready/);
            assert.equal(sends, 0);
            assert(dripClosed && dripChunks >= 2, 'total deadline aborted the active peer');
            regionsReady = true;
        }
        await until(() => output.includes('push-coordinator-ready'));
        assert.deepEqual(await health(socket), [200, true]);
        assert.equal(goodLookups, 1);
        assert(!delayed || ['incomplete-response', 'deadline'].every(reason => output.includes(reason)));
        assert(!delayed || [30000, 60000].every(ms => output.includes('"retryMs":' + ms)));
        assert(delayed || (probes === 1 && badLookups === 0));
        assert(output.includes('"registrations":2'));
        await until(() => sends === 2);
        await ipc.request(socket, { op: 'upsert', rows: [row(3)] });
        const deleted = await ipc.request(socket, { op: 'remove', selector: { fcmToken: 'fixture-3', cityIndex: 3 } });
        assert.equal(deleted.n, 1);
    } catch (error) {
        console.error(output);
        throw error;
    } finally {
        child.kill('SIGTERM');
        const [code] = await exited;
        origin.close();
        fs.rmSync(dir, { recursive: true, force: true });
        assert.equal(code, forbidden ? 1 : 0, 'coordinator shutdown');
    }
    console.log(delayed ? 'Delayed origin and region: 503 -> 200, same PID, two restored records, upsert/delete OK'
        : 'Healthy startup: first probe succeeded, two restored records, upsert/delete OK');
}

async function checkRegionResponses() {
    const resolveRegion = require('../../lib/pushCoordinator/region').resolveRegion;
    const peer = http.createServer((req, res) => {
        if (req.url.endsWith('/1,127')) res.end(JSON.stringify({ country: 'KR', kmaAddress: { name1: ' 서울특별시 ', name2: ' 강남구 ' } }));
        else if (req.url.endsWith('/2,127')) res.end(JSON.stringify({ country: 'KR', kmaAddress: { name1: 'Unknown province' } }));
        else if (req.url.endsWith('/3,127')) res.writeHead(302, { location: 'file:///unavailable' }).end();
        else res.writeHead(302, { location: '/1,127' }).end();
    });
    peer.listen(0, '127.0.0.1');
    await once(peer, 'listening');
    try {
        const origin = 'http://127.0.0.1:' + peer.address().port;
        const get = lat => resolveRegion(origin, { lat, long: 127 }, {});
        for (const lat of [1, 4]) {
            const result = await get(lat);
            assert.equal(result.town.first, '서울특별시');
            assert.equal(result.town.second, '강남구');
            assert(result.zones.length > 0);
        }
        await assert.rejects(get(2), e => e.category === 'unmapped-town' && e.retryable);
        await assert.rejects(get(3), e => e.category === 'invalid-redirect' && !e.retryable);
    } finally { peer.close(); }
    console.log('Domestic mapping and redirect controls passed');
}

if (require.main === module) {
    checkRegionResponses().then(() => rehearse('delayed')).then(() => rehearse('healthy')).then(() => rehearse('forbidden')).catch(err => { console.error(err); process.exitCode = 1; });
} else {
    installFixture();
}
