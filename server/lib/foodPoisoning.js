'use strict';

var https = require('https');
var DAY = 86400000;
var ENDPOINT = 'https://poisonmap.mfds.go.kr/api/risk.do';
var USER_AGENT = 'TodayWeather/1.0 (+https://github.com/WizardFactory/TodayWeather)';
var gwangju = ['동구', '서구', '남구', '북구', '광산구'];
var jeonnam = ['목포시', '여수시', '순천시', '나주시', '광양시', '담양군', '곡성군', '구례군',
    '고흥군', '보성군', '화순군', '장흥군', '강진군', '해남군', '영암군', '무안군',
    '함평군', '영광군', '장성군', '완도군', '진도군', '신안군'];

function dateKey(ms) { return new Date(ms).toISOString().slice(0, 10).replace(/-/g, ''); }
function today(now) { return dateKey(now.getTime() + 9 * 3600000); }
function dayMs(key) {
    if (typeof key !== 'string' || !/^\d{8}$/.test(key)) return NaN;
    var ms = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
    return dateKey(ms) === key ? ms : NaN;
}
function publicationMs(publication) {
    if (typeof publication !== 'string' || !/^\d{4}-\d{2}-\d{2}\d{4}$/.test(publication)) return NaN;
    var day = publication.slice(0, 10).replace(/-/g, '');
    var hour = Number(publication.slice(10, 12)), minute = Number(publication.slice(12, 14));
    if (hour > 23 || minute > 59) return NaN;
    return dayMs(day) + (hour - 9) * 3600000 + minute * 60000;
}
function grade(risk) { return risk < 0.315 ? 0 : risk < 0.559 ? 1 : risk < 0.743 ? 2 : 3; }
function parse(body, now) {
    now = now || new Date();
    if (!body || body.success !== true || !Array.isArray(body.data) || !body.data.length) {
        throw new Error('MFDS invalid response');
    }
    var seen = {}, rows = [];
    body.data.forEach(function (raw) {
        if (!raw || typeof raw.sd !== 'string' || !raw.sd.trim() ||
            !(raw.sgg === null || (typeof raw.sgg === 'string' && raw.sgg.trim())) ||
            !isFinite(dayMs(raw.baseDate)) || raw.baseDate > today(now) ||
            !isFinite(publicationMs(raw.regDatetime)) || publicationMs(raw.regDatetime) > now.getTime() ||
            raw.regDatetime.slice(0, 10).replace(/-/g, '') !== raw.baseDate) {
            throw new Error('MFDS invalid region or publication');
        }
        var sd = raw.sd.trim(), sgg = raw.sgg === null ? '' : raw.sgg.trim();
        var identity = JSON.stringify([sd, sgg]);
        if (seen[identity]) throw new Error('MFDS duplicate region');
        seen[identity] = true;
        ['todayRisk', 'tomorrowRisk', 'afterTomorrowRisk'].forEach(function (field, offset) {
            var risk = raw[field];
            if (typeof risk !== 'number' || !isFinite(risk) || risk < 0 || risk > 1) return;
            var date = dateKey(dayMs(raw.baseDate) + offset * DAY);
            if (date < today(now)) return;
            rows.push({_id: JSON.stringify([sd, sgg, date]), sd: sd, sgg: sgg, date: date,
                risk: risk, value: Number((risk * 100).toFixed(4)), grade: grade(risk), baseDate: raw.baseDate,
                publication: raw.regDatetime, fetchedAt: now,
                expireAt: new Date(dayMs(date) + DAY - 9 * 3600000)});
        });
    });
    if (!rows.length) throw new Error('MFDS no valid forecast dates');
    return rows;
}

// One HTTPS attempt with an absolute deadline; no redirects or retries.
function fetchRisk(callback, options) {
    options = options || {};
    var transport = options.transport || https;
    var completed = false, timer, req;
    function done(err, body) {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        callback(err, body);
    }
    timer = setTimeout(function () {
        done(new Error('MFDS request deadline'));
        if (req) req.destroy();
    }, options.timeoutMs || 10000);
    try {
        req = transport.get(options.url || ENDPOINT, {headers: {'User-Agent': USER_AGENT, Accept: 'application/json'}}, function (res) {
            if (res.statusCode !== 200) {
                res.resume();
                done(new Error('MFDS HTTP ' + res.statusCode));
                req.destroy();
                return;
            }
            var chunks = [], size = 0;
            res.on('data', function (chunk) {
                size += chunk.length;
                if (size > (options.maxBytes || 1024 * 1024)) {
                    done(new Error('MFDS response too large'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            res.on('error', done);
            res.on('aborted', function () { done(new Error('MFDS response aborted')); });
            res.on('end', function () {
                if (completed) return;
                var body;
                try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                catch (err) { return done(new Error('MFDS invalid JSON')); }
                done(null, body);
            });
        });
        req.on('error', done);
    }
    catch (err) { done(err); }
}
function region(town) {
    if (!town || typeof town.first !== 'string') return null;
    var sd = town.first.trim(), sgg = typeof town.second === 'string' ? town.second.replace(/\s+/g, '') : '';
    // Provider concatenates city/district names (e.g. 수원시장안구).
    if (sd === '전남광주통합특별시') {
        if (gwangju.indexOf(sgg) !== -1) sd = '광주광역시';
        else if (jeonnam.indexOf(sgg) !== -1) sd = '전라남도';
        else return null;
    }
    sd = {'전라북도': '전북특별자치도', '강원도': '강원특별자치도'}[sd] || sd;
    return sd ? {sd: sd, sgg: sgg} : null;
}
function slot(now) {
    var kst = new Date(now.getTime() + 9 * 3600000);
    var mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    var slots = [8 * 60 + 20, 12 * 60 + 20, 17 * 60 + 20];
    var selected;
    slots.forEach(function (s) { if (s <= mins) selected = s; });
    return selected === undefined ? null : today(now) + ':' + selected;
}
function due(now, startup) {
    if (!slot(now)) return false;
    var kst = new Date(now.getTime() + 9 * 3600000);
    return !!startup || (kst.getUTCMinutes() === 20 && [8, 12, 17].indexOf(kst.getUTCHours()) !== -1);
}
function create(options) {
    options = options || {};
    var service = {store: options.store, running: false, lastSlot: null};
    function store() { return service.store || (service.store = require('../models/modelFoodPoisoning')); }
    service.collect = function (now, callback) {
        var key = slot(now);
        if (!key || service.running || service.lastSlot === key) return callback(null, 0);
        service.running = true;
        service.lastSlot = key; // Failure waits for the next slot, including a repeated startup call.
        var finished = false;
        function done(err, count) {
            if (finished) return;
            finished = true;
            service.running = false;
            callback(err, count);
        }
        try {
            (options.fetch || fetchRisk)(function (err, body) {
                if (err) return done(err);
                var rows, model;
                try { rows = parse(body, now); model = store(); }
                catch (error) { return done(error); }
                var remaining = rows.length, firstError;
                rows.forEach(function (row) {
                    var acknowledged = false;
                    function saved(error) {
                        if (acknowledged) return;
                        acknowledged = true;
                        // Older publication/upsert races cannot replace an existing newer _id.
                        if (error && error.code !== 11000 && !firstError) firstError = error;
                        if (--remaining === 0) done(firstError, rows.length);
                    }
                    try {
                        model.updateOne({_id: row._id, publication: {$lte: row.publication}},
                            {$set: row}, {upsert: true}, saved);
                    }
                    catch (error) { saved(error); }
                });
            });
        }
        catch (err) { done(err); }
    };
    service.append = function (town, days, now, callback) {
        var target = region(town), completed = false, timer;
        function done() {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            callback();
        }
        if (!target || !Array.isArray(days)) return done();
        var start = today(now), end = dateKey(dayMs(start) + 2 * DAY);
        timer = setTimeout(done, options.readTimeoutMs || 2000);
        try {
            store().find({sd: target.sd, sgg: {$in: [target.sgg, '']}, date: {$gte: start, $lte: end}})
                .lean().exec(function (err, rows) {
                    if (completed) return;
                    if (err || !Array.isArray(rows)) return done();
                    var byDate = {};
                    rows.forEach(function (row) {
                        if (row.sd !== target.sd || (row.sgg !== target.sgg && row.sgg !== '') ||
                            !isFinite(dayMs(row.date)) || row.date < start || row.date > end ||
                            !isFinite(dayMs(row.baseDate)) || row.baseDate > start ||
                            row.date < row.baseDate || dayMs(row.date) > dayMs(row.baseDate) + 2 * DAY ||
                            !isFinite(publicationMs(row.publication)) || publicationMs(row.publication) > now.getTime() ||
                            row.publication.slice(0, 10).replace(/-/g, '') !== row.baseDate ||
                            typeof row.value !== 'number' || !isFinite(row.value) || row.value < 0 || row.value > 100 ||
                            typeof row.risk !== 'number' || !isFinite(row.risk) || row.risk < 0 || row.risk > 1 ||
                            row.value !== Number((row.risk * 100).toFixed(4)) || row.grade !== grade(row.risk)) return;
                        var prev = byDate[row.date];
                        if (!prev || row.sgg === target.sgg) byDate[row.date] = row;
                    });
                    days.forEach(function (day) {
                        var row = byDate[day.date];
                        if (row) { day.fsn = row.value; day.fsnGrade = row.grade; }
                    });
                    done();
                });
        }
        catch (err) { done(); }
    };
    return service;
}
var shared;
exports.shared = function () { return shared || (shared = create()); };
exports.create = create;
exports.parse = parse;
exports.region = region;
exports.due = due;
exports.fetch = fetchRisk;
exports.grade = grade;
