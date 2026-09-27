/**
 * Provider key lists for the gateway geocoder (#2606). Dedicated environment names
 * keep the existing KAKAO_SECRET_KEYS / GOOGLE_SECRET_KEY users unaffected.
 */

'use strict';

var crypto = require('crypto');

// AK 2026-09-27: the gateway uses a single Google key, the one whose fingerprint (first 8
// hex digits of its SHA-256) is this value. Using another key needs a code change.
var GOOGLE_KEY_FINGERPRINT = 'ecd5fdb1';

/**
 * @param {string|undefined} value JSON array of strings
 * @returns {string[]} an empty list when unset or unparseable
 */
function parseKeys(value) {
    if (typeof value !== 'string' || !value) {
        return [];
    }
    var list;
    try {
        list = JSON.parse(value);
    }
    catch (e) {
        return [];
    }
    if (!Array.isArray(list)) {
        return [];
    }
    return list.filter(function (key) {
        return typeof key === 'string' && key.length > 0;
    });
}

/**
 * A key's fingerprint for logs and allowlists: the first 8 hex digits of its SHA-256.
 */
function fingerprint(key) {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/**
 * The single Google key (GEOCODER_GOOGLE_KEY), used only if its fingerprint is the
 * allowed one. The check is skipped only when requests go to a test stub
 * (GEOCODER_GOOGLE_BASE_URL set), never against the real Google endpoint.
 * @param {string|undefined} value
 * @param {{stub?: boolean}=} options
 * @returns {{key: (string|null), ignored: (string|null)}} ignored is a fingerprint only
 */
function googleKey(value, options) {
    if (typeof value !== 'string' || !value) {
        return {key: null, ignored: null};
    }
    var fp = fingerprint(value);
    if (fp === GOOGLE_KEY_FINGERPRINT || (options && options.stub)) {
        return {key: value, ignored: null};
    }
    return {key: null, ignored: fp};
}

module.exports = {
    parseKeys: parseKeys,
    fingerprint: fingerprint,
    googleKey: googleKey,
    GOOGLE_KEY_FINGERPRINT: GOOGLE_KEY_FINGERPRINT
};
