/* Isolated loader for the air provider chain (#2628).
 * Loads real modules under server/ in a shared VM context, resolving their relative requires
 * from disk, while externals (axios, mongoose models, config) are replaced by the caller.
 * No production config, network, Mongo or timers are reachable unless the caller injects them.
 * Keep to Node 10 syntax: the Node 10.15.3 check reuses this file.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.resolve(__dirname, '../..');

/**
 * @param {object} options
 *   overrides: map from a path suffix (e.g. 'config/config.js', 'models/air.provider.usage.model.js')
 *              or a bare module id (e.g. 'axios') to the value require() returns
 *   globals: extra sandbox globals (log, Date, ...)
 * @returns {{load: function(string): *, cache: object}} load takes a path relative to server/
 */
function createLoader(options) {
    options = options || {};
    var overrides = options.overrides || {};
    var cache = {};
    var sandbox = Object.assign({console: console, Buffer: Buffer, setImmediate: setImmediate,
        setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, process: {env: {}, nextTick: process.nextTick},
        log: options.log}, options.globals || {});
    sandbox.global = sandbox;
    var context = vm.createContext(sandbox);

    function overrideFor(id, resolved) {
        var keys = Object.keys(overrides);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (id === key) { return {found: true, value: overrides[key]}; }
            if (resolved && resolved.replace(/\\/g, '/').endsWith('/' + key.replace(/^\.\//, ''))) {
                return {found: true, value: overrides[key]};
            }
        }
        return {found: false};
    }

    function loadFile(filename) {
        if (cache[filename]) { return cache[filename].exports; }
        var module = {exports: {}};
        cache[filename] = module;
        function localRequire(id) {
            var resolved = id.charAt(0) === '.' ? path.resolve(path.dirname(filename), id) : undefined;
            if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) { resolved = path.join(resolved, 'index.js'); }
            else if (resolved && !/\.js$/.test(resolved)) { resolved += '.js'; }
            var hit = overrideFor(id, resolved);
            if (hit.found) { return hit.value; }
            if (!resolved) {
                if (options.allowNodeModules && options.allowNodeModules.indexOf(id) !== -1) { return require(id); }
                throw new Error('Unstubbed dependency: ' + id + ' from ' + path.relative(root, filename));
            }
            if (!fs.existsSync(resolved)) {
                throw new Error('Missing module: ' + path.relative(root, resolved) + ' from ' + path.relative(root, filename));
            }
            return loadFile(resolved);
        }
        var code = fs.readFileSync(filename, 'utf8');
        vm.runInContext('(function (require, module, exports, __filename, __dirname) {' + code + '\n})', context, {filename: filename})(
            localRequire, module, module.exports, filename, path.dirname(filename));
        return module.exports;
    }

    return {
        load: function (relative) { return loadFile(path.join(root, relative)); },
        cache: cache,
        context: context
    };
}

/** In-memory stand-in for a mongoose model: findById(id, cb) / find({_id}).limit().lean().exec(cb) / updateOne(q, u, {upsert}, cb). */
function memoryModel(options) {
    options = options || {};
    var rows = {};
    var model = {
        rows: rows,
        reads: 0,
        writes: 0,
        failRead: false,
        failWrite: false,
        holdWrites: false,
        pendingWrites: [],
        findById: function (id, cb) {
            model.reads++;
            if (model.failRead) { return cb(new Error('read failed')); }
            cb(null, rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null);
        },
        find: function (query) {
            var q = {limit: function () { return q; }, lean: function () { return q; }, exec: function (cb) {
                model.reads++;
                if (model.failRead) { return cb(new Error('read failed')); }
                cb(null, rows[query._id] ? [JSON.parse(JSON.stringify(rows[query._id]))] : []);
            }};
            return q;
        },
        updateOne: function (query, update, opts, cb) {
            model.writes++;
            if (model.failWrite) { return cb(new Error('write failed')); }
            var apply = function () {
                var row = rows[query._id] || {_id: query._id};
                if (update.$set) { Object.keys(update.$set).forEach(function (k) { row[k] = JSON.parse(JSON.stringify(update.$set[k])); }); }
                if (update.$inc) { Object.keys(update.$inc).forEach(function (k) { row[k] = (row[k] || 0) + update.$inc[k]; }); }
                if (update.$setOnInsert && !rows[query._id]) {
                    Object.keys(update.$setOnInsert).forEach(function (k) { row[k] = JSON.parse(JSON.stringify(update.$setOnInsert[k])); });
                }
                rows[query._id] = row;
                cb(null);
            };
            if (model.holdWrites) { model.pendingWrites.push(apply); } else { apply(); }
        }
    };
    return model;
}

/** axios stand-in: respond(config) returns {status, data} or throws an axios-like error; `hold` defers answers. */
function fakeAxios(respond) {
    var http = {calls: [], pending: [], hold: false};
    function call(config) {
        http.calls.push(config);
        return new Promise(function (resolve, reject) {
            var answer = function () {
                try {
                    var r = respond(config);
                    if (r && r.status && r.status >= 400) {
                        var err = new Error('Request failed with status code ' + r.status);
                        err.response = {status: r.status, data: r.data};
                        return reject(err);
                    }
                    resolve(r);
                }
                catch (e) { reject(e); }
            };
            if (http.hold) { http.pending.push(answer); } else { answer(); }
        });
    }
    http.axios = {
        get: function (url, options) { return call(Object.assign({method: 'get', url: url}, options || {})); },
        post: function (url, data, options) { return call(Object.assign({method: 'post', url: url, data: data}, options || {})); }
    };
    http.release = function () { var p = http.pending.splice(0); p.forEach(function (fn) { fn(); }); };
    return http;
}

function fixture(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
}

function logger(lines) {
    var log = {};
    ['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(function (k) {
        log[k] = function () { lines.push({level: k, text: Array.prototype.map.call(arguments, String).join(' ')}); };
    });
    return log;
}

module.exports = {createLoader: createLoader, memoryModel: memoryModel, fakeAxios: fakeAxios, fixture: fixture, logger: logger, root: root};
