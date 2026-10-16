'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const {shiftRaw} = require('./shift-raw');
const DAY = 86400000;
const callback = fn => new Promise((resolve,reject) => fn((err,value) => err ? reject(err) : resolve(value)));
async function collectRich(L, context, now, stationSeed) {
    global.ORACLE_STATION_SEED = stationSeed;
    const station = (await require('./sections-stn').stn(L))[0];
    const F = require('./air-fixtures');
    const stationLists = F.stationLists, forecasts = F.forecasts, nationals = F.nationals;
    F.nationals = base => nationals(base).filter(r => r.fetched <= now);
    F.stationLists = () => shiftRaw(stationLists(), 1);
    F.forecasts = () => shiftRaw(forecasts(), 1).filter(r => r.fetched <= now).map(run => {
        run.pages = run.pages.map(page => {
            const value = JSON.parse(page);
            for (const item of value.response.body.items) {
                item.imageUrl7 = 'https://www.airkorea.or.kr/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM10.2days.ani.gif';
                item.imageUrl8 = 'https://www.airkorea.or.kr/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM2P5.2days.ani.gif';
            }
            return JSON.stringify(value);
        });
        return run;
    });
    // nationals(base) is shifted by its actual requested base, not after conversion.
    const air = await require('./sections-air').air(L, context);
    const area = await require('./sections-area').area(L, context);
    const life = await require('./sections-life').life(L, context);
    const kasi = await require('./sections-kasi').kasi(L, context);
    const mfds = await require('./sections-mfds').mfds(L, context);
    const asos = await require('./sections-rich-asos').asos(L, context, now);
    return {station, air, area, life, kasi, mfds, asos};
}
module.exports = {collectRich};
