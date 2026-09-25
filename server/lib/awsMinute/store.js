'use strict';
var crypto = require('crypto');
var policy = require('./policy');
function Store(db) {
    this.records = db.collection('aws_minute_observations');
    this.owners = db.collection('aws_minute_owners');
    this.stations = db.collection('kmastninfos');
}
Store.prototype.acquire = async function () {
    var token = crypto.randomBytes(16).toString('hex');
    try {
        await this.owners.insertOne(
            { _id: 'minute-writer', token: token, startedAt: new Date() },
            { maxTimeMS: 5000 },
        );
        return token;
    } catch (e) {
        if (e.code === 11000) return null;
        throw new Error('AWS_MINUTE_OWNER_WRITE');
    }
};
Store.prototype.release = async function (token) {
    await this.owners.deleteOne({ _id: 'minute-writer', token: token }, { maxTimeMS: 5000 });
};
Store.prototype.save = async function (row) {
    if (
        !row ||
        !policy.stationId(row.stationId) ||
        row._id !== policy.id(row.stationId, +row.observedAt) ||
        row.source !== 'KMA_AWS_MINUTE' ||
        row.timeBasis !== 'UTC'
    )
        throw new Error('AWS_MINUTE_RECORD');
    try {
        await this.records.updateOne(
            { _id: row._id },
            { $setOnInsert: row },
            { upsert: true, maxTimeMS: 5000 },
        );
    } catch (e) {
        if (e.code !== 11000) throw new Error('AWS_MINUTE_STORE_WRITE');
    }
};
Store.prototype.latest = async function (station, now) {
    if (!policy.stationId(station)) return null;
    var rows = await this.records
        .find(
            {
                _id: {
                    $gt: policy.id(station, now - policy.WINDOW),
                    $lte: policy.id(station, now),
                },
            },
            {
                projection: {
                    stationId: 1,
                    stationName: 1,
                    observedAt: 1,
                    source: 1,
                    timeBasis: 1,
                    values: 1,
                },
            },
        )
        .sort({ _id: -1 })
        .limit(1)
        .maxTimeMS(1500)
        .toArray();
    return rows[0] || null;
};
Store.prototype.mapping = async function (town) {
    var c = town && town.gCoord;
    if (!c || !Number.isFinite(c.lon) || !Number.isFinite(c.lat)) return null;
    var rows = await this.stations
        .find(
            {
                geo: { $near: [c.lon, c.lat], $maxDistance: 1 },
                isCityWeather: true,
                isMountain: { $ne: true },
            },
            { projection: { stnId: 1, stnName: 1, geo: 1, isCityWeather: 1, isMountain: 1 } },
        )
        .limit(8)
        .maxTimeMS(1000)
        .toArray();
    return policy.selectStation(town, rows);
};
Store.create = function () {
    var db = require('mongoose').connection.db;
    if (!db) throw new Error('AWS_MINUTE_DB_UNAVAILABLE');
    return new Store(db);
};
module.exports = Store;
