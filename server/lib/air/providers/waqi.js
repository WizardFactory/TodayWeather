/**
 * WAQI (aqicn.org) geo feed adapter (#2628; fetch logic from the #2622 fallback).
 * Station data: the feed returns the nearest station with US EPA sub-indices per pollutant,
 * which are converted back to concentrations as on the overseas path. Free only (token quota
 * per second, no monthly cap); attribution to WAQI and the originating agency is mandatory.
 */

"use strict";

var http = require('../httpClient');
var observation = require('../observation');
var AqiConverter = require('../../aqi.converter');

var BASE_URL = 'https://api.waqi.info/feed/';
var PPB_CODES = ['o3', 'no2', 'so2'];

function key(keyString) {
    var keys = keyString ? keyString.aqi_keys : undefined;
    return Array.isArray(keys) && keys[0] ? keys[0].key : undefined;
}

function parse(body) {
    // provider fields are untrusted; anything of an unexpected type is dropped
    var data = body.data;
    if (!data || typeof data !== 'object') {
        return undefined;
    }
    var t = data.time && typeof data.time === 'object' ? data.time : {};
    var time;
    if (typeof t.iso === 'string') {
        time = t.iso;
    }
    else if (typeof t.s === 'string' && typeof t.tz === 'string') {
        time = t.s.replace(' ', 'T') + t.tz;
    }
    if (!data.iaqi || typeof data.iaqi !== 'object') {
        return undefined;
    }
    var pollutants = {};
    observation.POLLUTANTS.forEach(function (code) {
        var item = data.iaqi[code];
        if (!item || !observation.finite(item.v)) {
            return;
        }
        var value = AqiConverter.extractValue(code, item.v);
        if (!observation.finite(value)) {
            return;
        }
        // extractValue gives ppb for o3/no2/so2 and ppm for co (US EPA table units)
        pollutants[code] = PPB_CODES.indexOf(code) === -1 ? value : AqiConverter.ppb2ppm(value);
    });
    var city = data.city && typeof data.city === 'object' ? data.city : {};
    var names = [];
    if (Array.isArray(data.attributions)) {
        data.attributions.forEach(function (a) {
            if (a && typeof a.name === 'string') {
                names.push(a.name);
            }
        });
    }
    var indexes = {};
    if (observation.finite(data.aqi)) {
        indexes.us = data.aqi;
    }
    return observation.create('aqicn', {
        stationBased: true,
        observedAt: time,
        stationName: city.name,
        stationGeo: city.geo,
        pollutants: pollutants,
        indexes: indexes,
        attribution: names.length ? 'World Air Quality Index Project; ' + names.join('; ') : 'World Air Quality Index Project'
    });
}

module.exports = {
    id: 'aqicn',
    label: 'WAQI (aqicn.org) geo feed',
    stationBased: true,
    isConfigured: function (keyString) {
        return http.isValidKey(key(keyString));
    },
    fetchCurrent: function (gCoord, deps, callback) {
        var url = BASE_URL + 'geo:' + Number(gCoord.lat) + ';' + Number(gCoord.lon) + '/?token=' + encodeURIComponent(key(deps.keyString));
        http.request(deps.axios, {method: 'get', url: url, timeoutMs: deps.timeoutMs}, function (result) {
            if (!result.ok) {
                return callback({outcome: 'failed', kind: result.kind, reason: result.reason});
            }
            var body = result.body;
            if (!Object.prototype.hasOwnProperty.call(body, 'status')) {
                return callback({outcome: 'failed', kind: 'invalid-body', reason: 'invalid-body'});
            }
            if (body.status !== 'ok') {
                return callback({outcome: 'failed', kind: 'status', reason: 'status-' + String(body.status).slice(0, 20)});
            }
            var obs = parse(body);
            if (!obs) {
                return callback({outcome: 'failed', kind: 'invalid-body', reason: 'invalid-body'});
            }
            callback({outcome: 'ok', observation: obs, cost: 1});
        });
    }
};
