/**
 * Gateway geocoder (#2606): coordinate and address lookups for the public
 * `/weather` and `/geocode` routes, replacing the tw-backend-functions Lambdas.
 *
 * Decision flow ported from tw-backend-functions a4c1deb geoinfo/controller.geoapi.js
 * (getGeoInfoByCoord, getGeoInfoByAddr) and geoinfo/function.geoinfo.js
 * (coord2geoInfo, addr2geoInfo), without the Dark Sky and Daum providers: a
 * coordinate result without a label or an address now fails (501) where the Lambda
 * asked Dark Sky. Transport changes: a 3 s total timer per provider request, a 5 s
 * budget per lookup, and one attempt per key with rotation (spec 3.5).
 */

'use strict';

var format = require('./format');
var kakao = require('./kakao');
var google = require('./google');
var keys = require('./keys');
var transport = require('./transport');
var cacheModule = require('./cache');

var PROVIDER_TIMEOUT_MS = 3000;
var BUDGET_MS = 5000;
var MONTH_MS = 2592000000;      // 1000*60*60*24*30

function geocodeError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
}

function isAbort(err) {
    return err && err.code === 'EABORTED';
}

/**
 * @param {Object} options
 * @param {string[]} options.kakaoKeys
 * @param {string[]} options.googleKeys
 * @param {string=} options.kakaoBaseUrl  test override
 * @param {string=} options.googleBaseUrl test override
 * @param {Object=} options.cache  {get, set} (createMongoCache or createNullCache)
 * @param {Object=} options.transport {getJson}
 * @param {function():number=} options.random
 * @param {function():number=} options.now
 * @param {Object=} options.log
 * @param {number=} options.providerTimeoutMs
 * @param {number=} options.budgetMs
 */
function createGeocoder(options) {
    var kakaoKeys = options.kakaoKeys || [];
    var googleKeys = options.googleKeys || [];
    var cache = options.cache || cacheModule.createNullCache();
    var http = options.transport || transport;
    var random = options.random || Math.random;
    var now = options.now || Date.now;
    var log = options.log || console;
    var providerTimeoutMs = options.providerTimeoutMs || PROVIDER_TIMEOUT_MS;
    var budgetMs = options.budgetMs || BUDGET_MS;

    /**
     * Try each key at most once, starting at a random key. Returns the parsed body
     * of the first successful response.
     */
    function callWithKeys(provider, keyList, build, classify, budget) {
        if (!keyList.length) {
            return Promise.reject(geocodeError('EPROVIDER', provider + ': no keys configured'));
        }
        var start = Math.floor(random() * keyList.length) % keyList.length;
        var attempt = 0;

        function next() {
            if (attempt >= keyList.length) {
                return Promise.reject(geocodeError('EPROVIDER', provider + ': all keys failed'));
            }
            var remaining = budget.deadline - now();
            if (remaining <= 0) {
                return Promise.reject(geocodeError('EPROVIDER', provider + ': budget exhausted'));
            }
            var key = keyList[(start + attempt) % keyList.length];
            attempt++;
            var request = build(key);
            budget.providers.push(provider);
            return http.getJson(request.url, {
                headers: request.headers,
                timeoutMs: Math.min(providerTimeoutMs, remaining),
                signal: budget.signal
            }).then(function (res) {
                return {res: res, outcome: classify(res)};
            }, function (err) {
                if (isAbort(err)) { throw err; }
                return {err: err, outcome: 'transient'};
            }).then(function (result) {
                if (result.outcome === 'success') {
                    return result.res.body;
                }
                log.warn('gateway geocoder ' + provider + ' ' + result.outcome + ' ' +
                    (result.res ? 'status=' + result.res.status : 'error=' + (result.err.code || result.err.message)) +
                    ' url=' + google.redact(request.url));
                if (result.outcome === 'auth' || result.outcome === 'quota' || result.outcome === 'transient') {
                    return next();
                }
                throw geocodeError('EPROVIDER', provider + ': ' + result.outcome);
            });
        }
        return next();
    }

    function newBudget(opts, meta) {
        return {deadline: now() + budgetMs, signal: opts && opts.signal, providers: meta.providers};
    }

    function kakaoCoord(loc, budget) {
        return callWithKeys('kakao', kakaoKeys, function (key) {
            return {url: kakao.coordUrl(options.kakaoBaseUrl, loc), headers: kakao.headers(key)};
        }, kakao.classify, budget).then(function (body) {
            try {
                return kakao.coord2geoInfo(body, loc);
            }
            catch (err) {
                throw geocodeError('EPROVIDER', 'kakao: ' + err.message);
            }
        });
    }

    function googleCoord(loc, lang, budget) {
        return callWithKeys('google', googleKeys, function (key) {
            return {url: google.coordUrl(options.googleBaseUrl, loc, lang, key)};
        }, google.classify, budget).then(function (body) {
            try {
                return google.coord2geoInfo(body, loc, lang);
            }
            catch (err) {
                throw geocodeError('EPROVIDER', 'google: ' + err.message);
            }
        });
    }

    function isFresh(doc) {
        return doc && doc.geoInfo && doc.updatedAt &&
            new Date(doc.updatedAt).getTime() >= now() - MONTH_MS;
    }

    function withMeta(client, meta) {
        Object.defineProperty(client, 'meta', {value: meta, enumerable: false});
        return client;
    }

    function write(meta, key, doc) {
        // MongoDB stores an undefined field as null, which a later hit would return
        // (e.g. `"country":null` for a Google address without a country). Store only
        // the fields that are present, so a hit equals the miss.
        doc.geoInfo = JSON.parse(JSON.stringify(doc.geoInfo));
        meta.write = cache.set(key, doc).catch(function (err) {
            log.warn('geocode cache write: ' + err.message);
        });
    }

    /**
     * @param {number[]} loc normalized [lat, lon]
     * @param {string} lang the Lambda language value (format.languageFromHeader)
     * @param {{signal?:AbortSignal}=} opts
     * @returns {Promise<Object>} client shape (Lambda byCoord); `meta` is non-enumerable
     */
    function coord(loc, lang, opts) {
        var meta = {cacheHit: false, providers: []};
        var cacheKey = 'c:' + loc[0] + ',' + loc[1] + ',' + lang;
        var isKoreaArea = format.isKoreaArea(loc);

        return cache.get(cacheKey).then(function (doc) {
            if (isFresh(doc) && doc.geoInfo.label && doc.geoInfo.address &&
                !(doc.geoInfo.country === 'KR' && doc.geoInfo.kmaAddress == undefined)) {
                meta.cacheHit = true;
                return withMeta(format.toClientCoord(doc.geoInfo), meta);
            }

            var budget = newBudget(opts, meta);
            var lookup;
            if (isKoreaArea) {
                lookup = kakaoCoord(loc, budget).then(function (geoInfo) {
                    if (lang !== 'ko') {
                        delete geoInfo.address;
                        delete geoInfo.label;
                        delete geoInfo.lang;
                        //fill from google api
                    }
                    if (geoInfo.address && geoInfo.label) {
                        return geoInfo;
                    }
                    return googleCoord(loc, lang, budget).then(function (newGeoInfo) {
                        for (var key in newGeoInfo) {
                            geoInfo[key] = geoInfo[key] ? geoInfo[key] : newGeoInfo[key];
                        }
                        return geoInfo;
                    }, function (err) {
                        if (isAbort(err)) { throw err; }
                        return geoInfo;
                    });
                });
            }
            else {
                lookup = googleCoord(loc, lang, budget);
            }

            return lookup.then(function (geoInfo) {
                if (!(geoInfo.address && geoInfo.label)) {
                    throw geocodeError('EPROVIDER', 'no label or address');
                }
                if (!(geoInfo.country === 'KR' && geoInfo.kmaAddress == undefined)) {
                    write(meta, cacheKey, {kind: 'coord', lang: lang, geoInfo: geoInfo});
                }
                return withMeta(format.toClientCoord(geoInfo), meta);
            });
        });
    }

    /**
     * @param {string} address decoded request string
     * @param {string} lang unused by the providers (the Lambda sent none)
     * @param {{signal?:AbortSignal}=} opts
     * @returns {Promise<Object>} client shape (Lambda byAddr); `meta` is non-enumerable
     */
    function addr(address, lang, opts) {
        var meta = {cacheHit: false, providers: []};
        var cacheKey = 'a:' + address;

        return cache.get(cacheKey).then(function (doc) {
            if (isFresh(doc) && doc.geoInfo.loc) {
                meta.cacheHit = true;
                return withMeta(format.toClientAddr(doc.geoInfo), meta);
            }

            var budget = newBudget(opts, meta);
            return callWithKeys('google', googleKeys, function (key) {
                return {url: google.addrUrl(options.googleBaseUrl, address, key)};
            }, google.classify, budget).then(function (body) {
                try {
                    return google.addr2geoInfo(body, address);
                }
                catch (err) {
                    throw geocodeError('EPROVIDER', 'google: ' + err.message);
                }
            }).catch(function (err) {
                if (isAbort(err)) { throw err; }
                return callWithKeys('kakao', kakaoKeys, function (key) {
                    return {url: kakao.addrUrl(options.kakaoBaseUrl, address), headers: kakao.headers(key)};
                }, kakao.classify, budget).then(function (body) {
                    try {
                        return kakao.addr2geoInfo(body, address);
                    }
                    catch (kakaoErr) {
                        throw geocodeError('EPROVIDER', 'kakao: ' + kakaoErr.message);
                    }
                });
            }).then(function (geoInfo) {
                geoInfo.loc = format.normalizeLoc(geoInfo.loc);
                write(meta, cacheKey, {kind: 'addr', lang: lang, geoInfo: geoInfo});
                return withMeta(format.toClientAddr(geoInfo), meta);
            });
        });
    }

    return {coord: coord, addr: addr};
}

var defaultGeocoder;

/**
 * The process-wide geocoder, configured from the environment on first use:
 * GEOCODER_KAKAO_KEYS / GEOCODER_GOOGLE_KEYS (JSON lists), and
 * GEOCODER_KAKAO_BASE_URL / GEOCODER_GOOGLE_BASE_URL (tests and local smoke only).
 */
function getDefaultGeocoder() {
    if (!defaultGeocoder) {
        var mongoose = require('mongoose');
        var GeocodeCache = require('../../models/modelGeocodeCache');
        var cache = cacheModule.createMongoCache({
            connection: mongoose.connection,
            collection: GeocodeCache.collection,
            log: console
        });
        cache.ensureIndex();
        defaultGeocoder = createGeocoder({
            kakaoKeys: keys.parseKeys(process.env.GEOCODER_KAKAO_KEYS),
            googleKeys: keys.parseKeys(process.env.GEOCODER_GOOGLE_KEYS),
            kakaoBaseUrl: process.env.GEOCODER_KAKAO_BASE_URL,
            googleBaseUrl: process.env.GEOCODER_GOOGLE_BASE_URL,
            cache: cache,
            log: console        // lib/log.js prints only errors in production
        });
    }
    return defaultGeocoder;
}

module.exports = {
    createGeocoder: createGeocoder,
    getDefaultGeocoder: getDefaultGeocoder,
    PROVIDER_TIMEOUT_MS: PROVIDER_TIMEOUT_MS,
    BUDGET_MS: BUDGET_MS
};
