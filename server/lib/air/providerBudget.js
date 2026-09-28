/**
 * Free-tier budgets, paid caps and down markers of the air provider chain (#2628), shared by all
 * API workers through Mongo (air.provider.usage). Visual Crossing counts against the overseas
 * weather day budget (vc.usage, VC_DAILY_RECORD_LIMIT) and its provider marker (#2585).
 * Free counting is read-then-increment, so ten workers can overshoot a cap by a few calls; the 5 %
 * reserve below each free cap absorbs that, and free-phase store errors never block a request.
 * Paid calls (D20) fail closed: every applicable read must succeed and one monthly call is reserved
 * with a conditional upsert before the request is sent. A reservation is never refunded; completion
 * only adds failures to the reserved month.
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
/** callback(row, failed): a failed read answers (undefined, true). */
function readById(Model, id, callback) {
    var answered = false;
    function answer(row, failed) {
        answered = true;
        callback(row, failed);
    }
    try {
        Model.findById(id, function (err, row) {
            if (err) {
                log.warn('air budget read failed id=' + id + ' ' + err.message);
                return answer(undefined, true);
            }
            answer(row || undefined, false);
        });
    }
    catch (err) {
        if (answered) {
            throw err;
        }
        log.warn('air budget read failed id=' + id + ' ' + err.message);
        answer(undefined, true);
    }
}

/**
 * An update result proves the reservation only when it is acknowledged and touched exactly one
 * document. Accepted shapes: the server result `{n, nModified, ok}` (mongoose 5.13 unwraps to it;
 * an upsert has n = 1), the driver 3.x result carrying it as `result` (mongoose 5.1.2 passes that
 * through; an unacknowledged write there is `{result: {ok: 1}}` without n), and the driver 4+
 * `{acknowledged, modifiedCount, upsertedCount}`. Anything else is not a reservation.
 */
function acknowledgedOne(raw) {
    if (!raw || typeof raw !== 'object' || raw.acknowledged === false) {
        return false;
    }
    var server = raw.result && typeof raw.result === 'object' ? raw.result : raw;
    if (typeof server.n === 'number') {
        return server.n === 1 && server.ok === 1;
    }
    if (raw.acknowledged === true) {
        return (raw.modifiedCount || 0) + (raw.upsertedCount || 0) === 1;
    }
    return false;
}

/**
 * Take one call from a monthly paid counter unless it is at the cap: the filter only matches a
 * document below the cap, so an upsert against a full one fails with a duplicate key. A duplicate
 * key can also mean another worker created the document first; the retry tells the two apart.
 * callback(outcome): 'reserved' | 'paid-cap' | 'reserve-error'
 */
function reserve(Model, id, cap, expireAt, callback, retried) {
    var answered = false;
    function answer(outcome) {
        answered = true;
        callback(outcome);
    }
    try {
        Model.updateOne({_id: id, calls: {$lt: cap}}, {$inc: {calls: 1}, $set: {expireAt: expireAt}}, {upsert: true}, function (err, raw) {
            if (err && err.code === 11000) {
                if (retried) {
                    return answer('paid-cap');
                }
                answered = true;
                return reserve(Model, id, cap, expireAt, callback, true);
            }
            if (err) {
                log.warn('air budget reservation failed id=' + id + ' ' + err.message);
                return answer('reserve-error');
            }
            if (!acknowledgedOne(raw)) {
                log.warn('air budget reservation not acknowledged id=' + id);
                return answer('reserve-error');
            }
            answer('reserved');
        });
    }
    catch (err) {
        if (answered) {
            throw err;
        }
        log.warn('air budget reservation failed id=' + id + ' ' + err.message);
        answer('reserve-error');
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

    function calls(row) {
        return row && typeof row.calls === 'number' ? row.calls : 0;
    }

    /**
     * Rolling minute (D5): the current minute's calls plus the previous minute's, weighted by the
     * part of the previous minute that is still inside the last 60 seconds. Shared across workers;
     * a cap of 0 blocks the provider.
     */
    function checkMinute(provider, strict, callback) {
        if (provider !== 'openweather') {
            return callback();
        }
        var now = new Date();
        var fraction = (60000 - (now.getTime() % 60000)) / 60000;
        readById(AirProviderUsage, provider + ':min:' + minuteKey(now), function (current, currentFailed) {
            readById(AirProviderUsage, provider + ':min:' + minuteKey(new Date(now.getTime() - 60000)), function (previous, previousFailed) {
                if (strict && (currentFailed || previousFailed)) {
                    return callback('store-error');
                }
                var estimate = calls(current) + calls(previous) * fraction;
                if (estimate >= config.owmMinuteCap) {
                    return callback('minute-cap');
                }
                callback();
            });
        });
    }

    // paid phase only, so every read is strict
    function checkVisualCrossing(cost, callback) {
        readById(VcFetchLock, VC_PROVIDER_KEY, function (marker, failed) {
            if (failed) {
                return callback('store-error');
            }
            if (active(marker)) {
                return callback('down');
            }
            if (!vcLimit) {
                return callback();
            }
            readById(VcUsage, dayKey(new Date()), function (usage, usageFailed) {
                if (usageFailed) {
                    return callback('store-error');
                }
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
            return checkMinute(provider, false, callback);
        }
        readById(AirProviderUsage, provider + ':m:' + monthKey(new Date()), function (row) {
            // a missing document is zero calls; a cap of 0 therefore blocks the first call
            if (calls(row) >= cap * (1 - config.RESERVE)) {
                return callback('free-cap');
            }
            checkMinute(provider, false, callback);
        });
    }

    /** Paid admission (D20): policy reads first, then the reservation, so a denied call reserves nothing. */
    function checkPaid(provider, cost, callback) {
        if (!config.paidProvidersEnabled) {
            return callback('paid-disabled');
        }
        if (!(config.paidMonthlyCallCap > 0)) {
            return callback('paid-cap');
        }
        var admit = function (reason) {
            if (reason) {
                return callback(reason);
            }
            var now = new Date();
            var id = provider + ':paid:m:' + monthKey(now);
            reserve(AirProviderUsage, id, config.paidMonthlyCallCap, monthExpiry(now), function (outcome) {
                if (outcome !== 'reserved') {
                    return callback(outcome);
                }
                callback(undefined, id);
            });
        };
        if (provider === 'visualcrossing') {
            return checkVisualCrossing(cost, admit);
        }
        checkMinute(provider, true, admit);
    }

    return {
        /**
         * @param phase 'free' | 'paid'
         * @param callback ({allowed: true}) or ({allowed: false, reason})
         *   reason: down | free-cap | minute-cap | free-phase-excluded | paid-disabled | paid-cap | vc-record-limit
         *   | store-error (paid read failed) | reserve-error (paid reservation failed or unacknowledged)
         *   An allowed paid call carries `reservation`, the monthly counter it was charged to; pass it to record().
         */
        check: function (provider, phase, cost, callback) {
            readById(AirProviderUsage, provider + ':down', function (marker, failed) {
                if (phase === 'paid' && failed) {
                    return callback({allowed: false, reason: 'store-error'});
                }
                if (active(marker)) {
                    return callback({allowed: false, reason: 'down'});
                }
                var done = function (reason, reservation) {
                    if (reason) {
                        return callback({allowed: false, reason: reason});
                    }
                    callback(reservation ? {allowed: true, reservation: reservation} : {allowed: true});
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

        /**
         * Count one request (including failures) in the phase's window(s). A paid call was counted by its
         * reservation (result.reservation, the reserved month's counter): only a failure is added there.
         */
        record: function (provider, phase, result, callback) {
            result = result || {};
            var now = new Date();
            var updates = [];
            if (phase !== 'paid') {
                updates.push([AirProviderUsage, provider + ':m:' + monthKey(now),
                    {$inc: {calls: 1, failures: result.failed ? 1 : 0}, $set: {expireAt: monthExpiry(now)}}]);
            }
            else if (result.failed) {
                updates.push([AirProviderUsage, result.reservation || provider + ':paid:m:' + monthKey(now), {$inc: {failures: 1}}]);
            }
            if (provider === 'openweather') {
                updates.push([AirProviderUsage, provider + ':min:' + minuteKey(now),
                    {$inc: {calls: 1}, $set: {expireAt: new Date(now.getTime() + 3 * 60 * 1000)}}]);
            }
            if (provider === 'visualcrossing') {
                updates.push([VcUsage, dayKey(now), {$inc: {calls: 1, records: result.cost || 0, failures: result.failed ? 1 : 0}}]);
            }
            if (!updates.length) {
                return callback ? callback() : undefined;
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
