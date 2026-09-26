/**
 * Visual Crossing Timeline API requester for overseas weather (#2585).
 * One call returns history, current conditions and forecast in Dark Sky-like `us` units.
 * Cost: 'combined' (yesterday + today..+7 days) = 25 records, 'forecast' (today..+7 days) = 1 record.
 */

'use strict';

const https = require('https');
const zlib = require('zlib');

const BASE_URL = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/';
const RANGES = {
    combined: 'yesterday/next7days',
    forecast: 'today/next7days'
};
const ELEMENTS = ['datetime', 'datetimeEpoch', 'temp', 'tempmax', 'tempmin', 'feelslike', 'feelslikemax', 'feelslikemin',
    'humidity', 'precip', 'precipprob', 'preciptype', 'snow', 'windspeed', 'winddir', 'pressure', 'visibility',
    'cloudcover', 'conditions', 'icon', 'source', 'sunriseEpoch', 'sunsetEpoch', 'moonphase'];
const MAX_BODY_BYTES = 4 * 1024 * 1024;    // a combined body is about 70 KB
const RESET_CODES = ['ECONNRESET', 'EPIPE'];

// Shared keep-alive agent: repeated calls from one worker reuse the TLS connection.
const agent = new https.Agent({keepAlive: true, maxSockets: 8});

// Coordinates as plain decimals (never exponent notation), at most 6 decimals.
function formatCoordinate(value) {
    return String(parseFloat(value.toFixed(6)));
}

// Log coordinates at 2 decimals (about 1 km): enough to identify the request, less location data.
function logCoordinate(value) {
    return value.toFixed(2);
}

class VcRequester {
    /**
     * @param {{timeoutMs?: number, retryDelayMs?: number, retryWindowMs?: number}} [options]
     */
    constructor(options) {
        options = options || {};
        // Budget for the whole call, including one retry.
        this.timeoutMs = options.timeoutMs || 2500;
        this.retryDelayMs = options.retryDelayMs === undefined ? 300 : options.retryDelayMs;
        this.retryWindowMs = options.retryWindowMs === undefined ? 1500 : options.retryWindowMs;
    }

    static isValidKey(key) {
        return typeof key === 'string' && key.length >= 10 && !/^You have to set/.test(key);
    }

    static _scrub(text, key) {
        text = String(text);
        if (!key) {
            return text;
        }
        return text.split(key).join('***').split(encodeURIComponent(key)).join('***');
    }

    _makeUrl(lat, lon, range, key) {
        return BASE_URL + formatCoordinate(lat) + ',' + formatCoordinate(lon) + '/' + RANGES[range] +
            '?unitGroup=us&lang=en&include=days,hours,current&elements=' + ELEMENTS.join(',') +
            '&key=' + encodeURIComponent(key);
    }

    _get(url, key, timeoutMs, callback) {
        let done = false;
        let req;
        const finish = (err, status, body) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            callback(err, status, body);
        };
        const fail = (prefix, err) => {
            const wrapped = new Error('VC> ' + prefix + ' ' + VcRequester._scrub(err.code || err.message, key));
            wrapped.code = err.code;
            finish(wrapped);
        };
        const timer = setTimeout(() => {
            finish(new Error('VC> timeout after ' + this.timeoutMs + 'ms'));
            if (req) {
                req.destroy();
            }
        }, Math.max(0, timeoutMs));

        req = https.get(url, {agent: agent, headers: {'Accept-Encoding': 'gzip'}}, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                    finish(new Error('VC> response too large (> ' + MAX_BODY_BYTES + ' bytes)'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                if ((res.headers || {})['content-encoding'] !== 'gzip') {
                    return finish(null, res.statusCode, raw.toString('utf8'));
                }
                zlib.gunzip(raw, (err, body) => {
                    if (err) {
                        return fail('gzip error', err);
                    }
                    finish(null, res.statusCode, body.toString('utf8'));
                });
            });
            res.on('error', (err) => fail('response error', err));
        });
        req.on('error', (err) => fail('request error', err));
    }

    /**
     * @param {{lat: number, lon: number, range: string}} params range 'combined' or 'forecast'
     * @param {string} key VC_SECRET_KEY
     * @param {function(Error, Object=, Object=)} callback parsed Timeline body and
     *        {status, cost, ms, retried}; err.providerDown marks daily-limit 429s and 401/403
     */
    getTimeline(params, key, callback) {
        if (!VcRequester.isValidKey(key)) {
            return callback(new Error('VC> VC_SECRET_KEY is not configured'));
        }
        if (!RANGES.hasOwnProperty(params.range)) {
            return callback(new Error('VC> unknown range ' + params.range));
        }
        const lat = Number(params.lat);
        const lon = Number(params.lon);
        if (!isFinite(lat) || !isFinite(lon) || params.lat === '' || params.lon === '') {
            return callback(new Error('VC> invalid coordinate ' + params.lat + ',' + params.lon));
        }

        const url = this._makeUrl(lat, lon, params.range, key);
        const where = 'range=' + params.range + ' loc=' + logCoordinate(lat) + ',' + logCoordinate(lon);
        const started = Date.now();
        const deadline = started + this.timeoutMs;
        const attempt = (retried) => {
            this._get(url, key, deadline - Date.now(), (err, status, body) => {
                const ms = Date.now() - started;
                const timeLeft = deadline - Date.now() > this.retryDelayMs;
                // Retry once: a concurrency 429 (not the daily limit) or a reset keep-alive socket.
                const concurrency = !err && status === 429 && /concurren/i.test(String(body));
                const reset = err && RESET_CODES.indexOf(err.code) >= 0;
                if (!retried && timeLeft && ((concurrency && ms < this.retryWindowMs) || reset)) {
                    log.warn('VC> ' + where + ' ' + (reset ? err.code : 'status=429') + ' retrying once');
                    return setTimeout(() => attempt(true), this.retryDelayMs);
                }
                if (!err && status >= 400) {
                    err = new Error('VC> HTTP ' + status + ': ' + VcRequester._scrub(String(body).slice(0, 120), key));
                    err.statusCode = status;
                    err.providerDown = status === 401 || status === 403 || (status === 429 && !concurrency);
                }
                let result;
                if (!err) {
                    try {
                        result = JSON.parse(body);
                    }
                    catch (e) {
                        err = new Error('VC> invalid JSON (' + String(body).length + ' bytes)');
                    }
                }
                if (!err && !(result && Array.isArray(result.days) && result.days.length > 0 &&
                        typeof result.timezone === 'string' && typeof result.tzoffset === 'number')) {
                    err = new Error('VC> unexpected body');
                }
                const meta = {status: status || 0, cost: result ? result.queryCost : 0, ms: ms, retried: retried};
                if (err) {
                    // The service host's console logs only errors (NODE_ENV=production).
                    log.error('VC> ' + where + ' failed ms=' + ms + ' ' + err.message);
                    return callback(err, undefined, meta);
                }
                log.info('VC> ' + where + ' status=' + status + ' cost=' + result.queryCost + ' ms=' + ms + (retried ? ' retried' : ''));
                callback(null, result, meta);
            });
        };
        attempt(false);
    }
}

VcRequester.BASE_URL = BASE_URL;
VcRequester.ELEMENTS = ELEMENTS;
VcRequester.RANGES = RANGES;

module.exports = VcRequester;
