'use strict';
var errors = require('./errors'),
    PreparationError = errors.PreparationError,
    safeReason = errors.safeReason;
// Bounded async admission. Registration processing never runs on this queue.
class Queue {
    constructor() {
        this.items = [];
        this.head = 0;
        this.offset = 0;
        this.size = 0;
    }
    get length() {
        return this.size;
    }
    push(x) {
        x.queue = this;
        x.queueIndex = this.offset + this.items.length;
        this.items.push(x);
        this.size++;
    }
    // Remove terminal unsent work without moving live FIFO entries or scanning the queue.
    remove(x) {
        var index = x.queueIndex - this.offset;
        if (x.queue !== this || this.items[index] !== x) return;
        this.items[index] = undefined;
        this.size--;
        delete x.queue;
        delete x.queueIndex;
    }
    shift() {
        while (this.head < this.items.length && !this.items[this.head]) this.head++;
        var x = this.items[this.head];
        if (x) { this.remove(x); this.head++; }
        if (this.head > 1024 && this.head * 2 > this.items.length) {
            this.items = this.items.slice(this.head);
            this.offset += this.head;
            this.head = 0;
        }
        return x;
    }
}
class Dispatcher {
    constructor(o) {
        o = o || {};
        this.send = o.send;
        this.concurrency = o.concurrency || 128;
        this.rate = o.rate || 1000;
        this.maxQueue = o.maxQueue || 250000;
        this.retryFloor = o.retryFloorMs === undefined ? 10000 : o.retryFloorMs;
        this.timeout = o.timeoutMs || 20000;
        this.recoveryMs = o.recoveryMs === undefined ? 30000 : o.recoveryMs;
        this.recoveryProbes = o.recoveryProbes || 2;
        // Preparation (weather) retries are counted apart from transport attempts and stop at the deadline.
        this.prepareAttempts =
            Number.isInteger(o.prepareAttempts) && o.prepareAttempts >= 1 ? o.prepareAttempts : 4;
        this.prepareRetry = o.prepareRetryMs === undefined ? 1000 : o.prepareRetryMs;
        this.now = o.now || Date.now;
        this.onInvalid = o.onInvalid || function () {};
        this.queues = { warning: new Queue(), normal: new Queue() };
        this.active = { warning: 0, normal: 0 };
        this.items = new Set();
        this.cleanupIterator = this.items.values();
        this.warningItems = new Set();
        this.projects = new Map();
        this.inflight = 0;
        this.total = 0;
        this.stopped = false;
        this.timers = new Set();
        this.scheduled = false;
        this.laneTurn = 0;
        this.metrics = { accepted: 0, expired: 0, superseded: 0, failed: 0, retries: 0, peak: 0 };
    }
    enqueue(job) {
        var self = this;
        if (this.stopped || !this.canEnqueue(job.priority))
            return Promise.reject(new Error('Push dispatch queue unavailable'));
        this.total++;
        return new Promise(function (resolve) {
            var item = {
                job: job,
                resolve: resolve,
                attempt: 0,
                preparations: job.preparationAttempts || 0,
                prepFailures: job.preparationFailures || 0,
                done: false
            };
            self.items.add(item);
            if (job.priority === 'warning') self.warningItems.add(item);
            self.queues[job.priority === 'warning' ? 'warning' : 'normal'].push(item);
            self.schedule();
        });
    }
    canEnqueue(priority) {
        return (
            this.total <
            (priority === 'warning' ? this.maxQueue : Math.max(1, Math.floor(this.maxQueue * 0.8)))
        );
    }
    later(fn, ms) {
        var self = this,
            t = setTimeout(function () {
                self.timers.delete(t);
                fn();
            }, ms);
        this.timers.add(t);
        return t;
    }
    schedule() {
        if (this.scheduled || this.stopped) return;
        var self = this;
        this.scheduled = true;
        this.later(function () {
            self.scheduled = false;
            self.pump();
        }, 5);
    }
    budget(project, lane) {
        var now = this.now(),
            b = this.projects.get(project);
        var cap = Math.max(1, this.rate / 10);
        if (!b) {
            b = {
                tokens: cap,
                normal: Math.max(1, cap * 0.2),
                warning: Math.max(1, cap * 0.8),
                time: now,
                paused: false,
                pauseReason: null,
                recoverAt: 0,
                ambiguous: 0,
                probes: 0,
                probing: false,
                proven: false,
                epoch: 0,
                cooldownUntil: 0
            };
            this.projects.set(project, b);
        }
        var refill = (Math.max(0, now - b.time) * this.rate) / 1000;
        b.tokens = Math.min(cap, b.tokens + refill);
        b.normal = Math.min(Math.max(1, cap * 0.2), b.normal + refill * 0.2);
        b.warning = Math.min(Math.max(1, cap * 0.8), b.warning + refill * 0.8);
        b.time = now;
        if (b.paused) {
            if (b.pauseReason === 'authentication' || (b.ambiguous && b.probes >= this.recoveryProbes && !b.probing))
                return 'paused';
            if (b.probing || now < b.recoverAt) return false;
        }
        if (now < b.cooldownUntil || b.tokens < 1) return false;
        var source = lane;
        // Warnings never borrow the normal reservation. Normal traffic can use spare
        // warning capacity only when no urgent work is queued or being prepared/sent.
        if (lane === 'normal' && b.normal < 1 && !this.queues.warning.length && !this.active.warning)
            source = 'warning';
        if (b[source] < 1) return false;
        // Inspect warnings only when cooldown and tokens permit this admission.
        if (b.paused && lane === 'normal' && this.recoveryWarning(project, b)) return false;
        b[source]--;
        b.tokens--;
        if (b.paused) {
            b.probing = true;
            b.probes++;
            this.metrics.recoveryProbes = (this.metrics.recoveryProbes || 0) + 1;
            return 'probe';
        }
        return true;
    }
    recoveryWarning(project, budget) {
        if (budget.warning < 1 || this.active.warning >= Math.max(1, Math.floor(this.concurrency * 0.8)))
            return false;
        var now = this.now();
        for (var item of this.warningItems) {
            var job = item.job;
            if (item.done || item.sending || item.waiting || (job.prepare && !item.prepared)) continue;
            if ((item.project || job.project || 'default') !== project) continue;
            if (job.deadline !== undefined && now >= job.deadline) continue;
            if (job.guard && !job.guard()) continue;
            return true;
        }
        return false;
    }
    // Pause admission, never release or replay an ambiguous physical request.
    ambiguous(item, reason) {
        var b = this.projects.get(item.project);
        // The watchdog already fenced this physical request. A later abort cannot
        // erase proof from a newer successful probe or restart the recovery gate.
        if (item.ambiguous) return;
        if (!item.ambiguous) {
            item.ambiguous = true;
            b.ambiguous++;
            b.epoch++;
        }
        if (b.probing === item) b.probing = false;
        if (b.pauseReason !== 'authentication') {
            b.paused = true;
            b.pauseReason = reason;
            b.proven = false;
            b.recoverAt = Math.max(b.recoverAt, this.now() + this.recoveryMs);
        }
        this.finish(item, 'failed', reason, 'transport');
    }
    // Observe even late outcomes for project safety, but never change the original job's result.
    settled(item, error) {
        var b = this.projects.get(item.project),
            status = error && (error.statusCode || error.status),
            code = error && (error.code || (error.errorInfo && error.errorInfo.code));
        if (item.ambiguous) {
            b.ambiguous--;
            item.ambiguous = false;
            if (!b.ambiguous) b.probes = 0;
        }
        if (b.probing === item) {
            b.probing = false;
            b.recoverAt = Math.max(b.recoverAt, this.now() + this.recoveryMs);
        }
        if (status === 429) {
            var after = Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0 ? error.retryAfterMs : 60000;
            b.cooldownUntil = Math.max(b.cooldownUntil, this.now() + Math.max(this.retryFloor, after));
        }
        if (status === 401 || status === 403 || code === 'messaging/authentication-error') {
            b.paused = true;
            b.pauseReason = 'authentication';
        } else if (item.probe && !error && item.probeEpoch === b.epoch) b.proven = true;
        if (b.paused && b.pauseReason !== 'authentication' && b.proven && !b.ambiguous && !b.probing) {
            b.paused = false;
            b.pauseReason = null;
            b.probes = 0;
            this.metrics.recoveries = (this.metrics.recoveries || 0) + 1;
        }
    }
    health() {
        var self = this, result = { ready: !this.stopped, readyProjects: 0, paused: 0, recovering: 0,
            cooldown: 0, unresolved: 0, reasons: {}, nextRecoveryMs: null };
        this.projects.forEach(function (b) {
            result.unresolved += b.ambiguous;
            if (self.now() < b.cooldownUntil) { result.cooldown++; result.ready = false; }
            if (!b.paused) { result.readyProjects++; return; }
            result.ready = false;
            var exhausted = b.ambiguous && b.probes >= self.recoveryProbes && !b.probing;
            var reason = b.pauseReason === 'authentication' ? 'authentication' : exhausted ? 'recovery-exhausted' : b.pauseReason;
            result.reasons[reason] = (result.reasons[reason] || 0) + 1;
            if (b.probing) result.recovering++;
            else result.paused++;
            if (reason !== 'authentication' && !exhausted && !b.probing) {
                var delay = Math.max(0, Math.max(b.recoverAt, b.cooldownUntil) - self.now());
                result.nextRecoveryMs = result.nextRecoveryMs === null ? delay : Math.min(result.nextRecoveryMs, delay);
            }
        });
        return result;
    }
    finish(item, status, error, stage) {
        if (item.done) return;
        item.done = true;
        if (item.queue) item.queue.remove(item);
        this.items.delete(item);
        this.warningItems.delete(item);
        this.total--;
        this.metrics[status] = (this.metrics[status] || 0) + 1;
        // Results are persisted by the engine: only a short identifier is kept, never error text.
        item.resolve({
            status: status,
            error: error === undefined ? undefined : safeReason(error),
            stage: stage,
            attempts: item.attempt,
            preparationAttempts: item.preparations,
            preparationFailures: item.prepFailures
        });
    }
    // A retryable typed weather failure is retried with bounded backoff before any FCM submission.
    // The retry re-enters the queue, so the registration guard and deadline are checked again.
    prepareFailed(item, lane, e) {
        var self = this,
            job = item.job,
            typed = e instanceof PreparationError,
            reason = typed ? e.code : 'preparation-error';
        // The bound counts failed preparations only: an explicit FCM retry prepares again without using it.
        item.prepFailures++;
        // The item now waits for a preparation retry; expiry in the queue is a preparation expiry.
        item.waiting = { reason: reason, stage: 'preparation' };
        if (job.onPreparationFailure) job.onPreparationFailure(item.prepFailures);
        if (!typed || !e.retryable || item.prepFailures >= this.prepareAttempts)
            return this.finish(item, 'failed', reason, 'preparation');
        var delay =
            Math.min(30000, this.prepareRetry * Math.pow(2, Math.max(0, item.prepFailures - 1))) +
            Math.floor(Math.random() * Math.min(1000, this.prepareRetry));
        if (job.deadline !== undefined && this.now() + delay >= job.deadline)
            return this.finish(item, 'expired', reason, 'preparation');
        this.metrics.prepareRetries = (this.metrics.prepareRetries || 0) + 1;
        this.later(function () {
            if (self.stopped) self.finish(item, 'failed', 'stopped');
            else {
                self.queues[lane].push(item);
                self.schedule();
            }
        }, delay);
    }
    // Queue terminal checks must not wait for a send slot. Cycle through at most
    // 1024 live items per pump, including entries behind an eligible FIFO head.
    cleanupQueued() {
        var limit = Math.min(this.items.size, 1024);
        for (var i = 0; i < limit; i++) {
            var next = this.cleanupIterator.next();
            if (next.done) {
                this.cleanupIterator = this.items.values();
                next = this.cleanupIterator.next();
            }
            if (next.done) break;
            var item = next.value, job = item.job;
            // In-progress preparation, retry timers and submitted requests have their own lifecycle.
            if (!item.queue || item.done) continue;
            if (job.deadline !== undefined && this.now() >= job.deadline) {
                if (item.waiting) this.finish(item, 'expired', item.waiting.reason, item.waiting.stage);
                else this.finish(item, 'expired');
            } else if (job.guard) {
                try {
                    if (!job.guard()) this.finish(item, 'superseded');
                } catch (e) {
                    // Match the existing run() preparation-error outcome without allocating a slot.
                    item.queue.remove(item);
                    this.prepareFailed(item, job.priority === 'warning' ? 'warning' : 'normal', e);
                }
            }
        }
    }
    pump() {
        if (this.stopped) return;
        this.cleanupQueued();
        var scanned = 0,
            limit = Math.min(this.total, 1024);
        while (this.inflight < this.concurrency && scanned++ < limit) {
            var urgent = this.queues.warning.length > 0;
            var warnCap = Math.max(1, Math.floor(this.concurrency * 0.8));
            var normalCap = Math.max(1, Math.floor(this.concurrency * (urgent ? 0.2 : 0.8)));
            var normalTurn =
                this.queues.normal.length && this.active.normal < normalCap && this.laneTurn++ % 5 === 4;
            var lane = urgent && !normalTurn && this.active.warning < warnCap ? 'warning' : 'normal';
            if (lane === 'normal' && (!this.queues.normal.length || this.active.normal >= normalCap)) {
                if (urgent && this.active.warning < warnCap) lane = 'warning';
                else break;
            }
            var item = this.queues[lane].shift();
            if (!item) break;
            var job = item.job;
            if (job.deadline !== undefined && this.now() >= job.deadline) {
                // Expiry while waiting for a retry records what the item was waiting for.
                if (item.waiting) this.finish(item, 'expired', item.waiting.reason, item.waiting.stage);
                else this.finish(item, 'expired');
                continue;
            }
            this.inflight++;
            this.active[lane]++;
            this.metrics.peak = Math.max(this.metrics.peak, this.inflight);
            this.run(item, lane);
        }
        if (this.queues.warning.length || this.queues.normal.length) this.schedule();
    }
    async run(item, lane) {
        var self = this,
            job = item.job,
            phase = 'prepare';
        try {
            if (job.guard && !job.guard()) {
                this.finish(item, 'superseded');
                return;
            }
            var payload;
            if (item.prepared) payload = item.payload;
            else if (job.prepare) {
                // The failure bound also holds for work re-admitted after supersession or recovery.
                if (item.prepFailures >= this.prepareAttempts) {
                    this.finish(item, 'failed', 'preparation-attempts-exhausted', 'preparation');
                    return;
                }
                item.preparations++;
                if (job.onPreparation) job.onPreparation(item.preparations);
                payload = await job.prepare();
                delete item.waiting;
            } else payload = job;
            if (this.stopped) return;
            if (payload === null) {
                this.finish(item, 'not-needed');
                return;
            }
            if (job.deadline !== undefined && this.now() >= job.deadline) {
                this.finish(item, 'expired');
                return;
            }
            if (job.guard && !job.guard()) {
                this.finish(item, 'superseded');
                return;
            }
            item.project = payload.authorization ? payload.authorization.projectId : job.project || 'default';
            var allowed = this.budget(item.project, lane);
            if (allowed === 'paused') {
                this.finish(item, 'failed', 'project-paused', 'transport');
                return;
            }
            if (!allowed) {
                item.prepared = true;
                item.payload = payload;
                this.queues[lane].push(item);
                return;
            }
            item.probe = allowed === 'probe';
            if (item.probe) {
                var projectBudget = this.projects.get(item.project);
                projectBudget.probing = item;
                item.probeEpoch = projectBudget.epoch;
            }
            item.attempt++;
            item.sending = true;
            phase = 'send';
            // Watchdog never releases a physical send slot or retries an ambiguous send.
            // The SDK promise must settle before this slot is reusable.
            var timeout = this.later(function () {
                self.ambiguous(item, 'transport-timeout-ambiguous');
            }, this.timeout);
            try {
                try {
                    await this.send(payload, job);
                    this.settled(item);
                } catch (error) {
                    if (error.code === 'transport-timeout-ambiguous' || error.code === 'transport-ambiguous')
                        this.ambiguous(item, error.code);
                    this.settled(item, error);
                    throw error;
                }
            } finally {
                item.sending = false;
                clearTimeout(timeout);
                this.timers.delete(timeout);
            }
            this.finish(item, 'accepted');
        } catch (e) {
            if (item.done || this.stopped) return;
            item.prepared = false;
            delete item.payload;
            if (phase === 'prepare') {
                this.prepareFailed(item, lane, e);
                return;
            }
            var code = e.code || (e.errorInfo && e.errorInfo.code),
                status = e.statusCode || e.status;
            if (code === 'messaging/registration-token-not-registered') {
                this.onInvalid(job);
                this.finish(item, 'invalid', undefined, 'transport');
            } else if (status === 401 || status === 403 || code === 'messaging/authentication-error') {
                this.finish(item, 'failed', 'authentication', 'transport');
            } else if (
                (status === 429 ||
                    status >= 500 ||
                    code === 'messaging/server-unavailable' ||
                    code === 'messaging/internal-error') &&
                item.attempt < 5
            ) {
                var delay =
                    status === 429
                        ? e.retryAfterMs === undefined
                            ? 60000
                            : e.retryAfterMs
                        : this.retryFloor * Math.pow(2, Math.max(0, item.attempt - 1));
                delay =
                    Math.max(this.retryFloor, delay) +
                    Math.floor(Math.random() * Math.min(1000, this.retryFloor));
                if (job.deadline !== undefined && this.now() + delay >= job.deadline)
                    this.finish(item, 'expired', 'transport-retry-deadline', 'transport');
                else {
                    this.metrics.retries++;
                    item.waiting = { reason: 'transport-retry-deadline', stage: 'transport' };
                    this.later(function () {
                        if (self.stopped) self.finish(item, 'failed', 'stopped');
                        else {
                            self.queues[lane].push(item);
                            self.schedule();
                        }
                    }, delay);
                }
            } else this.finish(item, 'failed', code || status || 'transport-error', 'transport');
        } finally {
            this.inflight--;
            this.active[lane]--;
            this.schedule();
        }
    }
    async idle() {
        while (this.total)
            await new Promise(function (r) {
                setTimeout(r, 10);
            });
    }
    close() {
        this.stopped = true;
        this.timers.forEach(clearTimeout);
        this.timers.clear();
        var self = this;
        this.items.forEach(function (item) {
            self.finish(item, 'failed', 'stopped');
        });
        this.queues = { warning: new Queue(), normal: new Queue() };
    }
}
module.exports = { Dispatcher: Dispatcher };
