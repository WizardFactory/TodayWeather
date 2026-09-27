/**
 * Air quality provider chain (#2628): which provider to ask, in which order.
 *
 * Free phase: FREE_ORDER (Google → OpenWeather → WAQI), each skipped when unconfigured, marked
 * down or over its free budget. When no free provider is left: WAQI (no cost) if not yet tried,
 * then — only with AIR_PAID_PROVIDERS_ENABLED — PAID_ORDER (OpenWeather → Visual Crossing →
 * Google) within the paid caps. Each provider is attempted at most once per request (at most four
 * attempts). The first observation that passes evaluate() wins; an auth or quota rejection marks
 * that provider down for every worker. Every request is counted.
 */

"use strict";

var defaultConfig = require('../../config/air');
var observation = require('./observation');

/**
 * @param options {providers: {id: adapter}, budget, config?, keyString, axios, timeoutMs?}
 */
function createChain(options) {
    var providers = options.providers;
    var budget = options.budget;
    var config = options.config || defaultConfig;
    var keyString = options.keyString;
    var axios = options.axios;
    var timeoutMs = options.timeoutMs || config.providerTimeoutMs;

    function configured(id) {
        var p = providers[id];
        return !!(p && p.isConfigured(keyString));
    }

    /**
     * @param callback (result) {outcome: 'ok', arpltn, observation, provider, attempts, skipped}
     *   or {outcome: 'failed', reason, observation?, attempts, skipped}
     */
    function fetch(gCoord, requestTime, callback) {
        var attempts = [];
        var skipped = [];
        var tried = {};
        var lastObservation;

        function finish(result) {
            result.attempts = attempts;
            result.skipped = skipped;
            callback(result);
        }

        function attempt(id, phase, next) {
            tried[id] = true;
            var provider = providers[id];
            provider.fetchCurrent(gCoord, {axios: axios, keyString: keyString, timeoutMs: timeoutMs, phase: phase}, function (result) {
                var failed = !result || result.outcome !== 'ok';
                budget.record(id, phase, {failed: failed, cost: result && result.cost}, function () {
                    if (failed) {
                        var kind = result ? result.kind : 'transport';
                        var reason = result ? result.reason : 'transport';
                        attempts.push({provider: id, phase: phase, outcome: 'failed', kind: kind, reason: reason});
                        log.warn('air provider ' + id + ' failed phase=' + phase + ' kind=' + kind + ' reason=' + reason);
                        if (kind === 'auth' || kind === 'quota') {
                            return budget.markDown(id, kind, next);
                        }
                        return next();
                    }
                    var ev = observation.evaluate(result.observation, gCoord, requestTime);
                    if (ev.arpltn) {
                        attempts.push({provider: id, phase: phase, outcome: 'ok'});
                        return finish({outcome: 'ok', arpltn: ev.arpltn, observation: result.observation, provider: id,
                            age: ev.age, distance: ev.distance, cost: result.cost});
                    }
                    lastObservation = result.observation;
                    attempts.push({provider: id, phase: phase, outcome: 'unusable', reason: ev.reason});
                    next();
                });
            });
        }

        function walk(ids, phase, next) {
            var index = 0;
            (function step() {
                if (index >= ids.length) {
                    return next();
                }
                var id = ids[index++];
                // one attempt per provider per request: a provider that already failed is not retried in
                // the paid phase; one skipped by its free budget is still eligible there
                if (!configured(id) || tried[id]) {
                    return step();
                }
                budget.check(id, phase, 1, function (state) {
                    if (!state.allowed) {
                        skipped.push({provider: id, phase: phase, reason: state.reason});
                        return step();
                    }
                    attempt(id, phase, step);
                });
            })();
        }

        function fail() {
            var last = attempts.length ? attempts[attempts.length - 1] : undefined;
            var reason = 'no-provider';
            if (last) {
                reason = last.outcome === 'unusable' ? last.reason : last.provider + ':' + last.reason;
            }
            finish({outcome: 'failed', reason: reason, observation: lastObservation});
        }

        walk(config.FREE_ORDER, 'free', function () {
            // free tiers exhausted (or nothing usable): WAQI costs nothing, then paid providers
            walk(['aqicn'], 'free', function () {
                if (!config.paidProvidersEnabled) {
                    return fail();
                }
                walk(config.PAID_ORDER, 'paid', fail);
            });
        });
    }

    return {
        fetch: fetch,
        anyConfigured: function () {
            return Object.keys(providers).some(configured);
        }
    };
}

module.exports = {
    createChain: createChain
};
