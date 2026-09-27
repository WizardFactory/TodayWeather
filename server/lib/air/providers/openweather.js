/**
 * OpenWeather Air Pollution API adapter (#2628): /data/2.5/air_pollution (current).
 * Modeled data for the requested point; every component is µg/m³. Free plan: 60 calls/min,
 * 1,000,000 calls/month (see air-provider-policy.md).
 */

"use strict";

var http = require('../httpClient');
var observation = require('../observation');

var URL = 'https://api.openweathermap.org/data/2.5/air_pollution';
var CODES = {pm2_5: 'pm25', pm10: 'pm10', o3: 'o3', no2: 'no2', so2: 'so2', co: 'co'};

function key(keyString) {
    var keys = keyString ? keyString.owm_keys : undefined;
    return Array.isArray(keys) && keys[0] ? keys[0].key : undefined;
}

function parse(body) {
    var item = Array.isArray(body.list) ? body.list[0] : undefined;
    if (!item || typeof item !== 'object' || !item.components || typeof item.components !== 'object' ||
        !observation.finite(item.dt)) {
        return undefined;
    }
    var pollutants = {};
    Object.keys(CODES).forEach(function (field) {
        var v = observation.fromUgm3(CODES[field], item.components[field]);
        if (v !== undefined) {
            pollutants[CODES[field]] = v;
        }
    });
    var indexes = {};
    if (item.main && typeof item.main === 'object' && observation.finite(item.main.aqi)) {
        indexes.owm = item.main.aqi;
    }
    return observation.create('openweather', {
        stationBased: false,
        observedAt: new Date(item.dt * 1000),
        pollutants: pollutants,
        indexes: indexes,
        attribution: 'OpenWeather'
    });
}

module.exports = {
    id: 'openweather',
    label: 'OpenWeather Air Pollution API',
    stationBased: false,
    isConfigured: function (keyString) {
        return http.isValidKey(key(keyString));
    },
    fetchCurrent: function (gCoord, deps, callback) {
        var url = URL + '?lat=' + Number(gCoord.lat) + '&lon=' + Number(gCoord.lon) +
            '&appid=' + encodeURIComponent(key(deps.keyString));
        http.request(deps.axios, {method: 'get', url: url, timeoutMs: deps.timeoutMs}, function (result) {
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
