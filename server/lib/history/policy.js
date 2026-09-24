'use strict';
// Explicit KST keys; no host-local Date parsing or mutation.
var DAY = 86400000,
    HOUR = 3600000,
    KST = 9 * HOUR;
var limits = {
    t1h: [-50, 60],
    t1d: [-50, 60],
    taMin: [-50, 60],
    taMax: [-50, 60],
    reh: [0, 100],
    rn1: [0, 5000],
    wsd: [0, 100],
    vec: [0, 360],
    sky: [1, 4]
};
exports.valid = function (field, value) {
    var r = limits[field];
    return (
        !!r &&
        typeof value === 'number' &&
        isFinite(value) &&
        value >= r[0] &&
        value <= r[1] &&
        (!/^t/.test(field) || value > -50)
    );
};
exports.number = function (value) {
    if (typeof value !== 'number' && typeof value !== 'string') return;
    if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return;
    var n = Number(value);
    if (isFinite(n)) return n;
};
exports.instant = function (key) {
    if (typeof key !== 'string' || !/^\d{8}(?:\d{4})?$/.test(key)) return NaN;
    var y = +key.slice(0, 4),
        m = +key.slice(4, 6),
        d = +key.slice(6, 8),
        h = +(key.slice(8, 10) || 0),
        min = +(key.slice(10, 12) || 0);
    if (y < 1900 || m < 1 || m > 12 || d < 1 || h > 23 || min !== 0) return NaN;
    var ms = Date.UTC(y, m - 1, d, h) - KST;
    return exports.key(ms, key.length === 8) === key ? ms : NaN;
};
exports.key = function (ms, daily) {
    var d = new Date(+ms + KST);
    if (!isFinite(d.getTime())) return;
    return d
        .toISOString()
        .slice(0, daily ? 10 : 16)
        .replace(/[-T:]/g, '');
};
exports.addDays = function (date, n) {
    return exports.key(exports.instant(date) + n * DAY, true);
};
exports.window = function (now) {
    var today = exports.key(now === undefined ? Date.now() : now, true);
    return { start: exports.addDays(today, -7), end: exports.addDays(today, -1), today: today };
};
exports.range = function (kind, start, end, now) {
    if (kind !== 'hourly' && kind !== 'daily') throw new Error('Invalid history product');
    var a = exports.instant(start),
        b = exports.instant(end),
        w = exports.window(now);
    if (
        !isFinite(a) ||
        !isFinite(b) ||
        start.length !== 8 ||
        end.length !== 8 ||
        a > b ||
        b - a > 6 * DAY ||
        end >= w.today
    )
        throw new Error('History requires 1-7 completed KST dates');
    var out = [],
        step = kind === 'daily' ? DAY : HOUR;
    for (var t = a; t < b + DAY; t += step) out.push(exports.key(t, kind === 'daily'));
    return out;
};
exports.station = function (value) {
    return /^\d{1,3}$/.test(String(value)) && +value > 0 ? String(+value) : undefined;
};
exports.id = function (kind, station, key) {
    return kind + ':' + station + ':' + key;
};
exports.complete = function (kind, row) {
    var f = (row && row.values) || {};
    return kind === 'hourly'
        ? exports.valid('t1h', f.t1h) && exports.valid('reh', f.reh)
        : exports.valid('taMin', f.taMin) && exports.valid('taMax', f.taMax) && f.taMin <= f.taMax;
};
exports.normalize = function (kind, item, station, allowed, now) {
    if (!item || exports.station(item.stnId) !== station || typeof item.tm !== 'string') return;
    var re = kind === 'daily' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(?::00)?$/;
    var match = item.tm.match(re);
    if (!match) return;
    var key = match.slice(1).join('') + (kind === 'hourly' ? '00' : '');
    if (!isFinite(exports.instant(key)) || !allowed.has(key)) return;
    var mappings =
        kind === 'hourly'
            ? { ta: 't1h', hm: 'reh', rn: 'rn1', ws: 'wsd', wd: 'vec' }
            : { minTa: 'taMin', maxTa: 'taMax', avgTa: 't1d', avgRhm: 'reh', sumRn: 'rn1', avgWs: 'wsd' };
    var values = {};
    Object.keys(mappings).forEach(function (source) {
        // KMA documents winter rain at three-hour intervals. Until the source
        // accumulation period is verified, it cannot populate one-hour rn1.
        var month = +key.slice(4, 6);
        if (kind === 'hourly' && source === 'rn' && (month <= 3 || month >= 11)) return;
        var flags = [item[source + 'Qcflag'], item[source + 'Qcflg']];
        if (
            kind === 'hourly' &&
            flags.some(function (flag) {
                return flag !== undefined && flag !== null && flag !== '' && String(flag) !== '0';
            })
        )
            return;
        var n = exports.number(item[source]),
            field = mappings[source];
        if (exports.valid(field, n)) values[field] = n;
    });
    if (kind === 'hourly') {
        var cloud = exports.number(item.dc10Tca);
        if (cloud !== undefined && cloud >= 0 && cloud <= 10)
            values.sky = cloud <= 2 ? 1 : cloud <= 5 ? 2 : cloud <= 8 ? 3 : 4;
    }
    if (
        kind === 'daily' &&
        values.taMin !== undefined &&
        values.taMax !== undefined &&
        values.taMin > values.taMax
    )
        return;
    if (!Object.keys(values).length) return;
    return {
        _id: exports.id(kind, station, key),
        kind: kind,
        stationId: station,
        key: key,
        date: new Date(exports.instant(key)),
        kstDate: key.slice(0, 8),
        timeBasis: 'UTC',
        source: 'KMA_ASOS',
        values: values,
        fetchedAt: new Date(now === undefined ? Date.now() : now)
    };
};
exports.ranges = function (kind, keys) {
    var step = kind === 'daily' ? DAY : HOUR,
        out = [];
    keys.slice()
        .sort()
        .forEach(function (key) {
            var last = out[out.length - 1];
            if (last && exports.instant(key) - exports.instant(last.end) === step) last.end = key;
            else out.push({ start: key, end: key });
        });
    return out;
};
exports.slot = function (row) {
    if (!row || typeof row.date !== 'string' || typeof row.time !== 'string') return;
    return row.time === '2400' ? exports.addDays(row.date, 1) + '0000' : row.date + row.time;
};
exports.hourlyResponse = function (rows) {
    return rows.map(function (row) {
        if (!row.historyObservation) return row;
        var result = Object.assign({}, row);
        // Older app charts treat negative sentinel values as printable rain.
        // Keep sentinels internally, but omit unknown recovered rain on the wire.
        ['rn1', 'r06', 's06'].forEach(function (field) {
            if (
                result[field] !== undefined &&
                (typeof result[field] !== 'number' || !isFinite(result[field]) || result[field] < 0)
            ) {
                delete result[field];
                delete result[field + 'Str'];
            }
        });
        return result;
    });
};
exports.mergeHourly = function (req, records) {
    var byKey = {};
    records.forEach(function (r) {
        if (r.source === 'KMA_ASOS' && r.timeBasis === 'UTC' && r.kind === 'hourly') byKey[r.key] = r;
    });
    (req.currentList || []).forEach(function (row) {
        var source = byKey[exports.slot(row)];
        if (!source) return;
        var fields = [];
        Object.keys(source.values).forEach(function (field) {
            if (!exports.valid(field, row[field]) && exports.valid(field, source.values[field])) {
                row[field] = source.values[field];
                fields.push(field);
            }
        });
        if (fields.length)
            row.historyObservation = {
                source: source.source,
                stationId: source.stationId,
                key: source.key,
                fields: fields
            };
    });
};
exports.mergeDaily = function (req, records, now) {
    var w = exports.window(now),
        daily = req.midData.dailyData;
    records.forEach(function (source) {
        if (
            source.kind !== 'daily' ||
            source.source !== 'KMA_ASOS' ||
            source.timeBasis !== 'UTC' ||
            source.key < w.start ||
            source.key > w.end ||
            !exports.complete('daily', source)
        )
            return;
        var row = daily.find(function (d) {
            return d.date === source.key;
        });
        if (!row) {
            row = { date: source.key };
            daily.push(row);
        }
        // An incomplete hourly aggregate is not a valid full-day measurement.
        if (row.observationType === 'hourly-summary' && row.observationHours < 24) {
            Object.keys(limits).forEach(function (f) {
                delete row[f];
            });
        }
        var fields = [];
        Object.keys(source.values).forEach(function (field) {
            if (!exports.valid(field, row[field]) && exports.valid(field, source.values[field])) {
                row[field] = source.values[field];
                fields.push(field);
            }
        });
        if (fields.length) {
            row.observationType = 'daily';
            row.historyObservation = {
                source: source.source,
                stationId: source.stationId,
                key: source.key,
                fields: fields
            };
        }
    });
    daily.sort(function (a, b) {
        return a.date.localeCompare(b.date);
    });
};
exports.status = function (req, now) {
    var w = exports.window(now),
        hours = {},
        days = {},
        fieldGaps = [];
    (req.currentList || []).forEach(function (r) {
        var k = exports.slot(r);
        if (k) hours[k] = r;
    });
    ((req.midData && req.midData.dailyData) || []).forEach(function (r) {
        days[r.date] = r;
    });
    var missingHours = exports.range('hourly', w.start, w.end, now).filter(function (k) {
        var r = hours[k] || {};
        var missing = ['t1h', 'reh', 'rn1', 'wsd', 'vec', 'sky'].filter(function (f) {
            return !exports.valid(f, r[f]);
        });
        if (missing.length) fieldGaps.push({ key: k, fields: missing });
        return !exports.valid('t1h', r.t1h) || !exports.valid('reh', r.reh);
    });
    var missingDays = exports.range('daily', w.start, w.end, now).filter(function (k) {
        var row = days[k];
        return (
            !exports.complete('daily', { values: row }) ||
            (row.observationType === 'hourly-summary' && row.observationHours < 24)
        );
    });
    return {
        startDate: w.start,
        endDate: w.end,
        timeZone: 'Asia/Seoul',
        missingHourlySlots: missingHours,
        missingDailyDates: missingDays,
        hourlyFieldGaps: fieldGaps
    };
};
exports.nearest = function (town, stations, maxKm) {
    var coord = town && town.gCoord;
    if (!coord) return;
    function finite(n) {
        return typeof n === 'number' && isFinite(n);
    }
    var lat = +coord.lat,
        lon = +coord.lon;
    if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    var best;
    stations.forEach(function (s) {
        if (
            !s.isCityWeather ||
            !Array.isArray(s.geo) ||
            !s.geo.every(finite) ||
            s.geo.length !== 2 ||
            Math.abs(s.geo[0]) > 180 ||
            Math.abs(s.geo[1]) > 90 ||
            !exports.station(s.stnId)
        )
            return;
        var rad = Math.PI / 180,
            dl = (s.geo[1] - lat) * rad,
            dn = (s.geo[0] - lon) * rad,
            a =
                Math.sin(dl / 2) ** 2 +
                Math.cos(lat * rad) * Math.cos(s.geo[1] * rad) * Math.sin(dn / 2) ** 2;
        var km = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
        if (
            km <= maxKm &&
            (!best || km < best.distanceKm || (km === best.distanceKm && +s.stnId < +best.stationId))
        )
            best = {
                stationId: String(+s.stnId),
                stationName: s.stnName,
                distanceKm: km,
                method: 'nearest-configured-ASOS-city-station'
            };
    });
    return best;
};
