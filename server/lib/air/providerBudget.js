/**
 * Free-tier budgets, paid caps and down markers of the air provider chain (#2628), shared by all
 * API workers through Mongo (air.provider.usage). Visual Crossing counts against the overseas
 * weather day budget (vc.usage, VC_DAILY_RECORD_LIMIT) and its provider marker (#2585).
 * Counting is read-then-increment, so ten workers can overshoot a cap by a few calls; the 5 %
 * reserve below each free cap absorbs that. Store errors never block a request.
 */

"use strict";

var AirProviderUsage = require('../../models/air.provider.usage.model');
var VcUsage = require('../../models/worldWeather/vc.usage.model');
var VcFetchLock = require('../../models/worldWeather/vc.fetch.lock.model');
var defaultConfig = require('../../config/air');
var appConfig = require('../../config/config');

var VC_PROVIDER_KEY = '~provider';

function pad(n) {
    return (n < 10 ? '0' : '') + n;
}

function monthKey(date) {
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1);
}

function minuteKey(date) {
    return date.toISOString().slice(0, 16);
}

function dayKey(date) {
    return date.toISOString().slice(0, 10);
}

/** First day of the month after next: month documents outlive the month they count. */
function monthExpiry(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 1));
}

// A store may answer synchronously (tests, some drivers): the guards keep a caller's exception
// from being taken as a store failure and from calling back twice.
function readById(Model, id, callback) {
    var answered = false;
    function answer(row) {
        answered = true;
        callback(row);
    }
    try {
        Model.findById(id, function (err, row) {
            if (err) {
                log.warn('air budget read failed id=' + id + ' ' + err.message);
                return answer(undefined);
            }
            answer(row || undefined);
        });
    }
    catch (err) {
        if (answered) {
            throw err;
        }
        log.warn('air budget read failed id=' + id + ' ' + err.message);
        answer(undefined);
    }
}

function increment(Model, id, update, callback, retried) {
    var answered = false;
    function answer() {
        answered = true;
        if (callback) {
            callback();
        }
    }
    try {
        Model.updateOne({_id: id}, update, {upsert: true}, function (err) {
            if (err && err.code === 11000 && !retried) {
                // Two workers created the document at once; the loser's retry updates it.
                answered = true;
                return increment(Model, id, update, callback, true);
            }
            if (err) {
                log.warn('air budget write failed id=' + id + ' ' + err.message);
            }
            answer();
        });
    }
    catch (err) {
        if (answered) {
            throw err;
        }
        log.warn('air budget write failed id=' + id + ' ' + err.message);
        answer();
    }
}

function active(row) {
    return !!(row && row.expireAt && new Date(row.expireAt).getTime() > Date.now());
}

/**
 * @param options {config?: air policy, vcDailyRecordLimit?: number (default config.vc.dailyRecordLimit)}
 */
function createBudget(options) {
    options = options || {};
    var config = options.config || defaultConfig;
    var vcLimit = options.vcDailyRecordLimit !== undefined ? options.vcDailyRecordLimit :
        (appConfig && appConfig.vc ? appConfig.vc.dailyRecordLimit : undefined);

    function freeCap(provider) {
        if (provider === 'google') {
            return config.googleMonthlyCap;
        }
        if (provider === 'openweather') {
            return config.owmMonthlyCap;
        }
        return undefined;
    }

    function checkMinute(provider, callback) {
        if (provider !== 'openweather' || !config.owmMinuteCap) {
            return callback();
        }
        readById(AirProviderUsage, provider + ':min:' + minuteKey(new Date()), function (row) {
            if (row && (row.calls || 0) >= config.owmMinuteCap) {
                return callback('minute-cap');
            }
            callback();
        });
    }

    function checkVisualCrossing(cost, callback) {
        readById(VcFetchLock, VC_PROVIDER_KEY, function (marker) {
            if (active(marker)) {
                return callback('down');
            }
            if (!vcLimit) {
                return callback();
            }
            readById(VcUsage, dayKey(new Date()), function (usage) {
                if (usage && (usage.records || 0) + cost > vcLimit) {
                    return callback('vc-record-limit');
                }
                callback();
            });
        });
    }

    function checkFree(provider, callback) {
        var cap = freeCap(provider);
        if (cap === undefined) {
            return checkMinute(provider, callback);
        }
        readById(AirProviderUsage, provider + ':m:' + monthKey(new Date()), function (row) {
            if (row && (row.calls || 0) >= cap * (1 - config.RESERVE)) {
                return callback('free-cap');
            }
            checkMinute(provider, callback);
        });
    }

    function checkPaid(provider, cost, callback) {
        if (!config.paidProvidersEnabled) {
            return callback('paid-disabled');
        }
        readById(AirProviderUsage, provider + ':paid:m:' + monthKey(new Date()), function (row) {
            if (row && (row.calls || 0) >= config.paidMonthlyCallCap) {
                return callback('paid-cap');
            }
            if (provider === 'visualcrossing') {
                return checkVisualCrossing(cost, callback);
            }
            checkMinute(provider, callback);
        });
    }

    return {
        /**
         * @param phase 'free' | 'paid'
         * @param callback ({allowed: true}) or ({allowed: false, reason})
         *   reason: down | free-cap | minute-cap | free-phase-excluded | paid-disabled | paid-cap | vc-record-limit
         */
        check: function (provider, phase, cost, callback) {
            readById(AirProviderUsage, provider + ':down', function (marker) {
                if (active(marker)) {
                    return callback({allowed: false, reason: 'down'});
                }
                var done = function (reason) {
                    callback(reason ? {allowed: false, reason: reason} : {allowed: true});
                };
                if (phase === 'paid') {
                    return checkPaid(provider, cost || 1, done);
                }
                if (provider === 'visualcrossing') {
                    return done('free-phase-excluded');
                }
                checkFree(provider, done);
            });
        },

        /** Count one request (including failures) in the phase's window(s). */
        record: function (provider, phase, result, callback) {
            result = result || {};
            var now = new Date();
            var inc = {calls: 1, failures: result.failed ? 1 : 0};
            var id = phase === 'paid' ? provider + ':paid:m:' + monthKey(now) : provider + ':m:' + monthKey(now);
            var updates = [[AirProviderUsage, id, {$inc: inc, $set: {expireAt: monthExpiry(now)}}]];
            if (provider === 'openweather') {
                updates.push([AirProviderUsage, provider + ':min:' + minuteKey(now),
                    {$inc: {calls: 1}, $set: {expireAt: new Date(now.getTime() + 2 * 60 * 1000)}}]);
            }
            if (provider === 'visualcrossing') {
                updates.push([VcUsage, dayKey(now), {$inc: {calls: 1, records: result.cost || 0, failures: result.failed ? 1 : 0}}]);
            }
            // count first: a store that answers synchronously must not complete the callback early
            var pending = updates.length;
            var finish = function () {
                if (--pending === 0 && callback) {
                    callback();
                }
            };
            updates.forEach(function (u) {
                increment(u[0], u[1], u[2], finish);
            });
        },

        /** Mark a provider unavailable for DOWN_MS after an auth or quota rejection. */
        markDown: function (provider, kind, callback) {
            var expireAt = new Date(Date.now() + config.DOWN_MS);
            log.error('air provider ' + provider + ' marked unavailable until ' + expireAt.toISOString() + ' reason=' + kind);
            increment(AirProviderUsage, provider + ':down', {$set: {expireAt: expireAt, reason: kind}}, callback);
        }
    };
}

module.exports = {
    createBudget: createBudget,
    monthKey: monthKey,
    minuteKey: minuteKey,
    dayKey: dayKey
};
