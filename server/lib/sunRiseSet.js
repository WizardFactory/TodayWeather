/**
 * Sunrise and sunset computed from the NOAA solar position equations (#2587).
 * Used when the KASI rise/set store has no row for a day.
 * Results are KST wall-clock strings and do not depend on the host time zone.
 */

'use strict';

var KST_OFFSET_MINUTES = 9 * 60;
// Standard altitude of the upper limb with atmospheric refraction, as KASI uses.
var SUN_ALTITUDE = -0.833;

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

/**
 * Julian day at 0h UT of a Gregorian calendar date.
 */
function julianDay(year, month, day) {
    if (month <= 2) {
        year -= 1;
        month += 12;
    }
    var a = Math.floor(year / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5;
}

/**
 * @param jd julian day of the instant
 * @returns {{declination: number, equationOfTime: number}} degrees, minutes
 */
function solarPosition(jd) {
    var t = (jd - 2451545.0) / 36525.0;
    var meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
    var meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    var eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    var m = toRad(meanAnomaly);
    var center = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
        Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289;
    var omega = toRad(125.04 - 1934.136 * t);
    var apparentLong = toRad(meanLong + center - 0.00569 - 0.00478 * Math.sin(omega));
    var meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    var obliq = toRad(meanObliq + 0.00256 * Math.cos(omega));
    var declination = toDeg(Math.asin(Math.sin(obliq) * Math.sin(apparentLong)));

    var y = Math.pow(Math.tan(obliq / 2), 2);
    var l0 = toRad(meanLong);
    var equationOfTime = 4 * toDeg(y * Math.sin(2 * l0) - 2 * eccent * Math.sin(m) +
        4 * eccent * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) -
        1.25 * eccent * eccent * Math.sin(2 * m));

    return {declination: declination, equationOfTime: equationOfTime};
}

/**
 * @param jd0 julian day at 0h UT of the date
 * @param lat degrees
 * @param lon degrees, east positive
 * @param rising true for sunrise
 * @returns {number|undefined} minutes after 0h UT of the date
 */
function eventUtcMinutes(jd0, lat, lon, rising) {
    var minutes = 720 - 4 * lon;
    // Recompute at the previous estimate; two passes converge to seconds.
    for (var i = 0; i < 3; i++) {
        var pos = solarPosition(jd0 + minutes / 1440);
        var latRad = toRad(lat);
        var declRad = toRad(pos.declination);
        var cosHourAngle = (Math.sin(toRad(SUN_ALTITUDE)) - Math.sin(latRad) * Math.sin(declRad)) /
            (Math.cos(latRad) * Math.cos(declRad));
        if (cosHourAngle < -1 || cosHourAngle > 1) {
            return undefined;
        }
        var hourAngle = toDeg(Math.acos(cosHourAngle));
        minutes = 720 - 4 * (lon + (rising ? hourAngle : -hourAngle)) - pos.equationOfTime;
    }
    return minutes;
}

function pad2(n) {
    return (n < 10 ? '0' : '') + n;
}

/**
 * @param year
 * @param month 1-12
 * @param day
 * @param utcMinutes minutes after 0h UT of the KST date
 * @returns {string} YYYY.MM.DD HH:MM in KST, seconds truncated
 */
function formatKst(year, month, day, utcMinutes) {
    var ms = Date.UTC(year, month - 1, day) + Math.floor((utcMinutes + KST_OFFSET_MINUTES) * 60) * 1000;
    var d = new Date(ms);
    return d.getUTCFullYear() + '.' + pad2(d.getUTCMonth() + 1) + '.' + pad2(d.getUTCDate()) + ' ' +
        pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

/**
 * @param lat degrees
 * @param lon degrees, east positive
 * @param strDate YYYYMMDD (KST date)
 * @returns {{sunrise: string, sunset: string}|undefined}
 */
function compute(lat, lon, strDate) {
    lat = Number(lat);
    lon = Number(lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 ||
        typeof strDate !== 'string' || !/^\d{8}$/.test(strDate)) {
        return undefined;
    }

    var year = parseInt(strDate.slice(0, 4), 10);
    var month = parseInt(strDate.slice(4, 6), 10);
    var day = parseInt(strDate.slice(6, 8), 10);
    var check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        return undefined;
    }

    var jd0 = julianDay(year, month, day);
    var rise = eventUtcMinutes(jd0, lat, lon, true);
    var set = eventUtcMinutes(jd0, lat, lon, false);
    if (rise === undefined || set === undefined) {
        return undefined;
    }

    return {sunrise: formatKst(year, month, day, rise), sunset: formatKst(year, month, day, set)};
}

module.exports = {compute: compute};
