/**
 * KMA warning collection from data.go.kr WthrWrnInfoService (#2609), replacing the retired
 * www.weather.go.kr/weather/warning/status.jsp scraper. Called by KmaScraper.gatherSpecialWeatherSituation
 * on every scrape cycle (3 minutes).
 *
 * Decision 6: warnings are issued at any time and a new announcement can reach the operations earlier
 * or later than expected, so nothing depends on a schedule. getPwnStatus is polled every cycle and a new
 * (tmFc, tmSeq) is the change signal; getWthrWrnMsg and getPwnCd are called only while an announcement
 * is unprocessed. It is processed once both reflect it, retried on later cycles while either lags, and
 * stored without a bulletin after MAX_PENDING_CYCLES. getPwnCd windows overlap by a day and are
 * resynced hourly so that late rows are applied. An incomplete 60-day bootstrap continues every cycle,
 * ZONE_DAYS_PER_SYNC days at a time, newest first; replay applies only newer events per zone and type, so
 * the fetch order does not change the result. getPwnCd is requested one KST day at a time: multi-page
 * windows repeat and drop rows at page boundaries (release rows went missing on 2026-09-27), while one
 * day fits one page (at most 275 rows a day over 60 days).
 */

"use strict";

var async = require('async');
var KmaWarningRequester = require('./kmaWarningRequester');
var zones = require('./kmaWarningZones');
var KmaSpecialWeatherSituation = require('../models/modelKmaSpecialWeatherSituation');
var KmaSpecialWeatherZone = require('../models/modelKmaSpecialWeatherZone');

var NATIONWIDE_STN_ID = 108;
var MAX_PENDING_CYCLES = 20;
var RESYNC_MS = 60*60*1000;
// getPwnCd accepts fromTmFc up to 60 days back; the other operations up to 6 days.
var ZONE_LOOKBACK_DAYS = 59;
// One page per KST day: numOfRows 10000 returned all 4,499 rows of 60 days in one page on 2026-09-27.
var ZONE_PAGE_ROWS = 10000;
// At most this many KST days per sync, newest first: the 60-day bootstrap spreads over cycles and resumes
// where it stopped, so a slow or failing provider holds a cycle for at most 10 requests.
var ZONE_DAYS_PER_SYNC = 10;
var SYNC_MARKER = '_sync';

var TYPE_SPECIAL = 1;
var TYPE_PRELIMINARY_SPECIAL = 2;
var TYPE_WEATHER_INFORMATION = 3;
var TYPE_WEATHER_FLASH = 4;

/**
 * @param date
 * @param offsetDays
 * @returns {string} YYYYMMDD in KST
 */
function kstDate(date, offsetDays) {
    var kst = new Date(date.getTime() + 9*3600*1000 + (offsetDays || 0)*24*3600*1000);
    return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * @param day YYYYMMDD
 * @param n days to add
 * @returns {string} YYYYMMDD
 */
function shiftDay(day, n) {
    return new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)) + n*24*3600*1000)
        .toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * tmFc YYYYMMDDHHmm (KST) → the stored announcement: KST wall-clock time as UTC, as the scraper stored it
 * on a UTC host. getCurrent shifts it by -9 h. Independent of the host time zone.
 */
function announcementOf(tmFc) {
    var s = String(tmFc);
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)));
}

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).replace(/\r/g, '').trim();
}

function latestItem(items) {
    return (items || []).slice().sort(function (a, b) {
        return Number(b.tmFc) - Number(a.tmFc) || Number(b.tmSeq || 0) - Number(a.tmSeq || 0);
    })[0];
}

/**
 * @param options {requester?}
 * @constructor
 */
function KmaWarningCollector(options) {
    options = options || {};
    this.requester = options.requester || new KmaWarningRequester();
    this.pending = null;
}

KmaWarningCollector.prototype._exists = function (type, announcement, callback) {
    KmaSpecialWeatherSituation.find({announcement: announcement, type: type}).limit(1).lean().exec(function (err, list) {
        callback(err, !err && list.length > 0);
    });
};

KmaWarningCollector.prototype._store = function (doc, callback) {
    KmaSpecialWeatherSituation.update({announcement: doc.announcement, type: doc.type}, doc, {upsert: true}, function (err) {
        if (!err) {
            log.info('kma warning stored type=' + doc.type + ' announcement=' + doc.announcement.toISOString());
        }
        callback(err);
    });
};

/**
 * KST days for one sync, newest first, at most ZONE_DAYS_PER_SYNC: days since the previous sync (today and
 * yesterday at least), then older days until the 60-day window is covered.
 * @param now
 * @param marker '_sync' document or undefined
 * @returns {{days: string[], oldest: string}} oldest is the start of the contiguous covered range afterwards
 */
function planDays(now, marker) {
    var today = kstDate(now);
    var earliest = kstDate(now, -ZONE_LOOKBACK_DAYS);
    var from = marker && marker.lastSyncAt ? kstDate(new Date(marker.lastSyncAt), -1) : today;
    if (from < earliest) {
        from = earliest;
    }
    if (from > today) {
        from = today;
    }
    var days = [];
    for (var offset = 0; kstDate(now, -offset) >= from; offset++) {
        days.push(kstDate(now, -offset));
    }
    var covered = marker && marker.oldestSyncedTmFc && days.length <= ZONE_DAYS_PER_SYNC ? marker.oldestSyncedTmFc : null;
    days = days.slice(0, ZONE_DAYS_PER_SYNC);
    var oldest = covered && covered < days[days.length - 1] ? covered : days[days.length - 1];
    // Backfill older days below the covered range.
    for (var back = 1; days.length < ZONE_DAYS_PER_SYNC; back++) {
        var day = shiftDay(oldest, -back);
        if (day < earliest) {
            break;
        }
        days.push(day);
    }
    if (days[days.length - 1] < oldest) {
        oldest = days[days.length - 1];
    }
    return {days: days, oldest: oldest};
}

/**
 * Apply getPwnCd rows since the previous sync (60 days when the state is empty) and persist changed zones.
 * @param callback (err, {rows, entries})
 */
KmaWarningCollector.prototype.syncZones = function (callback) {
    var self = this;
    var now = new Date();
    KmaSpecialWeatherZone.find({}).lean().exec(function (err, docs) {
        if (err) {
            return callback(err);
        }
        var marker = docs.filter(function (doc) {
            return doc.areaCode === SYNC_MARKER;
        })[0];
        var state = {};
        docs.forEach(function (doc) {
            if (doc.areaCode !== SYNC_MARKER) {
                state[zones.stateKey(doc.areaCode, doc.warnVar)] = doc;
            }
        });
        var plan = planDays(now, marker);
        var days = plan.days;
        var rows = [];
        async.eachSeries(days, function (day, done) {
            self.requester.getAll('getPwnCd', {fromTmFc: day, toTmFc: day}, ZONE_PAGE_ROWS, function (err, items) {
                rows = rows.concat(items || []);
                done(err);
            });
        }, function (err) {
            if (err) {
                return callback(err);
            }
            var changed = zones.applyEvents(state, zones.prepareEvents(rows));
            async.eachSeries(changed, function (key, done) {
                var entry = Object.assign({}, state[key], {updatedAt: now});
                delete entry._id;
                delete entry.__v;
                KmaSpecialWeatherZone.update({areaCode: entry.areaCode, warnVar: entry.warnVar}, entry, {upsert: true}, done);
            }, function (err) {
                if (err) {
                    return callback(err);
                }
                var complete = plan.oldest <= kstDate(now, -ZONE_LOOKBACK_DAYS);
                KmaSpecialWeatherZone.update({areaCode: SYNC_MARKER, warnVar: -1},
                    {areaCode: SYNC_MARKER, warnVar: -1, lastSyncAt: now, oldestSyncedTmFc: plan.oldest,
                     lastFromTmFc: days[days.length - 1], lastToTmFc: days[0], updatedAt: now},
                    {upsert: true}, function (err) {
                        if (err) {
                            return callback(err);
                        }
                        self.lastSyncAt = now;
                        self.bootstrapComplete = complete;
                        log.info('kma warning zones synced days=' + days.length + ' newest=' + days[0] + ' oldest=' + plan.oldest +
                                 (complete ? '' : ' (bootstrap continues)') + ' rows=' + rows.length + ' changed=' + changed.length);
                        var entries = Object.keys(state).map(function (key) {
                            return state[key];
                        });
                        callback(null, {rows: rows, entries: entries, complete: complete});
                    });
            });
        });
    });
};

/**
 * Type 1: getPwnStatus every cycle; a new announcement triggers getWthrWrnMsg and getPwnCd.
 */
KmaWarningCollector.prototype._specialStep = function (result, callback) {
    var self = this;
    self.requester.get('getPwnStatus', {pageNo: 1, numOfRows: 10}, function (err, res) {
        if (err) {
            return callback(err);
        }
        var status = res.noData ? undefined : latestItem(res.items);
        if (!status) {
            return callback();
        }
        var announcement = announcementOf(status.tmFc);
        self._exists(TYPE_SPECIAL, announcement, function (err, exists) {
            if (err) {
                return callback(err);
            }
            if (exists) {
                self.pending = null;
                return callback();
            }
            var key = status.tmFc + '|' + status.tmSeq;
            if (!self.pending || self.pending.key !== key) {
                self.pending = {key: key, cycles: 0};
            }
            self.pending.cycles++;

            var day = String(status.tmFc).slice(0, 8);
            var bulletin;
            var zoneResult;
            var errors = [];
            async.series([
                function (done) {
                    self.requester.getAll('getWthrWrnMsg', {stnId: NATIONWIDE_STN_ID, fromTmFc: day, toTmFc: day}, function (err, items) {
                        if (err) {
                            errors.push(err);
                            return done(err.isQuotaError ? err : null);
                        }
                        bulletin = (items || []).filter(function (item) {
                            return String(item.tmFc) === String(status.tmFc) &&
                                (item.tmSeq === undefined || String(item.tmSeq) === String(status.tmSeq));
                        })[0];
                        done();
                    });
                },
                function (done) {
                    self.syncZones(function (err, synced) {
                        if (err) {
                            errors.push(err);
                            return done(err.isQuotaError ? err : null);
                        }
                        zoneResult = synced;
                        done();
                    });
                }
            ], function (err) {
                if (err) {
                    return callback(err);
                }
                result.synced = !!zoneResult;
                var drift = zoneResult ? zones.driftFromT6(zoneResult.entries, status.t6) : null;
                if (drift && zoneResult.complete && drift.missing.length > 0) {
                    log.warn('kma warning zone state differs from t6 active=' + drift.active + ' none=' + drift.none +
                             ' missing=' + drift.missing.join(','));
                }
                var hasRows = zoneResult && zoneResult.rows.some(function (row) {
                    return String(row.tmFc) === String(status.tmFc) && String(row.tmSeq) === String(status.tmSeq);
                });
                var quiet = zoneResult && zoneResult.complete && drift.none && drift.active === 0;
                var ready = !!bulletin && !!(hasRows || quiet);
                if (errors.length > 0 || (!ready && self.pending.cycles < MAX_PENDING_CYCLES)) {
                    log.info('kma warning announcement ' + key + ' pending cycle=' + self.pending.cycles +
                             ' bulletin=' + !!bulletin + ' zoneRows=' + !!hasRows);
                    return callback(errors[0]);
                }
                if (!bulletin) {
                    log.warn('kma warning announcement ' + key + ' stored without bulletin after ' + self.pending.cycles + ' cycles');
                }
                var doc = {
                    announcement: announcement,
                    type: TYPE_SPECIAL,
                    situationList: KmaSpecialWeatherSituation.parseSpecialText(status.t6),
                    comment: cleanText(status.other)
                };
                if (bulletin) {
                    doc.bulletin = {title: cleanText(bulletin.t1), areas: cleanText(bulletin.t2),
                                    effectiveTimes: cleanText(bulletin.t3), releaseOutlook: cleanText(bulletin.t4)};
                }
                self._store(doc, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    self.pending = null;
                    result.stored++;
                    callback();
                });
            });
        });
    });
};

/**
 * Hourly getPwnCd resync without a change, for late or corrected rows.
 */
KmaWarningCollector.prototype._resyncStep = function (result, callback) {
    var self = this;
    if (result.synced) {
        return callback();
    }
    function sync() {
        self.syncZones(function (err) {
            callback(err);
        });
    }
    if (self.lastSyncAt && self.bootstrapComplete && Date.now() - self.lastSyncAt.getTime() < RESYNC_MS) {
        return callback();
    }
    KmaSpecialWeatherZone.find({areaCode: SYNC_MARKER}).lean().exec(function (err, list) {
        if (err) {
            return callback(err);
        }
        var last = list[0] && list[0].lastSyncAt ? new Date(list[0].lastSyncAt) : null;
        var complete = !!(list[0] && list[0].oldestSyncedTmFc && list[0].oldestSyncedTmFc <= kstDate(new Date(), -ZONE_LOOKBACK_DAYS));
        if (last && complete && Date.now() - last.getTime() < RESYNC_MS) {
            self.lastSyncAt = last;
            self.bootstrapComplete = true;
            return callback();
        }
        sync();
    });
};

/**
 * Types 2-4: the latest item of yesterday and today (KST).
 */
KmaWarningCollector.prototype._bulletinStep = function (operation, type, build, result, callback) {
    var self = this;
    var now = new Date();
    self.requester.getAll(operation, {stnId: NATIONWIDE_STN_ID, fromTmFc: kstDate(now, -1), toTmFc: kstDate(now)}, function (err, items) {
        if (err) {
            return callback(err);
        }
        var item = latestItem(items);
        if (!item) {
            return callback();
        }
        var announcement = announcementOf(item.tmFc);
        self._exists(type, announcement, function (err, exists) {
            if (err || exists) {
                return callback(err);
            }
            var doc = build(item);
            doc.announcement = announcement;
            doc.type = type;
            self._store(doc, function (err) {
                if (!err) {
                    result.stored++;
                }
                callback(err);
            });
        });
    });
};

/**
 * @param callback (err) err is 'skip' when nothing new was stored and no step failed
 */
KmaWarningCollector.prototype.gather = function (callback) {
    var self = this;
    var result = {stored: 0, synced: false};
    var errors = [];
    var steps = [
        self._specialStep.bind(self, result),
        self._resyncStep.bind(self, result),
        self._bulletinStep.bind(self, 'getWthrPwn', TYPE_PRELIMINARY_SPECIAL, function (item) {
            return {situationList: KmaSpecialWeatherSituation.parsePreliminaryText(item.pwn), comment: cleanText(item.rem)};
        }, result),
        self._bulletinStep.bind(self, 'getWthrInfo', TYPE_WEATHER_INFORMATION, function (item) {
            return {comment: cleanText(item.t1)};
        }, result),
        self._bulletinStep.bind(self, 'getWthrBrkNews', TYPE_WEATHER_FLASH, function (item) {
            return {comment: cleanText(item.ann)};
        }, result)
    ];
    async.eachSeries(steps, function (step, done) {
        step(function (err) {
            if (err) {
                errors.push(err);
                if (err.isQuotaError) {
                    // #2604: a quota rejection ends the cycle; the next cycle is the retry.
                    log.warn('kma warning quota exceeded; skip the rest of this cycle');
                    return done(err);
                }
            }
            done();
        });
    }, function () {
        if (errors.length > 0) {
            var err = new Error('kma warning collection failed: ' + errors.map(function (e) {
                return e.message;
            }).join('; '));
            err.errors = errors;
            return callback(err);
        }
        callback(result.stored > 0 ? undefined : 'skip');
    });
};

KmaWarningCollector.announcementOf = announcementOf;
KmaWarningCollector.kstDate = kstDate;

module.exports = KmaWarningCollector;
