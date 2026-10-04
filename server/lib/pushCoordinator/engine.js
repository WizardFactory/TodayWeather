'use strict';
var hash = require('./registry').hash,
    inside = require('./registry').inside;
var zones = require('../kmaWarningZones');
var mapLimit = require('./storage').mapLimit;
var safeReason = require('./errors').safeReason;
function yieldTurn() {
    return new Promise(function (resolve) {
        setImmediate(resolve);
    });
}
// Readback summary of a campaign: counts only, derived from the persisted job fields.
function summarize(jobs) {
    var summary = { jobs: jobs.length, status: {}, failures: {}, preparationAttempts: 0, transportAttempts: 0 };
    jobs.forEach(function (j) {
        summary.status[j.status] = (summary.status[j.status] || 0) + 1;
        summary.preparationAttempts += j.preparationAttempts || 0;
        summary.transportAttempts += j.attempts || 0;
        if (j.reason) {
            var key = (j.stage || 'dispatch') + ':' + j.reason;
            summary.failures[key] = (summary.failures[key] || 0) + 1;
        }
    });
    return summary;
}
// Keep only safe outcome fields from a dispatcher result; never the error object, payload or record.
function recordResult(job, result) {
    job.status = result.status === 'superseded' ? 'pending' : result.status;
    job.preparationAttempts = Number(result.preparationAttempts) || 0;
    job.preparationFailures = Number(result.preparationFailures) || 0;
    job.attempts = (job.attempts || 0) + (Number(result.attempts) || 0);
    if (result.status === 'superseded' || result.status === 'accepted') {
        delete job.stage;
        delete job.reason;
    } else {
        if (result.stage === 'preparation' || result.stage === 'transport') job.stage = result.stage;
        else delete job.stage;
        if (result.error !== undefined) job.reason = safeReason(result.error);
        else delete job.reason;
    }
}
function stateDate(state) {
    var s = JSON.parse(JSON.stringify(state || {}));
    ['airAlerts', 'precipAlerts'].forEach(function (k) {
        if (s[k] && s[k].pushTime) s[k].pushTime = new Date(s[k].pushTime);
    });
    return s;
}
class Engine {
    constructor(o) {
        this.registry = o.registry;
        this.storage = o.storage;
        this.dispatcher = o.dispatcher;
        this.runtime = o.runtime;
        this.feed = o.feed;
        this.warnings = !!o.warnings;
        this.now = o.now || Date.now;
        this.campaigns = new Map();
        this.seen = new Set();
        this.activeZones = {};
        this.state = {};
        this.stateDirty = new Set();
        this.flushing = null;
        this.ticking = false;
        this.polling = false;
        this.running = false;
        this.lastMinute = null;
        var self = this;
        this.registry.on('change', function () {
            self.changed = true;
        });
    }
    async init() {
        var self = this;
        await mapLimit(await this.storage.list('delivery-state/'), 8, async function (key) {
            var data = await self.storage.get(key);
            if (data) Object.assign(self.state, data);
        });
        var keys = (await this.storage.list('campaigns/')).filter(function (k) {
            return /\/manifest.json$/.test(k);
        });
        await mapLimit(keys, 8, async function (key) {
            var c = await self.storage.get(key);
            if (!c || c.schemaVersion !== 1) throw new Error('Invalid push campaign');
            if (c.deadline <= self.now()) return;
            c.jobs = [];
            c.inflight = new Set();
            c.dirty = false;
            for (var i = 0; i < c.parts; i++) {
                var part = await self.storage.get(c.path + '/parts/' + i + '.json');
                if (!part) throw new Error('Incomplete push campaign');
                part.forEach(function (j) {
                    if (j.status === 'sending') j.status = 'pending';
                    c.jobs.push(j);
                });
            }
            self.campaigns.set(c.id, c);
        });
        // Read releases before re-admitting recovered warning jobs.
        if (this.warnings && this.feed) await this.pollWarnings();
    }
    async create(id, kind, refs, event, observed) {
        if (this.campaigns.has(id)) {
            var existing = this.campaigns.get(id);
            if (kind === 'warning') {
                existing.event.zones = Array.from(new Set(existing.event.zones.concat(event.zones)));
                existing.dirty = true;
                this.changed = true;
            }
            return existing;
        }
        var path = 'campaigns/' + new Date(this.now()).toISOString().slice(0, 10) + '/' + id;
        var prior = await this.storage.get(path + '/manifest.json');
        if (prior) return null;
        var c = {
            schemaVersion: 1,
            id: id,
            path: path,
            kind: kind,
            event: event || null,
            createdAt: observed || this.now(),
            deadline: (observed || this.now()) + 300000,
            parts: 0,
            jobs: [],
            inflight: new Set(),
            dirty: true
        };
        var endpoints = new Set(),
            self = this;
        for (var i = 0; i < refs.length; i++) {
            var r = this.registry.get(refs[i]);
            if (!r) continue;
            var key = hash([r.package, r.fcmToken]);
            if (kind === 'warning' && endpoints.has(key)) continue;
            endpoints.add(key);
            c.jobs.push({ ref: r.ref, deviceKey: r.deviceKey, endpoint: key, status: 'pending' });
            if (i % 256 === 255) await yieldTurn();
        }
        if (!c.jobs.length && kind !== 'warning') return null;
        c.parts = Math.ceil(c.jobs.length / 512);
        // Parts precede manifest; no manifest means no sends after an interrupted initial write.
        await this.writeCampaign(c);
        this.campaigns.set(id, c);
        return c;
    }
    async writeCampaign(c) {
        var jobs = c.jobs.map(function (j) {
            return Object.assign({}, j);
        });
        var parts = Math.ceil(jobs.length / 512);
        await mapLimit(
            Array.from({ length: parts }, function (_, i) {
                return i;
            }),
            4,
            async (i) => {
                await this.storage.put(c.path + '/parts/' + i + '.json', jobs.slice(i * 512, (i + 1) * 512));
            }
        );
        await this.storage.put(c.path + '/manifest.json', {
            schemaVersion: 1,
            id: c.id,
            path: c.path,
            kind: c.kind,
            event: c.event,
            createdAt: c.createdAt,
            deadline: c.deadline,
            parts: parts,
            summary: summarize(jobs)
        });
    }
    partition(ref) {
        return hash(ref).slice(0, 2);
    }
    setState(ref, value) {
        this.state[ref] = value;
        this.stateDirty.add(this.partition(ref));
    }
    async flush() {
        if (this.flushing) return this.flushing;
        var self = this;
        this.flushing = (async function () {
            for (var c of self.campaigns.values()) {
                if (c.dirty) {
                    c.dirty = false;
                    try {
                        await self.writeCampaign(c);
                        if (c.deadline <= self.now() && !c.inflight.size) self.campaigns.delete(c.id);
                    } catch (e) {
                        c.dirty = true;
                        throw e;
                    }
                }
            }
            var parts = Array.from(self.stateDirty);
            self.stateDirty.clear();
            try {
                await mapLimit(parts, 4, async function (part) {
                    var data = {};
                    Object.keys(self.state).forEach(function (ref) {
                        if (self.partition(ref) === part) data[ref] = self.state[ref];
                    });
                    await self.storage.put('delivery-state/' + part + '.json', data);
                });
            } catch (e) {
                parts.forEach(function (p) {
                    self.stateDirty.add(p);
                });
                throw e;
            }
        })().then(
            function () {
                self.flushing = null;
            },
            function (e) {
                self.flushing = null;
                throw e;
            }
        );
        return this.flushing;
    }
    eligible(c, r) {
        if (!r) return false;
        var state = this.state[r.ref];
        if (state && state.disabled && state.generation === r.generation) return false;
        if (c.kind === 'warning') {
            var end = require('./warningFeed').publishedAt(c.event.endTime || c.event.allEndTime);
            if (Number.isFinite(end) && this.now() >= end) return false;
            if (r.category !== 'alert' || !inside(r, new Date(this.now()))) return false;
            return (c.event.zones || [c.event.areaCode]).some((z) => {
                var active = this.activeZones[z + '|' + c.event.warnVar];
                return (
                    r.zoneIds.indexOf(z) >= 0 &&
                    active &&
                    active.active &&
                    active.eventTmFc === c.event.tmFc &&
                    active.eventTmSeq === c.event.tmSeq &&
                    active.warnStress === c.event.warnStress
                );
            });
        }
        if (c.kind === 'alarm') {
            if (r.category !== 'alarm') return false;
            var slot = new Date(c.createdAt),
                minute = slot.getUTCHours() * 60 + slot.getUTCMinutes();
            var day = new Date(c.createdAt + (r.timezoneOffset || 0) * 60000).getUTCDay();
            return Math.floor(r.pushTime / 60) === minute && (!r.dayOfWeek || r.dayOfWeek[day]);
        }
        return r.category === 'alert' && inside(r, new Date(this.now()));
    }
    async prepare(c, j, r) {
        if (c.kind === 'alarm')
            return {
                notification: await this.runtime.alarm(r, { deadline: c.deadline }),
                record: r,
                eventId: c.id
            };
        if (c.kind === 'warning')
            return { notification: this.runtime.warning(c.event, r), record: r, eventId: c.id };
        var current = this.state[r.ref];
        if (current && current.generation !== r.generation) current = null;
        // Preserve the legacy store's coupled prefilter; severe warnings do not use it.
        var six = this.now() - 21600000;
        if (
            current &&
            ['airAlerts', 'precipAlerts'].some(function (k) {
                return current[k] && new Date(current[k].pushTime).getTime() >= six;
            })
        )
            return null;
        var result = await this.runtime.conditional(r, stateDate(current), new Date(this.now()), {
            deadline: c.deadline
        });
        j.nextState = Object.assign(result.state, { generation: r.generation });
        if (!result.notification) {
            var fresh = this.registry.get(r.ref);
            if (fresh && fresh.deviceRevision === r.deviceRevision && fresh.generation === r.generation)
                this.setState(r.ref, j.nextState);
            return null;
        }
        return { notification: result.notification, record: r, eventId: c.id };
    }
    async admit(c) {
        if (c.deadline <= this.now()) return;
        var self = this,
            replacements,
            admitted = new Set(
                c.jobs
                    .filter(function (j) {
                        return j.status === 'accepted' || j.status === 'sending';
                    })
                    .map(function (j) {
                        return j.endpoint;
                    })
            );
        for (var i = 0; i < c.jobs.length; i++) {
            var j = c.jobs[i];
            if (j.status !== 'pending' || c.inflight.has(i)) continue;
            var r = this.registry.get(j.ref);
            if (!this.eligible(c, r) && c.kind === 'warning') {
                if (!replacements) {
                    replacements = new Map();
                    this.registry.warningRefs(c.event.zones, new Date(this.now())).forEach(function (ref) {
                        var candidate = self.registry.get(ref);
                        if (self.eligible(c, candidate))
                            replacements.set(hash([candidate.package, candidate.fcmToken]), candidate);
                    });
                }
                r = replacements.get(j.endpoint);
                if (r) j.ref = r.ref;
            }
            if (!this.eligible(c, r)) {
                continue;
            }
            if (c.kind === 'warning') {
                var endpoint = hash([r.package, r.fcmToken]);
                if (admitted.has(endpoint)) {
                    j.status = 'deduplicated';
                    c.dirty = true;
                    continue;
                }
                j.endpoint = endpoint;
                j.deviceKey = r.deviceKey;
                admitted.add(endpoint);
            }
            if (!this.dispatcher.canEnqueue(c.kind === 'warning' ? 'warning' : 'normal')) break;
            c.inflight.add(i);
            j.status = 'sending';
            c.dirty = true;
            (function (index, job, record) {
                var revision = record.deviceRevision;
                self.dispatcher
                    .enqueue({
                        project: record.package,
                        priority: c.kind === 'warning' ? 'warning' : 'normal',
                        deadline: c.deadline,
                        preparationAttempts: job.preparationAttempts || 0,
                        preparationFailures: job.preparationFailures || 0,
                        onPreparationFailure: function (n) {
                            job.preparationFailures = n;
                            c.dirty = true;
                        },
                        // Checkpoints must keep the count of an unfinished job so restarts cannot reset the bound.
                        onPreparation: function (n) {
                            job.preparationAttempts = n;
                            c.dirty = true;
                        },
                        ref: record.ref,
                        generation: record.generation,
                        guard: function () {
                            var fresh = self.registry.get(job.ref);
                            return fresh && fresh.deviceRevision === revision && self.eligible(c, fresh);
                        },
                        prepare: async function () {
                            var payload = await self.prepare(c, job, record);
                            if (payload && self.runtime.authorize) {
                                payload.authorization = await self.runtime.authorize(record.package);
                                payload.urgent = c.kind === 'warning';
                            }
                            return payload;
                        }
                    })
                    .then(
                        function (result) {
                            recordResult(job, result);
                            var fresh = self.registry.get(record.ref);
                            if (
                                result.status === 'accepted' &&
                                job.nextState &&
                                fresh &&
                                fresh.deviceRevision === revision &&
                                fresh.generation === record.generation
                            )
                                self.setState(record.ref, job.nextState);
                            if (
                                result.status === 'invalid' &&
                                fresh &&
                                fresh.generation === record.generation
                            ) {
                                (self.registry.members.get(record.deviceKey) || []).forEach(function (ref) {
                                    self.setState(ref, { disabled: true, generation: record.generation });
                                });
                            }
                            delete job.nextState;
                            c.inflight.delete(index);
                            c.dirty = true;
                        },
                        function () {
                            job.status = 'pending';
                            c.inflight.delete(index);
                            c.dirty = true;
                        }
                    );
            })(i, j, r);
            if (i % 256 === 255) await yieldTurn();
        }
    }
    async pollWarnings() {
        if (!this.warnings || !this.feed || this.polling) return;
        this.polling = true;
        try {
            var items = (await this.feed.read()).filter(Boolean).sort(function (a, b) {
                return (
                    a.event.tmFc - b.event.tmFc ||
                    a.event.tmSeq - b.event.tmSeq ||
                    a.event.rank - b.event.rank
                );
            });
            var retained = new Set(
                items.map(function (item) {
                    return item.id;
                })
            );
            this.seen = new Set(
                Array.from(this.seen).filter(function (id) {
                    return retained.has(id);
                })
            );
            var groups = new Map();
            for (var item of items) {
                if (this.seen.has(item.id)) continue;
                zones.applyEvents(this.activeZones, [item.event]);
                var e = item.event;
                if (
                    ['1', '3', '6', '7'].indexOf(e.command) >= 0 &&
                    item.notify === true &&
                    this.now() - item.observedAt < 300000 &&
                    this.now() - item.sourceAt < 300000
                ) {
                    var key = hash([e.tmFc, e.tmSeq, e.warnVar, e.warnStress, e.command, e.endTime]);
                    if (!groups.has(key))
                        groups.set(key, {
                            id: key,
                            event: Object.assign({}, e, { zones: [] }),
                            at: item.observedAt,
                            ids: []
                        });
                    groups.get(key).event.zones.push(e.areaCode);
                    groups.get(key).ids.push(item.id);
                } else this.seen.add(item.id);
            }
            for (var group of groups.values()) {
                var refs = this.registry.warningRefs(group.event.zones, new Date(this.now()));
                await this.create(group.id, 'warning', refs, group.event, group.at);
                group.ids.forEach((id) => this.seen.add(id));
            }
        } finally {
            this.polling = false;
        }
    }
    async tick() {
        if (this.ticking || !this.registry.ready) return;
        this.ticking = true;
        try {
            this.registry.retryResolutions();
            var now = this.now(),
                minute = Math.floor(now / 60000),
                date = new Date(now);
            if (this.lastMinute !== minute) {
                var start = this.lastMinute === null ? minute : Math.max(minute - 4, this.lastMinute + 1);
                for (var m = start; m <= minute; m++) {
                    await this.create(
                        hash(['alarm', m]),
                        'alarm',
                        this.registry.alarmRefs(new Date(m * 60000)),
                        null,
                        m * 60000
                    );
                    if ([7, 17, 35, 50].indexOf(new Date(m * 60000).getUTCMinutes()) >= 0) {
                        var refs = Array.from(this.registry.records.values())
                            .filter((r) => r.category === 'alert' && inside(r, new Date(m * 60000)))
                            .map(function (r) {
                                return r.ref;
                            });
                        await this.create(hash(['conditional', m]), 'conditional', refs, null, m * 60000);
                    }
                }
                this.lastMinute = minute;
            }
            // Changes while an active warning is open can add newly eligible endpoints once.
            if (this.changed) {
                this.changed = false;
                for (var c of this.campaigns.values()) {
                    if (c.kind !== 'warning' || c.deadline <= now) continue;
                    var known = new Set(
                            c.jobs.map(function (j) {
                                return j.endpoint;
                            })
                        ),
                        devices = new Set(
                            c.jobs.map(function (j) {
                                return j.deviceKey || j.ref.split('/')[0];
                            })
                        );
                    for (var ref of this.registry.warningRefs(c.event.zones, new Date(now))) {
                        var r = this.registry.get(ref),
                            endpoint = hash([r.package, r.fcmToken]);
                        if (!known.has(endpoint) && !devices.has(r.deviceKey)) {
                            c.jobs.push({
                                ref: ref,
                                deviceKey: r.deviceKey,
                                endpoint: endpoint,
                                status: 'pending'
                            });
                            known.add(endpoint);
                            devices.add(r.deviceKey);
                            c.dirty = true;
                        }
                    }
                }
            }
            var ordered = Array.from(this.campaigns.values()).sort(function (a, b) {
                return Number(b.kind === 'warning') - Number(a.kind === 'warning');
            });
            for (var campaign of ordered) {
                if (campaign.deadline <= now) {
                    campaign.jobs.forEach(function (j) {
                        if (j.status === 'pending') j.status = 'expired';
                    });
                    campaign.dirty = true;
                    continue;
                }
                await this.admit(campaign);
            }
        } finally {
            this.ticking = false;
        }
    }
    start() {
        var self = this;
        this.running = true;
        this.timers = [
            setInterval(function () {
                self.tick().catch(function () {
                    self.report('tick-failed');
                });
            }, 100),
            setInterval(function () {
                self.pollWarnings().catch(function () {
                    self.report('warning-feed-failed');
                });
            }, 5000),
            setInterval(function () {
                self.flush().catch(function () {
                    self.report('checkpoint-failed');
                });
            }, 5000)
        ];
    }
    report(event) {
        console.warn(JSON.stringify({ component: 'push-coordinator', event: event }));
    }
    async stop() {
        (this.timers || []).forEach(clearInterval);
        this.dispatcher.close();
        if (this.runtime.close) this.runtime.close();
        await this.flush();
    }
}
module.exports = { Engine: Engine };
