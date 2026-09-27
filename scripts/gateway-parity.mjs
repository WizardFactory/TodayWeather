#!/usr/bin/env node
// Parity checks for #2606 (specs/issue-2606-test-scenarios.md DO-1 to DO-5, PC-1, RB-1).
// Read-only GETs/OPTIONS; every request carries a unique `_twcb` query so CloudFront
// answers from the origin. Prints a JSON report and exits non-zero on any failure.
//
//   Before cutover (A2): compare the direct service origin with the current gateway,
//   and save the Lambda-era header baseline (RB-1) and the direct-side statuses (PC-1):
//     node scripts/gateway-parity.mjs --direct http://<service-origin> \
//       --gateway https://todayweather.wizardfactory.net --save-baseline baseline.json
//   After cutover (PC-1):   node scripts/gateway-parity.mjs --public https://todayweather.wizardfactory.net --expect baseline.json
//     (a PC-1 cell must be 200 only where the direct origin answered 200 before cutover)
//   After a rollback (RB-1): node scripts/gateway-parity.mjs --public https://todayweather.wizardfactory.net --baseline baseline.json
//   Offline self-test (loopback servers only): node scripts/gateway-parity.mjs --self-test
//
// DO-2 runs first so that its direct requests are real cache misses. DO-1 uses the
// first fresh offset of each fixture coordinate; fields that also differ between two
// consecutive gateway misses (time-varying weather data) are ignored.
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';

export const FIXTURES = ['37.5665,126.9780', '35.146,126.923', '33.4996,126.5312', '40.7128,-74.0060', '51.5074,-0.1278'];
export const OFFSETS = [0.0015, 0.0035, 0.0055];
export const VERSIONS = [null, 'v000901', 'v000902', 'v000903'];
export const QUERIES = {
    none: '',
    app: 'temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea&airForecastSource=kaq',
    widget: 'temperatureUnit=(null)&windSpeedUnit=(null)&pressureUnit=(null)&distanceUnit=(null)&precipitationUnit=(null)&airUnit=(null)'
};
export const LANGUAGES = ['ko-KR', 'en-US', 'ko,en-US;q=0.9,en;q=0.8', null];
export const ADDRESS = '서울특별시 송파구 잠실동';
export const EXCLUDED = ['/weather', '/weather/addr/x', '/weather/v000903/addr/x', '/geocode/coord/1,2', '/geocode/addr/x',
    '/geocode/v000901/coord/1,2', '/geocode/v000902/addr/x', '/weather/v000803/coord/1,2'];
const GEO_FIELDS = ['name', 'country', 'address', 'location', 'kmaAddress'];
const BASELINE_HEADERS = ['cache-control', 'access-control-allow-origin', 'content-type'];

export function offset(loc, delta) {
    const [lat, lon] = loc.split(',').map(Number);
    return (lat + delta).toFixed(4) + ',' + (lon + delta).toFixed(4);
}

export function weatherPath(version, loc, query) {
    return (version ? '/weather/' + version + '/coord/' : '/weather/coord/') + loc + (query ? '?' + query : '');
}

export function withBust(p) {
    return p + (p.includes('?') ? '&' : '?') + '_twcb=' + randomUUID();
}

export async function fetchOnce(base, p, {method = 'GET', lang = null, headers = {}} = {}) {
    const h = Object.assign({}, headers);
    if (lang) { h['Accept-Language'] = lang; }
    const res = await fetch(base + p, {method, headers: h, redirect: 'manual'});
    const text = await res.text();
    const out = {status: res.status, headers: Object.fromEntries(res.headers), text};
    try { out.json = JSON.parse(text); } catch { out.json = undefined; }
    return out;
}

/** A request that reached the origin (CloudFront `X-Cache: Miss`), retried up to 3 times. */
export async function fetchMiss(base, p, options) {
    let res;
    for (let i = 0; i < 3; i++) {
        res = await fetchOnce(base, withBust(p), options);
        const xcache = res.headers['x-cache'];
        if (!xcache || /miss/i.test(xcache)) { return res; }
    }
    return res;
}

/** JSON paths whose values differ between a and b. */
export function diffPaths(a, b, prefix = '') {
    if (a === b) { return []; }
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        return [...keys].flatMap(k => diffPaths(a[k], b[k], prefix + '/' + k));
    }
    return [prefix || '/'];
}

export function unexplained(paths, ignore) {
    return paths.filter(p => ![...ignore].some(i => p === i || p.startsWith(i + '/')));
}

export function pick(obj, keys) {
    return Object.fromEntries(keys.filter(k => obj && Object.hasOwn(obj, k)).map(k => [k, obj[k]]));
}

function headerSnapshot(res) {
    return {status: res.status, ...pick(res.headers, BASELINE_HEADERS), setCookie: 'set-cookie' in res.headers};
}

export async function runDirectVsGateway(direct, gateway, report, saveBaseline) {
    const directGeo = {};
    const directStatus = {};           // PC-1 cell name -> direct-origin status
    // DO-2 (first): fresh coordinates and the address.
    for (const fixture of FIXTURES) {
        for (const delta of OFFSETS) {
            const loc = offset(fixture, delta);
            for (const lang of ['ko-KR', 'en-US']) {
                const p = '/geocode/v000903/coord/' + loc;
                const miss = await fetchOnce(direct, withBust(p), {lang});
                const hit = await fetchOnce(direct, withBust(p), {lang});
                const gw = await fetchMiss(gateway, p, {lang});
                directGeo[loc + '|' + lang] = miss.json;
                if (delta === OFFSETS[0] && lang === 'ko-KR') { directStatus['R3 ' + loc] = miss.status; }
                const ok = miss.status === 200 && hit.status === 200 && gw.status === 200 &&
                    JSON.stringify(pick(miss.json, GEO_FIELDS)) === JSON.stringify(pick(gw.json, GEO_FIELDS)) &&
                    JSON.stringify(miss.json) === JSON.stringify(hit.json);
                report.check('DO-2', p + ' ' + lang, ok, {direct: miss.status, hit: hit.status, gateway: gw.status,
                    diff: unexplained(diffPaths(pick(miss.json, GEO_FIELDS), pick(gw.json, GEO_FIELDS)), [])});
            }
        }
    }
    const addrBodies = [];
    for (const v of ['v000901', 'v000903']) {
        const p = '/geocode/' + v + '/addr/' + encodeURIComponent(ADDRESS);
        const d = await fetchOnce(direct, withBust(p));
        const g = await fetchMiss(gateway, p);
        directStatus['R4 ' + v] = d.status;
        addrBodies.push(d.text);
        const same = d.status === 200 && g.status === 200 && JSON.stringify(pick(d.json, ['country', 'address', 'location'])) === JSON.stringify(pick(g.json, ['country', 'address', 'location']));
        report.check('DO-2', p, same, same ? {} : {direct: d.json, gateway: g.json,
            note: 'The Lambda address cache never expires; adjudicate against a fresh offline golden (DO-2)'});
    }
    report.check('DO-2', 'R4 v000901 = R4 v000903 (direct)', addrBodies[0] === addrBodies[1]);

    // DO-1: every version × query × language on the first fresh offset; the exact fixtures are informational.
    for (const fixture of FIXTURES) {
        const loc = offset(fixture, OFFSETS[0]);
        for (const version of VERSIONS) {
            const control = [await fetchMiss(gateway, weatherPath(version, loc, ''), {lang: 'ko-KR'}),
                await fetchMiss(gateway, weatherPath(version, loc, ''), {lang: 'ko-KR'})];
            const ignore = new Set(diffPaths(control[0].json, control[1].json));
            for (const [qname, query] of Object.entries(QUERIES)) {
                for (const lang of LANGUAGES) {
                    const p = weatherPath(version, loc, query);
                    const d = await fetchOnce(direct, withBust(p), {lang});
                    if (lang === 'ko-KR' && qname !== 'none') {
                        directStatus[weatherPath(version, loc, '') + ' [' + qname + ']'] = d.status;
                    }
                    let g = await fetchMiss(gateway, p, {lang});
                    const name = p + ' ' + (lang || 'no-language') + ' [' + qname + ']';
                    if (d.status === 200 && g.status === 501) {
                        g = await fetchMiss(gateway, p, {lang});
                        const r3 = directGeo[loc + '|' + lang] || (await fetchOnce(direct, withBust('/geocode/v000903/coord/' + loc), {lang})).json;
                        const explained = g.status === 501 && JSON.stringify(pick(d.json, GEO_FIELDS.slice(0, 4))) === JSON.stringify(pick(r3, GEO_FIELDS.slice(0, 4)));
                        report.check('DO-1', name, explained, {direct: 200, gateway: 501, rule: 'gateway 501 repeated; direct geo fields equal direct R3'});
                        continue;
                    }
                    const diff = d.status === 200 && g.status === 200 ? unexplained(diffPaths(d.json, g.json), ignore) : [];
                    const keysEqual = d.status !== 200 || JSON.stringify(Object.keys(d.json).sort()) === JSON.stringify(Object.keys(g.json).sort());
                    report.check('DO-1', name, d.status === g.status && keysEqual && diff.length === 0, {direct: d.status, gateway: g.status, diff});
                }
            }
            const exact = weatherPath(version, fixture, '');
            const d = await fetchOnce(direct, withBust(exact), {lang: 'ko-KR'});
            const g = await fetchMiss(gateway, exact, {lang: 'ko-KR'});
            report.info('DO-1 informational', exact, {direct: d.status, gateway: g.status,
                geoDiff: d.status === 200 && g.status === 200 ? diffPaths(pick(d.json, GEO_FIELDS), pick(g.json, GEO_FIELDS)) : []});
        }
        const r1 = await fetchOnce(direct, withBust(weatherPath(null, loc, '')), {lang: 'ko-KR'});
        const r2 = await fetchOnce(direct, withBust(weatherPath('v000901', loc, '')), {lang: 'ko-KR'});
        report.check('DO-1', 'R1 = R2 v000901 (direct) ' + loc, r1.status === r2.status &&
            unexplained(diffPaths(r1.json, r2.json), new Set(diffPaths(r1.json, (await fetchOnce(direct, withBust(weatherPath(null, loc, '')), {lang: 'ko-KR'})).json))).length === 0);
    }

    // DO-3: headers on the direct origin; the gateway's headers become the RB-1 baseline.
    const baseline = {};
    for (const [label, p, method, maxAge] of headerRequests()) {
        const opts = method === 'OPTIONS' ? {method, headers: {'Origin': 'https://example.test', 'Access-Control-Request-Method': 'GET'}} : {lang: 'ko-KR'};
        const d = await fetchOnce(direct, withBust(p), opts);
        const g = await fetchMiss(gateway, p, opts);
        baseline[label] = headerSnapshot(g);
        const ok = method === 'OPTIONS'
            ? d.status === 204 && d.headers['access-control-allow-origin'] === '*'
            : d.status === 200 && d.headers['cache-control'] === 'max-age=' + maxAge && d.headers['access-control-allow-origin'] === '*' &&
              /^application\/json/.test(d.headers['content-type'] || '') && !('set-cookie' in d.headers);
        report.check('DO-3', label, ok, headerSnapshot(d));
    }
    if (saveBaseline) {
        fs.writeFileSync(saveBaseline, JSON.stringify({headers: baseline, direct: directStatus}, null, 1) + '\n');
        report.info('DO-3', 'baseline saved', {file: saveBaseline});
    }

    // DO-4: excluded shapes (and POST) on the direct origin.
    for (const p of EXCLUDED) {
        const d = await fetchOnce(direct, withBust(p));
        report.check('DO-4', p, d.status === 404 && d.headers['cache-control'] === 'no-store');
    }
    const post = await fetchOnce(direct, withBust('/weather/coord/1,2'), {method: 'POST'});
    report.check('DO-4', 'POST /weather/coord/1,2', post.status === 404);

    // DO-5: internal callers through the versioned public path, as seen on the direct origin.
    const kmaCoord = await fetchOnce(direct, withBust('/v000903/kma/coord/37.5665,126.9780'));
    report.check('DO-5', '/v000903/kma/coord', kmaCoord.status === 200 && !!(kmaCoord.json && kmaCoord.json.currentPubDate));
    const geo = await fetchOnce(direct, withBust('/v000903/geo/37.5665,126.9780'));
    report.check('DO-5', '/v000903/geo', geo.status >= 300 && geo.status < 400 && /^\.\.\/kma\/addr\//.test(geo.headers.location || ''), {status: geo.status, location: geo.headers.location});
}

function headerRequests() {
    const loc = offset(FIXTURES[0], OFFSETS[1]);
    return [
        ['R1', weatherPath(null, loc, ''), 'GET', 300],
        ['R2 v000903', weatherPath('v000903', loc, ''), 'GET', 300],
        ['R3', '/geocode/v000903/coord/' + loc, 'GET', 2592000],
        ['R4 v000903', '/geocode/v000903/addr/' + encodeURIComponent(ADDRESS), 'GET', 2592000],
        ['OPTIONS', '/weather/v000903/coord/' + loc, 'OPTIONS', 0]
    ];
}

export async function runPublic(base, report, baselineFile, expectFile) {
    if (baselineFile) {
        // RB-1: after a rollback the headers must equal the Lambda-era baseline.
        const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')).headers;
        for (const [label, p, method] of headerRequests()) {
            const opts = method === 'OPTIONS' ? {method, headers: {'Origin': 'https://example.test', 'Access-Control-Request-Method': 'GET'}} : {lang: 'ko-KR'};
            const res = await fetchMiss(base, p, opts);
            const now = headerSnapshot(res);
            report.check('RB-1', label, JSON.stringify(now) === JSON.stringify(baseline[label]), {now, baseline: baseline[label]});
        }
        return;
    }
    // PC-1. With --expect, a cell must be 200 only where the direct origin answered 200
    // before cutover (DO-1/DO-2); otherwise it must keep the direct-side status.
    const expected = expectFile ? JSON.parse(fs.readFileSync(expectFile, 'utf8')).direct : null;
    const cell = (name, res, ok200) => {
        const before = expected ? expected[name] : 200;
        if (before === 200 || before === undefined) {
            report.check('PC-1', name, ok200, {status: res.status});
        }
        else {
            report.check('PC-1', name, res.status === before, {status: res.status, directBeforeCutover: before});
        }
    };
    if (expected) {
        const nonKr = Object.entries(expected).filter(([k]) => /\/(40|51)\./.test(k));
        if (!nonKr.some(([, v]) => v === 200)) {
            report.info('PC-1', 'warning', {note: 'no non-KR cell answered 200 before cutover; non-KR success parity is unproven (deploy #2585 Visual Crossing before DO-1)'});
        }
    }
    for (const p of ['/weather/coord/37.5665,126.9780', '/weather/v000903/coord/37.5665,126.9780']) {
        const res = await fetchMiss(base, p, {lang: 'ko-KR'});
        report.check('PC-1', p + ' (issue URL)', res.status === 200 && !!(res.json && res.json.name));
    }
    for (const fixture of FIXTURES) {
        const loc = offset(fixture, OFFSETS[0]);
        for (const version of VERSIONS) {
            for (const qname of ['app', 'widget']) {
                const res = await fetchMiss(base, weatherPath(version, loc, QUERIES[qname]), {lang: 'ko-KR'});
                cell(weatherPath(version, loc, '') + ' [' + qname + ']', res, res.status === 200 && !!(res.json && res.json.name));
            }
        }
        const r3 = await fetchMiss(base, '/geocode/v000903/coord/' + loc, {lang: 'ko-KR'});
        cell('R3 ' + loc, r3, r3.status === 200 && !!(r3.json && r3.json.name));
    }
    for (const v of ['v000901', 'v000903']) {
        const res = await fetchMiss(base, '/geocode/' + v + '/addr/' + encodeURIComponent(ADDRESS));
        cell('R4 ' + v, res, res.status === 200 && !!(res.json && res.json.location));
    }
    for (const [label, p, method, maxAge] of headerRequests()) {
        const opts = method === 'OPTIONS' ? {method, headers: {'Origin': 'https://example.test', 'Access-Control-Request-Method': 'GET'}} : {lang: 'ko-KR'};
        const res = await fetchMiss(base, p, opts);
        const ok = method === 'OPTIONS' ? res.status === 204 : res.status === 200 && res.headers['cache-control'] === 'max-age=' + maxAge && !('set-cookie' in res.headers);
        report.check('PC-1 DO-3', label, ok, headerSnapshot(res));
    }
    for (const p of EXCLUDED) {
        const res = await fetchMiss(base, p);
        report.check('PC-1 DO-4', p, res.status === 404);
    }
}

export function createReport() {
    const results = [];
    return {
        results,
        check(scenario, name, ok, detail) { results.push({scenario, name, ok: !!ok, detail}); },
        info(scenario, name, detail) { results.push({scenario, name, ok: true, informational: true, detail}); },
        summary() {
            const failed = results.filter(r => !r.ok);
            return {checks: results.filter(r => !r.informational).length, failed: failed.length, failures: failed, results};
        }
    };
}

// ---------- offline self-test: two loopback servers standing in for the origin and the gateway ----------
function fakeService(kind, mutate) {
    let counter = 0;
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;
        const lang = req.headers['accept-language'] || 'none';
        const send = (status, body, headers = {}) => {
            res.writeHead(status, Object.assign({'Access-Control-Allow-Origin': '*'}, headers));
            res.end(body);
        };
        if (req.method === 'OPTIONS') { return send(kind === 'direct' ? 204 : 200, ''); }
        const geoFor = loc => ({name: 'n-' + loc + '-' + lang.split('-')[0], country: 'KR', address: 'a', location: {lat: 1, long: 2}, kmaAddress: {name1: 'x'}});
        const xcache = kind === 'gateway' ? {'X-Cache': 'Miss from cloudfront'} : {};
        let m;
        if ((m = p.match(/^\/weather(?:\/(v00090[123]))?\/coord\/([^/]+)$/)) && req.method === 'GET') {
            const body = Object.assign({version: m[1] || 'v000901', query: [...url.searchParams.keys()].filter(k => k !== '_twcb').join(','), now: kind + (counter++)}, geoFor(m[2]));
            delete body.kmaAddress;
            const status = (mutate && mutate(p, body)) === 501 ? 501 : 200;
            if (status === 501) { return send(501, 'Not Implemented', {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}); }
            return send(200, JSON.stringify(body), Object.assign({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=300'}, xcache));
        }
        if ((m = p.match(/^\/geocode\/v000903\/coord\/([^/]+)$/)) && req.method === 'GET') {
            return send(200, JSON.stringify(geoFor(m[1])), Object.assign({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=2592000'}, xcache));
        }
        if ((m = p.match(/^\/geocode\/(v000901|v000903)\/addr\/(.+)$/)) && req.method === 'GET') {
            return send(200, JSON.stringify({country: 'KR', address: decodeURIComponent(m[2]), location: {lat: 1, long: 2}}), Object.assign({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=2592000'}, xcache));
        }
        if (p === '/v000903/kma/coord/37.5665,126.9780') { return send(200, JSON.stringify({currentPubDate: '202609270900'}), {'Content-Type': 'application/json'}); }
        if (p === '/v000903/geo/37.5665,126.9780') { return send(302, '', {Location: '../kma/addr/x'}); }
        return send(404, 'Not Found', {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'});
    });
}

async function listen(server) {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return 'http://127.0.0.1:' + server.address().port;
}

function baselineFileFor() {
    return fs.mkdtempSync('/tmp/gateway-parity-') + '/baseline.json';
}

async function selfTest() {
    const direct = fakeService('direct');
    const gateway = fakeService('gateway');
    const broken = fakeService('gateway', (p, body) => { if (p.includes('/v000902/')) { body.name = 'different'; return true; } return false; });
    // London v000902 fails on both sides (e.g. Visual Crossing not yet deployed).
    const londonDown = (p) => (p.includes('/v000902/') && p.includes('/51.') ? 501 : false);
    const directDown = fakeService('direct', londonDown);
    const gatewayDown = fakeService('gateway', londonDown);
    const d = await listen(direct);
    const g = await listen(gateway);
    const b = await listen(broken);
    const dd = await listen(directDown);
    const gd = await listen(gatewayDown);
    const downBaseline = baselineFileFor();
    const baselineFile = baselineFileFor();
    const outcomes = [];
    try {
        let report = createReport();
        await runDirectVsGateway(d, g, report, baselineFile);
        let s = report.summary();
        outcomes.push(['identical services pass', s.failed === 0 && s.checks === 294, s.checks + ' checks, ' + s.failed + ' failed']);
        report = createReport();
        await runDirectVsGateway(d, b, report, null);
        s = report.summary();
        outcomes.push(['a v000902 difference is detected', s.failed > 0 && s.failures.every(f => f.name.includes('/v000902/')), s.failed + ' failed']);
        report = createReport();
        await runPublic(d, report, null);
        s = report.summary();
        outcomes.push(['PC-1 passes on the new routes', s.failed === 0, s.checks + ' checks']);
        report = createReport();
        await runPublic(g, report, baselineFile);
        s = report.summary();
        outcomes.push(['RB-1 matches the gateway baseline', s.failed === 0, s.checks + ' checks']);
        report = createReport();
        await runPublic(d, report, baselineFile);
        s = report.summary();
        outcomes.push(['RB-1 detects the new-route headers', s.failed > 0, s.failed + ' failed']);
        report = createReport();
        await runDirectVsGateway(dd, gd, report, downBaseline);
        s = report.summary();
        outcomes.push(['a cell failing on both sides passes DO-1', s.failed === 0, s.checks + ' checks']);
        report = createReport();
        await runPublic(dd, report, null, downBaseline);
        s = report.summary();
        outcomes.push(['PC-1 --expect accepts the cell that failed before cutover', s.failed === 0, s.checks + ' checks']);
        report = createReport();
        await runPublic(dd, report, null, null);
        s = report.summary();
        outcomes.push(['PC-1 without --expect would fail that cell', s.failed === 2 && s.failures.every(f => f.name.includes('/v000902/') && f.name.includes('/51.')), s.failed + ' failed']);
    }
    finally {
        [direct, gateway, broken, directDown, gatewayDown].forEach(server => server.close());
        fs.rmSync(baselineFile, {force: true});
        fs.rmSync(downBaseline, {force: true});
    }
    for (const [name, ok, detail] of outcomes) { console.log((ok ? 'ok     ' : 'FAILED ') + name + ' — ' + detail); }
    return outcomes.every(o => o[1]);
}

function arg(name) {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    if (process.argv.includes('--self-test')) {
        process.exit((await selfTest()) ? 0 : 1);
    }
    const report = createReport();
    if (arg('--direct') && arg('--gateway')) {
        await runDirectVsGateway(arg('--direct'), arg('--gateway'), report, arg('--save-baseline'));
    }
    else if (arg('--public')) {
        await runPublic(arg('--public'), report, arg('--baseline'), arg('--expect'));
    }
    else {
        console.error('usage: see the header of scripts/gateway-parity.mjs');
        process.exit(2);
    }
    const summary = report.summary();
    console.log(JSON.stringify(summary, null, 1));
    process.exit(summary.failed ? 1 : 0);
}

if (import.meta.url === 'file://' + process.argv[1]) {
    main().catch(err => { console.error(err); process.exit(1); });
}
