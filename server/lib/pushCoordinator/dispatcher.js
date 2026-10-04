'use strict';
var errors = require('./errors'),
    PreparationError = errors.PreparationError,
    safeReason = errors.safeReason;
// Bounded async admission. Registration processing never runs on this queue.
class Queue {
    constructor() {
        this.items = [];
        this.head = 0;
    }
    get length() {
        return this.items.length - this.head;
    }
    push(x) {
        this.items.push(x);
    }
    shift() {
        var x = this.items[this.head++];
        if (this.head > 1024 && this.head * 2 > this.items.length) {
            this.items = this.items.slice(this.head);
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
        this.timeout = o.timeoutMs || 15000;
        // Preparation (weather) retries are counted apart from transport attempts and stop at the deadline.
        this.prepareAttempts = o.prepareAttempts || 4;
        this.prepareRetry = o.prepareRetryMs === undefined ? 1000 : o.prepareRetryMs;
        this.now = o.now || Date.now;
        this.onInvalid = o.onInvalid || function () {};
        this.queues = { warning: new Queue(), normal: new Queue() };
        this.active = { warning: 0, normal: 0 };
        this.items = new Set();
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
                cooldownUntil: 0
            };
            this.projects.set(project, b);
        }
        var refill = (Math.max(0, now - b.time) * this.rate) / 1000;
        b.tokens = Math.min(cap, b.tokens + refill);
        b.normal = Math.min(Math.max(1, cap * 0.2), b.normal + refill * 0.2);
        b.warning = Math.min(Math.max(1, cap * 0.8), b.warning + refill * 0.8);
        b.time = now;
        if (b.paused) return 'paused';
        if (now < b.cooldownUntil || b.tokens < 1) return false;
        var source = lane;
        // Warnings never borrow the normal reservation. Normal traffic can use spare
        // warning capacity only when no urgent work is queued or being prepared/sent.
        if (lane === 'normal' && b.normal < 1 && !this.queues.warning.length && !this.active.warning)
            source = 'warning';
        if (b[source] < 1) return false;
        b[source]--;
        b.tokens--;
        return true;
    }
    finish(item, status, error, stage) {
        if (item.done) return;
        item.done = true;
        this.items.delete(item);
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
    pump() {
        if (this.stopped) return;
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
                this.finish(item, 'expired');
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
            item.attempt++;
            phase = 'send';
            // Watchdog never releases a physical send slot or retries an ambiguous send.
            // The SDK promise must settle before this slot is reusable.
            var timeout = this.later(function () {
                var budget = self.projects.get(item.project);
                if (budget) budget.paused = true;
                self.finish(item, 'failed', 'transport-timeout-ambiguous', 'transport');
            }, this.timeout);
            try {
                await this.send(payload, job);
            } finally {
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
            if (status === 429) {
                var projectBudget = this.projects.get(item.project || job.project || 'default');
                var retryAfter =
                    Number.isFinite(e.retryAfterMs) && e.retryAfterMs >= 0 ? e.retryAfterMs : 60000;
                if (projectBudget)
                    projectBudget.cooldownUntil = Math.max(
                        projectBudget.cooldownUntil,
                        this.now() + Math.max(this.retryFloor, retryAfter)
                    );
            }
            if (code === 'messaging/registration-token-not-registered') {
                this.onInvalid(job);
                this.finish(item, 'invalid', undefined, 'transport');
            } else if (status === 401 || status === 403 || code === 'messaging/authentication-error') {
                var b = this.projects.get(item.project || job.project || 'default');
                if (b) b.paused = true;
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
