'use strict';
var policy = require('./policy');
var DAY = 86400000;

exports.record = policy.record;

// Legacy station BSON dates encode the KST wall clock in UTC components.
// ASOS history dates, by contrast, are real UTC instants with an explicit KST key.
exports.legacyKey = function (date) {
    var value = new Date(date);
    if (!isFinite(value.getTime())) return;
    var iso = value.toISOString();
    if (iso.slice(14) !== '00:00.000Z') return;
    var key = iso.slice(0, 16).replace(/[-T:]/g, '');
    return isFinite(policy.instant(key)) ? key : undefined;
};
exports.mergeLegacy = function (req, records) {
    var byKey = {};
    (records || []).forEach(function (record) {
        var key = exports.legacyKey(record.date), station = policy.station(record.stnId);
        if (!key || !station) return;
        byKey[key] = {source: 'KMA_STATION_HOURLY', stationId: station, key: key,
            values: {t1h: record.t1h, reh: record.reh, rn1: record.rs1h, vec: record.vec, wsd: record.wsd}};
    });
    var rows = (req.currentList || []).slice();
    if (req.current && rows.indexOf(req.current) === -1) rows.push(req.current);
    rows.forEach(function (row) {
        var source = byKey[policy.slot(row)], fields = [];
        if (!source) return;
        Object.keys(source.values).forEach(function (field) {
            if (!policy.valid(field, row[field]) && policy.valid(field, source.values[field])) {
                row[field] = source.values[field];
                fields.push(field);
            }
        });
        if (fields.length) exports.record(row, source, fields);
    });
};
function temperatureSource(row) {
    if (row.fieldObservations && row.fieldObservations.t1h) return row.fieldObservations.t1h;
    var source = row.historyObservation;
    return source && source.fields && source.fields.indexOf('t1h') !== -1 ? source : undefined;
}
function measurementHour(source) {
    if (source.source !== 'KMA_STATION_LIVE') return policy.instant(source.key);
    if (typeof source.key !== 'string' || !/^\d{12}$/.test(source.key) || +source.key.slice(10) > 59) return NaN;
    return policy.instant(source.key.slice(0, 10) + '00');
}
exports.canCompare = function (current, yesterday) {
    if (!current || !yesterday || yesterday.missing || yesterday.comparisonAvailable === false) return false;
    if (typeof current.t1h !== 'number' || !isFinite(current.t1h) ||
        typeof yesterday.t1h !== 'number' || !isFinite(yesterday.t1h)) return false;
    // Selection validates Celsius before unit conversion. Converted legitimate
    // Fahrenheit values may exceed the Celsius bounds or equal its sentinel.
    if (yesterday.comparisonAvailable === true) return true;
    if (!policy.valid('t1h', current.t1h) || !policy.valid('t1h', yesterday.t1h)) return false;
    var a = temperatureSource(current), b = temperatureSource(yesterday);
    if (!a && !b) return true;
    // Preserve the existing live-current vs same-town grid-yesterday display.
    // The measurement must belong to the current hour and the selected grid
    // observation must be exactly 24 hours earlier; ASOS pairs remain separate.
    if (a && a.source === 'KMA_STATION_LIVE' && !b) {
        var hour = measurementHour(a);
        return !!policy.station(a.stationId) && hour === policy.instant(policy.slot(current)) &&
            hour - policy.instant(policy.slot(yesterday)) === DAY;
    }
    if (!a || !b || a.source !== b.source || String(a.stationId) !== String(b.stationId)) return false;
    if (a.source === 'KMA_STATION_LIVE') {
        return !!policy.station(a.stationId) && measurementHour(a) === policy.instant(policy.slot(current)) &&
            measurementHour(b) === policy.instant(policy.slot(yesterday)) && measurementHour(a) - measurementHour(b) === DAY;
    }
    return !a.key || !b.key || policy.instant(a.key) - policy.instant(b.key) === DAY;
};
exports.yesterday = function (current, rows) {
    var slot = policy.slot(current), target = policy.key(policy.instant(slot) - DAY);
    var result = (rows || []).find(function (row) {
        return policy.slot(row) === target && policy.valid('t1h', row.t1h);
    });
    if (!target) return {missing: true, comparisonAvailable: false};
    if (!result || !policy.valid('t1h', result.t1h)) {
        return {date: target.slice(0, 8), time: target.slice(8), missing: true, comparisonAvailable: false};
    }
    result = Object.assign({}, result);
    // Ignore an earlier request's eligibility marker; validate the source pair now.
    delete result.comparisonAvailable;
    result.comparisonAvailable = exports.canCompare(current, result);
    // Older clients calculate their own difference whenever both temperatures
    // exist; the additive eligibility flag alone cannot suppress that display.
    if (!result.comparisonAvailable) delete result.t1h;
    return result;
};
