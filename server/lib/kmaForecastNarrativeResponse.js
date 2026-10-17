/** Additive JSON only; future clients must render text literally, never as trusted HTML. */
'use strict';
var Narrative = require('./kmaForecastNarrative');
function capCache(res, seconds) {
    if (!res || !res.setHeader) { return; }
    var current = res.getHeader ? String(res.getHeader('Cache-Control') || '') : '';
    var cap = Math.min(300, seconds), parts = [];
    current.split(',').forEach(function (part) {
        part = part.trim();
        var age = /^(?:s-maxage|max-age)\s*=\s*"?(\d+)/i.exec(part);
        if (age) { cap = Math.min(cap, Number(age[1])); }
        else if (part && !/^stale-(?:while-revalidate|if-error)\s*=/i.test(part)) { parts.push(part); }
    });
    parts.push('max-age='+cap);
    if (/(?:^|,)\s*s-maxage\s*=/i.test(current)) { parts.push('s-maxage='+cap); }
    res.setHeader('Cache-Control', parts.join(', '));
}
function attach(result, stationId, res, done, reader) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) { return done(); }
    delete result.forecastNarrative;
    if (!stationId) { return done(); }
    var settled = false;
    function finish() { if (!settled) { settled = true; done(); } }
    try {
        reader = reader || new Narrative();
        reader.read(stationId, function (err, value) {
            if (settled) { return; }
            var remaining = value && new Date(value.expiresAt).getTime()-Date.now();
            if (!err && remaining > 0) {
                result.forecastNarrative = value;
                capCache(res, Math.floor(remaining/1000));
            }
            finish();
        });
    } catch (err) { log.warn('kma narrative optional read failed'); finish(); }
}
module.exports = {attach:attach};
