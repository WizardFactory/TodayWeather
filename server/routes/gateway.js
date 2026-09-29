/**
 * Public `/weather` and `/geocode` routes served directly by tw-svc (#2606),
 * replacing CloudFront → API Gateway → tw-backend-functions. Only the shapes with
 * traffic in the 30 days to 2026-09-22 are implemented; every other path under
 * `/weather` or `/geocode` returns 404. Weather requests are geocoded and then
 * dispatched to this server's own versioned `kma/addr` or `dsf/coord` routes over a
 * loopback request, exactly as the Lambda built them (see specs/issue-2606.md).
 *
 * Mounted in app.js after cors() and before the session middleware, so these
 * routes never set cookies. OPTIONS preflights are answered by cors().
 */

'use strict';

var http = require('http');
var express = require('express');
var format = require('../lib/geocoder/format');
var transport = require('../lib/geocoder/transport');
var weatherUnavailable = require('../lib/weatherUnavailable');

var DEFAULT_WEATHER_VERSION = 'v000901';
var OWN_PATH = /^\/(?:weather|geocode)(?:\/|$)/;
var WEATHER_MAX_AGE = 300;
var GEOCODE_MAX_AGE = 2592000;
var MAX_ADDRESS_LENGTH = 200;
// The Lambda passed backend bodies through up to its 6 MB response limit.
var LOOPBACK_MAX_BYTES = 6 * 1024 * 1024;
var ERROR_TEXT = {400: 'Bad Request', 404: 'Not Found', 501: 'Not Implemented', 503: 'Service Unavailable'};

function statusForError(err) {
    if (weatherUnavailable.isUnavailable(err)) { return 503; }
    if (err && err.code === 'EINPUT') { return 400; }
    if (err && err.code === 'ENOTFOUND') { return 404; }
    return 501;
}

function inputError(message, code) {
    var err = new Error(message);
    err.code = code || 'EINPUT';
    return err;
}

/**
 * Coordinates as the Lambda read them: the first two comma-separated parts through
 * Number(), normalized to 3 decimals. Out-of-range or non-numeric input is a 400;
 * a normalized (0,0) is a 404.
 */
function parseLoc(raw) {
    var parts = String(raw).split(',');
    if (parts.length < 2) {
        throw inputError('invalid location');
    }
    var lat = Number(parts[0]);
    var lon = Number(parts[1]);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw inputError('invalid location');
    }
    var loc = format.normalizeLoc([lat, lon]);
    if (loc[0] === 0 && loc[1] === 0) {
        throw inputError('invalid location', 'ENOTFOUND');
    }
    return loc;
}

/**
 * The query the Lambda forwarded: API Gateway gave it one (the last) value per key,
 * which it re-appended. Keys keep their first-appearance order; `+` is a space; a
 * pair without `=` has an empty value; undecodable pairs are dropped.
 * @returns {string} '' or '?k=v&...' with encoded keys and values
 */
function buildQuery(originalUrl) {
    var index = originalUrl.indexOf('?');
    if (index < 0) {
        return '';
    }
    var order = [];
    var values = Object.create(null);
    originalUrl.slice(index + 1).split('&').forEach(function (pair) {
        if (!pair) { return; }
        var eq = pair.indexOf('=');
        var rawKey = eq < 0 ? pair : pair.slice(0, eq);
        var rawValue = eq < 0 ? '' : pair.slice(eq + 1);
        var key;
        var value;
        try {
            key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
            value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
        }
        catch (e) {
            return;
        }
        if (!(key in values)) {
            order.push(key);
        }
        values[key] = value;
    });
    if (!order.length) {
        return '';
    }
    return '?' + order.map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(values[key]);
    }).join('&');
}

/**
 * The backend path the Lambda built (weather/function.weather.js _geoinfo2url).
 */
function backendPath(version, geo) {
    var url = '/' + version;
    if (geo.country === 'KR') {
        var kmaAddress = geo.kmaAddress;
        if (!kmaAddress || !kmaAddress.name1) {
            throw inputError('no KMA address', 'EPROVIDER');
        }
        url += '/kma/addr/' + encodeURIComponent(kmaAddress.name1);
        if (kmaAddress.name2) {
            url += '/' + encodeURIComponent(kmaAddress.name2);
        }
        if (kmaAddress.name3) {
            url += '/' + encodeURIComponent(kmaAddress.name3);
        }
        return url;
    }
    return url + '/dsf/coord/' + geo.location.lat + ',' + geo.location.long;
}

// Free sockets close before the server's 5 s keepAliveTimeout, so a reused socket is
// unlikely to meet a server-side close (which would cost one of the three attempts).
var loopbackAgent = new http.Agent({keepAlive: true, maxSockets: 50, timeout: 4000});

/**
 * Host for requests to this server: a wildcard listen address (0.0.0.0, ::, empty)
 * means "this machine", so use 127.0.0.1; an IPv6 literal needs brackets.
 */
function loopbackHost(ipAddress) {
    if (!ipAddress || ipAddress === '0.0.0.0' || ipAddress === '::') {
        return '127.0.0.1';
    }
    return ipAddress.indexOf(':') >= 0 ? '[' + ipAddress + ']' : ipAddress;
}

/**
 * Default backend: this server's own port (any PM2 cluster worker may answer).
 */
function defaultLoopback() {
    var config = require('../config/config');
    var host = loopbackHost(config.ipAddress);
    return function (path, headers, timeoutMs, signal) {
        return transport.getJson('http://' + host + ':' + config.port + path,
            {headers: headers, timeoutMs: timeoutMs, agent: loopbackAgent, signal: signal, maxBytes: LOOPBACK_MAX_BYTES});
    };
}

function positiveInt(value, fallback) {
    var n = parseInt(value, 10);
    return n > 0 ? n : fallback;
}

/**
 * @param {Object=} deps test overrides
 * @param {function():Object=} deps.geocoder returns {coord, addr}
 * @param {function(string, Object, number, AbortSignal):Promise=} deps.loopback
 * @param {Object=} deps.log
 * @param {number=} deps.maxInflight  default GATEWAY_MAX_INFLIGHT or 40
 * @param {number=} deps.deadlineMs   default 9000
 * @param {number=} deps.attemptMs    default 3000
 * @param {number=} deps.attempts     default 3
 */
function createGatewayRouter(deps) {
    deps = deps || {};
    var getGeocoder = deps.geocoder || function () {
        return require('../lib/geocoder').getDefaultGeocoder();
    };
    var loopback = deps.loopback || null;
    var maxInflight = deps.maxInflight || positiveInt(process.env.GATEWAY_MAX_INFLIGHT, 40);
    var deadlineMs = deps.deadlineMs || 9000;
    var attemptMs = deps.attemptMs || 3000;
    var attempts = deps.attempts || 3;
    var inflight = 0;

    // The app logger prints only errors when NODE_ENV=production (lib/log.js), so the
    // per-request lines go to stdout/stderr (PM2 logs) unless a logger is injected.
    function logger() {
        return deps.log || console;
    }

    function sendError(res, status, err) {
        if (res.headersSent) { return; }
        res.status(status);
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        if (status === 503) {
            res.set('Retry-After', weatherUnavailable.isUnavailable(err) ? String(weatherUnavailable.retryAfter(err)) : '5');
        }
        res.send(ERROR_TEXT[status] || ERROR_TEXT[501]);
    }

    function sendJson(res, body, maxAge) {
        res.set('Cache-Control', 'max-age=' + maxAge);
        res.json(body);
    }

    /**
     * Wraps a handler with the in-flight limit, the request deadline, error mapping
     * and the per-request log line. The in-flight slot is released exactly once,
     * when the handler settles or the deadline fires, whichever comes first.
     */
    function guarded(route, handler) {
        return function (req, res) {
            var started = Date.now();
            var info = {route: route, version: req.params.version || '-', cache: '-', provider: '-', backend: '-'};

            function finishLog(status) {
                info.ms = Date.now() - started;
                info.status = status;
                logger().info('gateway ' + JSON.stringify(info));
            }

            if (inflight >= maxInflight) {
                sendError(res, 503);
                return finishLog(503);
            }
            inflight++;
            var released = false;
            function release() {
                if (!released) {
                    released = true;
                    inflight--;
                }
            }

            var controller = new AbortController();
            var ctx = {signal: controller.signal, deadline: started + deadlineMs, info: info, expired: false};
            var timer = setTimeout(function () {
                ctx.expired = true;
                controller.abort();
                sendError(res, 501);
                finishLog(501);
                release();
            }, deadlineMs);

            Promise.resolve().then(function () {
                return handler(req, ctx);
            }).then(function (result) {
                if (ctx.expired) { return; }
                clearTimeout(timer);
                try {
                    sendJson(res, result.body, result.maxAge);
                }
                catch (err) {
                    logger().warn('gateway ' + route + ' 501: ' + err.message);
                    sendError(res, 501);
                    return finishLog(501);
                }
                finishLog(200);
            }, function (err) {
                if (ctx.expired) { return; }
                clearTimeout(timer);
                var status = statusForError(err);
                if (status === 501) {
                    logger().warn('gateway ' + route + ' 501: ' + (err && err.message));
                }
                sendError(res, status, err);
                finishLog(status);
            }).then(release, release);
        };
    }

    function noteGeo(ctx, geo) {
        var meta = geo.meta || {};
        ctx.info.cache = meta.cacheHit ? 'hit' : 'miss';
        ctx.info.provider = meta.providers && meta.providers.length ? meta.providers.join('+') : '-';
    }

    function fetchBackend(path, lang, ctx) {
        var call = loopback || (loopback = defaultLoopback());
        var headers = {'Accept-Language': lang, 'Accept': 'application/json'};
        var tried = 0;

        function attempt() {
            var remaining = ctx.deadline - Date.now();
            if (remaining <= 0) {
                return Promise.reject(inputError('deadline', 'EPROVIDER'));
            }
            tried++;
            return call(path, headers, Math.min(attemptMs, remaining), ctx.signal).then(function (res) {
                ctx.info.backend = res.status;
                if (res.status === 503 && res.json && weatherUnavailable.isUnavailable(res.body)) {
                    var unavailable = inputError('weather temporarily unavailable', res.body.code);
                    unavailable.retryAt = res.body.retryAt;
                    throw unavailable;
                }
                if (res.status >= 500 && tried < attempts) {
                    return attempt();
                }
                if (res.status !== 200 || !res.json || res.body === null || typeof res.body !== 'object') {
                    throw inputError('backend status ' + res.status, 'EPROVIDER');
                }
                return res.body;
            }, function (err) {
                if (err.code === 'EABORTED') { throw err; }
                ctx.info.backend = err.code || 'error';
                if (tried < attempts) {
                    return attempt();
                }
                throw inputError('backend ' + (err.code || err.message), 'EPROVIDER');
            });
        }
        return attempt();
    }

    function weather(defaultVersion) {
        return function (req, ctx) {
            var version = req.params.version || defaultVersion;
            ctx.info.version = version;
            var loc = parseLoc(req.params.loc);
            var lang = format.languageFromHeader(req.headers['accept-language']);
            var query = buildQuery(req.originalUrl);
            return getGeocoder().coord(loc, lang, {signal: ctx.signal}).then(function (geo) {
                noteGeo(ctx, geo);
                return fetchBackend(backendPath(version, geo) + query, lang, ctx).then(function (body) {
                    return {body: format.mergeIntoWeather(body, geo), maxAge: WEATHER_MAX_AGE};
                });
            });
        };
    }

    function geocodeCoord(req, ctx) {
        var loc = parseLoc(req.params.loc);
        var lang = format.languageFromHeader(req.headers['accept-language']);
        return getGeocoder().coord(loc, lang, {signal: ctx.signal}).then(function (geo) {
            noteGeo(ctx, geo);
            return {body: geo, maxAge: GEOCODE_MAX_AGE};
        });
    }

    function geocodeAddr(req, ctx) {
        var address = req.params[0];
        if (!address || address.length > MAX_ADDRESS_LENGTH) {
            throw inputError('invalid address');
        }
        var lang = format.languageFromHeader(req.headers['accept-language']);
        return getGeocoder().addr(address, lang, {signal: ctx.signal}).then(function (geo) {
            noteGeo(ctx, geo);
            return {body: geo, maxAge: GEOCODE_MAX_AGE};
        });
    }

    // Case-sensitive like CloudFront's path patterns: other spellings keep reaching
    // the legacy handlers, as today.
    var router = express.Router({caseSensitive: true});
    router.get('/weather/coord/:loc', guarded('weather', weather(DEFAULT_WEATHER_VERSION)));
    router.get('/weather/:version(v000901|v000902|v000903)/coord/:loc', guarded('weather', weather()));
    router.get('/geocode/:version(v000903)/coord/:loc', guarded('geocode-coord', geocodeCoord));
    router.get('/geocode/:version(v000901|v000903)/addr/*', guarded('geocode-addr', geocodeAddr));

    // Excluded shapes (0 requests in the 30-day window) and other methods.
    router.all(OWN_PATH, function (req, res) {
        sendError(res, 404);
        logger().info('gateway ' + JSON.stringify({route: 'excluded', status: 404}));
    });

    // The app-level handlers take 3 arguments and are not error handlers, so the
    // router terminates its own errors (malformed percent-encoding → 400).
    router.use(function (err, req, res, next) {
        if (!OWN_PATH.test(req.path)) {
            return next(err);
        }
        sendError(res, err && err.status === 400 ? 400 : 501);
    });

    return router;
}

module.exports = createGatewayRouter();
module.exports.createGatewayRouter = createGatewayRouter;
module.exports.parseLoc = parseLoc;
module.exports.buildQuery = buildQuery;
module.exports.backendPath = backendPath;
module.exports.loopbackHost = loopbackHost;
