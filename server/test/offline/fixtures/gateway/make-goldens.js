'use strict';
// Generates goldens.json by running the tw-backend-functions geoinfo/weather modules
// (commit a4c1deb; identical to the production API handlers at 1b489a9) offline
// against the fixtures in this directory. Provider, DynamoDB and backend boundaries
// are stubbed; nothing touches the network.
//
//   git clone https://github.com/WizardFactory/tw-backend-functions /tmp/twbf
//   git -C /tmp/twbf checkout a4c1deb
//   NODE_PATH=<dir with async@2.6.x> TWBF_DIR=/tmp/twbf node make-goldens.js
var Module = require('module');
var path = require('path');
var fs = require('fs');

var twbf = process.env.TWBF_DIR;
if (!twbf) { throw new Error('TWBF_DIR is required'); }
var providers = require('./providers.json');
var backend = require('./backend.json');
var cases = require('./cases.json');

var current;       // per-run stub state
function clone(v) { return JSON.parse(JSON.stringify(v)); }

function nextProvider(list, name) {
    if (!list.length) { return {error: new Error('unexpected ' + name + ' call')}; }
    var id = list.shift();
    if (id.indexOf('http:') === 0) { return {error: new Error('Request failed with status code ' + id.slice(5))}; }
    return {data: clone(providers[id])};
}

var stubs = {
    axios: {
        get: function (url) {
            current.calls.push('kakao ' + url.replace(/^https:\/\/dapi\.kakao\.com/, ''));
            var r = nextProvider(current.kakao, 'kakao');
            return r.error ? Promise.reject(r.error) : Promise.resolve({data: r.data});
        }
    },
    request: function (url, options, callback) {
        if (url.indexOf('https://maps.googleapis.com/') === 0) {
            current.calls.push('google ' + url.replace(/^https:\/\/maps\.googleapis\.com\/maps\/api\/geocode\/json/, '').replace(/&key=[^&]*/, ''));
            var r = nextProvider(current.google, 'google');
            if (r.error) { return callback(r.error); }
            return callback(null, {statusCode: 200}, r.data);
        }
        if (url.indexOf('https://darksky.net/') === 0) {
            current.calls.push('darksky');
            return callback(new Error('darksky is not available offline'));
        }
        if (url.indexOf('http://backend.test/') === 0) {
            var rest = url.slice('http://backend.test'.length);
            current.backend.push({url: rest, acceptLanguage: options.headers['Accept-Language']});
            var version = rest.split('/')[1];
            var kind = rest.indexOf('/kma/addr') > 0 ? 'kma' : 'dsf';
            return callback(null, {statusCode: 200}, clone(backend[version][kind]));
        }
        return callback(new Error('unexpected request ' + url));
    },
    config: {
        keyString: {kakao_keys: '["kakao-key"]', google_keys: '["google-key"]'},
        serviceServer: {url: 'http://backend.test', version: 'v000901'}
    },
    dynamo: function () {
        this.get = function () { arguments[arguments.length - 1](new Error('cache miss')); };
        this.update = function (item, callback) { callback(); };
    }
};

var originalLoad = Module._load;
Module._load = function (request, parent) {
    if (request === 'axios') { return stubs.axios; }
    if (request === 'request') { return stubs.request; }
    if (request === '../config') { return stubs.config; }
    if (request === './controller.geocode.dynamodb' || request === './controller.address.dynamodb') { return stubs.dynamo; }
    return originalLoad.apply(this, arguments);
};

var GeoInfo = require(path.join(twbf, 'geoinfo/function.geoinfo'));
var Weather = require(path.join(twbf, 'weather/function.weather'));

function headersFor(acceptLanguage) {
    return acceptLanguage === null ? {} : {'Accept-Language': acceptLanguage};
}

function run(fn) {
    return new Promise(function (resolve) {
        fn(function (err, result) {
            if (err) { return resolve({status: err.statusCode || 501}); }
            resolve({status: 200, body: JSON.parse(JSON.stringify(result))});
        });
    });
}

function parseQuery(q) {
    var out = {};
    if (!q) { return undefined; }
    q.split('&').forEach(function (pair) {
        var i = pair.indexOf('=');
        out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    return out;
}

async function main() {
    var out = {source: 'tw-backend-functions a4c1deb (geoinfo/ and weather/ identical to 1b489a9)', coord: {}, addr: {}, weather: {}};
    for (var c of cases.coord) {
        current = {kakao: c.kakao.slice(), google: c.google.slice(), calls: [], backend: []};
        var event = {pathParameters: {loc: c.loc}, headers: headersFor(c.acceptLanguage)};
        var result = await run(function (cb) { new GeoInfo().byCoord(event, cb); });
        result.calls = current.calls;
        out.coord[c.id] = result;
    }
    for (var a of cases.addr) {
        if (a.deviation) {
            // The Lambda's Kakao address fallback throws inside its own callback chain
            // ("Callback was already called") and never answers; see cases.json.
            out.addr[a.id] = {status: 'lambda-crash', reason: a.deviation};
            continue;
        }
        current = {kakao: a.kakao.slice(), google: a.google.slice(), calls: [], backend: []};
        var addrEvent = {pathParameters: {address: encodeURIComponent(a.address)}, headers: {}};
        var addrResult = await run(function (cb) { new GeoInfo().byAddr(addrEvent, cb); });
        addrResult.calls = current.calls;
        out.addr[a.id] = addrResult;
    }
    for (var id of cases.weather.cases) {
        var wc = cases.coord.find(function (x) { return x.id === id; });
        for (var version of cases.weather.versions) {
            for (var qname of cases.weather.queries) {
                current = {kakao: wc.kakao.slice(), google: wc.google.slice(), calls: [], backend: []};
                var params = {loc: wc.loc};
                if (version) { params.version = version; }
                var wEvent = {pathParameters: params, headers: headersFor(wc.acceptLanguage),
                    queryStringParameters: parseQuery(cases.queries[qname])};
                var wResult = await run(function (cb) { new Weather().byCoord(wEvent, cb); });
                wResult.backend = current.backend;
                out.weather[[id, version || 'unversioned', qname].join('|')] = wResult;
            }
        }
    }
    fs.writeFileSync(path.join(__dirname, 'goldens.json'), JSON.stringify(out, null, 1) + '\n');
    console.log('coord', Object.keys(out.coord).length, 'addr', Object.keys(out.addr).length, 'weather', Object.keys(out.weather).length);
}

main().catch(function (err) { console.error(err); process.exit(1); });
