/**
 * Visual Crossing Timeline body -> Dark Sky-format documents (#2585).
 * DsfController._parseData and the world merge/unit code keep their Dark Sky contract:
 * °F, mph, miles, hPa, in/h, humidity/cloud/probability as 0..1 fractions, English summaries.
 */

'use strict';

const HOUR_SEC = 3600;
const DAY_SEC = 86400;

function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : undefined;
}

// 0 would become the -100 "missing" sentinel in DsfController._parseData; 0.01 °F shows as 0.0 °F / -17.8 °C.
function temperature(value) {
    const t = num(value);
    return t === 0 ? 0.01 : t;
}

function fraction(percent) {
    const value = num(percent);
    return value === undefined ? undefined : value / 100;
}

/**
 * Dark Sky precipType from the Visual Crossing preciptype list.
 * @param {string[]|null} list e.g. ['rain'], ['rain', 'snow'], ['freezingrain']
 * @returns {string|undefined} 'rain', 'snow' or 'sleet'
 */
function precipType(list) {
    if (!Array.isArray(list) || list.length === 0) {
        return undefined;
    }
    const snow = list.indexOf('snow') >= 0;
    const icy = list.indexOf('freezingrain') >= 0 || list.indexOf('ice') >= 0;
    const rain = list.indexOf('rain') >= 0;
    if ((snow && (rain || icy)) || icy) {
        return 'sleet';
    }
    return snow ? 'snow' : rain ? 'rain' : undefined;
}

/**
 * English summary understood by ControllerWeatherDesc.makeWeatherType.
 * @param {Object} row Visual Crossing hour, day or currentConditions
 * @param {number} rate precipitation in inches per hour
 */
function summaryOf(row, rate) {
    const type = precipType(row.preciptype) || (row.icon === 'snow' ? 'snow' : 'rain');
    const observedWet = row.source !== 'fcst' && rate > 0;
    const wet = row.icon === 'rain' || row.icon === 'snow' || observedWet;
    if (wet && /thunder/i.test(row.conditions || '')) {
        return 'thundershowers';
    }
    if (wet) {
        if (rate <= 0 && row.source === 'fcst') {
            return type === 'sleet' ? 'light sleet' : 'possible light ' + type;
        }
        // 0.098 in/h = 2.5 mm/h, 0.3 in/h = 7.6 mm/h: the light/moderate/heavy rain bands.
        return rate < 0.098 ? 'light ' + type : rate < 0.3 ? type : 'heavy ' + type;
    }
    if (row.icon === 'fog' || (num(row.visibility) !== undefined && row.visibility < 0.62)) {
        return 'fog';
    }
    if (row.icon === 'wind') {
        return 'windy';
    }
    const cloud = num(row.cloudcover) || 0;
    return cloud <= 20 ? 'clear' : cloud <= 50 ? 'partly cloudy' : cloud <= 80 ? 'mostly cloudy' : 'overcast';
}

function iconOf(row, rate) {
    const type = precipType(row.preciptype);
    if (row.source !== 'fcst' && rate > 0) {
        return type || 'rain';
    }
    if ((row.icon === 'rain' || row.icon === 'snow') && type === 'sleet') {
        return 'sleet';
    }
    return row.icon;
}

/**
 * Dark Sky data point for a Visual Crossing hour or current conditions.
 * @param {Object} row
 * @param {number} [time] epoch seconds; defaults to row.datetimeEpoch
 */
function toDarkSkyHour(row, time) {
    const rate = num(row.precip) || 0;
    return {
        time: time === undefined ? row.datetimeEpoch : time,
        summary: summaryOf(row, rate),
        icon: iconOf(row, rate),
        precipIntensity: rate,
        precipProbability: fraction(row.precipprob),
        precipType: precipType(row.preciptype),
        temperature: temperature(row.temp),
        apparentTemperature: temperature(row.feelslike),
        humidity: fraction(row.humidity),
        windSpeed: num(row.windspeed),
        // 0 would become the -100 "missing" sentinel in DsfController._parseData; north is 360°.
        windBearing: num(row.winddir) === 0 ? 360 : num(row.winddir),
        visibility: num(row.visibility),
        cloudCover: fraction(row.cloudcover),
        pressure: num(row.pressure)
    };
}

function extreme(hours, field, pickMax) {
    let best;
    hours.forEach((hour) => {
        const value = num(hour[field]);
        if (value !== undefined && (best === undefined || (pickMax ? value > best.value : value < best.value))) {
            best = {value: value, time: hour.datetimeEpoch};
        }
    });
    return best || {};
}

/**
 * Dark Sky daily data point; times of extremes are taken from the day's hours.
 * @param {Object} day Visual Crossing day with hours
 * @param {number} time local midnight in epoch seconds
 */
function toDarkSkyDay(day, time) {
    const hours = day.hours || [];
    const total = num(day.precip) || 0;
    const wettest = extreme(hours, 'precip', true);
    const point = toDarkSkyHour(day, time);
    // Daily text uses the average hourly rate, as the hourly thresholds expect.
    point.summary = summaryOf(day, total / 24);
    point.icon = iconOf(day, total);
    point.precipIntensity = total / 24;
    point.precipIntensityMax = wettest.value === undefined ? 0 : wettest.value;
    point.precipIntensityMaxTime = wettest.time === undefined ? time : wettest.time;
    point.sunriseTime = num(day.sunriseEpoch);
    point.sunsetTime = num(day.sunsetEpoch);
    point.moonPhase = num(day.moonphase);
    point.temperatureMax = temperature(day.tempmax);
    point.temperatureMaxTime = extreme(hours, 'temp', true).time;
    point.temperatureMin = temperature(day.tempmin);
    point.temperatureMinTime = extreme(hours, 'temp', false).time;
    point.apparentTemperatureMax = temperature(day.feelslikemax);
    point.apparentTemperatureMaxTime = extreme(hours, 'feelslike', true).time;
    point.apparentTemperatureMin = temperature(day.feelslikemin);
    point.apparentTemperatureMinTime = extreme(hours, 'feelslike', false).time;
    return point;
}

/**
 * UTC offset in hours at `nowSec`. The body's top-level tzoffset is the offset at the start of
 * the requested range, which differs after a daylight-saving change; each hour row carries its
 * local wall time and epoch, so the latest row at or before now gives the current offset.
 */
function offsetAt(vc, nowSec) {
    let best;
    (vc.days || []).forEach((day) => {
        (day.hours || []).forEach((hour) => {
            if (hour.datetimeEpoch <= nowSec && (!best || hour.datetimeEpoch > best.hour.datetimeEpoch)) {
                best = {day: day, hour: hour};
            }
        });
    });
    if (!best) {
        return vc.tzoffset;
    }
    return (Date.parse(best.day.datetime + 'T' + best.hour.datetime + 'Z') / 1000 - best.hour.datetimeEpoch) / HOUR_SEC;
}

function localDateString(epochSec, offsetHours) {
    return new Date((epochSec + offsetHours * HOUR_SEC) * 1000).toISOString().slice(0, 10);
}

/**
 * Split a Timeline body into the three DsfForecast record kinds.
 * Record times follow the local day of `now` at the UTC offset in effect at `now`, so
 * DsfController._findDataFromDB classifies them like the former Time Machine records.
 * @param {Object} vc Timeline body (unitGroup=us, include=days,hours,current)
 * @param {Date} now fetch time
 * @returns {{timezone: string, offsetMin: number, yesterday: Object=, today: Object, current: Object}}
 */
function toDarkSkyDocs(vc, now) {
    const nowSec = Math.floor(now.getTime() / 1000);
    const offset = offsetAt(vc, nowSec);
    const todayStr = localDateString(nowSec, offset);
    const todayStart = Date.parse(todayStr + 'T00:00:00Z') / 1000 - offset * HOUR_SEC;
    const yesterdayStr = localDateString(todayStart - DAY_SEC, offset);
    const days = vc.days || [];
    const todayIndex = days.findIndex((day) => day.datetime === todayStr);
    if (todayIndex < 0) {
        throw new Error('VC> response has no local today ' + todayStr + ' for ' + vc.timezone);
    }

    const make = (currently, hours, dailyPoints) => ({
        timezone: vc.timezone,
        offset: offset,
        currently: currently,
        hourly: {summary: '', data: hours.map((hour) => toDarkSkyHour(hour))},
        daily: {summary: '', data: dailyPoints}
    });
    const dayRecord = (day, start) => {
        const hours = day.hours || [];
        const first = hours.length > 0 ? toDarkSkyHour(hours[0], start) : toDarkSkyHour(day, start);
        return make(first, hours, [toDarkSkyDay(day, start)]);
    };

    const docs = {timezone: vc.timezone, offsetMin: Math.round(offset * 60)};
    const yesterday = days.find((day) => day.datetime === yesterdayStr);
    if (yesterday) {
        docs.yesterday = dayRecord(yesterday, todayStart - DAY_SEC);
    }
    docs.today = dayRecord(days[todayIndex], todayStart);

    const hourStart = Math.floor(nowSec / HOUR_SEC) * HOUR_SEC;
    const ahead = [];
    days.slice(todayIndex).forEach((day) => {
        (day.hours || []).forEach((hour) => {
            if (hour.datetimeEpoch >= hourStart && hour.datetimeEpoch <= hourStart + 48 * HOUR_SEC) {
                ahead.push(hour);
            }
        });
    });
    const dailyAhead = days.slice(todayIndex, todayIndex + 8).map((day, i) => toDarkSkyDay(day, todayStart + i * DAY_SEC));
    const current = vc.currentConditions || (days[todayIndex].hours || []).find((hour) => hour.datetimeEpoch === hourStart) || days[todayIndex];
    docs.current = make(toDarkSkyHour(current, nowSec), ahead, dailyAhead);
    return docs;
}

module.exports = {
    toDarkSkyDocs: toDarkSkyDocs,
    toDarkSkyHour: toDarkSkyHour,
    toDarkSkyDay: toDarkSkyDay,
    precipType: precipType,
    summaryOf: summaryOf,
    offsetAt: offsetAt
};
