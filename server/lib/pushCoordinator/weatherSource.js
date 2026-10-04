'use strict';
var PreparationError = require('./errors').PreparationError;
// Weather fetches for push preparation: identical requests share one promise, origin concurrency is
// bounded, and failures are typed and never cached so retries can recover.
function classify(err, res, body) {
    if (err) {
        var code = err.code;
        var timeout = code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ECONNABORTED';
        return new PreparationError(timeout ? 'weather-timeout' : 'weather-unavailable', true);
    }
    if (!res || !body) return new PreparationError('weather-unavailable', true);
    var status = res.statusCode;
    if (status === 408 || status === 429 || status >= 500) return new PreparationError('weather-unavailable', true);
    if (status >= 400) return new PreparationError('weather-rejected', false);
    return null;
}
function create(o) {
    o = o || {};
    var request = o.request || require('request');
    var limit = Math.max(1, o.concurrency || 16),
        timeoutMs = o.timeoutMs || 5000,
        cacheMs = o.cacheMs === undefined ? 60000 : o.cacheMs,
        now = o.now || Date.now,
        normalize = o.normalize || function (body) { return body; };
    var cache = new Map(),
        waiting = [],
        active = 0;
    function acquire() {
        if (active < limit) {
            active++;
            return Promise.resolve();
        }
        return new Promise(function (resolve) {
            waiting.push(resolve);
        });
    }
    function release() {
        var next = waiting.shift();
        if (next) next();
        else active--;
    }
    function fetch(url, lang, deadline) {
        return acquire().then(function () {
            // A request queued behind the concurrency gate must not start once its campaign has expired.
            if (deadline !== undefined && now() >= deadline) {
                release();
                throw new PreparationError('weather-deadline', true);
            }
            return new Promise(function (resolve, reject) {
                var done = false;
                function finish(error, body) {
                    if (done) return;
                    done = true;
                    release();
                    if (error) reject(error);
                    else resolve(body);
                }
                try {
                    // The timeout starts here, after the concurrency gate, not while the call waits.
                    request(
                        { url: url, headers: { 'Accept-Language': lang }, json: true, timeout: timeoutMs },
                        function (err, res, body) {
                            var error = classify(err, res, body);
                            finish(error, error ? undefined : normalize(body));
                        }
                    );
                } catch (e) {
                    finish(new PreparationError('weather-unavailable', true));
                }
            });
        });
    }
    return {
        get: function (url, lang, deadline) {
            var key = JSON.stringify(['weather', url, lang]),
                old = cache.get(key);
            if (old && old.until > now()) return old.promise;
            var entry = { until: now() + cacheMs, promise: fetch(url, lang, deadline) };
            cache.set(key, entry);
            entry.promise.catch(function () {
                if (cache.get(key) === entry) cache.delete(key);
            });
            if (cache.size > 10000) cache.delete(cache.keys().next().value);
            return entry.promise;
        }
    };
}
module.exports = { create: create, classify: classify };
