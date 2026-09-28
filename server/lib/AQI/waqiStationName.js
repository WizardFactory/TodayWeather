/**
 * WAQI station names can be whole addresses with a native-script name, e.g.
 * "Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)". Long names are reduced to their
 * smallest unit, the first comma-separated part without the parenthesized name (#2622).
 */

"use strict";

var STATION_NAME_MAX_LENGTH = 20;

function shorten(name) {
    if (typeof name !== 'string') {
        return name;
    }
    var trimmed = name.trim();
    if (trimmed.length <= STATION_NAME_MAX_LENGTH) {
        return trimmed;
    }
    var first = trimmed.replace(/[(（][^)）]*[)）]/g, ' ').split(/[,，、]/)[0].replace(/\s+/g, ' ').trim();
    return first || trimmed;
}

module.exports = {
    STATION_NAME_MAX_LENGTH: STATION_NAME_MAX_LENGTH,
    shorten: shorten
};
