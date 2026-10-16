'use strict';
// Real client factories, HTTP, S3 middleware, Unix IPC, coordinator and HTTP-v1
// transport. Native callbacks, storage and the FCM endpoint are local test peers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const coordinator = path.resolve(__dirname, '../../server/lib/pushCoordinator');
const {Registry} = require(path.join(coordinator, 'registry'));
const {Dispatcher} = require(path.join(coordinator, 'dispatcher'));
const {Engine} = require(path.join(coordinator, 'engine'));
const ipc = require(path.join(coordinator, 'ipc'));
const serve = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-token-'));
    const data = new Map();
    const storage = {
        get: async key => data.has(key) ? JSON.parse(data.get(key)) : null,
        put: async (key, value) => { data.set(key, JSON.stringify(value)); },
        list: async prefix => [...data.keys()].filter(key => key.startsWith(prefix))
    };
    const registry = new Registry({storage, resolve: async () => ({weatherKey: 'test', zones: []})});
    await registry.init();
    process.env.PUSH_STORE = 's3';
    process.env.PUSH_SOCKET_PATH = path.join(dir, 'ipc.sock');
    const socket = await ipc.listen(process.env.PUSH_SOCKET_PATH, registry);
    const requests = [], submissions = [], pending = [], factories = {};
    const api = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            req.body = JSON.parse(body);
            requests.push({method: req.method, body: req.body});
            res.status = status => { res.statusCode = status; return res; };
            res.send = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
            ipc.middleware(req.url === '/v000902/push-list')(req, res, () => {
                res.statusCode = 404; res.end();
            });
        });
    });
    const port = await serve(api);
    const provider = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => { submissions.push(JSON.parse(body).message.token); res.end('{"name":"local"}'); });
    });
    const providerPort = await serve(provider);
    const transport = require(path.join(coordinator, 'transport')).create({endpoint: 'http://127.0.0.1:' + providerPort});
    const dispatcher = new Dispatcher({send: transport.send, rate: 1000});
    let emit;
    const context = {
        angular: {module: () => ({factory: (name, fn) => { factories[name] = fn; }})},
        window: {FirebasexMessaging: {onTokenRefresh: callback => { emit = callback; }, onMessageReceived() {}}},
        clientConfig: {serverUrl: 'http://127.0.0.1:' + port, package: 'todayWeather'},
        ionic: {Platform: {isIOS: () => true, isAndroid: () => false}},
        Date, console: {log() {}, error() {}}, setTimeout() {}
    };
    for (const file of ['service.firebase.js', 'service.push.js']) {
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/js', file), 'utf8'), context);
    }
    function clientHttp(options) {
        let success, error;
        pending.push(new Promise((resolve, reject) => {
            const url = new URL(options.url), body = JSON.stringify(options.data);
            assert.equal(url.hostname, '127.0.0.1');
            const req = http.request(url, {method: options.method, headers: {'content-type': 'application/json'}}, res => {
                let result = '';
                res.on('data', c => { result += c; });
                res.on('end', () => {
                    if (res.statusCode >= 400) { if (error) error(result, res.statusCode); }
                    else if (success) success(result);
                    resolve(res.statusCode);
                });
            });
            req.setTimeout(5000, () => req.destroy(new Error('local request timeout')));
            req.on('error', reject); req.end(body);
        }));
        return {success(fn) { success = fn; return this; }, error(fn) { error = fn; return this; }};
    }
    const firebase = factories.Firebase({track() {}, screen() {}});
    const push = factories.Push(clientHttp, {get: () => null, set() {}},
        {uuid: 'local-smoke-device', version: 'smoke', ga: {trackEvent() {}, trackException() {}}}, {}, {},
        {getAllUnits: () => ({airUnit: 'airkorea'})}, {$broadcast() {}}, firebase);
    const engine = new Engine({registry, storage, dispatcher, runtime: {
        alarm: async () => ({title: 'Local test', text: 'Local test'}),
        authorize: async () => ({projectId: 'synthetic', token: 'synthetic'})
    }});
    try {
        push.init();
        push.pushData.fcmToken = 'local-A';
        const time = new Date(Math.floor(Date.now() / 60000) * 60000);
        push.pushData.pushList = [{category: 'alarm', cityIndex: 0, id: 1, enable: true, time,
            dayOfWeek: [true, true, true, true, true, true, true], source: 'KMA', location: {lat: 37, long: 127}}];
        push._postPushList(push.pushData.pushList);
        assert.deepEqual(await Promise.all(pending.splice(0)), [200]);
        await registry.settled();
        const before = requests.length;
        for (const value of [null, undefined, '', '  ', false, {}]) emit(value);
        assert.equal(pending.length, 0);
        assert.equal(push.pushData.fcmToken, 'local-A');
        emit('local-B');
        assert.deepEqual(await Promise.all(pending.splice(0)), [200]);
        await registry.settled();
        emit('local-B');
        assert.equal(requests.length, before + 1);
        assert.deepEqual(requests.at(-1), {method: 'PUT', body: {newToken: 'local-B', oldToken: 'local-A'}});
        assert.equal(pending.length, 0);
        const record = [...registry.records.values()][0];
        assert.equal(record.fcmToken, 'local-B');
        const campaign = await engine.create('local-after-rotation', 'alarm', [record.ref], null, time.getTime());
        await engine.admit(campaign); await dispatcher.idle(); await engine.flush();
        assert.deepEqual(submissions, ['local-B']);
        assert.equal(campaign.jobs[0].status, 'accepted');
        console.log(JSON.stringify({result: 'PASS',putStatus: 200,invalidCallbackRequests: 0,
            duplicateTokenRequests: 0,oldTokenSubmissions: 0,newTokenSubmissions: 1,
            actualNativeSDK: false,actualFCM: false,transport: 'loopback HTTP-v1',storage: 'memory peer'}));
    } finally {
        dispatcher.close(); transport.close();
        await Promise.all([close(api), close(socket), close(provider)]);
        if (fs.existsSync(process.env.PUSH_SOCKET_PATH)) fs.unlinkSync(process.env.PUSH_SOCKET_PATH);
        fs.rmdirSync(dir);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
