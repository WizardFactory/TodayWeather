'use strict';
// Forecast completion is persisted coverage, never an in-memory successful-request flag.
var precipitation = require('./kmaPrecipitation');
var HOUR = 3600000, DAY = 24 * HOUR;
function stamp(slot) {
    if (!slot || typeof slot.date !== 'string' || !/^\d{8}$/.test(slot.date) ||
        typeof slot.time !== 'string' || !/^\d{4}$/.test(slot.time) || Number(slot.time.slice(0, 2)) > 23 ||
        Number(slot.time.slice(2)) > 59) { return NaN; }
    return Date.UTC(Number(slot.date.slice(0, 4)), Number(slot.date.slice(4, 6)) - 1,
        Number(slot.date.slice(6, 8)), Number(slot.time.slice(0, 2)), Number(slot.time.slice(2, 4)));
}
function parts(t) {
    var s = new Date(t).toISOString();
    return {date: s.slice(0, 10).replace(/-/g, ''), time: s.slice(11, 13) + '00'};
}
function expected(product, slot) {
    var base = stamp(slot), start = Math.floor(base / HOUR) * HOUR, times = [];
    if (!isFinite(base)) { throw new Error('Invalid forecast publication'); }
    if (product === 'shortest') {
        for (var i = 1; i <= 6; i++) { times.push(start + i * HOUR); }
    }
    else if (product === 'short') {
        var midnight = Math.floor(start / DAY) * DAY;
        var extension = midnight + (Number(slot.time.slice(0, 2)) >= 17 ? 4 : 3) * DAY;
        for (var t = start + HOUR; t < extension; t += HOUR) { times.push(t); }
        for (t = extension; t < extension + DAY; t += 3 * HOUR) { times.push(t); }
    }
    else { throw new Error('Unsupported forecast product'); }
    return times.map(parts);
}
function finite(value) { return typeof value === 'number' && isFinite(value) && value > -900 && value < 900; }
function valid(row, product, at, slot) {
    if (!row || row.date !== at.date || row.time !== at.time) { return false; }
    var temp = product === 'short' ? 't3h' : 't1h';
    var rain = product === 'short' ? ['r06', 's06'] : ['rn1'];
    var fields = [temp, 'sky', 'reh', 'pty', 'uuu', 'vvv', 'vec', 'wsd'].concat(rain);
    if (product === 'short' || slot.date + slot.time >= '202606231100') { fields.push('pop'); }
    if (product === 'shortest') { fields.push('lgt'); }
    if (product === 'short' && at.time === '0600' && (at.date !== slot.date || slot.time === '0200')) { fields.push('tmn'); }
    if (product === 'short' && at.time === '1500' && (at.date !== slot.date || slot.time <= '1100')) { fields.push('tmx'); }
    if (fields.some(function(f) { return !finite(row[f]); })) { return false; }
    return row[temp] !== -50 && row[temp] >= -100 && row.sky >= 1 && row.sky <= 4 &&
        row.reh >= 0 && row.reh <= 100 && row.pty >= 0 && row.pty <= 8 &&
        row.uuu !== -100 && row.vvv !== -100 && row.vec >= 0 && row.vec <= 360 && row.wsd >= 0 &&
        rain.every(function(f) { return row[f] >= 0; }) &&
        (fields.indexOf('pop') < 0 || (row.pop >= 0 && row.pop <= 100)) &&
        (fields.indexOf('tmn') < 0 || row.tmn !== -50) && (fields.indexOf('tmx') < 0 || row.tmx !== -50);
}
function complete(product, slot, rows) {
    if (!Array.isArray(rows)) { return false; }
    var byTime = new Map();
    rows.forEach(function(row) { if (row) { byTime.set(row.date + row.time, row); } });
    return expected(product, slot).every(function(at) { return valid(byTime.get(at.date + at.time), product, at, slot); });
}
function horizon(product, slot) {
    return new Set(expected(product, slot).map(function(at) { return at.date + at.time; }));
}
// Provider counts suggest one slot beyond the documented horizon end; keep such a
// trailing row only when it is itself valid, never before the base or far beyond.
function trailing(product, slot, row) {
    var times = expected(product, slot), last = stamp(times[times.length - 1]), at = stamp(row);
    return at > last && at <= last + DAY && valid(row, product, {date: row.date, time: row.time}, slot);
}
function within(product, slot, rows) {
    var allowed = horizon(product, slot);
    return Array.isArray(rows) ? rows.filter(function(row) {
        return row && (allowed.has(row.date + row.time) || trailing(product, slot, row));
    }) : rows;
}
// Writable rows are the expected horizon plus valid trailing rows, without duplicates:
// arbitrary extra slots could relabel stored data.
function batch(product, slot, coord, rows) {
    var allowed = horizon(product, slot), seen = new Set();
    return Array.isArray(rows) && rows.length > 0 && rows.every(function(row) {
        if (!row || seen.has(row.date + row.time)) { return false; }
        seen.add(row.date + row.time);
        if (!allowed.has(row.date + row.time) && !trailing(product, slot, row)) { return false; }
        return row.pubDate === slot.date + slot.time && row.mx === coord.mx && row.my === coord.my;
    }) && complete(product, slot, rows);
}
// Reject permissive parseFloat prefixes before the existing parser can normalize them.
function rawItems(items, product, slot, coord) {
    var numbers = product === 'short' ? ['TMP', 'T3H', 'SKY', 'REH', 'PTY', 'POP', 'UUU', 'VVV', 'VEC', 'WSD', 'TMN', 'TMX'] :
        ['T1H', 'SKY', 'REH', 'PTY', 'POP', 'UUU', 'VVV', 'VEC', 'WSD', 'LGT'];
    function value(item, name) { return item[name] && item[name][0]; }
    var slots = new Map(), allowed = horizon(product, slot), times = expected(product, slot);
    var last = stamp(times[times.length - 1]);
    var validItems = Array.isArray(items) && items.every(function(item) {
        if (!item || value(item, 'baseDate') !== slot.date || value(item, 'baseTime') !== slot.time ||
            String(coord.mx) !== value(item, 'nx') || String(coord.my) !== value(item, 'ny')) { return false; }
        var category = value(item, 'category'), text = value(item, 'fcstValue');
        var at = value(item, 'fcstDate') + value(item, 'fcstTime');
        if (!allowed.has(at)) {
            // within() drops out-of-horizon rows before writes; a storable trailing row is still value-checked.
            var t = stamp({date: value(item, 'fcstDate'), time: value(item, 'fcstTime')});
            if (!(t > last && t <= last + DAY)) { return true; }
        }
        else {
            if (!slots.has(at)) { slots.set(at, new Set()); }
            slots.get(at).add(category);
        }
        if (numbers.indexOf(category) >= 0) {
            return typeof text === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim()) && finite(Number(text));
        }
        if (['PCP', 'SNO', 'RN1', 'R06', 'S06'].indexOf(category) >= 0) {
            return !!precipitation.parse(text, category === 'SNO' || category === 'S06' ? 'cm' : 'mm',
                category === 'SNO' || category === 'S06' ? '적설없음' : '강수없음');
        }
        return true; // Conditional WAV / unknown optional categories never gate completion.
    });
    return validItems && expected(product, slot).every(function(at) {
        var categories = slots.get(at.date + at.time);
        var required = ['SKY', 'REH', 'PTY', 'UUU', 'VVV', 'VEC', 'WSD'];
        if (product === 'short') {
            required.push('POP');
            if (at.time === '0600' && (at.date !== slot.date || slot.time === '0200')) { required.push('TMN'); }
            if (at.time === '1500' && (at.date !== slot.date || slot.time <= '1100')) { required.push('TMX'); }
            if (!categories || !(categories.has('TMP') || categories.has('T3H')) ||
                !(categories.has('PCP') || categories.has('R06')) || !(categories.has('SNO') || categories.has('S06'))) { return false; }
        }
        else {
            required.push('T1H', 'RN1', 'LGT');
            if (slot.date + slot.time >= '202606231100') { required.push('POP'); }
        }
        return categories && required.every(function(category) { return categories.has(category); });
    });
}
// Preserve conditionally absent API inputs while replacing every required forecast field.
function preserveOptional(row, previous, product, slot) {
    var result = Object.assign({}, row);
    if ((!finite(row.wav) || row.wav === -1) && finite(previous.wav) && previous.wav >= 0) { result.wav = previous.wav; }
    if (product === 'short' && row.date === slot.date) {
        ['tmn', 'tmx'].forEach(function(field) {
            var absent = field === 'tmn' ? slot.time !== '0200' : slot.time > '1100';
            if (absent && (!finite(row[field]) || row[field] === -50) && finite(previous[field]) && previous[field] !== -50) {
                result[field] = previous[field];
            }
        });
    }
    return result;
}
function coordKey(coord) { return coord.mx + ':' + coord.my; }
function bounded(callback, ms) {
    var finished = false;
    var timer = setTimeout(function() { done(new Error('Forecast coverage read deadline exceeded')); }, ms || 3000);
    function done(err, result) {
        if (finished) { return; }
        finished = true; clearTimeout(timer); callback(err, result);
    }
    return done;
}
function pending(model, version, product, slot, coords, callback, timeoutMs) {
    var field = product + 'Data', identity = slot.date + slot.time;
    if (version !== '1.0' && version !== '2.0') { return callback(new Error('Unsupported forecast coverage storage version')); }
    var pubDate = version === '1.0' ? identity : new Date(stamp(slot) - 9 * HOUR);
    var projection = {_id: 0, mCoord: 1, pubDate: 1, fcsDate: 1}; projection[field] = 1;
    timeoutMs = timeoutMs || 3000;
    callback = bounded(callback, timeoutMs);
    var delivered = false;
    try {
        var query = {pubDate: pubDate};
        if (version === '2.0') {
            var horizon = expected(product, slot);
            query.fcsDate = {$gte: new Date(stamp(horizon[0]) - 9 * HOUR),
                $lte: new Date(stamp(horizon[horizon.length - 1]) - 9 * HOUR)};
        }
        model.find(query, projection).setOptions({maxTimeMS: Math.max(1, timeoutMs - 1000)}).lean().exec(function(err, docs) {
            delivered = true;
            if (err) { return callback(err); }
            if (!Array.isArray(docs)) { return callback(new Error('Invalid forecast coverage readback')); }
            var grouped = new Map(), covered = new Set();
            docs.forEach(function(doc) {
                var exact = version === '1.0' ? doc.pubDate === identity : doc.pubDate && Number(doc.pubDate) === Number(pubDate);
                if (!exact || !doc.mCoord) { return; }
                var id = coordKey(doc.mCoord), data = version === '1.0' ? doc[field] : [doc[field]];
                if (!Array.isArray(data)) { return; }
                // DB2 fcsDate and payload time must describe the same persisted slot.
                if (version === '2.0') {
                    data = data.filter(function(row) { return row && Number(doc.fcsDate) === stamp(row) - 9 * HOUR; });
                }
                if (!grouped.has(id)) { grouped.set(id, []); }
                grouped.get(id).push.apply(grouped.get(id), data);
            });
            grouped.forEach(function(rows, id) { if (complete(product, slot, rows)) { covered.add(id); } });
            callback(null, coords.filter(function(coord) { return !covered.has(coordKey(coord)); }));
        });
    } catch (err) {
        // Only query construction/dispatch failures are read errors; never swallow a caller's exception.
        if (delivered) { throw err; }
        callback(err);
    }
}
function ForecastGridCollection(options) { this.options = options; this.active = null; }
ForecastGridCollection.prototype.run = function(requested, key, callback) {
    var self = this, options = this.options, slot = {date: requested.date, time: requested.time};
    var identity = slot.date + slot.time, product = options.product;
    callback = callback || function() {};
    if (self.active) {
        if (self.active.identity === identity) { self.active.callbacks.push(callback); }
        else { callback(new Error('Forecast collection busy with another publication')); }
        return;
    }
    // Ultra-short publications are updated every ten minutes after generation: while the
    // publication is current, one process-local full refresh walk per publication is due.
    var base = stamp(slot) - 9 * HOUR, now = (options.now || Date.now)();
    var refreshDue = options.refreshAfterMs > 0 && now >= base + options.refreshAfterMs &&
        now < base + options.refreshAfterMs + (options.refreshWindowMs || HOUR) && self.refreshed !== identity;
    var run = {identity: identity, callbacks: [callback], finished: false};
    var control = {cancelled: false, collector: null, retryTimer: null, product: product, slot: slot, httpAttempts: 0};
    self.active = run;
    var coords;
    var deadline = setTimeout(function() {
        control.cancelled = true;
        if (control.retryTimer) { clearTimeout(control.retryTimer); }
        if (control.collector && control.collector.cancel) { control.collector.cancel(); }
        finish(new Error('Forecast collection run deadline exceeded'));
    }, options.collectTimeoutMs || 540000);
    function finish(err, report) {
        if (run.finished) { return; }
        run.finished = true; clearTimeout(deadline);
        if (self.active === run) { self.active = null; }
        report = report || {expected: coords ? coords.length : 0, complete: 0, pending: coords ? coords.length : 0};
        report.httpAttempts = control.httpAttempts;
        options.emit(Object.assign({event: 'forecast-collection', utc: new Date().toISOString(), product: product,
            publication: identity, outcome: err ? 'incomplete' : 'complete'}, report));
        var callbacks = run.callbacks; run.callbacks = [];
        callbacks.forEach(function(cb) { cb(err, report); });
    }
    function read(stage, done) {
        var started = Date.now();
        pending(options.model, options.version, product, slot, coords, function(err, list) {
            if (run.finished || control.cancelled) { return; }
            options.emit(Object.assign({event: 'forecast-coverage', stage: stage, utc: new Date().toISOString(),
                product: product, publication: identity, readMs: Date.now() - started, httpAttempts: control.httpAttempts},
                err ? {outcome: 'read-failed'} : {expected: coords.length, complete: coords.length - list.length, pending: list.length}));
            done(err, list);
        }, options.readTimeoutMs);
    }
    var ready = bounded(function(err, list) {
        if (run.finished || control.cancelled) { return; }
        if (err) { return finish(err); }
        if (!Array.isArray(list) || !list.length) { return finish(new Error('Forecast grid list unavailable')); }
        coords = list;
        read('before', function(err, list) {
            if (err) { return finish(err); }
            var walk = list, refreshed = refreshDue && list.length < coords.length;
            if (refreshDue) { self.refreshed = identity; walk = coords; }
            if (!walk.length) { return finish(null, {expected: coords.length, complete: coords.length, pending: 0}); }
            try {
                options.collect(walk, slot, key, function(collectionError) {
                    if (run.finished || control.cancelled) { return; }
                    read('after', function(readError, remaining) {
                        var error = collectionError || readError;
                        if (!error && remaining.length) { error = new Error('Forecast collection incomplete: pending=' + remaining.length); }
                        finish(error, {expected: coords.length, complete: readError ? 0 : coords.length - remaining.length,
                            pending: readError ? coords.length : remaining.length, refresh: refreshed});
                    });
                }, control);
            } catch (error) { if (run.finished) { throw error; } finish(error); }
        });
    }, options.readTimeoutMs);
    try { options.coords(ready); } catch (err) { if (run.finished) { throw err; } ready(err); }
};
ForecastGridCollection.preserveOptional = preserveOptional;
ForecastGridCollection.rawItems = rawItems;
ForecastGridCollection.expected = expected;
ForecastGridCollection.complete = complete;
ForecastGridCollection.batch = batch;
ForecastGridCollection.within = within;
ForecastGridCollection.pending = pending;
module.exports = ForecastGridCollection;
