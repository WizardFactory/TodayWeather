'use strict';

var http = require('../air/httpClient');
var URL = 'https://pollen.googleapis.com/v1/forecast:lookup';

function isoDay(date) {
    if (!date || !Number.isInteger(date.year) || date.year < 1000 || date.year > 9999 ||
        !Number.isInteger(date.month) || !Number.isInteger(date.day) ||
        date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) {
        return undefined;
    }
    var utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
    if (utc.getUTCDate() === date.day) {
        return utc.toISOString().slice(0, 10);
    }
}

function parseEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.reduce(function (out, row) {
        if (!row || typeof row.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(row.code)) {
            return out;
        }
        var entry = {code: row.code};
        if (typeof row.inSeason === 'boolean') {
            entry.inSeason = row.inSeason;
        }
        var index = row.indexInfo && row.indexInfo.value;
        if (Number.isInteger(index) && index >= 0 && index <= 5) {
            entry.index = index;
        }
        out.push(entry);
        return out;
    }, []);
}

function parse(body) {
    if (typeof body.regionCode !== 'string' || !/^[A-Z]{2}$/.test(body.regionCode) ||
        !Array.isArray(body.dailyInfo)) {
        return undefined;
    }
    var byDate = new Map();
    body.dailyInfo.forEach(function (row) {
        if (!row || typeof row !== 'object') {
            return;
        }
        var date = isoDay(row.date);
        var types = parseEntries(row.pollenTypeInfo);
        var plants = parseEntries(row.plantInfo);
        if (date && (types.length || plants.length)) {
            byDate.set(date, {date: date, types: types, plants: plants});
        }
    });
    if (!byDate.size) {
        return undefined;
    }
    return {
        outcome: 'ok',
        source: 'google',
        attribution: 'Google Maps',
        region: body.regionCode,
        days: Array.from(byDate.values()).sort(function (a, b) { return a.date.localeCompare(b.date); })
    };
}

function fetch(gCoord, deps, callback) {
    var key = deps.keyString && deps.keyString.google_key;
    var lat = gCoord && gCoord.lat;
    var lon = gCoord && gCoord.lon;
    if (!http.isValidKey(key) || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
        !Number.isFinite(lon) || Math.abs(lon) > 180) {
        return callback({outcome: 'failed', kind: 'unavailable', reason: 'invalid-lookup'});
    }
    var url = URL + '?location.latitude=' + lat + '&location.longitude=' + lon +
        '&days=5&key=' + encodeURIComponent(key);
    http.request(deps.axios, {method: 'get', url: url, timeoutMs: deps.timeoutMs}, function (result) {
        callback(http.guarded(function () {
            if (!result.ok) {
                return {outcome: 'failed', kind: result.kind, reason: result.reason};
            }
            return parse(result.body) || {outcome: 'failed', kind: 'invalid-body', reason: 'no-forecast'};
        }));
    });
}

module.exports = {fetch: fetch};
