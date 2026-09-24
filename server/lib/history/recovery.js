'use strict';
var policy = require('./policy');
function Recovery(store, provider) {
    this.store = store;
    this.provider = provider;
}
Recovery.prototype.run = async function (station, start, end, now) {
    station = policy.station(station);
    if (!station) throw new Error('Invalid ASOS station');
    var keys = {
        hourly: policy.range('hourly', start, end, now),
        daily: policy.range('daily', start, end, now)
    };
    var report = {
        stationId: station,
        startDate: start,
        endDate: end,
        requestedRanges: 0,
        accepted: 0,
        rejected: 0,
        missing: {},
        failures: []
    };
    var token = await this.store.acquire(station);
    if (!token) {
        report.failures.push('busy');
        return report;
    }
    var deadline = Date.now() + 10 * 60000;
    try {
        for (var kind of ['hourly', 'daily']) {
            var expected = keys[kind],
                old = await this.store.read(kind, station, expected[0], expected[expected.length - 1]);
            var complete = new Set(
                old
                    .filter(function (r) {
                        return policy.complete(kind, r);
                    })
                    .map(function (r) {
                        return r.key;
                    })
            );
            var missing = expected.filter(function (k) {
                return !complete.has(k);
            });
            for (var range of policy.ranges(kind, missing)) {
                if (Date.now() > deadline) {
                    report.failures.push('deadline');
                    break;
                }
                report.requestedRanges++;
                try {
                    var raw = await this.provider.fetch(kind, station, range),
                        allowed = new Set(
                            missing.filter(function (k) {
                                return k >= range.start && k <= range.end;
                            })
                        );
                    var seen = new Set();
                    for (var item of raw) {
                        if (Date.now() > deadline) throw new Error('HISTORY_DEADLINE');
                        var row = policy.normalize(kind, item, station, allowed, now);
                        if (!row || seen.has(row.key)) {
                            report.rejected++;
                            continue;
                        }
                        seen.add(row.key);
                        await this.store.save(row);
                        report.accepted++;
                    }
                } catch (e) {
                    report.failures.push({
                        kind: kind,
                        start: range.start,
                        end: range.end,
                        reason: /^(ASOS_|HISTORY_)[A-Z0-9_]+$/.test(e.message) ? e.message : 'recovery-failed'
                    });
                }
            }
            // Completion comes from persistence readback, never from HTTP or write callbacks alone.
            var stored = await this.store.read(kind, station, expected[0], expected[expected.length - 1]);
            var good = new Set(
                stored
                    .filter(function (r) {
                        return policy.complete(kind, r);
                    })
                    .map(function (r) {
                        return r.key;
                    })
            );
            report.missing[kind] = expected.filter(function (k) {
                return !good.has(k);
            });
        }
    } finally {
        await this.store.release(station, token);
    }
    report.complete =
        !report.failures.length &&
        !report.rejected &&
        !report.missing.hourly.length &&
        !report.missing.daily.length;
    return report;
};
module.exports = Recovery;
