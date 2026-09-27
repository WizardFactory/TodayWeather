/**
 * Bounded MongoDB cache for the gateway geocoder (#2606).
 * mongoose 5.1.2 has no Query#maxTimeMS or syncIndexes, so reads and writes use the
 * native collection in callback form, gated on the connection state and raced
 * against client-side timers. A cache failure never fails a request.
 */

'use strict';

var TTL_SECONDS = 2592000;          // 30 days
var READ_TIMEOUT_MS = 300;
var WRITE_TIMEOUT_MS = 500;

/**
 * @param {{connection:Object, collection:Object, log?:Object, now?:function():number}} options
 */
function createMongoCache(options) {
    var connection = options.connection;
    var collection = options.collection;
    var log = options.log || console;
    var now = options.now || Date.now;
    var indexRequested = false;

    function isOpen() {
        return connection.readyState === 1;
    }

    function createIndex() {
        collection.createIndex({updatedAt: 1}, {expireAfterSeconds: TTL_SECONDS}, function (err) {
            if (err) {
                log.error('geocode cache index: ' + err.message);
            }
        });
    }

    function ensureIndex() {
        if (indexRequested) {
            return;
        }
        indexRequested = true;
        if (isOpen()) {
            createIndex();
        }
        else {
            connection.once('open', createIndex);
        }
    }

    function race(ms, work) {
        return new Promise(function (resolve) {
            var done = false;
            var timer = setTimeout(function () {
                done = true;
                resolve({timeout: true});
            }, ms);
            try {
                work(function (err, value) {
                    if (done) { return; }
                    done = true;
                    clearTimeout(timer);
                    resolve({err: err, value: value});
                });
            }
            catch (err) {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    resolve({err: err});
                }
            }
        });
    }

    /**
     * @returns {Promise<Object|null>} the stored document, or null on a miss, a
     *   timeout, an error or a closed connection
     */
    function get(key) {
        if (!isOpen()) {
            return Promise.resolve(null);
        }
        return race(READ_TIMEOUT_MS, function (done) {
            collection.findOne({_id: key}, {maxTimeMS: READ_TIMEOUT_MS}, done);
        }).then(function (result) {
            if (result.err) {
                log.warn('geocode cache read: ' + result.err.message);
            }
            return result.value || null;
        });
    }

    /**
     * @returns {Promise<void>} resolves after the write, a timeout or an error
     */
    function set(key, doc) {
        if (!isOpen()) {
            return Promise.resolve();
        }
        var update = {$set: {kind: doc.kind, lang: doc.lang, geoInfo: doc.geoInfo, updatedAt: new Date(now())}};
        return race(WRITE_TIMEOUT_MS, function (done) {
            collection.updateOne({_id: key}, update, {upsert: true}, done);
        }).then(function (result) {
            if (result.err) {
                log.warn('geocode cache write: ' + result.err.message);
            }
        });
    }

    return {get: get, set: set, ensureIndex: ensureIndex};
}

/** A cache that never hits (used when no database is configured, and in tests). */
function createNullCache() {
    return {
        get: function () { return Promise.resolve(null); },
        set: function () { return Promise.resolve(); },
        ensureIndex: function () {}
    };
}

module.exports = {
    createMongoCache: createMongoCache,
    createNullCache: createNullCache,
    TTL_SECONDS: TTL_SECONDS,
    READ_TIMEOUT_MS: READ_TIMEOUT_MS,
    WRITE_TIMEOUT_MS: WRITE_TIMEOUT_MS
};
