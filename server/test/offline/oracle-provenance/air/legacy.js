/* Load legacy server modules offline for the S15b store oracle (task evidence, not a repository
 * tool). Network modules are replaced by stubs that throw; `global.log` is silent; Mongoose 5.1.2
 * models get the in-memory collection double. */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fake = require('./fakemongo');

const root = path.resolve(process.env.TW_REPO || path.join(__dirname, '../../../..'));
const server = path.join(root, 'server');
const sourceFiles = {};
const rawRead = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
    const out = rawRead.call(fs, file, ...args);
    const abs = path.resolve(String(file));
    if (abs.startsWith(server + path.sep)) {
        sourceFiles[path.relative(root, abs)] = crypto.createHash('sha256').update(rawRead.call(fs, abs)).digest('hex');
    }
    return out;
};
const noNetwork = () => { throw new Error('network access is not allowed in the oracle'); };
const stubs = {
    request: Object.assign(noNetwork, {get: noNetwork, post: noNetwork, defaults: () => noNetwork}),
    dnscache: () => ({}),
    // S15b-3: image and AWS modules are loaded by kecoRequester but never used offline.
    'get-pixels': noNetwork,
    'aws-sdk': {S3: function () { this.upload = noNetwork; this.listObjectsV2 = noNetwork; }, config: {update() {}}},
    // S15b-3b: a section may answer GETs deterministically (the Kakao address-search stub).
    axios: {get: (...a) => global.ORACLE_AXIOS_GET ? global.ORACLE_AXIOS_GET(...a) : noNetwork(), post: noNetwork},
};
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    // The utilities create a Winston/Logentries logger that writes files: use the silent log.
    if (/lib\/log(\.js)?$/.test(request)) {
        return function () { return global.log; };
    }
    if (/config\/config(\.js)?$/.test(request)) {
        return {db: {version: '2.0', path: '', options: {}}, keyString: {kakao_keys: '["oracle-kakao-key"]'}, mode: 'service', serviceServer: {}, gather: {},
            image: global.ORACLE_IMAGE_CONFIG || {airkorea_korea_image: {coordi: {}, size: {}, pixel_pos: {}},
                kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
                kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}}};
    }
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved.startsWith(server + path.sep) && resolved.endsWith('.js')) {
        sourceFiles[path.relative(root, resolved)] = crypto.createHash('sha256').update(rawRead.call(fs, resolved)).digest('hex');
    }
    return rawLoad.apply(this, arguments);
};
const silent = () => {};
global.log = {error: silent, warn: silent, info: silent, verbose: silent, debug: silent, silly: silent};

function load(rel) { return require(path.join(server, rel)); }
module.exports = {root, server, load, fake, sourceFiles};
