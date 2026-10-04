'use strict';
// Typed, retryable weather-preparation failure. Fields are fixed codes only: no URL, coordinate,
// token or provider payload may be attached because dispatcher results are persisted.
class PreparationError extends Error {
    constructor(code, retryable) {
        super('Push preparation failed: ' + code);
        this.name = 'PreparationError';
        this.stage = 'preparation';
        this.code = code;
        this.retryable = !!retryable;
    }
}
// Persisted failure reasons must be short identifiers; anything else (messages, tokens, URLs) is dropped.
function safeReason(value, fallback) {
    var text = typeof value === 'number' ? String(value) : value;
    return typeof text === 'string' && /^[A-Za-z0-9_.:\/-]{1,64}$/.test(text) ? text : fallback || 'unknown';
}
module.exports = { PreparationError: PreparationError, safeReason: safeReason };
