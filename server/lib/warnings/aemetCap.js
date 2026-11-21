'use strict';

const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {parseStringPromise} = require('xml2js');

const origin = 'https://www.aemet.es';
const base = '/documentos_d/eltiempo/prediccion/avisos/';
const indexUrl = origin + base + 'rss/CAP_AFAE_ATOM.xml';
const issuerUrl = origin + '/es/eltiempo/prediccion/avisos';
const leaseMs = 5 * 60 * 1000;
const maxArchiveBytes = 4_000_000;
const sender = 'http://www.aemet.es';
const levels = {Moderate: 'amarillo', Severe: 'naranja', Extreme: 'rojo'};
let zones;

function getZones() {
    if (!zones) {
        const asset = fs.readFileSync(__dirname + '/data/aemet-zones-v6.json.gz');
        zones = JSON.parse(zlib.gunzipSync(asset));
    }
    return zones;
}

function relationToRing(ring, lon, lat) {
    let inside = false;
    for (let i = 0, prev = ring.length - 1; i < ring.length; prev = i++) {
        const [x, y] = ring[i];
        const [prevX, prevY] = ring[prev];
        if (lon >= Math.min(x, prevX) && lon <= Math.max(x, prevX) &&
            lat >= Math.min(y, prevY) && lat <= Math.max(y, prevY) &&
            Math.abs((lon - x) * (prevY - y) - (lat - y) * (prevX - x)) < 1e-12) {
            return 'boundary';
        }
        if ((y > lat) !== (prevY > lat) && lon < (prevX - x) * (lat - y) / (prevY - y) + x) {
            inside = !inside;
        }
    }
    return inside ? 'inside' : 'outside';
}

function locate(point) {
    const {lat, lon} = point;
    const matches = [];
    for (const [code, name, [west, south, east, north], polygons] of getZones()) {
        if (lon < west || lon > east || lat < south || lat > north) continue;
        for (const [outer, ...holes] of polygons) {
            const relation = relationToRing(outer, lon, lat);
            if (relation === 'outside') continue;
            const holeRelations = holes.map(ring => relationToRing(ring, lon, lat));
            if (holeRelations.includes('inside')) continue;
            matches.push({code, name, boundary: relation === 'boundary' || holeRelations.includes('boundary')});
            break;
        }
    }
    const land = matches.filter(({code}) => !code.endsWith('C'));
    const qualified = land.length ? land : matches;
    if (!qualified.length) return null;
    if (qualified.length > 1 || qualified[0].boundary) return {ambiguous: true};
    const {code, name} = qualified[0];
    return {code, name};
}

function fetchBuffer(url, maxBytes) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, {headers: {'Cache-Control': 'no-cache'}}, response => {
            if (response.statusCode !== 200 ||
                (url === indexUrl && Number(response.headers.age || 0) * 1000 > leaseMs)) {
                response.destroy();
                reject(new Error('AEMET product unavailable'));
                return;
            }
            const buffers = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > maxBytes) request.destroy(new Error('AEMET response too large'));
                else buffers.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(buffers)));
            response.on('error', reject);
            response.on('aborted', () => reject(new Error('AEMET response interrupted')));
        });
        const deadline = setTimeout(() => request.destroy(new Error('AEMET request timeout')), 3500);
        request.on('close', () => clearTimeout(deadline));
        request.on('error', reject);
    });
}

async function xml(buffer) {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported XML declaration');
    return parseStringPromise(text, {explicitArray: true, trim: true, strict: true});
}

function iso(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
        throw new Error('Invalid AEMET time');
    }
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) throw new Error('Invalid AEMET time');
    return new Date(millis).toISOString();
}

async function readIndex(buffer) {
    const {feed} = await xml(buffer);
    const updatedAt = iso(feed?.updated?.[0]);
    const link = new URL(feed?.entry?.[0]?.link?.[0]?.$?.href);
    const match = /\/Z_CAP_C_LEMM_(\d{14})_AFAE\.tar\.gz$/.exec(link.pathname);
    if (link.origin !== origin || link.username || link.password || link.search || link.hash ||
        !link.pathname.startsWith(base + 'cap/') || !match ||
        match[1] !== updatedAt.replace(/\D/g, '').slice(0, 14)) {
        throw new Error('Invalid AEMET national archive link');
    }
    return {updatedAt, url: link.href};
}

function* archiveXml(bytes) {
    if (bytes.length > maxArchiveBytes) throw new Error('AEMET archive size limit');
    const tar = zlib.gunzipSync(bytes, {maxOutputLength: 10_000_000});
    for (let offset = 0, count = 0; count < 500 && offset + 512 <= tar.length; count++) {
        const header = tar.subarray(offset, offset + 512);
        if (!header.some(Boolean)) {
            if (offset + 1024 <= tar.length && !tar.subarray(offset).some(Boolean)) return;
            break;
        }
        const octal = (start, width) => {
            const field = header.toString('ascii', start, start + width).replace(/\0.*$/, '').trim();
            return /^[0-7]+$/.test(field) ? parseInt(field, 8) : NaN;
        };
        const type = header[156];
        const size = octal(124, 12);
        const name = header.toString('ascii', 0, 100).replace(/\0.*$/, '');
        const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
        if (checksum !== octal(148, 8) || (type !== 0 && type !== 48) ||
            !/^[A-Za-z0-9_.-]+\.xml$/.test(name) || !size || size > 500_000 ||
            offset + 512 + size > tar.length) {
            throw new Error('Invalid AEMET archive member');
        }
        yield tar.subarray(offset + 512, offset + 512 + size);
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    throw new Error('Incomplete AEMET archive');
}

function recordsFor(alert, known, coverage) {
    return (alert.info || []).map(info => {
        const severity = info.severity?.[0];
        const language = info.language?.[0];
        const event = info.event?.[0];
        if ((!Object.prototype.hasOwnProperty.call(levels, severity) && severity !== 'Minor') || !language || !event) {
            throw new Error('Invalid AEMET warning variant');
        }
        const codes = (info.area || []).flatMap(area =>
            (area.geocode || []).filter(row => row.valueName?.[0] === 'AEMET-Meteoalerta zona').map(row => row.value?.[0]));
        if (!codes.length || codes.some(code => !known.has(code))) throw new Error('Unknown AEMET zone coverage');
        codes.forEach(code => coverage.add(code));
        const effectiveAt = iso(info.effective?.[0]);
        const expiresAt = iso(info.expires?.[0]);
        const onsetAt = info.onset ? iso(info.onset[0]) : undefined;
        if (effectiveAt > expiresAt || (onsetAt && onsetAt > expiresAt)) throw new Error('Invalid AEMET period');
        const eventCode = info.eventCode?.find(row => row.valueName?.[0] === 'AEMET-Meteoalerta fenomeno')?.value?.[0];
        return {
            codes: [...new Set(codes)].sort(), severity, language, event, effectiveAt, onsetAt, expiresAt,
            eventCode: eventCode?.split(';')[0],
            urgency: info.urgency?.[0], certainty: info.certainty?.[0],
            headline: info.headline?.[0], description: info.description?.[0], instruction: info.instruction?.[0]
        };
    });
}

async function readSnapshot(buffer, known = new Set(getZones().map(([code]) => code)), revision) {
    const coverage = new Set();
    const messages = new Map();
    for (const document of archiveXml(buffer)) {
        const {alert} = await xml(document);
        if (!alert || alert.$?.xmlns !== 'urn:oasis:names:tc:emergency:cap:1.2') throw new Error('Invalid CAP namespace');
        const author = alert.sender?.[0];
        const id = alert.identifier?.[0];
        const type = alert.msgType?.[0];
        const sentAt = iso(alert.sent?.[0]);
        if (author !== sender || !id || /[,\s]/.test(id) || !['Alert', 'Update', 'Cancel'].includes(type) ||
            alert.status?.[0] !== 'Actual' || alert.scope?.[0] !== 'Public' || (revision && sentAt > revision)) {
            throw new Error('Invalid AEMET message');
        }
        const key = [author, id, sentAt].join(',');
        if (messages.has(key)) throw new Error('Duplicate AEMET message');
        const references = (alert.references?.[0] || '').split(/\s+/).filter(Boolean).map(ref => {
            const [from, identifier, time, unexpected] = ref.split(',');
            if (from !== sender || !identifier || unexpected) throw new Error('Invalid AEMET reference');
            const refTime = iso(time);
            if (refTime > sentAt) throw new Error('Invalid AEMET reference time');
            return [from, identifier, refTime].join(',');
        });
        if ((type === 'Alert' && references.length) || (type !== 'Alert' && !references.length)) {
            throw new Error('Missing or unexpected AEMET references');
        }
        const variants = recordsFor(alert, known, coverage);
        if (type !== 'Cancel' && !variants.length) throw new Error('Missing AEMET warning variants');
        messages.set(key, {id, type, sentAt, variants, references});
    }
    if (coverage.size !== known.size) throw new Error('Incomplete AEMET area coverage');
    const sorted = [...messages].sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    const retired = new Set(sorted.flatMap(([, record]) => record.references));
    const records = sorted.filter(([key]) => !retired.has(key)).flatMap(([, record]) => {
        const variants = record.variants.filter(v => v.severity !== 'Minor' && v.expiresAt > v.effectiveAt);
        return record.type !== 'Cancel' && variants.length ? [{id: record.id, sentAt: record.sentAt, variants}] : [];
    });
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
    return {records, fingerprint};
}

function pickVariant(variants, locale) {
    const lang = (locale || 'es').toLowerCase();
    const base = lang.split('-')[0];
    return variants.find(v => v.language.toLowerCase() === lang) ||
        variants.find(v => v.language.toLowerCase().split('-')[0] === base) ||
        variants.find(v => v.language === 'es-ES') || variants[0];
}

function response(point, zone, checkedAt, snapshot, locale) {
    const location = {lat: point.lat, lon: point.lon, country: zone ? 'ES' : null};
    const source = {issuer: 'AEMET', issuerLabel: 'Agencia Estatal de Meteorología', sourceUrl: issuerUrl, product: 'Meteoalerta', scope: 'ES', state: 'unsupported'};
    const warnings = [];
    if (zone) source.state = 'unavailable';
    if (zone && !zone.ambiguous) source.area = zone;
    if (snapshot) {
        source.state = 'current';
        source.asOf = snapshot.updatedAt;
        source.freshUntil = new Date(snapshot.freshUntil).toISOString();
        for (const record of snapshot.records) {
            const active = record.variants.filter(v =>
                v.codes.includes(zone.code) && v.effectiveAt <= checkedAt && checkedAt < v.expiresAt);
            const variant = pickVariant(active, locale);
            if (!variant) continue;
            const {codes, ...fields} = variant;
            warnings.push({
                ...fields, id: record.id, sentAt: record.sentAt, issuer: 'AEMET',
                issuerLabel: 'Agencia Estatal de Meteorología', sourceUrl: issuerUrl, product: 'warning',
                level: levels[variant.severity], area: zone, matchMethod: 'area-code'
            });
        }
    }
    return {location, checkedAt, sources: [source], warnings};
}

function createAemetService({fetch = fetchBuffer, now = Date.now} = {}) {
    let last;
    let refreshing;
    let retryAt = 0;

    async function refresh() {
        const index = await readIndex(await fetch(indexUrl, 180_000));
        if (Date.parse(index.updatedAt) > now() + 60_000 || (last && index.updatedAt < last.updatedAt)) {
            throw new Error('Invalid AEMET snapshot revision');
        }
        const snapshot = await readSnapshot(await fetch(index.url, maxArchiveBytes), undefined, index.updatedAt);
        if (last && index.updatedAt === last.updatedAt && last.fingerprint !== snapshot.fingerprint) {
            throw new Error('Conflicting AEMET snapshot revision');
        }
        return {...index, ...snapshot, freshUntil: now() + leaseMs};
    }

    return {
        locate,
        async evaluate(point, zone, locale) {
            if (zone && !zone.ambiguous && (!last || last.freshUntil <= now()) && now() >= retryAt) {
                if (!refreshing) {
                    refreshing = refresh().then(value => { last = value; }).catch(() => {
                        retryAt = now() + 30_000;
                    }).finally(() => { refreshing = null; });
                }
                await refreshing;
            }
            const evaluated = now();
            return response(point, zone, new Date(evaluated).toISOString(),
                zone && !zone.ambiguous && last?.freshUntil > evaluated ? last : null, locale);
        }
    };
}

module.exports = {createAemetService, locate, readSnapshot};
