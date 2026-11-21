'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const googlePollen = require('../../lib/pollen/googleForecast');

const tokyo = {lat: 35.68, lon: 139.69};
const syntheticKey = 'POLLEN_FIXTURE_TOKEN';
function localDay(at, timeZone) {
    return new Intl.DateTimeFormat('en', {timeZone, day: 'numeric'})
        .formatToParts(at).find(part => part.type === 'day').value;
}
function lookup(place, response) {
    const calls = [];
    const axios = {
        get(url, opts) {
            calls.push({url, timeout: opts.timeout});
            return response instanceof Error ? Promise.reject(response) :
                Promise.resolve({status: 200, data: response});
        }
    };
    return new Promise(resolve => googlePollen.fetch(place,
        {axios, keyString: {google_key: syntheticKey}, timeoutMs: 1900},
        result => resolve({result, calls})));
}

test('Tokyo day records preserve supported species without inventing a zero', async () => {
    const {result, calls} = await lookup(tokyo, {regionCode: 'JP', dailyInfo: [
        {date: {year: 2026, month: 11, day: 20}, pollenTypeInfo: [
            {code: 'TREE'}, {code: 'GRASS', indexInfo: {value: 0}}
        ], plantInfo: [
            {code: 'JAPANESE_CEDAR'}, {code: 'JAPANESE_CYPRESS', inSeason: false}
        ]},
        {date: {year: 2026, month: 11, day: 31}, plantInfo: [{code: 'JAPANESE_CEDAR'}]}
    ]});
    const url = new URL(calls[0].url);
    assert.equal(url.origin, 'https://pollen.googleapis.com');
    assert.equal(url.pathname, '/v1/forecast:lookup');
    assert.equal(url.searchParams.get('location.latitude'), '35.68');
    assert.equal(url.searchParams.get('location.longitude'), '139.69');
    assert.equal(url.searchParams.get('days'), '5');
    assert.deepEqual(result, {outcome: 'ok', source: 'google', attribution: 'Google Maps', region: 'JP', days: [{
        dateUtc: '2026-11-20',
        types: [{code: 'TREE'}, {code: 'GRASS', index: 0}],
        plants: [{code: 'JAPANESE_CEDAR'}, {code: 'JAPANESE_CYPRESS', inSeason: false}]
    }]});
});

test('a supported European value keeps its risk index, discarding malformed entries', async () => {
    const {result} = await lookup({lat: 52.52, lon: 13.4}, {regionCode: 'DE', dailyInfo: [
        {date: {year: 2026, month: 4, day: 2}, plantInfo: [
            {code: 'BIRCH', indexInfo: {value: 4}},
            {code: 'OAK', indexInfo: {value: 8}},
            {code: '__proto__', indexInfo: {value: 1}}
        ]}
    ]});
    assert.deepEqual(result.days[0].plants, [{code: 'BIRCH', index: 4}, {code: 'OAK'}]);
});

test('provider no-coverage errors leave the normal weather path independent', async () => {
    const error = new Error('provider diagnostic includes credentials');
    error.response = {status: 404};
    const {result} = await lookup({lat: -34.9, lon: -56.16}, error);
    assert.deepEqual(result, {outcome: 'failed', kind: 'http', reason: 'http-404'});
});

test('viewed country gates acquisition and unsupported countries spend no request', async () => {
    const reserveCalls = [];
    const requests = [];
    const forecast = require('../../lib/pollen/coordinateForecast')({
        keyString: {google_key: syntheticKey}, timeoutMs: 60, deadlineMs: 1000,
        reserve(now, callback) {
            reserveCalls.push(now);
            callback(true);
        },
        axios: {
            get(url) {
                requests.push(url);
                return Promise.resolve({status: 200, data: {regionCode: 'JP', dailyInfo: [
                    {date: {year: 2026, month: 11, day: 20}, plantInfo: [{code: 'JAPANESE_CEDAR'}]}
                ]}});
            }
        }
    });
    const now = new Date('2026-11-20T15:30:00Z');
    const load = country => new Promise(resolve => forecast.fetch(tokyo, country, now, resolve));
    assert.equal(await load('CO'), undefined);
    assert.equal(await load('UY'), undefined);
    assert.equal(reserveCalls.length, 0);
    assert.equal(requests.length, 0);
    assert.equal(forecast.supports('KR'), true);
    assert.equal(await load('KR'), undefined);
    const result = await load('JP');
    assert.equal(result.region, 'JP');
    assert.equal(result.retrievedAt, now.toISOString());
    assert.equal(localDay(now, 'Asia/Tokyo'), '21');
    assert.equal(result.days[0].dateUtc, '2026-11-20');
    assert.equal(result.days[0].plants[0].index, undefined);
    assert.equal(requests.length, 2);
});

test('a UTC day is kept even when the viewed American date is the previous day', async () => {
    const now = new Date('2026-11-21T01:00:00.000Z');
    const losAngeles = {lat: 34.05, lon: -118.24};
    const forecast = require('../../lib/pollen/coordinateForecast')({
        keyString: {google_key: syntheticKey}, timeoutMs: 60,
        reserve(at, callback) { callback(true); },
        axios: {get: () => Promise.resolve({status: 200, data: {regionCode: 'US', dailyInfo: [
            {date: {year: 2026, month: 11, day: 21}, pollenTypeInfo: [{code: 'GRASS', indexInfo: {value: 0}}]}
        ]}})}
    });
    assert.equal(localDay(now, 'America/Los_Angeles'), '20');
    const result = await new Promise(resolve => forecast.fetch(losAngeles, 'US', now, resolve));
    assert.equal(result.days[0].dateUtc, '2026-11-21');
    assert.equal(result.days[0].types[0].index, 0);
});

test('pollen quota refusal and late admission do not contact Google', async () => {
    let delayed;
    const forecast = require('../../lib/pollen/coordinateForecast')({
        keyString: {google_key: syntheticKey}, timeoutMs: 60, deadlineMs: 20,
        reserve(now, callback) { delayed = callback; },
        axios: {get() { throw Error('No HTTP hit after the deadline'); }}
    });
    const now = new Date('2026-11-20T15:30:00Z');
    assert.equal(await new Promise(resolve => forecast.fetch(tokyo, 'JP', now, resolve)), undefined);
    delayed(true);
    const refused = new Promise(resolve => forecast.fetch(tokyo, 'JP', now, resolve));
    delayed(false);
    assert.equal(await refused, undefined);
});

test('pollen reserves its own monthly counter and denies on cap or storage errors', async () => {
    const createMonthlyBudget = require('../../lib/pollen/monthlyBudget');
    const now = new Date('2026-11-20T15:30:00Z');
    const calls = [];
    const simulate = [
        [{code: 11000}, null], [null, {calls: 2}],
        [{code: 11000}, null], [null, null],
        [new Error('storage unavailable'), null]
    ];
    const Usage = {
        findOneAndUpdate(filter, update, options, callback) {
            calls.push({filter, update, options});
            callback(...simulate.shift());
        }
    };
    const reserve = createMonthlyBudget(Usage, 2);
    const claim = () => new Promise(resolve => reserve(now, resolve));
    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    assert.equal(await claim(), false);
    assert.deepEqual(calls[0].filter, {_id: 'pollen:google:m:2026-11', calls: {$lt: 2}});
    assert.equal(calls[0].update.$inc.calls, 1);
    assert.equal(calls[0].update.$set.expireAt.toISOString(), '2027-01-01T00:00:00.000Z');
    assert.equal(calls[0].options.upsert, true);
    assert.equal(calls[1].options.upsert, undefined);
    assert.equal(await new Promise(resolve => createMonthlyBudget(Usage, 0)(now, resolve)), false);
    assert.equal(calls.length, 5);
});
