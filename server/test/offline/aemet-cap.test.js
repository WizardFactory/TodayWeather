'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const gzip = require('node:zlib').gzipSync;
const fixtures = require('../../lib/warnings/aemetCap');
const first = '2026-11-21T10:14:23Z';
const until = '2026-11-21T13:00:00Z';
const madrid = {lat: 40.4168, lon: -3.7038};
const barcelona = {lat: 41.3874, lon: 2.1686};

function document(id, code, opt = {}) {
    const sent = opt.sent || first;
    return Buffer.from('<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">' +
        '<identifier>' + id + '</identifier><sender>http://www.aemet.es</sender><sent>' + sent +
        '</sent><status>Actual</status><scope>Public</scope><msgType>' + (opt.type || 'Alert') + '</msgType>' +
        (opt.ref ? '<references>http://www.aemet.es,' + opt.ref + ',' + first + '</references>' : '') +
        '<info><language>es-ES</language><event>Viento</event><severity>' + (opt.severity || 'Moderate') +
        '</severity><effective>' + sent + '</effective><expires>' + (opt.expires || until) +
        '</expires><area><geocode><valueName>AEMET-Meteoalerta zona</valueName><value>' + code +
        '</value></geocode></area></info></alert>');
}

function archive(parts) {
    const blocks = [];
    parts.forEach((bytes, index) => {
        const header = Buffer.alloc(512);
        header.write('notice-' + index + '.xml');
        header.write('0000644\0', 100);
        header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
        header.fill(32, 148, 156);
        header[156] = 48;
        header.write('ustar\0', 257);
        header.write([...header].reduce((sum, b) => sum + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    });
    return gzip(Buffer.concat(blocks.concat(Buffer.alloc(1024))));
}

test('AEMET v6 joins exact capital and offshore points by different zone codes', () => {
    assert.equal(fixtures.locate(madrid).code, '722802');
    assert.equal(fixtures.locate(barcelona).code, '690804');
    assert.equal(fixtures.locate({lat: 41.29, lon: 2.27}).code, '690804C');
    assert.equal(fixtures.locate({lat: 48.86, lon: 2.35}), null);
});

test('complete-snapshot checks and references precede expiry and zone filtering', async () => {
    const later = '2026-11-21T10:15:23Z';
    const docs = archive([
        document('old-warning', '722802'),
        document('terminal', '722802', {type: 'Update', ref: 'old-warning', sent: later, expires: later}),
        document('barcelona-warning', '690804'),
        document('madrid-clear', '722802', {severity: 'Minor'})
    ]);
    const known = new Set(['722802', '690804']);
    const parsed = await fixtures.readSnapshot(docs, known);
    assert.deepEqual(parsed.records.map(x => x.id), ['barcelona-warning']);
    await assert.rejects(fixtures.readSnapshot(docs, new Set([...known, '690803'])), /coverage/);
    await assert.rejects(fixtures.readSnapshot(gzip(Buffer.from('<!DOCTYPE')), known));
});

const express = require('express');
const {createGatewayRouter} = require('../../routes/gateway');

test('shared gateway serves exact coordinates, selected issuer, and no-store coverage states', async () => {
    const files = JSON.parse(require('node:zlib').gunzipSync(
        fs.readFileSync(require.resolve('../../lib/warnings/data/aemet-zones-v6.json.gz'))));
    const bundle = archive([
        ...files.map(([code]) => document('clear-' + code, code, {severity: 'Minor'})),
        document('madrid-wind', '722802')
    ]);
    const atom = Buffer.from('<feed><updated>' + first + '</updated><entry><link href="' +
        'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/cap/Z_CAP_C_LEMM_20261121101423_AFAE.tar.gz' +
        '"/></entry></feed>');
    let now = Date.parse(first), fetches = 0, offline = false;
    const aemet = fixtures.createAemetService({
        now: () => now,
        fetch: async url => {
            fetches++;
            if (offline) throw new Error('test provider outage');
            return url.endsWith('.xml') ? atom : bundle;
        }
    });
    const app = express();
    app.use(createGatewayRouter({
        aemet, vigilance: async point => ({location: point, sources: [{issuer: 'France test router'}], warnings: []}),
        log: {info() {}, warn() {}}
    }));
    const server = app.listen(0, '127.0.0.1');
    await require('node:events').once(server, 'listening');
    try {
        const base = `http://127.0.0.1:${server.address().port}/weather/v000903/coord/`;
        const check = point => new Promise((resolve, reject) => {
            http.get(base + point + '/warnings', {headers: {'Accept-Language': 'es-ES'}}, response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { body += chunk; });
                response.on('end', () => resolve({headers: response.headers, status: response.statusCode, body}));
                response.on('error', reject);
            }).on('error', reject);
        });
        const [affected, clear] = await Promise.all([check('40.4168,-3.7038'), check('41.3874,2.1686')]);
        assert.equal(affected.headers['cache-control'], 'no-store');
        assert.equal(clear.headers['cache-control'], 'no-store');
        const data = JSON.parse(affected.body);
        assert.equal(data.location.lon, madrid.lon);
        assert.equal(data.sources[0].state, 'current');
        assert.equal(data.warnings[0].area.code, '722802');
        assert.equal(data.warnings[0].language, 'es-ES');
        assert.deepEqual(JSON.parse(clear.body).warnings, []);
        assert.equal(fetches, 2, 'one index and archive for concurrent lookups');
        assert.equal(JSON.parse((await check('48.85,2.35')).body).sources[0].issuer, 'France test router');
        assert.equal((await check('91,0')).status, 400);
        offline = true;
        now += 300_000;
        assert.equal(JSON.parse((await check('40.4168,-3.7038')).body).sources[0].state, 'unavailable');
        assert.equal(fetches, 3);
    } finally {
        server.closeIdleConnections?.();
        await new Promise(resolve => server.close(resolve));
    }
});
