/**
 * Air quality provider chain policy (#2628).
 *
 * Every default equals the vendor free tier known on 2026-09-27 or the #2622 constant it
 * replaces, so an unset environment keeps the documented behaviour. Values are documented in
 * docs/operations/air-provider-policy.md. An invalid value throws at load time.
 *
 * Consumers require this module directly (like config/gather.js).
 */
'use strict';

function integer(env, name, defaultValue, min, max) {
    var raw = env[name];
    if (raw === undefined || String(raw).trim() === '') {
        return defaultValue;
    }
    if (max === undefined) {
        max = Number.MAX_SAFE_INTEGER;
    }
    var text = String(raw).trim();
    var value = Number(text);
    if (!/^\d+$/.test(text) || value < min || value > max) {
        throw new Error('Invalid ' + name + ': expected an integer from ' + min + ' to ' + max);
    }
    return value;
}

function flag(env, name, defaultValue) {
    var raw = env[name];
    if (raw === undefined || String(raw).trim() === '') {
        return defaultValue;
    }
    var text = String(raw).trim();
    if (text !== 'true' && text !== 'false') {
        throw new Error('Invalid ' + name + ': expected true or false');
    }
    return text === 'true';
}

function load(env) {
    return {
        // Free-tier caps per calendar month (UTC); a 5 % reserve is kept below each.
        googleMonthlyCap: integer(env, 'AIR_GOOGLE_MONTHLY_CAP', 10000, 0),
        owmMonthlyCap: integer(env, 'AIR_OWM_MONTHLY_CAP', 1000000, 0),
        owmMinuteCap: integer(env, 'AIR_OWM_MINUTE_CAP', 60, 0),
        // Paid calls are off unless the operator enables them; each paid provider is capped per month.
        paidProvidersEnabled: flag(env, 'AIR_PAID_PROVIDERS_ENABLED', false),
        paidMonthlyCallCap: integer(env, 'AIR_PAID_MONTHLY_CALL_CAP', 100000, 0),
        providerTimeoutMs: integer(env, 'AIR_PROVIDER_TIMEOUT_MS', 3000, 500, 10000),

        RESERVE: 0.05,
        // Issue #2628 decision log D2/D3: free tiers first (quality order), then WAQI (no cost),
        // then paid providers cheapest first.
        FREE_ORDER: ['google', 'openweather', 'aqicn'],
        PAID_ORDER: ['openweather', 'visualcrossing', 'google'],
        DOWN_MS: 10 * 60 * 1000,
        FRESHNESS_HOURS: 8,
        FUTURE_SLACK_MS: 60 * 60 * 1000,
        MAX_STATION_DISTANCE_KM: 30,
        CACHE_TTL_MS: 30 * 60 * 1000,
        FAILURE_CACHE_TTL_MS: 2 * 60 * 1000,
        load: load
    };
}

// Isolated harnesses load production modules in a VM without a `process` global (the overseas
// route smoke found this in CI); defaults apply there.
module.exports = load(typeof process !== 'undefined' && process && process.env ? process.env : {});
