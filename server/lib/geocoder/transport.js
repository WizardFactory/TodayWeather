/**
 * Minimal HTTP GET with a total timer (#2606). The `request` library's `timeout`
 * only bounds the connect phase and idle gaps, so a slowly dripping response could
 * outlive it; this timer covers the whole exchange. Redirects are not followed.
 */

'use strict';

var http = require('http');
var https = require('https');

var DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * @param {string} url
 * @param {{headers?:Object, timeoutMs:number, agent?:Object, signal?:AbortSignal, maxBytes?:number}} options
 * @returns {Promise<{status:number, headers:Object, json:boolean, body:*, text:string}>}
 */
function getJson(url, options) {
    return new Promise(function (resolve, reject) {
        var lib = url.indexOf('https:') === 0 ? https : http;
        var maxBytes = options.maxBytes || DEFAULT_MAX_BODY_BYTES;
        var settled = false;
        var timer;
        var req;

        function fail(err) {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            if (options.signal) { options.signal.removeEventListener('abort', onAbort); }
            if (req) { req.destroy(); }
            reject(err);
        }

        function onAbort() {
            var err = new Error('aborted');
            err.code = 'EABORTED';
            fail(err);
        }

        if (options.signal) {
            if (options.signal.aborted) { return onAbort(); }
            options.signal.addEventListener('abort', onAbort, {once: true});
        }

        timer = setTimeout(function () {
            var err = new Error('timeout');
            err.code = 'ETIMEDOUT';
            fail(err);
        }, Math.max(1, options.timeoutMs));

        try {
            req = lib.get(url, {headers: options.headers || {}, agent: options.agent}, function (res) {
                var chunks = [];
                var size = 0;
                res.on('data', function (chunk) {
                    size += chunk.length;
                    if (size > maxBytes) {
                        var err = new Error('response too large');
                        err.code = 'ETOOLARGE';
                        return fail(err);
                    }
                    chunks.push(chunk);
                });
                res.on('error', fail);
                res.on('end', function () {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(timer);
                    if (options.signal) { options.signal.removeEventListener('abort', onAbort); }
                    var text = Buffer.concat(chunks).toString('utf8');
                    var result = {status: res.statusCode, headers: res.headers, json: false, body: undefined, text: text};
                    try {
                        result.body = JSON.parse(text);
                        result.json = true;
                    }
                    catch (e) {
                        result.body = text;
                    }
                    resolve(result);
                });
            });
            req.on('error', fail);
        }
        catch (err) {
            fail(err);
        }
    });
}

module.exports = {getJson: getJson};
