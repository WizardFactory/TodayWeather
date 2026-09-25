'use strict';
var fields = ['t1h', 'reh', 'vec', 'wsd'];
var WINDOW = 20 * 60000;
function instant(text) {
    var m = /^(\d{4})[.]?(\d{2})[.]?(\d{2})[.]?(\d{2}):?(\d{2})$/.exec(String(text));
    if (!m) return NaN;
    var y = +m[1],
        month = +m[2],
        d = +m[3],
        h = +m[4],
        min = +m[5];
    var local = Date.UTC(y, month - 1, d, h, min);
    var dt = new Date(local);
    if (
        y < 2000 ||
        y > 2100 ||
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== month - 1 ||
        dt.getUTCDate() !== d ||
        h > 23 ||
        min > 59
    )
        return NaN;
    return local - 9 * 3600000;
}
function valid(field, v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if (field === 't1h') return v > -50 && v <= 60;
    if (field === 'reh') return v >= 0 && v <= 100;
    if (field === 'vec') return v >= 0 && v <= 360;
    if (field === 'wsd') return v >= 0 && v <= 100;
    return false;
}
function stationId(v) {
    return /^[1-9]\d{0,3}$/.test(String(v)) ? String(v) : null;
}
function fresh(ms, now) {
    return Number.isFinite(ms) && ms <= now && ms > now - WINDOW;
}
function id(station, ms) {
    return station + ':' + new Date(ms).toISOString();
}
function selectStation(town, rows) {
    var c = town && town.gCoord;
    if (
        !c ||
        !Number.isFinite(c.lon) ||
        !Number.isFinite(c.lat) ||
        Math.abs(c.lon) > 180 ||
        Math.abs(c.lat) > 90
    )
        return null;
    var eligible = (rows || [])
        .filter(function (s) {
            return (
                stationId(s.stnId) &&
                typeof s.stnName === 'string' &&
                s.stnName.trim() &&
                s.isCityWeather === true &&
                s.isMountain !== true &&
                Array.isArray(s.geo) &&
                s.geo.length === 2 &&
                s.geo.every(Number.isFinite) &&
                Math.abs(s.geo[0]) <= 180 &&
                Math.abs(s.geo[1]) <= 90
            );
        })
        .map(function (s) {
            return {
                stationId: String(s.stnId),
                stationName: s.stnName,
                distanceDegrees: Math.hypot(s.geo[0] - c.lon, s.geo[1] - c.lat),
                method: 'city-planar-1deg',
            };
        })
        .filter(function (s) {
            return s.distanceDegrees <= 1;
        })
        .sort(function (a, b) {
            return a.distanceDegrees - b.distanceDegrees;
        });
    return eligible[0] || null;
}
// Capture only a proven current observation row; synthesized forecast values have unknown observation age.
function capture(req, original, effective) {
    var result = {},
        ms = original && instant(String(original.date) + String(original.time));
    if (
        original &&
        effective &&
        original.date === effective.date &&
        original.time === effective.time &&
        Number.isFinite(ms)
    ) {
        fields.forEach(function (f) {
            if (valid(f, original[f]) && original[f] === effective[f])
                result[f] = { value: effective[f], observedAt: new Date(ms).toISOString() };
        });
    }
    req._awsMinuteSources = result;
}
function overlay(current, row, mapping, sources, now) {
    var ms = row && +new Date(row.observedAt);
    if (
        !current ||
        !mapping ||
        !row ||
        row.stationId !== mapping.stationId ||
        row.timeBasis !== 'UTC' ||
        row.source !== 'KMA_AWS_MINUTE' ||
        !fresh(ms, now)
    )
        return current;
    var output = Object.assign({}, current),
        applied = {},
        sourceFields = sources || {};
    fields.forEach(function (f) {
        var v = row.values && row.values[f],
            before = sourceFields[f];
        if (!valid(f, v)) return;
        if (valid(f, current[f])) {
            if (
                !before ||
                before.value !== current[f] ||
                !Number.isFinite(Date.parse(before.observedAt)) ||
                ms <= Date.parse(before.observedAt)
            )
                return;
        }
        output[f] = v;
        applied[f] = {
            observedAt: new Date(ms).toISOString(),
            stationId: row.stationId,
            source: row.source,
        };
    });
    if (!Object.keys(applied).length) return current;
    var kst = new Date(ms + 9 * 3600000).toISOString();
    if (applied.t1h) {
        output.liveTime = kst.slice(11, 16).replace(':', '');
        output.liveDate = kst.slice(0, 10).replace(/-/g, '');
    }
    output.minuteObservation = {
        stationId: mapping.stationId,
        stationName: mapping.stationName,
        observedAt: new Date(ms).toISOString(),
        observationDate: kst.slice(0, 10).replace(/-/g, ''),
        timeBasis: 'UTC',
        mapping: mapping.method,
        distanceDegrees: mapping.distanceDegrees,
        fields: applied,
    };
    return output;
}
module.exports = {
    fields: fields,
    WINDOW: WINDOW,
    instant: instant,
    valid: valid,
    stationId: stationId,
    fresh: fresh,
    id: id,
    selectStation: selectStation,
    capture: capture,
    overlay: overlay,
};
