'use strict';
var crypto = require('crypto');
var EventEmitter = require('events');
var mapLimit = require('./storage').mapLimit;
function hash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function copy(value) {
    return JSON.parse(JSON.stringify(value));
}
function keyOf(d) {
    return 'registrations/' + d.product + '/' + d.key.slice(0, 2) + '/' + d.key + '.json';
}
function refOf(d, k) {
    return d.key + '/' + k;
}
function clock(date) {
    return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
}
function inside(r, date) {
    var t = clock(date);
    return r.startTime <= r.endTime ? t >= r.startTime && t <= r.endTime : t >= r.startTime || t <= r.endTime;
}
function groupKey(r) {
    return JSON.stringify([r.category, r.cityIndex, r.id]);
}
function tokenOf(d) {
    return d.endpoint.fcmToken || d.endpoint.registrationId;
}
function validate(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Invalid push registration');
    if (['alarm', 'alert'].indexOf(r.category || 'alarm') < 0) throw new Error('Invalid push category');
    if (['ios', 'android'].indexOf(r.type) < 0) throw new Error('Invalid push device type');
    if (!(typeof r.fcmToken === 'string' && r.fcmToken.length) || r.fcmToken.length > 4096)
        throw new Error('FCM token is required');
    if (r.package && ['todayWeather', 'todayAir'].indexOf(r.package) < 0)
        throw new Error('Invalid push product');
    if (!Number.isInteger(r.cityIndex) || r.cityIndex < 0 || !Number.isInteger(r.id) || r.id < 0)
        throw new Error('Invalid push registration id');
    if (r.location) {
        if (
            !Number.isFinite(r.location.lat) ||
            !Number.isFinite(r.location.long) ||
            Math.abs(r.location.lat) > 90 ||
            Math.abs(r.location.long) > 180
        )
            throw new Error('Invalid push location');
    } else if (!r.town || !r.town.first) throw new Error('Push location is required');
    ['pushTime', 'startTime', 'endTime'].forEach(function (k) {
        if (r[k] !== undefined && (!Number.isFinite(r[k]) || r[k] < 0 || r[k] >= 86400))
            throw new Error('Invalid push time');
    });
    if ((r.category || 'alarm') === 'alarm' && r.pushTime === undefined)
        throw new Error('Alarm time is required');
    if (r.category === 'alert' && (r.startTime === undefined || r.endTime === undefined))
        throw new Error('Alert window is required');
}
class Registry extends EventEmitter {
    constructor(options) {
        super();
        this.storage = options.storage;
        this.resolve = options.resolve;
        this.now = options.now || Date.now;
        this.devices = new Map();
        this.records = new Map();
        this.minute = new Map();
        this.zones = new Map();
        this.members = new Map();
        this.resolutionQueue = [];
        this.resolutionHead = 0;
        this.resolving = 0;
        this.resolutionCache = new Map();
        this.tokens = new Map();
        this.sequence = 0;
        this.tail = Promise.resolve();
        this.queued = 0;
        this.pending = new Set();
        this.retryAt = new Map();
        this.blocked = new Set();
        this.ready = false;
        this.mappingVersion = 1;
        this.maxQueue = options.maxQueue || 256;
    }
    async init() {
        var self = this,
            keys = await this.storage.list('registrations/');
        var docs = await mapLimit(keys, 16, function (k) {
            return self.storage.get(k);
        });
        docs.forEach(function (d) {
            if (!d || d.schemaVersion !== 2 || !d.key || !d.registrations || !d.endpoint)
                throw new Error('Invalid push object; restoration stopped');
            self.sequence = Math.max(self.sequence, d.acceptedSequence || 0);
            self.devices.set(d.key, d);
        });
        for (var d of docs) {
            if (!d.supersededBy) self.publish(d);
            if (self.records.size % 256 === 0) await new Promise(setImmediate);
        }
        await this.settled();
        if (this.retryAt.size)
            throw new Error('Push region restoration incomplete; restart after geocoder recovery');
        this.ready = true;
        return this;
    }
    command(fn) {
        if (!this.ready) return Promise.reject(new Error('Push coordinator is not ready'));
        if (this.queued >= this.maxQueue) return Promise.reject(new Error('Push registration queue is full'));
        var self = this,
            at = this.now();
        this.queued++;
        var job = this.tail.then(function () {
            if (self.now() - at > 7000) throw new Error('Push registration queue timed out');
            return fn();
        });
        this.tail = job
            .catch(function () {})
            .then(function () {
                self.queued--;
            });
        return job;
    }
    find(token, product) {
        var self = this;
        return Array.from(this.devices.values()).filter(function (d) {
            return (
                !d.supersededBy &&
                (!product || d.product === product) &&
                (tokenOf(d) === token || d.endpoint.registrationId === token)
            );
        });
    }
    async persist(docs) {
        var self = this;
        docs.forEach(function (d) {
            self.blocked.add(d.key);
        });
        try {
            for (var d of docs) {
                await this.storage.put(keyOf(d), d);
            }
            docs.forEach(function (d) {
                self.publish(d);
            });
        } catch (err) {
            // PUT timeouts may have committed. Reconcile before another command/send for each affected device.
            for (var candidate of docs) {
                try {
                    var actual = await this.storage.get(keyOf(candidate));
                    if (actual) this.publish(actual);
                } catch (readError) {
                    this.ready = false;
                    throw new Error('Push persistence uncertain; coordinator restart required');
                }
            }
            throw new Error('Push registration persistence failed');
        } finally {
            docs.forEach(function (d) {
                if (self.ready) self.blocked.delete(d.key);
            });
        }
    }
    async upsert(rows) {
        var self = this;
        if (!Array.isArray(rows) || rows.length > 256) return Promise.reject(new Error('Invalid push list'));
        rows.forEach(validate);
        return this.command(async function () {
            var changed = new Map();
            rows.forEach(function (input) {
                var r = copy(input),
                    product = r.package || 'todayWeather';
                r.category = r.category || 'alarm';
                var candidates = new Map(self.devices);
                changed.forEach(function (value, key) {
                    candidates.set(key, value);
                });
                var matches = Array.from(candidates.values()).filter(function (doc) {
                    return !doc.supersededBy && doc.product === product && tokenOf(doc) === r.fcmToken;
                });
                var id = r.uuid
                    ? hash([product, r.type, 'uuid', r.uuid])
                    : matches[0]
                      ? matches[0].key
                      : hash([product, r.type, 'token', r.fcmToken]);
                var alias = candidates.get(id),
                    visited = new Set();
                while (alias && alias.supersededBy) {
                    if (visited.has(id)) throw new Error('Invalid device alias');
                    visited.add(id);
                    id = alias.supersededBy;
                    alias = candidates.get(id);
                }
                var d = copy(
                    candidates.get(id) || {
                        schemaVersion: 2,
                        key: id,
                        product: product,
                        platform: r.type,
                        uuid: !!r.uuid,
                        revision: 0,
                        endpoint: { generation: 0 },
                        registrations: {}
                    }
                );
                // Full/partial POST also repairs token collisions when a previous PUT was missed.
                matches.forEach(function (other) {
                    if (other.key === id) return;
                    Object.keys(other.registrations).forEach(function (k) {
                        if (
                            !d.registrations[k] ||
                            other.registrations[k].acceptedSequence > d.registrations[k].acceptedSequence
                        )
                            d.registrations[k] = copy(other.registrations[k]);
                    });
                    if (
                        other.currentLocation &&
                        (!d.currentLocation ||
                            other.currentLocation.acceptedSequence > d.currentLocation.acceptedSequence)
                    )
                        d.currentLocation = copy(other.currentLocation);
                    d.endpoint.generation = Math.max(d.endpoint.generation, other.endpoint.generation) + 1;
                    var loser = copy(other);
                    loser.supersededBy = id;
                    changed.set(loser.key, loser);
                });
                d.revision++;
                d.acceptedSequence = ++self.sequence;
                d.updatedAt = new Date(self.now()).toISOString();
                if (d.endpoint.fcmToken !== r.fcmToken) d.endpoint.generation++;
                d.endpoint = Object.assign(d.endpoint, {
                    fcmToken: r.fcmToken,
                    registrationId: r.registrationId,
                    disabled: false,
                    acceptedSequence: self.sequence
                });
                r.acceptedSequence = self.sequence;
                r.enable = r.enable !== false;
                r.package = product;
                r.location = r.location || { town: r.town };
                if (r.cityIndex === 0) {
                    var loc = Object.assign({}, r.location, { town: r.town });
                    var before = d.currentLocation;
                    if (!before || JSON.stringify(before.value) !== JSON.stringify(loc))
                        d.currentLocation = {
                            version: before ? before.version + 1 : 1,
                            value: loc,
                            receivedAt: d.updatedAt,
                            acceptedSequence: self.sequence
                        };
                }
                d.registrations[groupKey(r)] = Object.assign({}, d.registrations[groupKey(r)], r);
                changed.set(id, d);
            });
            await self.persist(
                Array.from(changed.values()).sort(function (a, b) {
                    return Number(!!a.supersededBy) - Number(!!b.supersededBy);
                })
            );
            return rows.map(function () {
                return { n: 1, nModified: 1, ok: 1 };
            });
        });
    }
    rotate(oldToken, newToken, kind, product) {
        var self = this;
        kind = kind || 'fcmToken';
        if (!oldToken || !newToken || ['fcmToken', 'registrationId'].indexOf(kind) < 0)
            return Promise.reject(new Error('Invalid token update'));
        return this.command(async function () {
            var sources = self.find(oldToken, product),
                count = 0;
            for (var src of sources) {
                var other = self.find(newToken, src.product).find(function (d) {
                    return d.key !== src.key;
                });
                var winner = copy(src),
                    loser;
                if (other) {
                    var pair = [src, other].sort(function (a, b) {
                        return Number(b.uuid) - Number(a.uuid) || a.key.localeCompare(b.key);
                    });
                    winner = copy(pair[0]);
                    loser = copy(pair[1]);
                    Object.keys(loser.registrations).forEach(function (k) {
                        if (
                            !winner.registrations[k] ||
                            loser.registrations[k].acceptedSequence > winner.registrations[k].acceptedSequence
                        )
                            winner.registrations[k] = loser.registrations[k];
                    });
                    if (
                        loser.currentLocation &&
                        (!winner.currentLocation ||
                            loser.currentLocation.acceptedSequence > winner.currentLocation.acceptedSequence)
                    )
                        winner.currentLocation = loser.currentLocation;
                    loser.supersededBy = winner.key;
                }
                winner.endpoint[kind] = newToken;
                winner.endpoint.generation++;
                winner.endpoint.disabled = false;
                winner.revision++;
                winner.acceptedSequence = ++self.sequence;
                winner.endpoint.acceptedSequence = self.sequence;
                count += Object.keys(winner.registrations).length;
                await self.persist(loser ? [winner, loser] : [winner]);
            }
            return { n: count, nModified: count, ok: 1 };
        });
    }
    remove(selector) {
        var self = this;
        return this.command(async function () {
            var docs = self.find(selector.fcmToken || selector.registrationId, selector.package),
                n = 0;
            var changed = docs.map(function (old) {
                var d = copy(old);
                Object.keys(d.registrations).forEach(function (k) {
                    var r = d.registrations[k];
                    if (
                        (selector.category === undefined || r.category === selector.category) &&
                        (selector.cityIndex === undefined || r.cityIndex === selector.cityIndex) &&
                        (selector.id === undefined || r.id === selector.id)
                    ) {
                        delete d.registrations[k];
                        n++;
                    }
                });
                d.revision++;
                d.acceptedSequence = ++self.sequence;
                return d;
            });
            await self.persist(changed);
            return { n: n, ok: 1 };
        });
    }
    clearDevice(id) {
        var self = this;
        var refs = this.members.get(id) || [];
        refs.forEach(function (ref) {
            var r = self.records.get(ref);
            if (r) {
                if (self.minute.has(Math.floor(r.pushTime / 60)))
                    self.minute.get(Math.floor(r.pushTime / 60)).delete(ref);
                (r.zoneIds || []).forEach(function (z) {
                    if (self.zones.has(z)) self.zones.get(z).delete(ref);
                });
                self.records.delete(ref);
            }
        });
        this.members.set(id, []);
        this.tokens.forEach(function (value, k) {
            if (value === id) self.tokens.delete(k);
        });
    }
    publish(d) {
        this.clearDevice(d.key);
        this.devices.set(d.key, d);
        if (d.supersededBy) return;
        this.tokens.set(hash([d.product, tokenOf(d)]), d.key);
        var self = this,
            groups = new Map();
        Object.keys(d.registrations).forEach(function (k) {
            var raw = d.registrations[k],
                loc = raw.cityIndex === 0 && d.currentLocation ? d.currentLocation.value : raw.location;
            var ref = refOf(d, k),
                r = Object.assign({}, raw, {
                    ref: ref,
                    deviceKey: d.key,
                    fcmToken: d.endpoint.fcmToken,
                    generation: d.endpoint.generation,
                    location: loc,
                    locationVersion:
                        raw.cityIndex === 0 && d.currentLocation
                            ? d.currentLocation.version
                            : raw.acceptedSequence,
                    deviceRevision: d.revision,
                    zoneIds: [],
                    resolved: false
                });
            self.records.set(ref, r);
            self.members.get(d.key).push(ref);
            if (r.category === 'alarm') {
                var m = Math.floor(r.pushTime / 60);
                if (!self.minute.has(m)) self.minute.set(m, new Set());
                self.minute.get(m).add(ref);
            }
            var g = JSON.stringify(loc);
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(r);
        });
        groups.forEach(function (records) {
            var captured = records.map(function (r) {
                    return r.ref;
                }),
                revision = d.revision,
                mapping = self.mappingVersion;
            var work = Promise.resolve()
                .then(function () {
                    return self.resolveBounded(records[0].location, records[0]);
                })
                .then(function (result) {
                    if (
                        self.devices.get(d.key) !== d ||
                        d.supersededBy ||
                        d.revision !== revision ||
                        mapping !== self.mappingVersion
                    )
                        return;
                    captured.forEach(function (ref) {
                        var r = self.records.get(ref);
                        if (!r || r.deviceRevision !== revision) return;
                        r.resolved = true;
                        r.country = result.country;
                        r.weatherKey = result.weatherKey;
                        r.zoneIds = result.zones || [];
                        r.town = result.town || r.location.town || r.town;
                        if (r.location.lat !== undefined) r.geo = [r.location.long, r.location.lat];
                        if (r.category === 'alert' && r.enable)
                            r.zoneIds.forEach(function (z) {
                                if (!self.zones.has(z)) self.zones.set(z, new Set());
                                self.zones.get(z).add(ref);
                            });
                    });
                    self.emit('change', d.key);
                })
                .catch(function () {
                    self.retryAt.set(d.key, self.now() + 30000);
                    self.emit('resolutionError', d.key);
                })
                .then(function () {
                    self.pending.delete(work);
                });
            self.pending.add(work);
        });
        this.emit('change', d.key);
    }
    resolveBounded(location, record) {
        var self = this,
            key = JSON.stringify([this.mappingVersion, location, record.source, record.town]),
            entry = this.resolutionCache.get(key);
        if (entry && entry.until > this.now()) return entry.promise;
        entry = { until: this.now() + 3600000 };
        entry.promise = new Promise(function (resolve, reject) {
            self.resolutionQueue.push({
                location: location,
                record: record,
                resolve: resolve,
                reject: reject
            });
            self.pumpResolutions();
        });
        this.resolutionCache.set(key, entry);
        entry.promise.catch(function () {
            self.resolutionCache.delete(key);
        });
        if (this.resolutionCache.size > 10000)
            this.resolutionCache.delete(this.resolutionCache.keys().next().value);
        return entry.promise;
    }
    pumpResolutions() {
        var self = this;
        while (this.resolving < 8 && this.resolutionHead < this.resolutionQueue.length) {
            var item = this.resolutionQueue[this.resolutionHead++];
            this.resolving++;
            (function (work) {
                Promise.resolve()
                    .then(function () {
                        return self.resolve(work.location, work.record);
                    })
                    .then(work.resolve, work.reject)
                    .then(function () {
                        self.resolving--;
                        self.pumpResolutions();
                    });
            })(item);
        }
        if (this.resolutionHead === this.resolutionQueue.length) {
            this.resolutionQueue = [];
            this.resolutionHead = 0;
        }
    }
    retryResolutions() {
        var self = this;
        this.retryAt.forEach(function (at, key) {
            if (at <= self.now()) {
                self.retryAt.delete(key);
                var d = self.devices.get(key);
                if (d && !d.supersededBy) self.publish(d);
            }
        });
    }
    async settled() {
        while (this.pending.size) await Promise.all(Array.from(this.pending));
    }
    get(ref) {
        var r = this.records.get(ref);
        if (!r || !this.ready || this.blocked.has(r.deviceKey)) return null;
        var d = this.devices.get(r.deviceKey);
        return d && !d.supersededBy && !d.endpoint.disabled && r.enable && r.resolved ? r : null;
    }
    alarmRefs(date) {
        var self = this;
        return Array.from(this.minute.get(Math.floor(clock(date) / 60)) || []).filter(function (ref) {
            var r = self.get(ref);
            if (!r) return false;
            var day = new Date(date.getTime() + (r.timezoneOffset || 0) * 60000).getUTCDay();
            return !r.dayOfWeek || r.dayOfWeek[day];
        });
    }
    warningRefs(zoneIds, date) {
        var self = this,
            refs = new Set();
        zoneIds.forEach(function (z) {
            (self.zones.get(z) || []).forEach(function (ref) {
                var r = self.get(ref);
                if (r && r.category === 'alert' && (!date || inside(r, date))) refs.add(ref);
            });
        });
        return Array.from(refs);
    }
}
module.exports = {
    validate: validate,
    Registry: Registry,
    hash: hash,
    inside: inside,
    keyOf: keyOf,
    copy: copy
};
