/**
 * Visual Crossing air quality adapter (#2628): the Timeline API's air quality elements for the
 * current conditions of the requested point (µg/m³). Each call costs `queryCost` records of the
 * daily budget shared with overseas weather (#2585, vc.usage / VC_DAILY_RECORD_LIMIT).
 */

"use strict";

var http = require('../httpClient');
var observation = require('../observation');

var BASE_URL = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/';
var ELEMENTS = 'datetime,datetimeEpoch,pm2p5,pm10,o3,no2,so2,co,aqius,aqieur';
var CODES = {pm2p5: 'pm25', pm10: 'pm10', o3: 'o3', no2: 'no2', so2: 'so2', co: 'co'};

function key(keyString) {
    return keyString ? keyString.vc_key : undefined;
}

function parse(body) {
    var current = body.currentConditions;
    if (!current || typeof current !== 'object' || !observation.finite(current.datetimeEpoch)) {
        return undefined;
    }
    var pollutants = {};
    Object.keys(CODES).forEach(function (field) {
        var v = observation.fromUgm3(CODES[field], current[field]);
        if (v !== undefined) {
            pollutants[CODES[field]] = v;
        }
    });
    var indexes = {};
    if (observation.finite(current.aqius)) {
        indexes.us = current.aqius;
    }
    if (observation.finite(current.aqieur)) {
        indexes.eu = current.aqieur;
    }
    return observation.create('visualcrossing', {
        stationBased: false,
        observedAt: new Date(current.datetimeEpoch * 1000),
        pollutants: pollutants,
        indexes: indexes,
        attribution: 'Visual Crossing'
    });
}

module.exports = {
    id: 'visualcrossing',
    label: 'Visual Crossing Timeline API (air quality elements)',
    stationBased: false,
    isConfigured: function (keyString) {
        return http.isValidKey(key(keyString));
    },
    fetchCurrent: function (gCoord, deps, callback) {
        var url = BASE_URL + Number(gCoord.lat) + ',' + Number(gCoord.lon) + '/today' +
            '?unitGroup=metric&include=current&elements=' + ELEMENTS + '&key=' + encodeURIComponent(key(deps.keyString));
        http.request(deps.axios, {method: 'get', url: url, timeoutMs: deps.timeoutMs}, function (result) {
            if (!result.ok) {
                return callback({outcome: 'failed', kind: result.kind, reason: result.reason});
            }
            var obs = parse(result.body);
            if (!obs) {
                return callback({outcome: 'failed', kind: 'invalid-body', reason: 'invalid-body'});
            }
            var cost = observation.finite(result.body.queryCost) ? result.body.queryCost : 1;
            callback({outcome: 'ok', observation: obs, cost: cost});
        });
    }
};
