'use strict';

// Internal DSF-to-gateway contract. Unknown failures must retain their old mapping.
var CODE = 'EWEATHERUNAVAILABLE';
var MAX_RETRY_SECONDS = 3600;

function isUnavailable(value) {
    return !!value && value.code === CODE && typeof value.retryAt === 'number' &&
        isFinite(value.retryAt) && value.retryAt > 0;
}

function retryAfter(value) {
    // Round down to avoid extending a marker/budget window. The final fractional
    // second (or an expiry crossed in transit) needs the minimum positive value.
    return Math.max(1, Math.min(MAX_RETRY_SECONDS, Math.floor((value.retryAt - Date.now()) / 1000)));
}

module.exports = {isUnavailable: isUnavailable, retryAfter: retryAfter};
