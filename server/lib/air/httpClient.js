/**
 * One classified HTTP request for the air providers (#2628): a fixed timeout, no retry, and
 * a result that never throws. Keys never appear in reasons or logs; callers pass them only
 * inside the URL/body, and the fixed reason strings contain no request data.
 */

"use strict";

/**
 * @param axios axios instance (injected so tests and the route harness can redirect hosts)
 * @param options {method: 'get'|'post', url, data?, timeoutMs}
 * @param callback ({ok: true, status, body}) or ({ok: false, kind, reason})
 *   kind: timeout | transport | auth | quota | http | invalid-body
 */
function request(axios, options, callback) {
    var settled = false;
    var done = function (result) {
        if (settled) {
            return;
        }
        settled = true;
        // leave the promise chain so a callback exception is not taken as a request failure
        setImmediate(function () {
            callback(result);
        });
    };
    var config = {timeout: options.timeoutMs};
    var promise;
    try {
        promise = options.method === 'post' ?
            axios.post(options.url, options.data, config) : axios.get(options.url, config);
    }
    catch (err) {
        return done({ok: false, kind: 'transport', reason: 'transport'});
    }
    promise.then(function (response) {
        try {
            var body = response ? response.data : undefined;
            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body);
                }
                catch (e) {
                    return done({ok: false, kind: 'invalid-body', reason: 'invalid-body'});
                }
            }
            if (!body || typeof body !== 'object') {
                return done({ok: false, kind: 'invalid-body', reason: 'invalid-body'});
            }
            done({ok: true, status: response.status, body: body});
        }
        catch (err) {
            done({ok: false, kind: 'invalid-body', reason: 'invalid-body'});
        }
    }, function (err) {
        done(classify(err));
    });
}

function classify(err) {
    if (err && err.code === 'ECONNABORTED') {
        return {ok: false, kind: 'timeout', reason: 'timeout'};
    }
    var status = err && err.response && err.response.status;
    if (typeof status === 'number') {
        if (status === 401 || status === 403) {
            return {ok: false, kind: 'auth', reason: 'http-' + status};
        }
        if (status === 429) {
            return {ok: false, kind: 'quota', reason: 'http-429'};
        }
        return {ok: false, kind: 'http', reason: 'http-' + status};
    }
    return {ok: false, kind: 'transport', reason: 'transport'};
}

function isValidKey(key) {
    return typeof key === 'string' && key.length >= 10 && !/^You have to set/.test(key);
}

module.exports = {
    request: request,
    classify: classify,
    isValidKey: isValidKey
};
