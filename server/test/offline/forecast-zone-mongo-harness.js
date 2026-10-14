'use strict';
// Real mongod (mongodb-memory-server), Mongoose 5.1.2 and the real zone model/controller (#2739).
// No app startup or configuration file; the caller supplies the request function and keys.
const fs = require('fs');
const path = require('path');
const async = require('async');
const mongoose = require('mongoose');
const {MongoMemoryServer} = require('mongodb-memory-server-core');
const h = require('./harness');
const rejection = require('../../lib/dataGoKrRejection');

// Mongoose 5.1.2's driver needs OP_QUERY, which MongoDB 5.1+ removed; use the 4.4 server line.
// TW_MONGOD names a local 4.4 binary (as in CI); otherwise mongodb-memory-server downloads one.
exports.start = async function (request, logs) {
    const binary = process.env.TW_MONGOD ? {systemBinary: process.env.TW_MONGOD} : {version: '4.4.29'};
    const mongo = await MongoMemoryServer.create({binary, instance: {ip: '127.0.0.1'}});
    const connection = mongoose.createConnection(mongo.getUri('zones2739'));
    let Model;
    try {
        await new Promise((resolve, reject) => { connection.once('open', resolve); connection.once('error', reject); });
        Model = h.load('models/kma/kma.forecast.zone.model.js',
            {mongoose: {Schema: mongoose.Schema, model: connection.model.bind(connection)}});
        await new Promise((resolve, reject) => Model.ensureIndexes(err => err ? reject(err) : resolve()));
    } catch (err) {
        await connection.close();
        await mongo.stop();
        throw err;
    }
    const Controller = h.load('controllers/kma/kma.forecast.zone.controller.js', {request, async, fs, path,
        '../../models/kma/kma.forecast.zone.model': Model, '../../lib/dataGoKrRejection': rejection},
        {log: h.logger(logs), setImmediate, __dirname: path.resolve(__dirname, '../../controllers/kma')});
    return {
        Model, Controller,
        exec: query => new Promise((resolve, reject) => query.exec((err, rows) => err ? reject(err) : resolve(rows))),
        zones: (ctrl, region, city) => new Promise((resolve, reject) =>
            ctrl.findForecastZoneByName(region, city).exec((err, rows) => err ? reject(err) : resolve(rows.map(r => r.regId)))),
        midTempZones: ctrl => new Promise((resolve, reject) =>
            ctrl.findMidTempZones((err, rows) => err ? reject(err) : resolve(rows))),
        stop: async () => { await connection.close(); await mongo.stop(); }
    };
};
// The 군위 code retired on 2023-11-30, as a newsky2-era row without the retirement fields.
exports.legacyRows = [{regId: '11H10603', regName: '군위', regSp: 'C', regUp: '11H10600', tmEd: '210012310000', geo: [128.57, 36.24]}];
exports.townCases = [
    ['서울특별시', '강남구', '11B10101'], ['광주광역시', '북구', '11F20501'], ['경기도', '광주시', '11B20702'],
    ['강원특별자치도', '고성군', '11D20402'], ['경상남도', '고성군', '11H20404'],
    ['경상북도', '군위군', '11H10707'], ['대구광역시', '군위군', '11H10707']];
