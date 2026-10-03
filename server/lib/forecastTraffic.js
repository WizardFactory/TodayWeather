'use strict';
// Per-process observations, not a distributed provider quota ledger.
function kstHour(now) { return new Date(now + 9 * 3600000).toISOString().slice(0, 13); }
function ForecastTraffic(emit) {
    this.emit = emit;
    this.day = null;
    this.rejected = {};
    this.blocked = {};
    this.hourly = {};
}
ForecastTraffic.prototype.advance = function(now) {
    var day = kstHour(now).slice(0,10);
    if (this.day === null || day > this.day) { this.day = day; this.rejected = {}; this.blocked = {}; this.hourly = {}; }
};
ForecastTraffic.prototype.available = function(type, count, preferred, now) {
    this.advance(now);
    for (var offset = 0; offset < count; offset++) {
        var index = (preferred + offset) % count;
        // Only current traffic is governed here; other product quota scopes remain unverified.
        if (type !== 0 || !this.blocked[type + ':' + index]) { return index; }
    }
    return -1;
};
ForecastTraffic.prototype.attempt = function(product, index, now) {
    this.advance(now);
    var bucket = kstHour(now) + ':' + product + ':' + index;
    this.hourly[bucket] = (this.hourly[bucket] || 0) + 1;
    return {kstHour: kstHour(now), hourlyAttempts: this.hourly[bucket]};
};
ForecastTraffic.prototype.quota = function(type, product, index, now, reasonCode, startedAt) {
    this.advance(now);
    var daily = reasonCode === '22';
    var requestDay = kstHour(startedAt === undefined ? now : startedAt).slice(0,10);
    var currentDay = requestDay === this.day;
    if (daily && type === 0 && currentDay) { this.blocked[type + ':' + index] = true; }
    var reason = daily ? 'daily-quota' : (reasonCode === '23' ? 'per-second' : 'unclassified-429');
    var id = requestDay + ':' + type + ':' + index + ':' + reason;
    if (this.rejected[id]) { return; }
    this.rejected[id] = true;
    this.emit({event: 'first-quota', utc: new Date(now).toISOString(), kstHour: kstHour(now),
        product: product, keyIndex: index, reason: reason, requestKstDay: requestDay,
        cooldown: daily && type === 0 && currentDay ? 'next-KST-day' : 'none'});
};
ForecastTraffic.kstHour = kstHour;
module.exports = ForecastTraffic;
