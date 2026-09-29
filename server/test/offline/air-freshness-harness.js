'use strict';
// Real production controllers with isolated storage/provider collaborators; no app startup.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const noop = () => {};
const log = Object.fromEntries(['info', 'warn', 'error', 'debug', 'verbose', 'silly'].map(k => [k, noop]));
function Stub() {}
function harness(instant) {
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [instant])); }
        static now() { return new Date(instant).getTime(); }
    }
    function load(file, deps = {}) {
        const module = {exports: {}};
        const context = {module, exports: module.exports, Date: Clock, console, log, setImmediate,
            manager: {leadingZeros: (n, width) => String(n).padStart(width, '0')},
            require: name => Object.prototype.hasOwnProperty.call(deps, name) ? deps[name] : Stub};
        context.global = context;
        vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
        return module.exports;
    }
    const converter = load('lib/aqi.converter.js');
    const keco = load('controllers/kecoController.js', {'../lib/aqi.converter': converter});
    const Town = load('controllers/controllerTown.js', {'../controllers/kecoController': keco});
    const Detail = load('controllers/controllerTown24h.js', {
        '../controllers/controllerTown': Town, '../controllers/kecoController': keco,
        '../lib/aqi.converter': converter, '../lib/kmaTimeLib': load('lib/kmaTimeLib.js')
    });
    return {keco, town: new Town(), detail: new Detail()};
}
function observation(dataTime, stationName = 'fresh') {
    return {dataTime, stationName, pm10Value: 20, pm25Value: 10, pm10Grade: 1, pm25Grade: 1};
}
module.exports = {harness, observation};
