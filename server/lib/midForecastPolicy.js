'use strict';
// Side-effect-free contract shared by collection, both DB formats and service.
var DAY = 86400000;
var KST = 9 * 3600000;
var landFields = [], tempFields = [];
for (var d = 3; d <= 10; d++) {
    (d <= 7 ? ['Am', 'Pm'] : ['']).forEach(function (half) {
        landFields.push('wf' + d + half, 'rnSt' + d + half);
    });
    tempFields.push('taMin' + d, 'taMax' + d);
}
exports.landFields = landFields;
exports.tempFields = tempFields;
exports.rssEnabled = false; // Retired feed: no verified replacement (issue #2560).
exports.temperature = function (value) {
    return typeof value === 'number' && isFinite(value) && value > -50 && value < 60;
};
exports.probability = function (value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 100;
};
// One mapping for validation and service conversion. Shower icons use the
// existing rain category (pty=1); the original provider wording is preserved.
var weatherMap = Object.create(null);
[
    [1, 0, '맑음'], [2, 0, '구름조금'], [3, 0, '구름많음'], [4, 0, '흐림'],
    [4, 1, '흐리고 한때 비|흐리고 비|흐리고 소나기'],
    [2, 1, '구름적고 한때 비|구름적고 비'],
    [3, 1, '구름많고 한때 비|구름많고 비|구름많고 소나기'],
    [4, 3, '흐리고 한때 눈|흐리고 눈'],
    [2, 3, '구름적고 한때 눈|구름적고 눈'],
    [3, 3, '구름많고 한때 눈|구름많고 눈'],
    [2, 2, '구름적고 비/눈|구름적고 눈/비'],
    [3, 2, '구름많고 비/눈|구름많고 눈/비'],
    [4, 2, '흐리고 비/눈|흐리고 눈/비']
].forEach(function (group) {
    group[2].split('|').forEach(function (text) { weatherMap[text] = {sky: group[0], pty: group[1]}; });
});
exports.skyInfo = function (value) {
    var info = typeof value === 'string' && weatherMap[value.trim()];
    return info ? {sky: info.sky, pty: info.pty, lgt: 0} : undefined;
};
exports.weather = function (value) { return !!exports.skyInfo(value); };
exports.number = function (value) {
    if (typeof value !== 'number' && typeof value !== 'string') { return NaN; }
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value).trim())) { return NaN; }
    return Number(value);
};
exports.timestamp = function (value) {
    if (typeof value === 'string' && /^\d{12}$/.test(value)) {
        var y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8);
        var h = +value.slice(8, 10), min = +value.slice(10, 12);
        var date = new Date(Date.UTC(y, m - 1, d, h, min));
        if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 ||
            date.getUTCDate() !== d || h > 23 || min > 59) { return NaN; }
        return date.getTime() - KST;
    }
    // Require timezone-bearing ISO or Date. Never coerce a calendar number.
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
        return Date.parse(value);
    }
    if (value && typeof value.getTime === 'function') { return value.getTime(); }
    return NaN;
};
exports.date = function (value) {
    var ms = typeof value === 'number' ? value : exports.timestamp(value);
    return isFinite(ms) ? new Date(ms + KST).toISOString().slice(0, 10).replace(/-/g, '') : undefined;
};
exports.addDays = function (date, days) {
    var ms = typeof date === 'string' && /^\d{8}$/.test(date) ? exports.timestamp(date + '0000') : NaN;
    return isFinite(ms) ? exports.date(ms + days * DAY) : undefined;
};
exports.publication = function (value) {
    var ms = exports.timestamp(value);
    if (!isFinite(ms)) { return false; }
    var local = new Date(ms + KST);
    return (local.getUTCHours() === 6 || local.getUTCHours() === 18) &&
        local.getUTCMinutes() === 0 && local.getUTCSeconds() === 0 && local.getUTCMilliseconds() === 0;
};
exports.fresh = function (value, now) {
    var ms = exports.timestamp(value);
    var age = (now === undefined ? Date.now() : +now) - ms;
    return exports.publication(value) && age >= 0 && age <= 36 * 3600000;
};
exports.freshShort = function (value, now) {
    var age = (now === undefined ? Date.now() : +now) - exports.timestamp(value);
    return age >= 0 && age <= 24 * 3600000;
};
// Raw snapshots contain only daily inputs. They never include unadjusted
// overlapping rain/snow accumulations or values inherited by legacy merges.
exports.shortDailySnapshot = function (row, publication) {
    var result = {pubDate: publication};
    ['date', 'time', 't3h', 'tmn', 'tmx', 'sky', 'pty', 'reh', 'pop', 'wsd'].forEach(function (field) {
        if (row[field] !== undefined) { result[field] = row[field]; }
    });
    return result;
};
exports.dailyShortRows = function (records, now) {
    var slots = {};
    (Array.isArray(records) ? records : []).forEach(function (row) {
        if (!row || typeof row.date !== 'string' || typeof row.time !== 'string') { return; }
        if (!isFinite(exports.timestamp(row.date + row.time)) ||
            !isFinite(exports.timestamp(row.pubDate))) { return; }
        var key = row.date + row.time;
        if (!slots[key] || exports.timestamp(row.pubDate) >= exports.timestamp(slots[key].pubDate)) { slots[key] = row; }
    });
    return Object.keys(slots).sort().map(function (key) { return slots[key]; }).filter(function (row) {
        return exports.freshShort(row.pubDate, now) && exports.inWindow(row.date, now) &&
            row.date <= exports.addDays(exports.date(row.pubDate), 4);
    });
};
exports.latest = function (records, publication, now) {
    if (!Array.isArray(records) || !records.length) { return null; }
    var latest = records.reduce(function (a, b) {
        return exports.timestamp(b.date + b.time) > exports.timestamp(a.date + a.time) ? b : a;
    });
    var identity = latest.date + latest.time;
    if (!exports.fresh(identity, now) || (publication !== undefined &&
        exports.timestamp(publication) !== exports.timestamp(identity))) { return null; }
    return latest;
};
exports.complete = function (row) {
    return row && exports.temperature(row.taMin) && exports.temperature(row.taMax) && row.taMin <= row.taMax;
};
exports.inWindow = function (date, now) {
    var today = exports.date(now === undefined ? Date.now() : +now);
    return exports.addDays(date, 0) === date && date >= exports.addDays(today, -7) && date <= exports.addDays(today, 10);
};
exports.dailyHealth = function (mid, now) {
    var rows = mid && mid.dailyData || [], reasons = [], seen = {};
    var today = exports.date(now === undefined ? Date.now() : +now);
    if (!mid || !exports.fresh(mid.landPubDate, now)) { reasons.push('land-unavailable'); }
    if (!mid || !exports.fresh(mid.tempPubDate, now)) { reasons.push('temperature-unavailable'); }
    rows.forEach(function (row, i) {
        if (!exports.inWindow(row.date, now)) { reasons.push('target-out-of-window'); }
        if (seen[row.date] || (i && rows[i - 1].date > row.date)) { reasons.push('dates-not-unique-sorted'); }
        if (exports.complete(row) && exports.weather(row.wfAm) && exports.weather(row.wfPm)) {
            seen[row.date] = true;
        } else { reasons.push('invalid-daily-row'); }
    });
    if (!rows.some(function (row) { return row.date >= exports.addDays(today, 4) &&
        exports.complete(row) && exports.weather(row.wfAm) && exports.weather(row.wfPm); })) {
        reasons.push('future-mid-unavailable');
    }
    var missing = [];
    for (var d = 0; d <= 10; d++) {
        var target = exports.addDays(today, d);
        if (!seen[target]) { missing.push(target); }
    }
    var last = Object.keys(seen).filter(function (date) { return date >= today; }).sort().pop();
    if (last && missing.some(function (date) { return date <= last; })) { reasons.push('forecast-gap'); }
    return {healthy: reasons.length === 0, reasons: reasons.filter(function (reason, i) { return reasons.indexOf(reason) === i; }), unavailableDates: missing, rss: 'retired'};
};
exports.parse = function (kind, response, options) {
    var envelope = response && response.response;
    var header = envelope && envelope.header && envelope.header[0];
    var body = envelope && envelope.body && envelope.body[0];
    var items = body && body.items && body.items[0] && body.items[0].item;
    if (!header || !header.resultCode || header.resultCode[0] !== '00' ||
        !Array.isArray(items) || !items.length || !body.totalCount ||
        Number(body.totalCount[0]) !== items.length || !options ||
        !exports.publication(options.date + options.time)) { throw new Error('Invalid mid envelope/publication'); }
    return items.map(function (item) {
        if (!item || !Array.isArray(item.regId) || item.regId.length !== 1 ||
            typeof item.regId[0] !== 'string' || !/^[A-Za-z0-9]+$/.test(item.regId[0])) {
            throw new Error('Invalid mid region');
        }
        var result = {regId: item.regId[0], date: options.date, time: options.time, pubDate: options.date + options.time};
        var usable = 0;
        (kind === 'land' ? landFields : tempFields).forEach(function (key) {
            if (!Array.isArray(item[key]) || item[key].length !== 1) { return; }
            var value = item[key][0];
            if (key.slice(0, 2) === 'wf') {
                if (exports.weather(value)) { result[key] = value.trim(); usable++; }
            } else {
                value = exports.number(value);
                if ((kind === 'temp' ? exports.temperature : exports.probability)(value)) {
                    result[key] = value;
                    if (kind === 'temp') { usable++; }
                }
            }
        });
        if (!usable) { throw new Error('No usable mid forecast'); }
        return result;
    });
};
