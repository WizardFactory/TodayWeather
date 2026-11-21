'use strict';

var HOUR_MS = 60 * 60 * 1000;

function period(now, hours) {
    var start = (Math.floor(now.getTime() / HOUR_MS) + 1) * HOUR_MS;
    return {start: start, end: start + (hours - 1) * HOUR_MS};
}

function timeString(ms) {
    return new Date(ms).toISOString().replace('.000Z', 'Z');
}

// Both providers use the observation adapters' canonical concentration units.
// A forecast exposes the valid timestamp and index codes instead of observedAt.
function rows(items, parse, range) {
    if (!Array.isArray(items)) {
        return [];
    }
    var byTime = new Map();
    items.forEach(function (item) {
        if (!item || typeof item !== 'object') {
            return;
        }
        var point = parse(item);
        if (!point || !point.observedAt || !Object.keys(point.pollutants).length) {
            return;
        }
        var validAt = Date.parse(point.observedAt);
        if (validAt < range.start || validAt > range.end || validAt % HOUR_MS !== 0) {
            return;
        }
        byTime.set(validAt, {at: point.observedAt, pollutants: point.pollutants, indexes: point.indexes});
    });
    return Array.from(byTime.values()).sort(function (a, b) { return a.at.localeCompare(b.at); });
}

function read(http, result, items, parse, range) {
    return http.guarded(function () {
        if (!result.ok) {
            return {outcome: 'failed', kind: result.kind, reason: result.reason};
        }
        var forecast = rows(result.body[items], parse, range);
        if (!forecast.length) {
            return {outcome: 'failed', kind: 'invalid-body', reason: 'no-forecast'};
        }
        return {outcome: 'ok', rows: forecast, cost: 1};
    });
}

module.exports = {period: period, timeString: timeString, read: read};
