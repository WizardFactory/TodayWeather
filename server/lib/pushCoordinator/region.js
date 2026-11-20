'use strict';
var performance = require('perf_hooks').performance;
var getJson = require('../geocoder/transport').getJson;
var zones = require('../kmaWarningZones');
var RegionError = require('./errors').RegionError;

// Preserve redirects from the configured geocoder within one absolute lookup budget.
async function lookup(url, timeoutMs) {
    var deadline = performance.now() + timeoutMs;
    for (var redirects = 0; redirects <= 10; redirects++) {
        var remaining = Math.ceil(deadline - performance.now());
        if (remaining <= 0) throw new RegionError('deadline', true);
        var response;
        try {
            response = await getJson(url, { timeoutMs: remaining, headersOnlyOnNon200: true });
        } catch (error) {
            if (error.code === 'ERR_INVALID_URL' || error.code === 'ERR_INVALID_PROTOCOL') {
                throw new RegionError('invalid-url', false);
            }
            throw new RegionError(error.code === 'ETIMEDOUT' ? 'deadline' : 'unavailable', true);
        }
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            var next;
            try { next = new URL(response.headers.location, url); }
            catch (error) { throw new RegionError('invalid-redirect', false); }
            if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new RegionError('invalid-redirect', false);
            url = next.href;
            continue;
        }
        if (response.status !== 200) {
            var retryable = response.status >= 500 || [408, 425, 429].includes(response.status);
            throw new RegionError('http-' + response.status, retryable);
        }
        var data = response.body;
        if (!response.json || !data || typeof data.country !== 'string' || !/^[A-Z]{2}$/.test(data.country) ||
            (data.country === 'KR' && !(data.kmaAddress && typeof data.kmaAddress.name1 === 'string' &&
                data.kmaAddress.name1.trim()))) {
            throw new RegionError('incomplete-response', true);
        }
        return data;
    }
    throw new RegionError('redirect-limit', false);
}

async function resolveRegion(origin, loc, record, timeoutMs = 5000) {
    var town = loc.town || record.town, country = town ? 'KR' : undefined;
    if (loc.lat !== undefined) {
        var data = await lookup(origin + '/geocode/v000903/coord/' + loc.lat + ',' + loc.long, timeoutMs);
        country = data.country;
        var address = data.kmaAddress || {};
        town = address.name1 ? { first: address.name1, second: address.name2, third: address.name3 } : undefined;
    }
    if (country === 'KR' && town) {
        town = Object.assign({}, town);
        for (var field of ['first', 'second', 'third']) {
            if (typeof town[field] === 'string') town[field] = town[field].trim();
        }
    }
    var zoneIds = town && town.first ? zones.zonesForTown(town) : [];
    if (country === 'KR' && !zoneIds.length) throw new RegionError('unmapped-town', loc.lat !== undefined);
    return { country: country, town: town, zones: zoneIds,
        weatherKey: JSON.stringify([record.source || 'KMA', loc.lat, loc.long, town]) };
}
module.exports = { resolveRegion: resolveRegion };
