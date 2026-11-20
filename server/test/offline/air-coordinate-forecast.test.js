'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const google = require('../../lib/air/providers/google');
const openweather = require('../../lib/air/providers/openweather');

const time = new Date('2026-11-20T08:23:00Z');
const coord = {lat: 19.43, lon: -99.13};
const keyString = {google_key: 'GOOGLE_SYNTHETIC_FIXTURE_KEY', owm_keys: [{key: 'OWM_SYNTHETIC_FIXTURE_KEY'}]};

function request(provider, body) {
    const requests = [];
    const respond = (...args) => {
        requests.push(args);
        return Promise.resolve({data: body, status: 200});
    };
    return new Promise(resolve => provider.fetchForecast(coord, time, {
        keyString,
        timeoutMs: 2000,
        axios: {get: respond, post: respond}
    }, result => resolve({result, requests})));
}

test('Google hourly forecast uses its forecast endpoint and keeps native index lineage', async () => {
    const pm = {code: 'pm25', concentration: {units: 'MICROGRAMS_PER_CUBIC_METER', value: 0}};
    const ozone = {code: 'o3', concentration: {units: 'PARTS_PER_BILLION', value: 30}};
    const {result, requests} = await request(google, {hourlyForecasts: [
        {dateTime: '2026-11-20T08:00:00Z', pollutants: [pm]},
        {dateTime: '2026-11-20T09:00:00Z', pollutants: [pm, ozone], indexes: [
            {code: 'uaqi', aqi: 71}, {code: 'mex_icars', aqi: 40}
        ]},
        {dateTime: '2026-11-20T10:00:00Z', pollutants: []}
    ]});
    assert.equal(result.outcome, 'ok');
    assert.match(requests[0][0], /\/v1\/forecast:lookup\?/);
    assert.deepEqual(requests[0][1].period, {
        startTime: '2026-11-20T09:00:00Z', endTime: '2026-11-21T08:00:00Z'
    });
    assert.deepEqual(result.rows, [{
        at: '2026-11-20T09:00:00.000Z',
        pollutants: {pm25: 0, o3: 0.03},
        indexes: {uaqi: 71, local: {code: 'mex_icars', aqi: 40}}
    }]);
});

test('OpenWeather hourly concentrations retain its separate five-level index and zero', async () => {
    const {result, requests} = await request(openweather, {list: [
        {dt: Date.parse('2026-11-20T10:00:00Z') / 1000, components: {pm2_5: 8, pm10: 12}},
        {dt: Date.parse('2026-11-20T09:00:00Z') / 1000, main: {aqi: 1}, components: {pm2_5: 0, pm10: -1}},
        {dt: Date.parse('2026-11-20T08:00:00Z') / 1000, components: {pm2_5: 100}}
    ]});
    assert.equal(result.outcome, 'ok');
    assert.match(requests[0][0], /\/air_pollution\/forecast\?/);
    assert.deepEqual(result.rows, [
        {at: '2026-11-20T09:00:00.000Z', pollutants: {pm25: 0}, indexes: {owm: 1}},
        {at: '2026-11-20T10:00:00.000Z', pollutants: {pm25: 8, pm10: 12}, indexes: {}}
    ]);
});

test('forecast service only admits configured providers inside their free limits', async () => {
    const calls = [];
    const options = {
        providers: {google, openweather},
        keyString,
        timeoutMs: 300,
        axios: {
            post: () => { throw Error('Google requires budget admission'); },
            get: () => Promise.resolve({status: 200, data: {list: [{
                dt: Date.parse('2026-11-20T09:00:00Z') / 1000, components: {pm2_5: 0}
            }]}})
        },
        budget: {
            check(id, phase, cost, callback) {
                calls.push(['check', id, phase, cost]);
                callback({allowed: id === 'openweather'});
            },
            record(id, phase, result, callback) {
                calls.push(['record', id, phase, result.failed]);
                callback();
            }
        }
    };
    const service = require('../../lib/air/coordinateForecast')(options);
    const result = await new Promise(resolve => service(coord, time, resolve));
    assert.equal(result.source, 'openweather');
    assert.equal(result.rows[0].pollutants.pm25, 0);
    assert.deepEqual(calls, [['check', 'google', 'forecast', 1], ['check', 'openweather', 'forecast', 1], ['record', 'openweather', 'forecast', false]]);
});

test('forecast service releases the weather caller at the deadline while billing the attempted request', async () => {
    let respondToProvider;
    const ledger = [];
    let markRecorded;
    const recorded = new Promise(resolve => { markRecorded = resolve; });
    const slowWait = new Promise(resolve => { respondToProvider = resolve; });
    const service = require('../../lib/air/coordinateForecast')({
        providers: {google, openweather},
        keyString,
        timeoutMs: 300,
        deadlineMs: 20,
        axios: {post: () => slowWait, get: () => { throw Error('No second call after deadline'); }},
        budget: {
            check(id, phase, cost, callback) { ledger.push(id); callback({allowed: true}); },
            record(id, phase, result, callback) { ledger.push(id + ':recorded'); markRecorded(); callback(); }
        }
    });
    const result = await new Promise(resolve => service(coord, time, resolve));
    assert.equal(result, undefined);
    assert.deepEqual(ledger, ['google']);
    respondToProvider({status: 200, data: {hourlyForecasts: []}});
    await recorded;
    assert.deepEqual(ledger, ['google', 'google:recorded']);
});
