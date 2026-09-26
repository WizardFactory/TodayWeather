/**
 * Visual Crossing Timeline API requester for overseas weather (#2585).
 * One call returns history, current conditions and forecast in Dark Sky-like `us` units.
 * Cost: 'combined' (yesterday + today..+7 days) = 25 records, 'forecast' (today..+7 days) = 1 record.
 */

'use strict';

const https = require('https');

const BASE_URL = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/';
const RANGES = {
    combined: 'yesterday/next7days',
    forecast: 'today/next7days'
};
const ELEMENTS = ['datetime', 'datetimeEpoch', 'temp', 'tempmax', 'tempmin', 'feelslike', 'feelslikemax', 'feelslikemin',
    'humidity', 'precip', 'precipprob', 'preciptype', 'snow', 'windspeed', 'winddir', 'pressure', 'visibility',
    'cloudcover', 'conditions', 'icon', 'source', 'sunriseEpoch', 'sunsetEpoch', 'moonphase'];

// Shared keep-alive agent: repeated calls from one worker reuse the TLS connection.
const agent = new https.Agent({keepAlive: true, maxSockets: 8});

class VcRequester {
    /**
     * @param {{timeoutMs?: number, retryDelayMs?: number, retryWindowMs?: number}} [options]
     */
    constructor(options) {
        options = options || {};
        // Budget for the whole call, including a 429 retry: the gateway Lambda waits 3 s per backend attempt.
        this.timeoutMs = options.timeoutMs || 2500;
        this.retryDelayMs = options.retryDelayMs === undefined ? 300 : options.retryDelayMs;
        this.retryWindowMs = options.retryWindowMs === undefined ? 1500 : options.retryWindowMs;
    }

    static isValidKey(key) {
        return typeof key === 'string' && key.length >= 10 && !/^You have to set/.test(key);
    }

    static _scrub(text, key) {
        text = String(text);
        return key ? text.split(key).join('***') : text;
    }

    _makeUrl(lat, lon, range, key) {
        return BASE_URL + lat + ',' + lon + '/' + RANGES[range] +
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
        const timer = setTimeout(() => {
            finish(new Error('VC> timeout after ' + this.timeoutMs + 'ms'));
            if (req) {
                req.destroy();
            }
        }, Math.max(0, timeoutMs));

        req = https.get(url, {agent: agent}, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => finish(null, res.statusCode, body));
            res.on('error', (err) => finish(new Error('VC> response error ' + VcRequester._scrub(err.code || err.message, key))));
        });
        req.on('error', (err) => finish(new Error('VC> request error ' + VcRequester._scrub(err.code || err.message, key))));
    }

    /**
     * @param {{lat: number, lon: number, range: string}} params range 'combined' or 'forecast'
     * @param {string} key VC_SECRET_KEY
     * @param {function(Error, Object=)} callback parsed Timeline body
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
        const started = Date.now();
        const deadline = started + this.timeoutMs;
        const attempt = (retried) => {
            this._get(url, key, deadline - Date.now(), (err, status, body) => {
                const ms = Date.now() - started;
                if (!err && status === 429 && !retried && ms < this.retryWindowMs &&
                        deadline - Date.now() > this.retryDelayMs) {
                    log.warn('VC> range=' + params.range + ' status=429 retrying once');
                    return setTimeout(() => attempt(true), this.retryDelayMs);
                }
                if (!err && status >= 400) {
                    err = new Error('VC> HTTP ' + status + ': ' + VcRequester._scrub(String(body).slice(0, 120), key));
                    err.statusCode = status;
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
                if (err) {
                    log.warn('VC> range=' + params.range + ' loc=' + lat + ',' + lon + ' failed ms=' + ms + ' ' + err.message);
                    return callback(err);
                }
                log.info('VC> range=' + params.range + ' loc=' + lat + ',' + lon + ' status=' + status +
                    ' cost=' + result.queryCost + ' ms=' + ms + (retried ? ' retried' : ''));
                callback(null, result);
            });
        };
        attempt(false);
    }
}

VcRequester.BASE_URL = BASE_URL;
VcRequester.ELEMENTS = ELEMENTS;
VcRequester.RANGES = RANGES;

module.exports = VcRequester;
