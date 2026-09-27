/**
 * Domestic air fallback from the WAQI geo feed (#2622).
 * Used by the v000903 KMA routes when no nearby AirKorea station has an observation within
 * eight hours. Results are shared by all API workers through a Mongo cache; a request finishes
 * only after its result is written, and one worker makes at most one call per cell at a time.
 * Provider failures never reach the caller as errors.
 */

"use strict";

var config = require('../../config/config');
var AqiConverter = require('../aqi.converter');
var StationName = require('./waqiStationName');
var WaqiAirCache = require('../../models/waqi.air.cache.model');

var BASE_URL = 'https://api.waqi.info/feed/';
var FRESHNESS_HOURS = 8;                    // same window as AirKorea current observations
var FUTURE_SLACK_MS = 60 * 60 * 1000;
var MAX_STATION_DISTANCE_KM = 30;
var REQUEST_TIMEOUT_MS = 3000;
var CACHE_TTL_MS = 30 * 60 * 1000;          // WAQI publishes hourly
var FAILURE_CACHE_TTL_MS = 2 * 60 * 1000;
var POLLUTANTS = ['pm10', 'pm25', 'o3', 'no2', 'co', 'so2'];
// WAQI gas sub-indices convert to ppb; AirKorea values are ppm (same as the world path).
var PPB_POLLUTANTS = ['o3', 'no2', 'so2'];

var inFlight = {};

function _getKey() {
    var keys = config.keyString && config.keyString.aqi_keys;
    var key = Array.isArray(keys) && keys[0] ? keys[0].key : undefined;
    if (typeof key !== 'string' || key === '' || key.indexOf('You have to set') === 0) {
        return undefined;
    }
    return key;
}

function _cellOf(gCoord) {
    return Number(gCoord.lat).toFixed(2) + ',' + Number(gCoord.lon).toFixed(2);
}

function _distanceKm(lat1, lon1, lat2, lon2) {
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _pad(n) {
    return (n < 10 ? '0' : '') + n;
}

/**
 * AirKorea dataTime form "YYYY-MM-DD HH:mm" in KST.
 */
function _kstDataTime(date) {
    var kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCFullYear() + '-' + _pad(kst.getUTCMonth() + 1) + '-' + _pad(kst.getUTCDate()) + ' ' +
        _pad(kst.getUTCHours()) + ':' + _pad(kst.getUTCMinutes());
}

/**
 * Keep only what the fallback needs from a WAQI feed body.
 */
function _compactFeed(data) {
    // provider fields are untrusted; anything of an unexpected type is dropped
    var time;
    var t = data.time && typeof data.time === 'object' ? data.time : {};
    if (typeof t.iso === 'string') {
        time = t.iso;
    }
    else if (typeof t.s === 'string' && typeof t.tz === 'string') {
        time = t.s.replace(' ', 'T') + t.tz;
    }
    var city = data.city && typeof data.city === 'object' ? data.city : {};
    var geo;
    if (Array.isArray(city.geo) && city.geo.length >= 2 &&
        typeof city.geo[0] === 'number' && isFinite(city.geo[0]) &&
        typeof city.geo[1] === 'number' && isFinite(city.geo[1])) {
        geo = [city.geo[0], city.geo[1]];
    }
    var iaqi = {};
    POLLUTANTS.forEach(function (code) {
        var item = data.iaqi && typeof data.iaqi === 'object' ? data.iaqi[code] : undefined;
        if (item && typeof item.v === 'number' && isFinite(item.v)) {
            iaqi[code] = item.v;
        }
    });
    return {
        name: typeof city.name === 'string' ? city.name : undefined,
        geo: geo,
        time: time,
        iaqi: iaqi
    };
}

function _failureReason(err) {
    if (err && err.code === 'ECONNABORTED') {
        return 'timeout';
    }
    if (err && err.response && err.response.status) {
        return 'http-' + err.response.status;
    }
    return 'transport';
}

function _fetch(gCoord, key, callback) {
    var url = BASE_URL + 'geo:' + gCoord.lat + ';' + gCoord.lon + '/?token=' + encodeURIComponent(key);
    var settled = false;
    var done = function (outcome) {
        if (settled) {
            return;
        }
        settled = true;
        // leave the promise chain so a callback exception is not taken as a request failure
        setImmediate(function () {
            callback(outcome);
        });
    };
    try {
        require('axios').get(url, {timeout: REQUEST_TIMEOUT_MS}).then(function (response) {
            try {
                var body = response && response.data;
                if (!body || body.status !== 'ok' || !body.data || typeof body.data !== 'object') {
                    return done({outcome: 'failed', reason: 'status-' + (body && body.status)});
                }
                done({outcome: 'ok', feed: _compactFeed(body.data)});
            }
            catch (err) {
                done({outcome: 'failed', reason: 'invalid-body'});
            }
        }, function (err) {
            done({outcome: 'failed', reason: _failureReason(err)});
        });
    }
    catch (err) {
        done({outcome: 'failed', reason: 'transport'});
    }
}

function _readCache(cell, now, callback) {
    var answered = false;
    function answer(row) {
        answered = true;
        callback(row);
    }
    try {
        WaqiAirCache.find({_id: cell}).limit(1).lean().exec(function (err, rows) {
            if (err) {
                log.warn('WAQI air cache read failed cell=' + cell + ' ' + err.message);
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
        log.warn('WAQI air cache read failed cell=' + cell + ' ' + err.message);
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
        var set = {outcome: row.outcome, reason: row.reason, feed: row.feed, fetchedAt: row.fetchedAt, expireAt: row.expireAt};
        WaqiAirCache.updateOne({_id: row._id}, {$set: set}, {upsert: true}, function (err) {
            if (err) {
                log.warn('WAQI air cache write failed cell=' + row._id + ' ' + err.message);
            }
            answer();
        });
    }
    catch (err) {
        if (answered) {
            // thrown by a waiting caller, not by the cache write
            throw err;
        }
        log.warn('WAQI air cache write failed cell=' + row._id + ' ' + err.message);
        answer();
    }
}

/**
 * One fetch per cell in this process; later callers for the same cell wait for it.
 */
function _fetchShared(cell, gCoord, key, callback) {
    if (inFlight[cell]) {
        inFlight[cell].push(callback);
        return;
    }
    inFlight[cell] = [callback];
    _fetch(gCoord, key, function (result) {
        var now = Date.now();
        var row = {
            _id: cell,
            outcome: result.outcome,
            reason: result.reason,
            feed: result.feed,
            fetchedAt: new Date(now),
            expireAt: new Date(now + (result.outcome === 'ok' ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS))
        };
        if (row.outcome !== 'ok') {
            log.warn('WAQI air fallback request failed cell=' + cell + ' reason=' + row.reason);
        }
        // requests for this cell keep joining until the cache holds the result
        _writeCache(row, function () {
            var waiting = inFlight[cell];
            delete inFlight[cell];
            waiting.forEach(function (cb) {
                cb(row);
            });
        });
    });
}

/**
 * Accept a cached or fetched feed for this request, or give the reason it is not usable.
 */
function _evaluate(feed, gCoord, requestTime) {
    var observed = new Date(feed.time);
    if (!feed.time || isNaN(observed.getTime())) {
        return {reason: 'no-time'};
    }
    var age = requestTime.getTime() - observed.getTime();
    if (age > FRESHNESS_HOURS * 60 * 60 * 1000) {
        return {reason: 'stale'};
    }
    if (age < -FUTURE_SLACK_MS) {
        return {reason: 'future'};
    }
    if (!feed.geo || feed.geo.length < 2) {
        return {reason: 'no-station-geo'};
    }
    var distance = _distanceKm(Number(gCoord.lat), Number(gCoord.lon), Number(feed.geo[0]), Number(feed.geo[1]));
    if (!(distance <= MAX_STATION_DISTANCE_KM)) {
        return {reason: 'too-far'};
    }

    var arpltn = {source: 'aqicn', stationName: StationName.shorten(feed.name), dataTime: _kstDataTime(observed)};
    POLLUTANTS.forEach(function (code) {
        var index = feed.iaqi ? feed.iaqi[code] : undefined;
        if (typeof index !== 'number' || !isFinite(index) || index < 0) {
            return;
        }
        var value = AqiConverter.extractValue(code, index);
        if (typeof value !== 'number' || !isFinite(value) || value < 0) {
            return;
        }
        if (PPB_POLLUTANTS.indexOf(code) >= 0) {
            value = AqiConverter.ppb2ppm(value);
        }
        arpltn[code + 'Value'] = value;
    });
    if (arpltn.pm10Value === undefined && arpltn.pm25Value === undefined) {
        return {reason: 'no-pm'};
    }
    return {arpltn: arpltn, distance: distance, age: age};
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
    var key = _getKey();
    if (!key) {
        return callback(null, undefined, 'no-key');
    }
    var cell = _cellOf(gCoord);

    function finish(row) {
        var result;
        try {
            result = row.outcome === 'ok' && row.feed ?
                _evaluate(row.feed, gCoord, requestTime) : {reason: row.reason || 'failed'};
        }
        catch (err) {
            return callback(err);
        }
        if (result.arpltn) {
            log.info('WAQI air fallback used cell=' + cell + ' station=' + result.arpltn.stationName +
                ' dataTime=' + result.arpltn.dataTime + ' distanceKm=' + result.distance.toFixed(1));
        }
        callback(null, result.arpltn, result.reason);
    }

    _readCache(cell, Date.now(), function (row) {
        if (row) {
            return finish(row);
        }
        _fetchShared(cell, gCoord, key, finish);
    });
}

module.exports = {
    FRESHNESS_HOURS: FRESHNESS_HOURS,
    MAX_STATION_DISTANCE_KM: MAX_STATION_DISTANCE_KM,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    CACHE_TTL_MS: CACHE_TTL_MS,
    FAILURE_CACHE_TTL_MS: FAILURE_CACHE_TTL_MS,
    getArpltn: getArpltn
};
