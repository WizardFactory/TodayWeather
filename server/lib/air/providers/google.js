/**
 * Google Air Quality API adapter (#2628): currentConditions:lookup.
 * Modeled data for the requested point (no station). Concentrations arrive in µg/m³ (PM) or
 * ppb (gases). Free tier 10,000 calls/month, then billed per 1,000 (see air-provider-policy.md).
 */

"use strict";

var http = require('../httpClient');
var observation = require('../observation');

var URL = 'https://airquality.googleapis.com/v1/currentConditions:lookup?key=';
var CODES = {pm25: 'pm25', pm10: 'pm10', o3: 'o3', no2: 'no2', so2: 'so2', co: 'co'};

function key(keyString) {
    return keyString ? keyString.google_key : undefined;
}

function concentration(code, item) {
    var c = item.concentration;
    if (!c || typeof c !== 'object' || !observation.finite(c.value)) {
        return undefined;
    }
    switch (c.units) {
        case 'MICROGRAMS_PER_CUBIC_METER':
            return observation.fromUgm3(code, c.value);
        case 'PARTS_PER_BILLION':
            return observation.GASES.indexOf(code) === -1 ? undefined : observation.fromPpb(c.value);
        case 'PARTS_PER_MILLION':
            return observation.GASES.indexOf(code) === -1 ? undefined : c.value;
        default:
            return undefined;
    }
}

function parse(body) {
    if (!Array.isArray(body.pollutants) || typeof body.dateTime !== 'string') {
        return undefined;
    }
    var pollutants = {};
    body.pollutants.forEach(function (item) {
        if (!item || typeof item !== 'object' || !CODES[item.code]) {
            return;
        }
        var v = concentration(CODES[item.code], item);
        if (v !== undefined) {
            pollutants[CODES[item.code]] = v;
        }
    });
    var indexes = {};
    if (Array.isArray(body.indexes)) {
        body.indexes.forEach(function (index) {
            if (!index || typeof index !== 'object' || !observation.finite(index.aqi)) {
                return;
            }
            if (index.code === 'uaqi') {
                indexes.uaqi = index.aqi;
            }
            else if (typeof index.code === 'string' && !indexes.local) {
                indexes.local = {code: index.code, aqi: index.aqi};
            }
        });
    }
    return observation.create('google', {
        stationBased: false,
        observedAt: body.dateTime,
        pollutants: pollutants,
        indexes: indexes,
        attribution: 'Google Air Quality'
    });
}

module.exports = {
    id: 'google',
    label: 'Google Air Quality API',
    stationBased: false,
    isConfigured: function (keyString) {
        return http.isValidKey(key(keyString));
    },
    fetchCurrent: function (gCoord, deps, callback) {
        var body = {
            location: {latitude: Number(gCoord.lat), longitude: Number(gCoord.lon)},
            extraComputations: ['LOCAL_AQI', 'POLLUTANT_CONCENTRATION'],
            universalAqi: true,
            languageCode: 'en'
        };
        http.request(deps.axios, {method: 'post', url: URL + encodeURIComponent(key(deps.keyString)), data: body,
            timeoutMs: deps.timeoutMs}, function (result) {
            callback(http.guarded(function () {
                if (!result.ok) {
                    return {outcome: 'failed', kind: result.kind, reason: result.reason};
                }
                var obs = parse(result.body);
                if (!obs) {
                    return {outcome: 'failed', kind: 'invalid-body', reason: 'invalid-body'};
                }
                return {outcome: 'ok', observation: obs, cost: 1};
            }));
        });
    }
};
