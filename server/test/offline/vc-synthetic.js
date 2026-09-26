/* Synthetic Visual Crossing Timeline bodies for offline tests (#2585).
 * Built with Intl like Visual Crossing's local days: hour rows at local wall-clock hours,
 * day epochs at local midnight, and the top-level tzoffset of the range start (observed
 * live for Pacific/Auckland on 2026-09-26). Past hours are `obs`, later hours `fcst`.
 * Options:
 *   now          epoch ms used to mark obs/fcst rows (default: range start)
 *   hour(row)    returns fields merged into each hour row
 *   day(day)     returns fields merged into each day
 *   current      fields merged into currentConditions; `false` omits currentConditions
 *   polar        null sunrise/sunset
 */
'use strict';

function localParts(zone) {
    const fmt = new Intl.DateTimeFormat('en-US', {timeZone: zone, hour12: false, year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit'});
    return epoch => {
        const p = {};
        fmt.formatToParts(new Date(epoch * 1000)).forEach(x => { p[x.type] = x.value; });
        return {date: p.year + '-' + p.month + '-' + p.day, hour: p.hour === '24' ? 0 : Number(p.hour), minute: Number(p.minute)};
    };
}

function syntheticTimeline(zone, firstDay, days, options) {
    options = options || {};
    const local = localParts(zone);
    const offsetAt = epoch => { const l = local(epoch); return (Date.parse(l.date + 'T' + String(l.hour).padStart(2, '0') + ':' + String(l.minute).padStart(2, '0') + ':00Z') / 1000 - epoch) / 3600; };
    // Start of firstDay: the first quarter hour on that local date (covers +5:45 and +12:45 zones, and
    // days whose 00:00 is skipped by a daylight-saving change, such as America/Santiago).
    let epoch = Date.parse(firstDay + 'T00:00:00Z') / 1000 - 15 * 3600;
    while (local(epoch).date !== firstDay) epoch += 900;
    const nowSec = Math.floor((options.now || epoch * 1000) / 1000);
    const byDay = new Map();
    for (; byDay.size <= days; epoch += 3600) {
        const l = local(epoch);
        if (!byDay.has(l.date)) byDay.set(l.date, []);
        const row = {datetime: String(l.hour).padStart(2, '0') + ':' + String(l.minute).padStart(2, '0') + ':00', datetimeEpoch: epoch,
            temp: 50 + l.hour, feelslike: 50 + l.hour, humidity: 60, precip: 0, precipprob: 0, preciptype: null, windspeed: 5, winddir: 90,
            pressure: 1010, visibility: 9, cloudcover: 30, conditions: 'Partially cloudy', icon: 'partly-cloudy-day',
            source: epoch <= nowSec ? 'obs' : 'fcst'};
        byDay.get(l.date).push(Object.assign(row, options.hour ? options.hour(row) : {}));
    }
    const list = [...byDay.entries()].slice(0, days).map(([date, hours]) => {
        const first = hours[0].datetimeEpoch;
        const day = {datetime: date, datetimeEpoch: first, tempmax: 73, tempmin: 50, feelslikemax: 73, feelslikemin: 50, humidity: 60,
            precip: 0, precipprob: 0, preciptype: null, windspeed: 5, winddir: 90, pressure: 1010, visibility: 9, cloudcover: 30,
            conditions: 'Partially cloudy', icon: 'partly-cloudy-day', source: first + 86400 <= nowSec ? 'obs' : first <= nowSec ? 'comb' : 'fcst',
            sunriseEpoch: options.polar ? null : first + 6 * 3600, sunsetEpoch: options.polar ? null : first + 18 * 3600, moonphase: 0.5, hours};
        return Object.assign(day, options.day ? options.day(day) : {});
    });
    const body = {queryCost: 25, timezone: zone, tzoffset: offsetAt(list[0].datetimeEpoch), days: list};
    if (options.current !== false) {
        const all = [].concat(...list.map(d => d.hours));
        const last = all.filter(h => h.datetimeEpoch <= nowSec).pop() || all[0];
        body.currentConditions = Object.assign({}, last, {source: 'obs'}, options.current || {});
    }
    return body;
}

module.exports = {syntheticTimeline, localParts};
