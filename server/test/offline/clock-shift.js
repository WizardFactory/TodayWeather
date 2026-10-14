'use strict';
/* Test-only preload: runs a test process as if the real date were TW_CLOCK_SHIFT_DAYS later.
 * Fixed-date fixtures must keep passing however long after they were written the tests run; the
 * KMA grid smokes broke once the real date passed their 2026-10-03 slots by nine days.
 * Usage: NODE_OPTIONS=--require=<this file> TW_CLOCK_SHIFT_DAYS=400 node <test>
 * Only the current time moves; explicit dates and date arithmetic are unchanged. */
var days = Number(process.env.TW_CLOCK_SHIFT_DAYS || 0);
if (days) {
    var shift = days * 86400000;
    var RealDate = Date;
    var ShiftedDate = function Date(a, b, c, d, e, f, g) {
        if (!(this instanceof ShiftedDate)) { return new RealDate(RealDate.now() + shift).toString(); }
        var args = arguments.length ? Array.prototype.slice.call(arguments) : [RealDate.now() + shift];
        return new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
    };
    ShiftedDate.prototype = RealDate.prototype;
    ShiftedDate.now = function () { return RealDate.now() + shift; };
    ShiftedDate.UTC = RealDate.UTC;
    ShiftedDate.parse = RealDate.parse;
    global.Date = ShiftedDate;
}
