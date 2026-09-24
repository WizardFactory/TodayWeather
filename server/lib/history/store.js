'use strict';
var crypto = require('crypto');
var policy = require('./policy');
// Native collections allow the same durable adapter with both legacy grid DB formats.
function Store(records, leases) {
    this.records = records;
    this.leases = leases;
}
Store.prototype.read = function (kind, station, start, end) {
    return this.records
        .find({ _id: { $gte: policy.id(kind, station, start), $lte: policy.id(kind, station, end) } })
        .sort({ key: 1 })
        .maxTimeMS(2000)
        .toArray();
};
Store.prototype.save = async function (row) {
    var identity = {};
    Object.keys(row).forEach(function (k) {
        if (k !== 'values') identity[k] = row[k];
    });
    identity.values = {};
    try {
        await this.records.updateOne(
            { _id: row._id },
            { $setOnInsert: identity },
            { upsert: true, maxTimeMS: 5000 }
        );
    } catch (e) {
        if (e.code !== 11000) throw new Error('HISTORY_STORAGE_WRITE');
    }
    for (var field of Object.keys(row.values)) {
        if (!policy.valid(field, row.values[field])) continue;
        var query = { _id: row._id },
            update = {};
        query['values.' + field] = { $exists: false };
        update['values.' + field] = row.values[field];
        try {
            await this.records.updateOne(query, { $set: update }, { maxTimeMS: 5000 });
        } catch (e) {
            throw new Error('HISTORY_STORAGE_WRITE');
        }
    }
};
Store.prototype.acquire = async function (station) {
    var token = crypto.randomBytes(16).toString('hex'),
        now = new Date();
    try {
        var result = await this.leases.updateOne(
            { _id: station, expiresAt: { $lte: now } },
            { $set: { owner: token, expiresAt: new Date(+now + 15 * 60000) } },
            { upsert: true, maxTimeMS: 5000 }
        );
        return result ? token : null;
    } catch (e) {
        if (e.code === 11000) return null;
        throw new Error('HISTORY_LEASE_WRITE');
    }
};
Store.prototype.release = async function (station, token) {
    try {
        await this.leases.deleteOne({ _id: station, owner: token }, { maxTimeMS: 5000 });
    } catch (e) {
        throw new Error('HISTORY_LEASE_RELEASE');
    }
};
Store.create = function () {
    var db = require('mongoose').connection.db;
    if (!db) throw new Error('HISTORY_DB_UNAVAILABLE');
    return new Store(db.collection('asos_history'), db.collection('asos_history_leases'));
};
module.exports = Store;
