'use strict';
// Small process-local cache for read-only observation snapshots. A timed-out
// caller detaches; the coalesced DB read can still warm subsequent requests.
function ReadCache(options) {
    options = options || {};
    this.entries = new Map();
    this.ttl = options.ttl || 30000;
    this.wait = options.wait || 250;
    this.max = options.max || 256;
    this.failureTTL = options.failureTTL || 2500;
    this.readTimeout = options.readTimeout || 2500;
}
ReadCache.prototype.read = function (key, loader, callback) {
    var self = this, now = Date.now(), entry = self.entries.get(key);
    if (entry && entry.expires > now) return callback(entry.error, entry.value);
    if (!entry || !entry.pending) {
        if (self.entries.size >= self.max) {
            // Do not evict in-flight work and turn overload into duplicate reads.
            for (var pair of self.entries) {
                if (!pair[1].pending) { self.entries.delete(pair[0]); break; }
            }
            if (self.entries.size >= self.max) return callback(new Error('HISTORY_CACHE_BUSY'));
        }
        entry = {pending: true, expires: 0};
        self.entries.set(key, entry);
        entry.promise = new Promise(function (resolve) {
            var finished = false, timedOut = false, lateFinished = false;
            var timer = setTimeout(function () {
                timedOut = true;
                done(new Error('HISTORY_READ_TIMEOUT'));
            }, self.readTimeout);
            function done(error, value) {
                if (finished) {
                    // A read deadline releases waiters/capacity, but the DB may
                    // still finish. Warm only the original entry, once; never
                    // overwrite a newer read or call detached waiters again.
                    if (timedOut && !lateFinished) {
                        lateFinished = true;
                        if (!error && self.entries.get(key) === entry) {
                            entry.error = null;
                            entry.value = value;
                            entry.expires = Date.now() + self.ttl;
                        }
                    }
                    return;
                }
                finished = true;
                clearTimeout(timer);
                entry.pending = false;
                entry.error = error;
                entry.value = value;
                entry.expires = Date.now() + (error ? self.failureTTL : self.ttl);
                resolve({error: error, value: value});
            }
            try { loader(done); } catch (error) { done(error); }
        });
    }
    var completed = false;
    var timer = setTimeout(function () { finish(new Error('HISTORY_CACHE_WAIT')); }, self.wait);
    function finish(error, value) {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        callback(error, value);
    }
    entry.promise.then(function (result) { finish(result.error, result.value); });
};
module.exports = ReadCache;
