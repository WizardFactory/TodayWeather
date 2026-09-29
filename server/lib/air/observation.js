/**
 * Normalized current air observation shared by every provider adapter (#2628), and its
 * conversion to the AirKorea-shaped `arpltn` object used by the KMA response path.
 * Concentrations: PM in µg/m³, gases in ppm — the units of AirKorea data, so grades, strings
 * and summaries for any airUnit keep one path.
 */

"use strict";

var AqiConverter = require('../aqi.converter');
var StationName = require('../AQI/waqiStationName');
var policy = require('../../config/air');

var POLLUTANTS = ['pm10', 'pm25', 'o3', 'no2', 'so2', 'co'];
var GASES = ['o3', 'no2', 'so2', 'co'];

function finite(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0;
}

/** µg/m³ → ppm for a gas (molar conversion in AqiConverter); PM stays µg/m³. */
function fromUgm3(code, value) {
    if (!finite(value)) {
        return undefined;
    }
    if (GASES.indexOf(code) === -1) {
        return value;
    }
    var ppm = AqiConverter.um2ppm(code, value);
    return finite(ppm) ? ppm : undefined;
}

function fromPpb(value) {
    return finite(value) ? AqiConverter.ppb2ppm(value) : undefined;
}

function toDate(value) {
    // Date instances may come from another realm (tests) or a driver; check the method, not the class
    if (value && typeof value === 'object' && typeof value.getTime === 'function') {
        var ms = value.getTime();
        return typeof ms === 'number' && !isNaN(ms) ? new Date(ms) : undefined;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        var d = new Date(value);
        return isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
}

/**
 * @param provider adapter id ('google', 'openweather', 'visualcrossing', 'aqicn')
 * @param fields {stationBased, observedAt, stationName, stationGeo, pollutants, indexes, attribution}
 */
function create(provider, fields) {
    var pollutants = {};
    POLLUTANTS.forEach(function (code) {
        var v = fields.pollutants ? fields.pollutants[code] : undefined;
        if (finite(v)) {
            pollutants[code] = v;
        }
    });
    var geo;
    if (Array.isArray(fields.stationGeo) && fields.stationGeo.length >= 2 &&
        typeof fields.stationGeo[0] === 'number' && isFinite(fields.stationGeo[0]) &&
        typeof fields.stationGeo[1] === 'number' && isFinite(fields.stationGeo[1])) {
        geo = [fields.stationGeo[0], fields.stationGeo[1]];
    }
    var observedAt = toDate(fields.observedAt);
    var obs = {
        provider: provider,
        stationBased: !!fields.stationBased,
        observedAt: observedAt ? observedAt.toISOString() : undefined,
        pollutants: pollutants,
        indexes: fields.indexes && typeof fields.indexes === 'object' ? fields.indexes : {},
        attribution: typeof fields.attribution === 'string' ? fields.attribution : provider
    };
    if (typeof fields.stationName === 'string' && fields.stationName.trim()) {
        obs.stationName = StationName.shorten(fields.stationName);
    }
    if (geo) {
        obs.stationGeo = geo;
    }
    return obs;
}

function distanceKm(lat1, lon1, lat2, lon2) {
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pad(n) {
    return (n < 10 ? '0' : '') + n;
}

/** AirKorea dataTime form "YYYY-MM-DD HH:mm" in KST. */
function kstDataTime(date) {
    var kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.getUTCFullYear() + '-' + pad(kst.getUTCMonth() + 1) + '-' + pad(kst.getUTCDate()) + ' ' +
        pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes());
}

/** Attribution text for display by the client: a non-empty string, trimmed; anything else is dropped. */
function attributionText(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    var text = value.trim();
    return text ? text : undefined;
}

/**
 * Accept an observation for a request, or say why not.
 * @returns {{reason: string}} or {{arpltn: object, age: number, distance: number|undefined}}
 */
function evaluate(observation, gCoord, requestTime) {
    var observed = toDate(observation && observation.observedAt);
    if (!observed) {
        return {reason: 'no-time'};
    }
    var age = requestTime.getTime() - observed.getTime();
    if (age > policy.FRESHNESS_HOURS * 60 * 60 * 1000) {
        return {reason: 'stale'};
    }
    if (age < -policy.FUTURE_SLACK_MS) {
        return {reason: 'future'};
    }
    var distance;
    if (observation.stationBased) {
        if (!observation.stationGeo) {
            return {reason: 'no-station-geo'};
        }
        distance = distanceKm(Number(gCoord.lat), Number(gCoord.lon), observation.stationGeo[0], observation.stationGeo[1]);
        if (!(distance <= policy.MAX_STATION_DISTANCE_KM)) {
            return {reason: 'too-far'};
        }
    }
    var arpltn = {source: observation.provider};
    if (observation.stationName) {
        arpltn.stationName = observation.stationName;
    }
    arpltn.dataTime = kstDataTime(observed);
    var attribution = attributionText(observation.attribution);
    if (attribution) {
        arpltn.attribution = attribution;
    }
    POLLUTANTS.forEach(function (code) {
        var v = observation.pollutants ? observation.pollutants[code] : undefined;
        if (finite(v)) {
            arpltn[code + 'Value'] = v;
        }
    });
    if (arpltn.pm10Value === undefined && arpltn.pm25Value === undefined) {
        return {reason: 'no-pm'};
    }
    return {arpltn: arpltn, age: age, distance: distance};
}

module.exports = {
    POLLUTANTS: POLLUTANTS,
    GASES: GASES,
    create: create,
    evaluate: evaluate,
    fromUgm3: fromUgm3,
    fromPpb: fromPpb,
    finite: finite,
    distanceKm: distanceKm,
    attributionText: attributionText
};
