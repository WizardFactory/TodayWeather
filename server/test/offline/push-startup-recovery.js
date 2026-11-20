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
        resolve: async location => {
            const answer = await harness.send(Number(process.env.FIXTURE_PORT), 'GET', '/region/' + location.lat);
            if (answer.status !== 200) throw new Error('region offline');
            return { zones: ['local'] };
        },
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

async function rehearse(delayed) {
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
    const origin = http.createServer((req, res) => {
        if (req.url === '/health') {
            probes++;
            res.statusCode = originReady ? 200 : 503;
            res.end(originReady ? 'OK' : 'waiting');
        } else if (req.url === '/region/2' && !regionsReady) {
            badLookups++;
            res.writeHead(503).end();
        } else {
            if (req.url === '/region/1') goodLookups++;
            res.end('ok');
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
        if (delayed) {
            await until(() => probes >= 2);
            assert.deepEqual(await health(socket), [503, false]);
            assert.equal(goodLookups + badLookups, 0);
            originReady = true;
            await until(() => badLookups >= 3);
            assert.deepEqual(await health(socket), [503, false]);
            await assert.rejects(ipc.request(socket, { op: 'upsert', rows: [row(3)] }), /not ready/);
            assert.equal(sends, 0);
            regionsReady = true;
        }
        await until(() => output.includes('push-coordinator-ready'));
        assert.deepEqual(await health(socket), [200, true]);
        assert.equal(goodLookups, 1);
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
        assert.equal(code, 0, 'coordinator shutdown');
    }
    console.log(delayed ? 'Delayed origin and region: 503 -> 200, same PID, two restored records, upsert/delete OK'
        : 'Healthy startup: first probe succeeded, two restored records, upsert/delete OK');
}

if (require.main === module) {
    rehearse(true).then(() => rehearse(false)).catch(err => { console.error(err); process.exitCode = 1; });
} else {
    installFixture();
}
