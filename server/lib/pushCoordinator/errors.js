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
// Persisted failure reasons come from a closed list of codes (or an HTTP status); any other value, which
// could carry a message, token, credential or location, is replaced by 'unknown'.
var REASONS = new Set([
    'weather-timeout',
    'weather-unavailable',
    'weather-rejected',
    'weather-deadline',
    'preparation-error',
    'preparation-attempts-exhausted',
    'transport-error',
    'transport-timeout-ambiguous',
    'transport-ambiguous',
    'transport-retry-deadline',
    'project-paused',
    'authentication',
    'stopped'
]);
var MESSAGING = new Set([
    'registration-token-not-registered',
    'invalid-registration-token',
    'invalid-argument',
    'invalid-payload',
    'invalid-apns-credentials',
    'mismatched-credential',
    'authentication-error',
    'third-party-auth-error',
    'server-unavailable',
    'internal-error',
    'message-rate-exceeded',
    'device-message-rate-exceeded',
    'payload-size-limit-exceeded',
    'unknown-error'
]);
function safeReason(value, fallback) {
    var text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string') {
        if (REASONS.has(text)) return text;
        if (text.indexOf('messaging/') === 0 && MESSAGING.has(text.slice(10))) return text;
        if (/^[1-5][0-9][0-9]$/.test(text)) return text;
    }
    return fallback || 'unknown';
}
module.exports = { PreparationError: PreparationError, safeReason: safeReason };
