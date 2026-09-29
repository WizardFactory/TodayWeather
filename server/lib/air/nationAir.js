/** Nation map reads: real province averages first, otherwise labelled representative points. */
'use strict';
var Keco = require('../../controllers/kecoController');
var fallback = require('../AQI/airFallback');
var policy = require('../../config/air');
// Fixed city-centre points, not provincial centroids or a computed province average.
var regions = [
    ['서울','Seoul',37.5665,126.9780], ['부산','Busan',35.1796,129.0756],
    ['대구','Daegu',35.8714,128.6014], ['인천','Incheon',37.4563,126.7052],
    ['광주','Gwangju',35.1595,126.8526], ['대전','Daejeon',36.3504,127.3845],
    ['울산','Ulsan',35.5384,129.3114], ['경기','Suwon',37.2636,127.0286],
    ['강원','Chuncheon',37.8813,127.7298], ['충북','Cheongju',36.6424,127.4890],
    ['충남','Hongseong',36.6012,126.6608], ['전북','Jeonju',35.8242,127.1480],
    ['전남','Mokpo',34.8118,126.3922], ['경북','Andong',36.5684,128.7294],
    ['경남','Changwon',35.2280,128.6811], ['제주','Jeju',33.4996,126.5312],
    ['세종','Sejong',36.4800,127.2890]
];
function storedFailure(row, now) {
    var ms = Keco._parseDateTime(row && row.dataTime);
    if (!isFinite(ms) || !['pm10Value','pm25Value'].some(function (k) {
        return typeof row[k] === 'number' && isFinite(row[k]) && row[k] >= 0;
    })) { return 'invalid'; }
    var age = now.getTime() - ms;
    if (age < -policy.FUTURE_SLACK_MS) { return 'future'; }
    return age >= policy.FRESHNESS_HOURS * 3600000 ? 'stale' : null;
}
function getAir(callback, options) {
    options = options || {};
    var now = options.now || new Date(), finished = false, active = 0, cursor = 0;
    var rows = {}, status = {}, pending = [], readFinished = false;
    var expires = Date.now() + (options.deadlineMs || policy.responseDeadlineMs);
    regions.forEach(function (r) { status[r[0]] = {sidoName: r[0], available: false, reason: 'read-pending'}; });
    function finish() {
        if (finished) { return; }
        finished = true; clearTimeout(timer);
        regions.forEach(function (r) {
            var s = status[r[0]];
            if (!s.available && ['read-pending','fallback-pending','queued'].indexOf(s.reason) !== -1) {
                s.reason = 'deadline';
            }
        });
        // Fresh arrays/objects; no late asynchronous work may mutate a returned result.
        callback(null, regions.map(function (r) { return rows[r[0]]; }).filter(Boolean),
            {checkedAt: now.toISOString(), provinces: regions.map(function (r) { return status[r[0]]; })});
    }
    var timer = setTimeout(finish, Math.max(1, expires - Date.now()));
    function pump() {
        if (finished) { return; }
        if (Date.now() >= expires) { return finish(); }
        while (active < 4 && cursor < pending.length && !finished) {
            var region = pending[cursor++];
            active++;
            fetchRegion(region);
        }
        if (readFinished && active === 0 && cursor === pending.length) { finish(); }
    }
    function fetchRegion(region) {
        var name = region[0], coord = {lat: region[2], lon: region[3]}, called = false;
        status[name].reason = 'fallback-pending';
        function done(err, air, reason) {
            if (called || finished) { return; }
            called = true; active--;
            // The shared service already applies its provider freshness/distance/PM policy.
            // Do not reapply AirKorea's stricter boundary to an accepted global observation.
            if (!err && air) {
                rows[name] = Object.assign({}, air, {sidoName: name, cityName: '', sidocityName: name,
                    date: new Date(Keco._parseDateTime(air.dataTime)), coverage: 'representative-point',
                    representativeCity: region[1], representativeCoord: coord});
                status[name] = Object.assign({}, status[name], {available: true, source: air.source, reason: 'fallback'});
            } else {
                // Enumerated outcomes only; provider errors may contain private request details.
                var safeReasons = ['no-provider','no-pm','stale','future','too-far','no-station-geo','no-time','no-coord','failed'];
                status[name].reason = safeReasons.indexOf(reason) !== -1 ? reason : 'fallback-unavailable';
            }
            pump();
        }
        try { fallback.getArpltn(coord, now, done); }
        catch (_) { done(true); }
    }
    try {
        Keco.getSidoArpltn(function (err, list, readStatus) {
            if (finished || readFinished) { return; }
            readFinished = true;
            list = Array.isArray(list) ? list : [];
            regions.forEach(function (r) {
                var name = r[0], row = list.find(function (a) { return a.sidoName === name; });
                var dbState = (readStatus || []).find(function (a) { return a.sidoName === name; });
                var failure = row && storedFailure(row, now);
                if (row && !failure) {
                    rows[name] = Object.assign({}, row, {source: 'airkorea', coverage: 'province-average'});
                    status[name] = {sidoName: name, available: true, source: 'airkorea', reason: 'stored'};
                } else {
                    status[name].airkorea = err || (dbState && dbState.reason === 'database-error') ? 'database-error' : row ? failure : 'missing';
                    status[name].reason = 'queued'; pending.push(r);
                }
            });
            pump();
        });
    } catch (_) {
        if (readFinished || finished) { return; }
        readFinished = true;
        regions.forEach(function (r) { status[r[0]].airkorea = 'database-error'; status[r[0]].reason = 'queued'; pending.push(r); });
        pump();
    }
}
module.exports = {getAir: getAir, regions: regions};
