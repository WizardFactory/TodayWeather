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
exports.collector = function (request, logs) {
    var Collector = exports.load('lib/collectTownForecast.js', {
        './midForecastPolicy': require('../../lib/midForecastPolicy'),
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
// SYNTHETIC short product sized like the reported live getVilageFcst response
// (#2590): 84 hours x 12 hourly categories + TMN/TMX for 4 days = 1,016 rows.
exports.shortProduct = function () {
    var items = [];
    var start = Date.UTC(2026, 8, 24, 6);
    for (var h = 0; h < 84; h++) {
        var at = new Date(start + h * 3600000).toISOString();
        var date = at.slice(0, 10).replace(/-/g, ''), time = at.slice(11, 13) + '00';
        var hourly = exports.shortItems({TMP: String(10 + h % 10), WAV: '0'}, time);
        if (time === '0600') { hourly.push(exports.item('TMN', '8.0', time)); }
        if (time === '1500') { hourly.push(exports.item('TMX', '20.0', time)); }
        hourly.forEach(function (item) {
            item.baseTime = ['0500']; item.fcstDate = [date]; items.push(item);
        });
    }
    return items;
};
// HTTP stub serving `items` by the requested pageNo/numOfRows. `mutate(page, response)`
// may alter a page before XML serialization; every requested URL is recorded.
exports.pagedHttp = function (items, requests, mutate, echo) {
    return {get: function (url, options, callback) {
        requests.push(url);
        var query = new URL(url).searchParams;
        var page = Number(query.get('pageNo')), size = Number(query.get('numOfRows'));
        var r = exports.response(items.slice((page - 1) * size, page * size));
        r.response.body[0].totalCount = [String(items.length)];
        if (echo) { r.response.body[0].pageNo = [String(page)]; r.response.body[0].numOfRows = [String(size)]; }
        if (mutate) { mutate(page, r); }
        callback(null, {statusCode: 200}, exports.xml(r));
    }};
};
