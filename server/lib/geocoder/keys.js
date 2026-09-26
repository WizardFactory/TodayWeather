/**
 * Provider key lists for the gateway geocoder (#2606). Dedicated environment names
 * keep the existing KAKAO_SECRET_KEYS / GOOGLE_SECRET_KEY users unaffected.
 */

'use strict';

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

module.exports = {parseKeys: parseKeys};
