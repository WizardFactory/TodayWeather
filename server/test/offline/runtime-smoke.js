'use strict';
// Real SDK/HTTP execution with generated credentials and loopback peers only.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const child = require('child_process');
const net = require('net');
const serverRoot = path.resolve(__dirname, '../..');
const mode = process.argv[2];
if (!mode) {
    for (const stage of ['sdk', 'app']) {
        const run = child.spawnSync(process.execPath, [__filename, stage], {stdio: 'inherit', env: process.env, timeout: 30000});
        if (run.error) { throw run.error; }
        if (run.status !== 0) { process.exit(run.status || 1); }
    }
    process.exit(0);
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const normalized = net._normalizeArgs(args);
    const settings = normalized[0];
    if (settings.path || !['127.0.0.1', '::1', 'localhost'].includes(settings.host || 'localhost')) {
        throw new Error('External network connection forbidden in runtime smoke');
    }
    return originalConnect.apply(this, args);
};

async function sdkSmoke() {
    const grpc = require('grpc');
    const Iconv = require('iconv').Iconv;
    assert.equal(typeof grpc.credentials.createInsecure, 'function');
    assert.equal(new Iconv('EUC-KR', 'UTF-8').convert(Buffer.from([0xb0, 0xa1])).toString(), '가');
    const apn = require('apn');
    const firebase = require('firebase-admin');
    const http2 = require('http2');
    const https = require('https');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-node16-smoke-'));
    let peer, provider, app;
    const originalRequest = https.request;
    try {
        child.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
            '-keyout', path.join(temporary, 'key.pem'), '-out', path.join(temporary, 'cert.pem')], {stdio: 'ignore'});
        const cert = fs.readFileSync(path.join(temporary, 'cert.pem'));
        const pair = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1',
            privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
        const received = [];
        // APNs advertises its stream limit. apn2 waits for this HTTP/2 setting.
        peer = http2.createSecureServer({key: fs.readFileSync(path.join(temporary, 'key.pem')), cert,
            allowHTTP1: true, settings: {maxConcurrentStreams: 100}});
        peer.on('request', (req, res) => {
            let body = '';
            req.on('data', data => { body += data; });
            req.on('end', () => {
                received.push({path: req.url, headers: req.headers, body: JSON.parse(body)});
                if (req.url.startsWith('/3/device/')) {
                    const rejected = req.url.endsWith('b'.repeat(64));
                    res.writeHead(rejected ? 400 : 200, {'content-type': 'application/json'});
                    res.end(rejected ? JSON.stringify({reason: 'BadDeviceToken'}) : '');
                } else {
                    res.writeHead(200, {'content-type': 'application/json'});
                    res.end(JSON.stringify({name: 'projects/offline-only/messages/synthetic-message'}));
                }
            });
        });
        await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve));
        const port = peer.address().port;
        provider = new apn.Provider({token: {key: pair.privateKey, keyId: 'OFFLINEKEY', teamId: 'OFFLINETEAM'},
            production: false, address: '127.0.0.1', port, ca: cert});
        const note = new apn.Notification();
        note.topic = 'test.offline'; note.alert = 'Offline notification'; note.payload = {cityIndex: 0};
        const accepted = await provider.send(note, 'a'.repeat(64));
        assert.equal(accepted.sent.length, 1); assert.equal(accepted.failed.length, 0);
        const rejected = await provider.send(note, 'b'.repeat(64));
        assert.equal(rejected.failed[0].response.reason, 'BadDeviceToken');
        assert.equal(received[0].headers['apns-topic'], 'test.offline');
        assert.equal(received[0].body.aps.alert, 'Offline notification');
        assert.equal(received[0].body.cityIndex, 0);
        const jwt = received[0].headers.authorization.replace(/^bearer /, '');
        const decoded = require('jsonwebtoken').verify(jwt, pair.publicKey, {algorithms: ['ES256']});
        assert.equal(decoded.iss, 'OFFLINETEAM');

        // Keep real FCM encoding and HTTP handling; redirect only its endpoint to our TLS peer.
        https.request = function (options, callback) {
            assert.equal(options.hostname || options.host, 'fcm.googleapis.com');
            return originalRequest.call(this, Object.assign({}, options, {
                hostname: '127.0.0.1', host: '127.0.0.1', port, ca: cert, agent: false
            }), callback);
        };
        app = firebase.initializeApp({projectId: 'offline-only', credential: {
            getAccessToken: () => Promise.resolve({access_token: 'synthetic-token', expires_in: 3600})
        }}, 'runtime-offline');
        const messageId = await app.messaging().send({token: 'synthetic-device', notification: {title: 'Title', body: 'Body'}, data: {cityIndex: '0'}});
        assert.equal(messageId, 'projects/offline-only/messages/synthetic-message');
        const fcm = received[received.length - 1];
        assert.equal(fcm.path, '/v1/projects/offline-only/messages:send');
        assert.equal(fcm.body.message.data.cityIndex, '0');
        assert.equal(fcm.body.message.token, 'synthetic-device');
        console.log('PASS Node16 native grpc/iconv; real APNs HTTP/2 acceptance/rejection/JWT; real FCM HTTP request/response using loopback only');
    } finally {
        https.request = originalRequest;
        if (provider) { provider.shutdown(); }
        if (app) { await app.delete(); }
        if (peer) { await new Promise(resolve => peer.close(resolve)); }
        fs.rmSync(temporary, {recursive: true, force: true});
    }
}

async function appSmoke() {
    process.chdir(serverRoot);
    process.env.SERVER_MODE = 'service'; process.env.NODE_ENV = 'test'; process.env.DB_DATA_VERSION = '2.0';
    for (const name of Object.keys(process.env)) {
        if (name.startsWith('NEW_RELIC_')) { delete process.env[name]; }
    }
    const config = require('../../config/config');
    config.logToken = {}; // Real Console logger, no external log transport.
    const mongoose = require('mongoose');
    let connections = 0;
    mongoose.connect = function (url, options, callback) { connections++; callback(null, {name: 'offline-only'}); };
    const app = require('../../app');
    assert.equal(connections, 1);
    assert.equal(Object.keys(require.cache).some(file => /[/\\]newrelic[/\\]/.test(file)), false);
    assert.equal(require('firebase-admin').apps.length, 0, 'service routers do not initialize messaging apps');
    const http = require('http');
    const listener = http.createServer(app);
    try {
        await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
        const response = await new Promise((resolve, reject) => {
            http.get({host: '127.0.0.1', port: listener.address().port, path: '/health'}, res => {
                let body = ''; res.on('data', data => { body += data; });
                res.on('end', () => resolve({status: res.statusCode, body}));
            }).on('error', reject);
        });
        assert.deepEqual(response, {status: 200, body: 'OK'});
        global.log.info('Node16 isolated application logging smoke');
        console.log('PASS real service app/routers + loopback /health + Console logging; Mongo connect stubbed, no collection/provider calls');
    } finally { await new Promise(resolve => listener.close(resolve)); }
}

(mode === 'sdk' ? sdkSmoke() : appSmoke()).then(() => process.exit(0), error => { console.error(error); process.exit(1); });
