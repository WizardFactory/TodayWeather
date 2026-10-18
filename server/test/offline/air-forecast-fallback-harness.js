'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const instant = '2026-09-24T00:10:00Z';
function harness(kaq, airkorea, options = {}) {
    const calls = [];
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [options.now || instant])); }
        static now() { return new Date(options.now || instant).getTime(); }
    }
    function Stub() {}
    function load(file, deps = {}) {
        const module = {exports: {}};
        const context = {module, exports: module.exports, Date: Clock, console,
            manager: {leadingZeros: (n, width) => String(n).padStart(width, '0')},
            log: Object.fromEntries(['info','warn','error','debug','verbose'].map(k => [k, () => {}])),
            require: name => Object.prototype.hasOwnProperty.call(deps, name) ? deps[name] : Stub};
        context.global = context;
        vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
        return module.exports;
    }
    function provider(source, rows) {
        return function() {
            this.getForecast = (station, cb) => {
                calls.push({source, station});
                setImmediate(() => cb(rows instanceof Error ? rows : null, rows instanceof Error ? undefined : rows));
            };
        };
    }
    const converter = load('lib/aqi.converter.js');
    const keco = load('controllers/kecoController.js', {'../lib/aqi.converter': converter, async: require('async'), '../models/modelMsrStnInfo.js': options.stationModel || Stub, '../models/arpltnKeco.js': options.observationModel || Stub});
    const Town = load('controllers/controllerTown.js', {'../controllers/kecoController': keco});
    const Detail = load('controllers/controllerTown24h.js', {
        async: require('async'), '../controllers/controllerTown': Town, '../controllers/kecoController': keco,
        '../lib/aqi.converter': converter, '../lib/kmaTimeLib': load('lib/kmaTimeLib.js'),
        '../controllers/kaq.hourly.forecast.controller': options.kaqController || provider('kaq', kaq),
        '../controllers/airkorea.hourly.forecast.controller': options.airkoreaController || provider('airkorea', airkorea),
        '../lib/AQI/airFallback': options.fallback || Stub
    });
    const detail = new Detail();
    return {detail, keco, calls, get(info, source = 'kaq', station) {
        return new Promise(resolve => detail._getAirForecast(info, source, 'airkorea', (error, result) => resolve({error, result}), station));
    }};
}
function airInfo() {
    return {source: 'airkorea', last: {stationName: '중구', dataTime: '2026-09-24 09:00', pm10Value: 20},
        pollutants: {pm10: {hourly: [{date: '2026-09-24 09:00', val: 20, grade: 1}]}}};
}
function row(overrides = {}) {
    return Object.assign({code: 'pm10', val: 32, dataTime: '2026-09-24 10:00', pubDate: '2026-09-24 08:00'}, overrides);
}
module.exports = {harness, airInfo, row};
