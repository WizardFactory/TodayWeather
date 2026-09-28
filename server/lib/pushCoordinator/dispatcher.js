'use strict';
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
        this.metrics = { accepted: 0, expired: 0, superseded: 0, failed: 0, retries: 0, peak: 0 };
    }
    enqueue(job) {
        var self = this;
        if (this.stopped || !this.canEnqueue(job.priority))
            return Promise.reject(new Error('Push dispatch queue unavailable'));
        this.total++;
        return new Promise(function (resolve) {
            var item = { job: job, resolve: resolve, attempt: 0, done: false };
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
        if (!b) {
            b = { tokens: Math.max(1, this.rate / 10), time: now, paused: false };
            this.projects.set(project, b);
        }
        b.tokens = Math.min(this.rate / 10, b.tokens + ((now - b.time) * this.rate) / 1000);
        b.time = now;
        if (b.paused) return 'paused';
        var floor = lane === 'normal' ? (this.rate / 10) * 0.2 : 0;
        if (b.tokens < floor + 1) return false;
        b.tokens--;
        return true;
    }
    finish(item, status, error) {
        if (item.done) return;
        item.done = true;
        this.items.delete(item);
        this.total--;
        this.metrics[status] = (this.metrics[status] || 0) + 1;
        item.resolve({ status: status, error: error, attempts: item.attempt });
    }
    pump() {
        if (this.stopped) return;
        var scanned = 0,
            limit = Math.min(this.total, 1024);
        while (this.inflight < this.concurrency && scanned++ < limit) {
            var urgent = this.queues.warning.length > 0;
            var warnCap = Math.max(1, Math.floor(this.concurrency * 0.8));
            var normalCap = Math.max(1, Math.floor(this.concurrency * (urgent ? 0.2 : 0.8)));
            var lane = urgent && this.active.warning < warnCap ? 'warning' : 'normal';
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
            job = item.job;
        try {
            if (job.guard && !job.guard()) {
                this.finish(item, 'superseded');
                return;
            }
            var payload = item.prepared ? item.payload : job.prepare ? await job.prepare() : job;
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
                this.finish(item, 'failed', 'project-paused');
                return;
            }
            if (!allowed) {
                item.prepared = true;
                item.payload = payload;
                this.queues[lane].push(item);
                return;
            }
            item.attempt++;
            // Watchdog never releases a physical send slot or retries an ambiguous send.
            // The SDK promise must settle before this slot is reusable.
            var timeout = this.later(function () {
                var budget = self.projects.get(item.project);
                if (budget) budget.paused = true;
                self.finish(item, 'failed', 'transport-timeout-ambiguous');
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
            var code = e.code || (e.errorInfo && e.errorInfo.code),
                status = e.statusCode || e.status;
            if (code === 'messaging/registration-token-not-registered') {
                this.onInvalid(job);
                this.finish(item, 'invalid');
            } else if (status === 401 || status === 403 || code === 'messaging/authentication-error') {
                var b = this.projects.get(item.project || job.project || 'default');
                if (b) b.paused = true;
                this.finish(item, 'failed', 'authentication');
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
                    this.finish(item, 'expired');
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
            } else this.finish(item, 'failed', code || status || 'preparation');
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
