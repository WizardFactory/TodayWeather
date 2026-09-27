/**
 * data.go.kr gateway/API rejection codes shared by the forecast collector and the
 * warning requester (#2604). Only the code classification is shared; each caller keeps
 * its own response contract.
 */

"use strict";

// 20 access denied, 30 unregistered key, 31 expired key, 32 unregistered IP.
var AUTH_CODES = ['20', '30', '31', '32'];
// 22 is the daily request limit (LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR).
var QUOTA_CODE = '22';

/**
 * The gateway can answer XML with any HTTP status, even when JSON is requested.
 * @param body response body
 * @returns {string|undefined} first returnReasonCode/resultCode digits
 */
function code(body) {
    if (typeof body !== 'string') {
        return undefined;
    }
    var match = /<(returnReasonCode|resultCode)>\s*(\d+)\s*</.exec(body);
    return match ? match[2] : undefined;
}

function isQuota(statusCode, reasonCode) {
    return statusCode === 429 || reasonCode === QUOTA_CODE;
}

function isAuth(statusCode, reasonCode) {
    return statusCode === 401 || statusCode === 403 || AUTH_CODES.indexOf(reasonCode) !== -1;
}

module.exports = {
    code: code,
    isQuota: isQuota,
    isAuth: isAuth
};
