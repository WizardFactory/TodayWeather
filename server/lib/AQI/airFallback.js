/**
 * Domestic air fallback (#2622, providers generalized in #2628).
 * Used by the v000903 KMA routes when no nearby AirKorea station has an observation within
 * eight hours. The provider chain (lib/air) picks the provider; results are shared by all API
 * workers through a Mongo cache; a request finishes only after its result is written, and one
 * worker makes at most one chain call per cell at a time. Provider failures never reach the
 * caller as errors.
 */

"use strict";

var config = require('../../config/config');
var policy = require('../../config/air');
var providers = require('../air/providers');
var providerBudget = require('../air/providerBudget');
var providerChain = require('../air/providerChain');
var observation = require('../air/observation');
var AirObservationCache = require('../../models/air.observation.cache.model');

var inFlight = {};
var chain;

function _chain() {
    if (!chain) {
        chain = providerChain.createChain({
            providers: providers.byId,
            budget: providerBudget.createBudget({config: policy}),
            config: policy,
            keyString: config.keyString,
            axios: require('axios')
        });
    }
    return chain;
}

function _cellOf(gCoord) {
    return Number(gCoord.lat).toFixed(2) + ',' + Number(gCoord.lon).toFixed(2);
}

function _readCache(cell, now, callback) {
    var answered = false;
    function answer(row) {
        answered = true;
        callback(row);
    }
    try {
        AirObservationCache.find({_id: cell}).limit(1).lean().exec(function (err, rows) {
            if (err) {
                log.warn('air cache read failed cell=' + cell + ' ' + err.message);
                return answer();
            }
            var row = Array.isArray(rows) ? rows[0] : undefined;
            answer(row && new Date(row.expireAt).getTime() > now ? row : undefined);
        });
    }
    catch (err) {
        if (answered) {
            // thrown by the caller's callback, not by the cache read
            throw err;
        }
        log.warn('air cache read failed cell=' + cell + ' ' + err.message);
        answer();
    }
}

/**
 * Calls back once the write is acknowledged (or failed), so a request finishes only when
 * other workers can already read its result.
 */
function _writeCache(row, callback) {
    var answered = false;
    function answer() {
        if (!answered) {
            answered = true;
            callback();
        }
    }
    try {
        // explicit nulls: a cell can change from ok to failed and back, and undefined would be dropped or
        // stored differently depending on the driver settings
        var set = {outcome: row.outcome, provider: row.provider || null, reason: row.reason || null,
            observation: row.observation || null, fetchedAt: row.fetchedAt, expireAt: row.expireAt};
        AirObservationCache.updateOne({_id: row._id}, {$set: set}, {upsert: true}, function (err) {
            if (err) {
                log.warn('air cache write failed cell=' + row._id + ' ' + err.message);
            }
            answer();
        });
    }
    catch (err) {
        if (answered) {
            throw err;
        }
        log.warn('air cache write failed cell=' + row._id + ' ' + err.message);
        answer();
    }
}

/**
 * One chain call per cell in this process; later callers for the same cell wait for it, and
 * everybody is answered after the cache write.
 */
function _fetchShared(cell, gCoord, requestTime, callback) {
    if (inFlight[cell]) {
        inFlight[cell].push(callback);
        return;
    }
    inFlight[cell] = [callback];
    _chain().fetch(gCoord, requestTime, function (result) {
        var now = Date.now();
        // an observation that exists but is unusable now (stale, far, no PM) is kept: its
        // evaluation is repeated per request, and refetching would return the same data
        var ok = !!result.observation;
        var row = {
            _id: cell,
            outcome: ok ? 'ok' : 'failed',
            provider: ok ? result.observation.provider : undefined,
            reason: result.outcome === 'ok' ? undefined : result.reason,
            observation: result.observation,
            fetchedAt: new Date(now),
            expireAt: new Date(now + (ok ? policy.CACHE_TTL_MS : policy.FAILURE_CACHE_TTL_MS))
        };
        if (result.outcome !== 'ok') {
            log.warn('air fallback: no usable observation cell=' + cell + ' reason=' + result.reason +
                ' attempts=' + result.attempts.map(function (a) { return a.provider + ':' + a.outcome; }).join(',') +
                ' skipped=' + result.skipped.map(function (s) { return s.provider + ':' + s.reason; }).join(','));
        }
        _writeCache(row, function () {
            var waiting = inFlight[cell];
            delete inFlight[cell];
            waiting.forEach(function (cb) {
                cb(row, result);
            });
        });
    });
}

/**
 * @param gCoord {lat, lon} of the requested town
 * @param requestTime Date
 * @param callback (err, arpltn|undefined, reason) — err is only set for programming errors
 */
function getArpltn(gCoord, requestTime, callback) {
    if (!gCoord || !isFinite(Number(gCoord.lat)) || !isFinite(Number(gCoord.lon))) {
        return callback(null, undefined, 'no-coord');
    }
    if (!_chain().anyConfigured()) {
        return callback(null, undefined, 'no-provider');
    }
    var cell = _cellOf(gCoord);

    function finish(row, chainResult) {
        var result;
        try {
            if (row.outcome === 'ok' && row.observation) {
                result = observation.evaluate(row.observation, gCoord, requestTime);
            }
            else {
                result = {reason: row.reason || 'failed'};
            }
        }
        catch (err) {
            return callback(err);
        }
        if (result.arpltn) {
            log.info('air fallback used cell=' + cell + ' provider=' + row.provider + ' dataTime=' + result.arpltn.dataTime +
                (result.distance !== undefined ? ' distanceKm=' + result.distance.toFixed(1) : '') +
                (chainResult ? ' fetched' : ' cached'));
        }
        callback(null, result.arpltn, result.reason);
    }

    _readCache(cell, Date.now(), function (row) {
        if (row) {
            return finish(row);
        }
        _fetchShared(cell, gCoord, requestTime, finish);
    });
}

module.exports = {
    getArpltn: getArpltn
};
