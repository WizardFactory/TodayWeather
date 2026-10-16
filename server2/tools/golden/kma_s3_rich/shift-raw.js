'use strict';
// Only generated provider inputs/acquisition metadata use this function. Never
// apply it to saved documents, reader results or expected HTTP responses.
const DAY = 86400000;
function shiftRaw(value, days) {
    if (typeof value === 'number' && value > 1e12 && value < 2e12) return value + days * DAY;
    if (Array.isArray(value)) return value.map(v => shiftRaw(v, days));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,shiftRaw(v,days)]));
    if (typeof value !== 'string') return value;
    return value.replace(/2026[-./]?(?:09|10)[-./]?\d\d/g, old => {
        const digits = old.replace(/\D/g,'');
        const day = new Date(Date.UTC(+digits.slice(0,4), +digits.slice(4,6)-1, +digits.slice(6,8)) + days * DAY).toISOString().slice(0,10);
        const sep = old.match(/[-./]/);
        return sep ? day.replace(/-/g,sep[0]) : day.replace(/-/g,'');
    });
}
module.exports = {shiftRaw};
