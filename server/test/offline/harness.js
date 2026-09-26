'use strict';
// Execute the real CommonJS module in isolation; every dependency is explicit.
// No production config, DNS cache, timers, application startup or network loads.
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var util = require('util');
exports.load = function (relative, dependencies, globals) {
    var filename = path.resolve(__dirname, '../..', relative);
    var module = {exports: {}};
    var sandbox = Object.assign({module: module, exports: module.exports,
        require: function (name) {
            if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
                throw new Error('Unstubbed dependency: ' + name);
            }
            return dependencies[name];
        },
        setTimeout: function () { throw new Error('Unexpected timer'); },
        setInterval: function () { throw new Error('Unexpected interval'); }
    }, globals);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, {filename: filename});
    return sandbox.module.exports;
};
exports.logger = function (lines) {
    var log = {};
    ['debug', 'info', 'warn', 'error', 'verbose', 'silly'].forEach(function (level) {
        log[level] = function () { lines.push(util.format.apply(util, arguments)); };
    });
    return log;
};
// Modules introduced after a baseline may be absent when tests run against it.
function optional(id) {
    try { return require(id); } catch (e) { if (e.code === 'MODULE_NOT_FOUND') { return undefined; } throw e; }
}
exports.optional = optional;
exports.collector = function (request, logs) {
    var Collector = exports.load('lib/collectTownForecast.js', {
        './midForecastPolicy': require('../../lib/midForecastPolicy'),
        './kmaPrecipitation': optional('../../lib/kmaPrecipitation'),
        events: require('events'), request: request || {get: function () { throw new Error('Unexpected HTTP'); }},
        xml2js: require('xml2js'), dnscache: function () {}
    }, {log: exports.logger(logs || [])});
    return new Collector();
};
exports.prepare = function (collector, count) {
    collector.listCount = count || 1;
    collector.resetResult();
    return collector;
};
exports.item = function (category, value, time) {
    return {baseDate: ['20260924'], baseTime: ['0800'], fcstDate: ['20260924'],
        fcstTime: [time || '0900'], nx: ['60'], ny: ['127'], category: [category], fcstValue: [String(value)]};
};
exports.shortItems = function (overrides, time) {
    var fields = Object.assign({TMP: '12.5', PCP: '강수없음', SNO: '적설없음', SKY: '1',
        REH: '60', PTY: '0', POP: '0', UUU: '0', VVV: '0', VEC: '0', WSD: '0'}, overrides);
    return Object.keys(fields).map(function (key) { return exports.item(key, fields[key], time); });
};
exports.response = function (items) {
    return {response: {header: [{resultCode: ['00'], resultMsg: ['NORMAL_SERVICE']}],
        body: [{totalCount: [String(items.length)], items: [{item: items}]}]}};
};
exports.xml = function (response) { return new (require('xml2js').Builder)().buildObject(response); };
exports.organize = function (kind, items) {
    var c = exports.prepare(exports.collector());
    c[kind](0, exports.response(items));
    return c.resultList[0];
};
