/* Load the legacy alarm worker (controllerPush.js) offline for the S18b-1 oracle (task evidence,
 * not a repository tool). HTTP (`request`), Firebase, node-gcm and the push store are
 * controllable doubles that record every call; other network modules throw; `global.log` is
 * silent; Date is a fixed clock. Mongoose models load over the in-memory collection double. */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(process.env.TW_REPO);
const server = path.join(root, 'server');
const sourceFiles = {};
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const RealDate = Date;
const clock = {now: RealDate.parse('2026-10-15T00:00:00.000Z')};
function FixedDate(...a) {
    if (!new.target) return RealDate();
    return a.length === 0 ? new RealDate(clock.now) : new RealDate(...a);
}
FixedDate.prototype = RealDate.prototype;
FixedDate.now = () => clock.now;
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
Object.defineProperty(FixedDate, 'name', {value: 'Date'});
global.Date = FixedDate;

// Per-case controls and recordings.
const ctl = {
    http: (url, options) => ({error: 'no response configured'}),
    // HTTPS (firebase-admin): returns {status, headers, body} | {error: code}
    https: rec => ({status: 200, headers: {'content-type': 'application/json'}, body: '{}'}),
    store: {},
    calls: [],
};
// firebase-admin reaches Google over https.request: route it to the per-case double.
const https = require('https');
const {EventEmitter} = require('events');
https.request = function (options, cb) {
    const req = new EventEmitter();
    const chunks = [];
    req.write = d => { chunks.push(Buffer.from(d)); };
    req.setTimeout = () => req;
    req.abort = () => { req.aborted = true; };
    req.end = d => {
        if (d) chunks.push(Buffer.from(d));
        const rec = {host: options.host || options.hostname, path: options.path, method: options.method,
            headers: options.headers || {}, body: Buffer.concat(chunks).toString()};
        ctl.calls.push(Object.assign({kind: 'https'}, rec));
        const r = ctl.https(rec);
        setImmediate(() => {
            if (r.error) {
                const e = new Error('socket hang up'); e.code = r.error; req.emit('error', e); return;
            }
            const res = new EventEmitter();
            res.statusCode = r.status; res.headers = r.headers || {};
            cb(res);
            res.emit('data', Buffer.from(r.body));
            res.emit('end');
        });
    };
    setImmediate(() => req.emit('socket', {setTimeout() {}, on() {}}));
    return req;
};
const noNetwork = () => { throw new Error('network access is not allowed in the oracle'); };
function request(options, cb) {
    const url = typeof options === 'string' ? options : options.url;
    ctl.calls.push({kind: 'http', url, headers: options.headers || null, json: !!options.json});
    const r = ctl.http(url, options);
    process.nextTick(() => {
        if (r.error) return cb(new Error(r.error));
        cb(null, {statusCode: r.status}, r.body);
    });
}
request.get = noNetwork; request.post = noNetwork; request.defaults = () => noNetwork;
const store = new Proxy({}, {get: (_, name) => function (...args) {
    const cb = args.pop();
    ctl.calls.push({kind: 'store', method: name, args: JSON.parse(JSON.stringify(args))});
    const r = ctl.store[name] ? ctl.store[name](...args) : {n: 1, ok: 1};
    process.nextTick(() => (r === 'NONE' ? cb(null) : cb(null, r)));
}});
const stubs = {
    request,
    dnscache: () => ({}),
    'node-gcm': {
        Sender: function () {
            this.send = (message, ids, retries, cb) => {
                ctl.calls.push({kind: 'gcm', retries, data: message.params ? message.params.data : null});
                process.nextTick(() => cb(new Error('gcm retired')));
            };
        },
        Message: function (o) { this.params = o; },
    },
    'get-pixels': noNetwork,
    'aws-sdk': {S3: function () { this.upload = noNetwork; this.listObjectsV2 = noNetwork; }, config: {update() {}}},
    axios: {get: noNetwork, post: noNetwork},
};
const rawLoad = Module._load;
Module._load = function (req, parent, isMain) {
    if (stubs[req]) return stubs[req];
    if (/lib\/log(\.js)?$/.test(req)) return function () { return global.log; };
    if (/config\/config(\.js)?$/.test(req)) {
        return {push: {gcmAccessKey: 'synthetic'}, serviceServer: {url: 'http://service.test'}, apiServer: {url: 'http://api.test'},
            db: {version: '2.0', path: '', options: {}}, keyString: {kakao_keys: '[]', daum_keys: '[]', google_key: 'x', normal: '', cert_key: '', aqi_keys: '[]', airkorea_keys: '[]'}, mode: 'push', gather: {},
            image: {airkorea_korea_image: {coordi: {}, size: {}, pixel_pos: {}}, kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
                kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}}};
    }
    if (/lib\/pushProviders(\.js)?$/.test(req)) {
        // lib/pushProviders.js with the test service accounts instead of the private files.
        const firebase = rawLoad('firebase-admin', parent, false);
        const apps = {};
        return {firebase: product => {
            const name = product === 'todayAir' ? 'todayAir' : 'todayWeather';
            if (apps[name]) return apps[name];
            const credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'fcm-test-' + name + '.json'), 'utf8'));
            apps[name] = firebase.initializeApp({credential: firebase.credential.cert(credentials), projectId: credentials.project_id}, name);
            return apps[name];
        }};
    }
    if (/lib\/pushStore(\/index)?(\.js)?$/.test(req)) return {get: () => store};
    const resolved = Module._resolveFilename(req, parent, isMain);
    if (resolved.startsWith(server + path.sep) && resolved.endsWith('.js')) {
        sourceFiles[path.relative(root, resolved)] = hash(resolved);
    }
    return rawLoad.apply(this, arguments);
};
const silent = () => {};
global.log = {error: silent, warn: silent, info: silent, verbose: silent, debug: silent, silly: silent};

function load(rel) { return require(path.join(server, rel)); }
module.exports = {root, server, load, sourceFiles, clock, RealDate, ctl};
