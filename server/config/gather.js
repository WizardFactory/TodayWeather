/**
 * Gather runtime policy (#2588).
 *
 * Every default equals the master literal it replaces, so an unset environment
 * keeps master behaviour. Production values are documented in
 * docs/operations/gather-runtime-policy.md.
 *
 * Consumers require this module directly instead of reading config.gather:
 * a host may run its own config.js without a gather section.
 * An invalid value throws at load time; silently falling back to the default
 * would revert the operator's policy without notice.
 */
'use strict';

// Values above MAX_SAFE_INTEGER are rejected: a retry count that large cannot be
// decremented exactly (1e20 - 1 === 1e20), so the retry loop would never end.
function integer(env, name, defaultValue, min, max) {
    var raw = env[name];
    if (raw === undefined || String(raw).trim() === '') {
        return defaultValue;
    }
    if (max === undefined) {
        max = Number.MAX_SAFE_INTEGER;
    }
    var text = String(raw).trim();
    var value = Number(text);
    if (!/^\d+$/.test(text) || value < min || value > max) {
        throw new Error('Invalid ' + name + ': expected an integer from ' + min + ' to ' + max);
    }
    return value;
}

function flag(env, name, defaultValue) {
    var raw = env[name];
    if (raw === undefined || String(raw).trim() === '') {
        return defaultValue;
    }
    var text = String(raw).trim();
    if (text !== 'true' && text !== 'false') {
        throw new Error('Invalid ' + name + ': expected true or false');
    }
    return text === 'true';
}

function load(env) {
    var townRetry = integer(env, 'GATHER_TOWN_RETRY', 70, 1);
    var midRetry = integer(env, 'GATHER_MID_RETRY', 70, 1);

    var pastConditionRetry = integer(env, 'GATHER_PAST_CONDITION_RETRY', 10, 1);
    // When set, the retry count is ceil(updateList.length / divisor) instead.
    var pastConditionRetryDivisor = integer(env, 'GATHER_PAST_CONDITION_RETRY_DIVISOR', 0, 0);

    return {
        retry: {
            townShort: townRetry,
            townShortest: townRetry,
            townCurrent: townRetry,
            invalidCurrent: integer(env, 'GATHER_INVALID_CURRENT_RETRY', 50, 1),
            midForecast: midRetry,
            midLand: midRetry,
            midTemp: midRetry,
            midSea: midRetry
        },
        // Delay before each recursive retry pass of _recursiveRequestData.
        // setTimeout turns larger values into 1 ms, so they are rejected.
        retryDelayMs: integer(env, 'GATHER_RETRY_DELAY_MS', 0, 0, 2147483647),
        tasks: {
            past: flag(env, 'GATHER_PAST_ENABLED', true),
            airForecast: flag(env, 'GATHER_AIR_FORECAST_ENABLED', true)
        },
        pastCondition: {
            retryCount: pastConditionRetry,
            retryDivisor: pastConditionRetryDivisor
        },
        /**
         * Per-coordinate retry count PastConditionGather passes to requestDataByUpdateList.
         * Always a positive integer, so the decrementing retry count reaches zero.
         * @param {number} updateListLength
         * @returns {number}
         */
        pastConditionRetryCount: function (updateListLength) {
            if (!pastConditionRetryDivisor) {
                return pastConditionRetry;
            }
            return Math.max(1, Math.ceil(updateListLength / pastConditionRetryDivisor));
        },
        // Minimum PM2_5.09KM model images required before KAQ forecasts are parsed.
        // More than 4 images is still rejected as an unexpected new model image.
        kaqMinModelImages: integer(env, 'GATHER_KAQ_MIN_MODEL_IMAGES', 4, 1, 4)
    };
}

module.exports = load(process.env);
module.exports.load = load;
