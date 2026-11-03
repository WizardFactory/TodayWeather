'use strict';
// Real legacy modules and Town schema; isolate startup, providers and collections.
const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const h = require('./harness');
const clone = value => JSON.parse(JSON.stringify(value));
const seed = () => ({town: {first: '서울특별시', second: '중구', third: '기존동'},
    gCoord: {lat: 37.56, lon: 126.97}, mCoord: {mx: 60, my: 127}, areaNo: '1114000000'});
const address = {region: '서울특별시', city: '중구', town: '새로운동'};
const coordinates = {lat: '37.56649', lon: '126.97851', mx: 60, my: 127};
function TownModel(instance) {
    return h.load('models/town.js', {mongoose: instance});
}
function controllers(Town, geocode) {
    function Unused() {}
    const Geo = h.load('controllers/geo.controller.js', {axios: {}, async: require('async'),
        request: {}, dnscache: () => ({}), '../config/config': {keyString: {daum_keys: '[]'}}}, {log: h.logger([])});
    const deps = {async: require('async'), sprintf: require('sprintf'),
        '../config/config': {db: {version: '2.0'}}, '../models/town': Town,
        '../utils/convertGeocode': geocode, './geo.controller': Geo,
        '../lib/midForecastPolicy': require('../../lib/midForecastPolicy'),
        '../lib/kmaPrecipitation': require('../../lib/kmaPrecipitation'),
        '../lib/history/observations': require('../../lib/history/observations'),
        '../lib/kmaTimeLib': require('../../lib/kmaTimeLib'),
        '../lib/unitConverter': require('../../lib/unitConverter'),
        '../lib/aqi.converter': require('../../lib/aqi.converter')};
    ['modelShort', 'modelCurrent', 'modelShortest', 'modelMidForecast', 'modelMidTemp',
        'modelMidLand', 'modelShortRss', 'modelAreaNo'].forEach(name => { deps['../models/' + name] = {}; });
    ['../controllers/lifeIndexKmaController', '../lib/foodPoisoning', '../controllers/kecoController',
        '../controllers/controllerKmaStnWeather', '../controllers/kasi.riseset.controller', '../lib/sunRiseSet',
        './kma/kma.town.current.controller.js', './kma/kma.town.short.controller.js',
        './kma/kma.town.short.rss.controller.js', './kma/kma.town.shortest.controller.js',
        './kma/kma.town.mid.controller.js', './controller.weather.desc', './kma/kma.forecast.zone.controller']
        .forEach(name => { deps[name] = Unused; });
    const Controller = h.load('controllers/controllerTown.js', deps, {log: h.logger([])});
    const Controller24h = h.load('controllers/controllerTown24h.js', Object.assign({}, deps, {
        request: {}, '../controllers/controllerTown': Controller,
        '../controllers/airkorea.hourly.forecast.controller': Unused,
        '../controllers/kaq.hourly.forecast.controller': Unused,
        '../controllers/kma.specialweather.controller': Unused,
        '../lib/AQI/airFallback': Unused,
        // This fixture verifies coordinates; narrative response behavior has its own HTTP/Mongo smoke.
        '../lib/kmaForecastRegions': {forProvince: () => null},
        '../lib/kmaForecastNarrativeResponse': {attach: (result, station, res, done) => done()},
        '../lib/history/policy': require('../../lib/history/policy')
    }), {log: h.logger([])});
    return new Controller24h();
}
function fixture(options = {}) {
    const instance = new mongoose.Mongoose();
    const Town = TownModel(instance);
    const rows = [], pending = [];
    let geocodes = 0, writes = 0, saveFinished = 0;
    // Actual Mongoose save validation/casting, then an in-memory driver boundary.
    Town.collection.insertOne = (row, opts, callback) => {
        writes++;
        pending.push(() => {
            if (!options.saveError) rows.push(clone(row));
            callback(options.saveError || null, {insertedId: row._id});
            saveFinished++;
        });
    };
    Town.collection.find = (query, opts, callback) => callback(null, {
        toArray: cb => cb(null, rows.map(clone))
    });
    const controller = controllers(Town, (region, city, town, cb) => {
        geocodes++;
        cb(options.geocodeError || null, clone(options.coordinates || coordinates));
    });
    const list = options.list || [seed()];
    return {Town, controller, list, rows,
        counts: () => ({geocodes, writes, saveFinished}),
        flush: async () => {
            await new Promise(resolve => setImmediate(resolve));
            pending.splice(0).forEach(fn => fn());
            await new Promise(resolve => setImmediate(resolve));
        }};
}
function lookup(controller, list, params = address) {
    return new Promise((resolve, reject) => controller._findTown(list, params.region, params.city, params.town,
        (err, row) => err ? reject(err) : resolve(row)));
}
function responseApp(controller, resolveTown) {
    const app = require('express')();
    app.get('/:version/addr/:region/:city/:town', (req, res, next) => {
        resolveTown(req.params).then(row => {
            req.gCoord = row.gCoord;
            req.version = req.params.version;
            // Controlled usable weather; the formatter and HTTP serialization are real.
            req.current = {t1h: 20, yesterday: {t1h: 19}};
            req.sessionID = 'town-geocode-isolated';
            controller.makeResult(req, res, next);
        }, next);
    }, controller.sendResult);
    app.use((err, req, res, next) => res.status(500).json({error: err.message}));
    return app;
}
async function listen(app) {
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return {server, url: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise(resolve => server.close(resolve))};
}
function get(url) {
    return new Promise((resolve, reject) => http.get(url, res => {
        let body = '';
        res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => { try { resolve({status: res.statusCode, body: JSON.parse(body)}); } catch (e) { reject(e); } });
    }).on('error', reject));
}
function weatherUrl(base, version = 'v000903', params = address) {
    return base + '/' + version + '/addr/' + [params.region, params.city, params.town].map(encodeURIComponent).join('/');
}
function location(response) {
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.deepStrictEqual(response.body.location, {lat: 37.566, long: 126.979});
    assert.strictEqual(response.body.source, 'KMA');
    assert.strictEqual(response.body.current.t1h, 20);
    return response.body.location;
}
module.exports = {TownModel, controllers, fixture, lookup, responseApp, listen, get, weatherUrl,
    location, seed, address, coordinates, clone};
