'use strict';

// Count against the separate Pollen SKU. Consume the reservation before the
// request and keep it when transport fails or the client gives up.
module.exports = function createMonthlyBudget(Usage, cap) {
    return function reserve(now, callback) {
        if (!(cap > 0)) {
            return callback(false);
        }
        var month = now.toISOString().slice(0, 7);
        var expiry = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
        var filter = {_id: 'pollen:google:m:' + month, calls: {$lt: cap}};
        var update = {$inc: {calls: 1}, $set: {expireAt: expiry}};
        Usage.findOneAndUpdate(filter, update, {upsert: true, new: true}, function (error, row) {
            if (error && error.code === 11000) {
                // A concurrent insert and a full counter can both produce a
                // duplicate key. One conditional non-upsert distinguishes them.
                return Usage.findOneAndUpdate(filter, update, {new: true}, function (nextError, nextRow) {
                    callback(!nextError && !!nextRow);
                });
            }
            callback(!error && !!row);
        });
    };
};
