'use strict';
const time = require('../history/policy');

// Seconds of usable cache life left on the marked Korean civil date.
// A response prepared just before midnight may finish serialization after midnight.
function remainingSeconds(isoDate, now) {
    if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 0;
    const midnight = time.instant(isoDate.replace(/-/g,''));
    if (!Number.isFinite(midnight) || now < midnight) return 0;
    return Math.max(0, Math.floor((midnight + 86400000 - now) / 1000));
}
module.exports = {remainingSeconds};
