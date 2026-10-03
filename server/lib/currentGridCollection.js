'use strict';

// Grid collection coverage only. Station/ASOS response fallbacks never enter these models.
var fields = ['t1h', 'rn1', 'uuu', 'vvv', 'reh', 'pty', 'vec', 'wsd'];
var partialWalkLimit = 2;
function complete(row, slot) {
    if (!row || row.date !== slot.date || row.time !== slot.time) { return false; }
    if (fields.some(function(field) { return typeof row[field] !== 'number' || !isFinite(row[field]); })) { return false; }
    return row.t1h !== -50 && row.rn1 >= 0 && row.uuu !== -100 && row.vvv !== -100 &&
        row.reh >= 0 && row.reh <= 100 && row.pty >= 0 && row.vec >= 0 && row.vec <= 360 && row.wsd >= 0;
}
// Keep useful temperature/rain/type observations, without counting optional gaps as complete.
function partial(row, slot) {
    return row && row.date === slot.date && row.time === slot.time &&
        ['t1h', 'rn1', 'pty'].every(function(field) { return typeof row[field] === 'number' && isFinite(row[field]); }) &&
        row.t1h !== -50 && row.rn1 >= 0 && row.pty >= 0 && !complete(row, slot);
}
function coordKey(coord) { return coord.mx + ':' + coord.my; }
// Stop waiting; this does not cancel the underlying Mongo transport.
function bounded(callback, milliseconds) {
    var finished = false;
    var timer = setTimeout(function() { done(new Error('Current coverage read deadline exceeded')); }, milliseconds || 3000);
    function done(err, result, partialKeys) {
        if (finished) { return; }
        finished = true;
        clearTimeout(timer);
        callback(err, result, partialKeys);
    }
    return done;
}
function pending(model, version, slot, coords, callback, timeoutMs) {
    var query, projection = {_id: 0, mCoord: 1, currentData: 1};
    var condition = {date: slot.date, time: slot.time};
    if (version === '1.0') {
        query = {currentData: {$elemMatch: condition}};
        projection.currentData = {$elemMatch: condition};
    }
    else if (version === '2.0') {
        var instant = new Date(Date.UTC(Number(slot.date.slice(0,4)), Number(slot.date.slice(4,6)) - 1,
            Number(slot.date.slice(6,8)), Number(slot.time.slice(0,2)), Number(slot.time.slice(2,4))) - 9 * 3600000);
        query = {fcsDate: instant, 'currentData.date': slot.date, 'currentData.time': slot.time};
    }
    else { return callback(new Error('Unsupported current coverage storage version')); }
    callback = bounded(callback, timeoutMs);
    try {
        model.find(query, projection).setOptions({maxTimeMS: 2000}).lean().exec(function(err, rows) {
            if (err) { return callback(err); }
            if (!Array.isArray(rows)) { return callback(new Error('Invalid current coverage readback')); }
            var covered = new Set(), partialKeys = new Set();
            rows.forEach(function(item) {
                var data = version === '1.0' ? item.currentData : [item.currentData];
                if (item.mCoord && Array.isArray(data) && data.some(function(row) { return complete(row, slot); })) {
                    covered.add(coordKey(item.mCoord));
                }
                else if (item.mCoord && Array.isArray(data) && data.some(function(row) { return partial(row, slot); })) {
                    partialKeys.add(coordKey(item.mCoord));
                }
            });
            callback(null, coords.filter(function(coord) { return !covered.has(coordKey(coord)); }), partialKeys);
        });
    }
    catch (err) { callback(err); }
}
function CurrentGridCollection(options) { this.options = options; this.active = null; this.admissions = null; }
CurrentGridCollection.prototype.run = function(slot, key, callback) {
    var self = this, options = this.options, identity = slot.date + slot.time;
    callback = callback || function() {};
    if (this.active) {
        if (this.active.identity === identity) { this.active.callbacks.push(callback); }
        else { callback(new Error('Current collection busy with another publication')); }
        return;
    }
    // Process-local admission memory, not coverage or a provider/shared quota cap.
    if (!this.admissions || this.admissions.identity !== identity) {
        this.admissions = {identity: identity, counts: new Map()};
    }
    var counts = this.admissions.counts;
    var run = {identity: identity, callbacks: [callback], finished: false};
    // Stop admission, not an already issued Mongo operation.
    var control = {cancelled: false, collector: null, retryTimer: null};
    this.active = run;
    var deadline = setTimeout(function() {
        control.cancelled = true;
        if (control.retryTimer) { clearTimeout(control.retryTimer); }
        if (control.collector && control.collector.cancel) { control.collector.cancel(); }
        options.emit({event: 'current-collection-stop', utc: new Date().toISOString(), publication: identity, reason: 'deadline'});
        finish(new Error('Current collection run deadline exceeded'));
    }, options.collectTimeoutMs || 540000);
    function finish(err, report) {
        if (run.finished) { return; }
        run.finished = true;
        clearTimeout(deadline);
        if (self.active === run) { self.active = null; }
        var callbacks = run.callbacks;
        run.callbacks = [];
        callbacks.forEach(function(cb) { cb(err, report); });
    }
    function read(coords, stage, done) {
        pending(options.model, options.version, slot, coords, function(err, list, partialKeys) {
            if (run.finished || control.cancelled) { return; }
            if (!err) {
                options.emit({event: 'current-coverage', stage: stage, utc: new Date().toISOString(),
                    publication: identity, total: coords.length, complete: coords.length - list.length, pending: list.length});
            }
            done(err, list, partialKeys);
        }, options.readTimeoutMs);
    }
    var coordinatesReady = bounded(function(err, coords) {
        if (run.finished || control.cancelled) { return; }
        if (err) { return finish(err); }
        if (!Array.isArray(coords) || !coords.length) { return finish(new Error('Current grid list unavailable')); }
        read(coords, 'before', function(err, list, partialKeys) {
            if (err) { return finish(err); }
            if (!list.length) { return finish(null, {total: coords.length, pending: 0, deferred: 0}); }
            var deferred = new Set();
            var eligible = list.filter(function(coord) {
                var id = coordKey(coord);
                if (partialKeys.has(id) && (counts.get(id) || 0) >= partialWalkLimit) {
                    deferred.add(id);
                    return false;
                }
                return true;
            });
            options.emit({event: 'current-repair-plan', utc: new Date().toISOString(), publication: identity,
                pending: list.length, eligible: eligible.length, deferred: deferred.size, limit: partialWalkLimit});
            if (!eligible.length) {
                return finish(new Error('Current collection incomplete: pending=' + list.length + ', deferred=' + deferred.size),
                    {total: coords.length, pending: list.length, deferred: deferred.size});
            }
            eligible.forEach(function(coord) {
                var id = coordKey(coord);
                counts.set(id, Math.min(partialWalkLimit, (counts.get(id) || 0) + 1));
            });
            try { options.collect(eligible, slot, key, function(collectionError) {
                if (run.finished || control.cancelled) { return; }
                read(coords, 'after', function(readError, remaining) {
                    var error = collectionError || readError;
                    if (!error && remaining.length) { error = new Error('Current collection incomplete: pending=' + remaining.length); }
                    finish(error, {total: coords.length, pending: readError ? coords.length : remaining.length,
                        deferred: readError ? deferred.size : remaining.filter(function(coord) { return deferred.has(coordKey(coord)); }).length});
                });
            }, control); } catch (err) { finish(err); }
        });
    }, options.readTimeoutMs);
    try { options.coords(coordinatesReady); } catch (err) { coordinatesReady(err); }
};
CurrentGridCollection.complete = complete;
CurrentGridCollection.pending = pending;
module.exports = CurrentGridCollection;
