/**
 * KMA forecast precipitation amounts (#2583, D45).
 *
 * VilageFcstInfoService_2.0 reports PCP/forecast RN1 (mm) and SNO (cm) per hour, either as a
 * number or as a category: "1mm 미만", "30.0~50.0mm", "50.0mm 이상". A parsed value keeps a
 * representative amount plus its bounds, so sums over hours stay honest about categories.
 */
"use strict";

var NUMBER = '(\\d+(?:\\.\\d+)?)';

function round(value) {
    return Math.round(value * 10) / 10;
}

function exact(amount) {
    return {amount: round(amount), min: round(amount), max: round(amount), approx: false};
}

/**
 * An exact amount accumulated over the given hours, or null for a missing amount.
 */
exports.exact = function (amount, hours) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) {
        return null;
    }
    var result = exact(amount);
    result.hours = hours;
    return result;
};

/**
 * @param value provider text or number
 * @param unit 'mm' or 'cm'; the suffix is optional in the text
 * @param noValue text meaning zero, e.g. '강수없음' or '적설없음'
 * @returns {{amount: number, min: number, max: (number|null), approx: boolean}|null}
 *   max is null when the category has no upper bound. null means unparseable.
 */
exports.parse = function (value, unit, noValue) {
    if (typeof value === 'number') {
        return isFinite(value) && value >= 0 ? exact(value) : null;
    }
    if (typeof value !== 'string') {
        return null;
    }
    var text = value.trim();
    if (noValue && text === noValue) {
        return exact(0);
    }
    var u = '(?:\\s*' + unit + ')?';
    var match = text.match(new RegExp('^' + NUMBER + u + '$'));
    if (match) {
        return exact(+match[1]);
    }
    match = text.match(new RegExp('^' + NUMBER + u + '\\s*미만$'));
    if (match && +match[1] > 0) {
        // Representative amount: half of the threshold.
        return {amount: round(+match[1] / 2), min: 0, max: round(+match[1]), approx: true};
    }
    match = text.match(new RegExp('^' + NUMBER + u + '\\s*~\\s*' + NUMBER + u + '$'));
    if (match && +match[1] < +match[2]) {
        // Representative amount: midpoint of the range.
        return {amount: round((+match[1] + +match[2]) / 2), min: round(+match[1]), max: round(+match[2]), approx: true};
    }
    match = text.match(new RegExp('^' + NUMBER + u + '\\s*이상$'));
    if (match) {
        // Representative amount: the lower bound.
        return {amount: round(+match[1]), min: round(+match[1]), max: null, approx: true};
    }
    return null;
};

/**
 * Stored value to parsed value. Category text wins; a stored amount without text is exact
 * (rows from the deployed parseFloat collector have no text).
 */
exports.read = function (amount, text, unit) {
    var parsed = typeof text === 'string' ? exports.parse(text, unit) : null;
    if (parsed && parsed.approx) {
        return parsed;
    }
    return exports.parse(typeof amount === 'number' ? amount : undefined, unit);
};

/**
 * Sum of parsed values. Each item counts as one hour unless it states its own hours.
 * @returns {{amount, min, max, approx, hours}|null} null when no item is usable
 */
exports.total = function (list) {
    var items = (list || []).filter(function (item) { return item; });
    if (!items.length) {
        return null;
    }
    var result = {amount: 0, min: 0, max: 0, approx: false, hours: 0};
    items.forEach(function (item) {
        result.amount += item.amount;
        result.min += item.min;
        result.max = result.max === null || item.max === null ? null : result.max + item.max;
        result.approx = result.approx || item.approx;
        result.hours += item.hours === undefined ? 1 : item.hours;
    });
    result.amount = round(result.amount);
    result.min = round(result.min);
    result.max = result.max === null ? null : round(result.max);
    return result;
};

/**
 * Literal-unit text, independent of the requested units (as the retired table was).
 * '10mm', '~1mm' (below 1), '30~51mm', '50~?mm' (no upper bound).
 */
exports.format = function (total, unit) {
    if (!total) {
        return '';
    }
    if (!total.approx) {
        return total.amount + unit;
    }
    if (total.max === null) {
        return total.min + '~?' + unit;
    }
    if (total.min === 0) {
        return '~' + total.max + unit;
    }
    return total.min + '~' + total.max + unit;
};

/**
 * Copy stored category text for fields that the service sums later.
 */
exports.copyText = function (source, target, fields) {
    fields.forEach(function (field) {
        if (typeof source[field + 'Text'] === 'string') {
            target[field + 'Text'] = source[field + 'Text'];
        }
    });
    return target;
};

// Bounds stay with the row object but never reach the JSON response.
var kept = new WeakMap();

function keep(row, field, total) {
    var fields = kept.get(row);
    if (!fields) {
        fields = {};
        kept.set(row, fields);
    }
    fields[field] = total;
}

exports.get = function (row, field) {
    var fields = row && kept.get(row);
    return fields ? fields[field] : undefined;
};

/**
 * Keep a total that a later step applies, without touching the row's public fields.
 */
exports.keep = function (row, field, total) {
    keep(row, field, total || undefined);
};

/**
 * Set an amount with its period (hours summed) and approximation flag.
 * A null total writes the -1 sentinel and removes the period fields.
 */
exports.assign = function (row, field, total) {
    if (!total) {
        row[field] = -1;
        delete row[field + 'Hours'];
        delete row[field + 'Approx'];
        keep(row, field, undefined);
        return row;
    }
    row[field] = total.amount;
    row[field + 'Hours'] = total.hours;
    row[field + 'Approx'] = total.approx;
    keep(row, field, total);
    return row;
};

/**
 * Remove an amount whose period is unknown, with its period fields.
 */
exports.clear = function (row, field) {
    delete row[field];
    delete row[field + 'Hours'];
    delete row[field + 'Approx'];
    keep(row, field, undefined);
    return row;
};

/**
 * A stored hourly shortest forecast: rn1 with a one-hour period and approximation flag.
 * The stored category text stays out of the row.
 */
exports.readShortest = function (row, stored) {
    var total = exports.read(stored.rn1, stored.rn1Text, 'mm');
    if (total) {
        total.hours = 1;
        exports.assign(row, 'rn1', total);
    }
    return row;
};

/**
 * Response form for a forecast slot: never negative, always with a period.
 * A missing amount becomes a 0 placeholder over 0 hours.
 */
exports.finalize = function (row, field) {
    if (exports.get(row, field)) {
        return row;
    }
    return exports.assign(row, field, exports.exact(row[field], 3) || exports.exact(0, 0));
};
