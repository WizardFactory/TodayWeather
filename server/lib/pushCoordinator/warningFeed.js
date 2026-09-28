'use strict';
var zones = require('../kmaWarningZones');
var hash = require('./registry').hash;
function eventId(e) {
    return hash([e.areaCode, e.warnVar, e.warnStress, e.command, e.tmFc, e.tmSeq, e.endTime, e.allEndTime]);
}
function publishedAt(value) {
    var s = String(value);
    if (!/^\d{12}$/.test(s)) return NaN;
    return Date.UTC(
        +s.slice(0, 4),
        +s.slice(4, 6) - 1,
        +s.slice(6, 8),
        +s.slice(8, 10) - 9,
        +s.slice(10, 12)
    );
}
class Feed {
    constructor(o) {
        this.storage = o.storage;
        this.now = o.now || Date.now;
        this.tail = Promise.resolve();
        this.cache = new Map();
    }
    publish(rows, options) {
        var self = this;
        var work = this.tail.then(async function () {
            var head = (await self.storage.get('warning-feed/head.json')) || {
                schemaVersion: 1,
                events: [],
                seen: [],
                baseline: false
            };
            var seen = new Set(head.seen),
                events = zones.prepareEvents(rows),
                now = self.now();
            var bootstrap = (options || {}).bootstrap || !head.baseline;
            for (var e of events) {
                var id = eventId(e);
                if (seen.has(id)) continue;
                seen.add(id);
                if (!bootstrap) {
                    var sourceAt = publishedAt(e.tmFc);
                    await self.storage.put('warning-feed/events/' + id + '.json', {
                        id: id,
                        event: e,
                        observedAt: now,
                        sourceAt: sourceAt,
                        notify:
                            Number.isFinite(sourceAt) && sourceAt <= now + 60000 && now - sourceAt < 300000
                    });
                    head.events.push({ id: id, at: now });
                }
            }
            head.events = head.events.filter(function (e) {
                return now - e.at < 86400000;
            });
            // A bounded full-day source window is replayed by the collector; keep fingerprints across restarts.
            head.seen = Array.from(seen).slice(-50000);
            head.baseline = true;
            head.updatedAt = now;
            await self.storage.put('warning-feed/head.json', head);
            return head;
        });
        this.tail = work.catch(function () {});
        return work;
    }
    async read() {
        var head = await this.storage.get('warning-feed/head.json');
        if (!head) return [];
        var self = this,
            keep = new Set(
                head.events.map(function (x) {
                    return x.id;
                })
            );
        this.cache.forEach(function (v, k) {
            if (!keep.has(k)) self.cache.delete(k);
        });
        return require('./storage').mapLimit(head.events, 8, async function (x) {
            if (self.cache.has(x.id)) return self.cache.get(x.id);
            var item = await self.storage.get('warning-feed/events/' + x.id + '.json');
            if (item) self.cache.set(x.id, item);
            return item;
        });
    }
}
module.exports = { Feed: Feed, eventId: eventId, publishedAt: publishedAt };
