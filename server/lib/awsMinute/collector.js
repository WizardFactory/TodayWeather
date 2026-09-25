'use strict';
var parser = require('./parser');
function Collector(options) {
    this.options = options;
    this.now = options.now || Date.now;
    this.schedule = options.schedule || setTimeout;
    this.cancel = options.cancel || clearTimeout;
    this.stopped = true;
    this.inFlight = null;
    this.token = null;
    this.lastWrite = null;
    this.acquiring = null;
    this.stopping = null;
}
Collector.prototype.start = async function () {
    if (!this.options.enabled && !this.options.dryRun) return { disabled: true };
    if (this.stopping) await this.stopping;
    if (!this.stopped) return { alreadyStarted: true };
    this.stopping = null;
    this.stopped = false;
    if (!this.options.dryRun) {
        var self = this;
        this.acquiring = (async function () {
            self.token = await self.options.store.acquire();
            if (!self.token) throw new Error('AWS_MINUTE_WRITER_BUSY');
        })();
        try {
            await this.acquiring;
        } catch (error) {
            this.stopped = true;
            throw error;
        } finally {
            this.acquiring = null;
        }
    }
    // stop() owns release and must finish it before the CLI closes the connection.
    if (this.stopped) return;
    var report = await this.poll();
    if (this.options.once) {
        await this.stop();
        return report;
    }
    this.enqueue();
    return report;
};
Collector.prototype.enqueue = function () {
    var self = this;
    if (this.stopped) return;
    this.timer = this.schedule(async function () {
        await self.poll();
        self.enqueue();
    }, 120000);
};
Collector.prototype.poll = function () {
    var self = this;
    if (this.stopped) return Promise.resolve({ stopped: true });
    if (this.inFlight) return this.inFlight;
    this.abort = new AbortController();
    this.inFlight = (async function () {
        var report = {
            accepted: 0,
            rejected: 0,
            written: 0,
            lastSuccessfulWrite: self.lastWrite,
            dryRun: !!self.options.dryRun,
        };
        var deadline = self.now() + 60000;
        try {
            var response = await self.options.fetch({ signal: self.abort.signal });
            if (self.stopped) throw new Error('AWS_MINUTE_ABORTED');
            var data = (self.options.parse || parser.parse)(response, self.now());
            report.publication = data.observedAt.toISOString();
            report.accepted = data.accepted;
            report.rejected = data.rejected;
            report.samples = ['108', '159', '184'].map(function (id) {
                var sample = data.rows.find(function (row) {
                    return row.stationId === id;
                });
                return sample
                    ? {
                          stationId: id,
                          stationName: sample.stationName,
                          observedAt: sample.observedAt,
                          values: sample.values,
                      }
                    : { stationId: id, missing: true };
            });
            if (!self.options.dryRun) {
                for (var row of data.rows) {
                    if (self.stopped) throw new Error('AWS_MINUTE_ABORTED');
                    if (self.now() >= deadline) throw new Error('AWS_MINUTE_POLL_BUDGET');
                    await self.options.store.save(row);
                    report.written++;
                    self.lastWrite = new Date(self.now()).toISOString();
                }
            }
            report.ok = true;
        } catch (e) {
            if (e.publication) report.publication = e.publication;
            report.ok = false;
            report.reason = /^AWS_MINUTE_[A-Z_]+$/.test(e.message)
                ? e.message
                : 'AWS_MINUTE_POLL_FAILED';
        }
        report.lastSuccessfulWrite = self.lastWrite;
        if (self.options.log) self.options.log(report);
        return report;
    })().finally(function () {
        self.inFlight = null;
    });
    return this.inFlight;
};
Collector.prototype.stop = function () {
    this.stopped = true;
    if (this.timer) this.cancel(this.timer);
    if (this.abort) this.abort.abort();
    if (this.stopping) return this.stopping;
    var self = this;
    this.stopping = (async function () {
        if (self.acquiring) {
            try {
                await self.acquiring;
            } catch (error) {
                /* start() reports acquisition errors. */
            }
        }
        try {
            if (self.inFlight) await self.inFlight;
        } finally {
            if (self.token) {
                var token = self.token;
                self.token = null;
                await self.options.store.release(token);
            }
        }
    })();
    return this.stopping;
};
module.exports = Collector;
