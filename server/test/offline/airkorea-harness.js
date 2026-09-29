'use strict';
const {createLoader, logger} = require('./air-harness');
const async = require('async');
const Arpltn = require('../../models/arpltnKeco');
const Sido = require('../../models/sido.arpltn.keco.model');
function harness(options = {}) {
    const logs = [], stationWrites = [], sidoWrites = [];
    const station = Object.assign({}, Arpltn.schema.statics, {update(q, row, opts, cb) {
        stationWrites.push(row); cb(options.stationError);
    }, remove(q, cb) { cb(); }});
    const sido = Object.assign({}, Sido.schema.statics, {update(q, row, opts, cb) {
        sidoWrites.push(row); if (options.saveSido) return options.saveSido(q, row, opts, cb);
        cb(options.sidoError);
    }, remove(q, cb) { cb(); }});
    const loader = createLoader({log: logger(logs), allowNodeModules: ['https', 'url'], overrides: {
        async, request: () => { throw Error('Legacy network forbidden'); }, dnscache: () => {},
        'models/arpltnKeco.js': station, 'models/sido.arpltn.keco.model.js': sido,
        'models/modelMsrStnInfo.js': {}, 'models/modelMinuDustFrcst.js': {},
        'controllers/airkorea.hourly.forecast.controller.js': function () {},
        'lib/kmaTimeLib.js': {convertDateToYYYY_MM_DD_HHoMM: d => d.toISOString().slice(0,16).replace('T',' ')}, 'config/config.js': {}, 's3/controller.s3.js': function () {},
        ...(options.overrides || {})
    }});
    const Keco = loader.load('lib/kecoRequester.js');
    const keco = new Keco(); keco._uploadS3 = (value, cb) => cb();
    return {keco, loader, station, sido, stationWrites, sidoWrites, logs};
}
function invoke(obj, name, ...args) {
    return new Promise((resolve, reject) => obj[name](...args, (err, value) => err ? reject(err) : resolve(value)));
}
module.exports = {harness, invoke};
