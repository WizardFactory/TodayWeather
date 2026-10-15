'use strict';
const {createLoader, logger} = require('./air-harness');
const async = require('async');
const nominal = [[105,0,0],[130,0,0],[155,0,0],[180,0,0],[205,0,0],[230,0,0],[255,0,0],
    [255,60,60],[255,90,90],[255,120,120],[255,150,150],[100,100,0],[115,115,0],[131,131,0],
    [146,146,0],[162,162,0],[177,177,0],[193,193,0],[208,208,0],[224,224,0],[240,240,0],
    [0,118,0],[0,138,0],[0,157,0],[0,177,0],[0,195,0],[0,216,0],[0,234,0],[0,254,0],
    [100,254,100],[149,254,149],[53,150,249],[76,162,244],[100,175,240],[135,192,232],[152,201,228]];
function pixels(options = {}) {
    return {shape: options.shape || [48,820,820,4], get(frame,x,y,channel) {
        if (channel === 3) return 255;
        if (x === 680 && y >= 74 && y < 775) {
            const band = Math.min(35, Math.floor((y-74)*36/701));
            if (options.badLegend && frame === 47 && band === 10) return 255;
            return nominal[band][channel]+(options.paletteDelta && band === 21 && channel === 1 ? options.paletteDelta : 0);
        }
        if (options.unknown) return 0;
        const band = options.band === undefined ? 31 : options.band;
        return nominal[band][channel]+(options.paletteDelta && band === 21 && channel === 1 ? options.paletteDelta : 0);
    }};
}
function imagePath(code = 'pm10', day = '2026/10/14', hour = '23') {
    return 'https://www.airkorea.or.kr/dustImage/' + day + '/' + hour + '/09km/AQF.' + day.replace(/\//g,'') +
        '.NIER_09_01.' + (code === 'pm25' ? 'PM2P5' : 'PM10') + '.2days.ani.gif';
}
function harness(options = {}) {
    const rows = [], logs = [];
    const model = {
        find(query) {
            const q = {lean: () => q, sort: () => q, exec(cb) {
                cb(null, rows.filter(row => Object.keys(query).every(k => row[k] === query[k])));
            }}; return q;
        },
        update(query,row,opts,cb) {rows.push(row); cb();},
        remove(query,cb) {if (cb) cb();}
    };
    const original = ['PM10','PM25'].map(code => {
        const urls = []; urls[code === 'PM10' ? 6 : 7] = imagePath(code.toLowerCase());
        return {dataTime:'2026-10-15 11시 발표',informCode:code,imageUrl:urls};
    });
    function queryModel(rows) {return {find(q) {
        const query = {lean: () => query, exec(cb) {cb(null,rows.filter(row => Object.keys(q).every(k => row[k] === q[k])));}};
        return query;
    }};}
    const loader = createLoader({log: logger(logs), allowNodeModules: ['url'], globals: {process: {env: options.env || {}}}, overrides: {
        async, 'get-pixels': options.getPixels || ((path,type,cb) => cb(null, options.pixels || pixels())),
        'models/modelMinuDustFrcst.js': queryModel(original), 'models/arpltn.hourly.forecast.js': model,
        'models/modelMsrStnInfo.js': queryModel([{stationName:'synthetic-seoul',geo:[126.978,37.5665]}]),
        'lib/kmaTimeLib.js': {convertYYYY_MM_DD_HHStr2YYYY_MM_DD_HHoZZ: str => str.slice(0,13)+':00',
            toTimeZone: () => new Date('2030-01-01T23:30:00Z')}
    }});
    const config = loader.load('config/config.js');
    if (options.config) Object.assign(config.image.airkorea_korea_image, options.config);
    const Parser = loader.load('lib/airkorea.finedust.image.parser.js');
    const Dust = loader.load('controllers/airkorea.dust.image.controller.js');
    const Hourly = loader.load('controllers/airkorea.hourly.forecast.controller.js');
    return {loader, config, parser: new Parser(), dust: new Dust(), hourly: new Hourly(), rows, logs};
}
function invoke(obj, method, ...args) {
    return new Promise((resolve,reject) => obj[method](...args,(err,value) => err ? reject(err) : resolve(value)));
}
async function pipeline(h, paths) {
    await invoke(h.dust, 'getDustImage', paths || {pubDate:'2026-10-15 11:00',pm10:imagePath(),pm25:imagePath('pm25')});
    h.hourly.airkoreaDustImageMgr = h.dust;
    await invoke(h.hourly, '_updateHourlyForecast', ['pm10','pm25'], [{stationName:'synthetic-seoul',geo:[126.978,37.5665]}]);
    return invoke(h.hourly, 'getForecast', 'synthetic-seoul');
}
module.exports = {nominal, pixels, imagePath, harness, invoke, pipeline};
