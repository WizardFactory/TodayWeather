/* Full v000903 KMA coordinate router smoke for forecast rain/snow periods (#2583, D45).
 * Mixed-period fixture (verification matrix V41): past observed rows, the shortest window and
 * hourly PCP/SNO rows in one response. Uses the rss-response-smoke harness: no HTTP socket,
 * Mongo, provider calls or timers.
 * Run: TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/precipitation-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'precipitation-smoke-output');
fs.mkdirSync(outputDir, {recursive: true});

function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }
function hhmm(d) { return d.toISOString().slice(11, 16).replace(':', ''); }

// Stored hourly values, as the collector writes them: amount plus category text.
const pcp = {
    '2026092405': 1, '2026092406': 1,                                                   // past forecast hours
    '2026092416': 2, '2026092417': 4, '2026092418': 1,                                  // AC1 slot 18h
    '2026092420': [0.5, '1mm 미만'], '2026092421': [40, '30.0~50.0mm'],                 // category slot 21h
    '2026092513': 10, '2026092519': [50, '50.0mm 이상'],                               // AC6 10 mm; open category
    '2026092607': 3, '2026092608': 2.5                                                   // exact-only day
};
const sno = {'2026092412': 1, '2026092511': [0.5, '1cm 미만']};
function mixedFixture(policy) {
    const fixture = makeFixture(locations[0], policy);
    fixture.short = [];
    for (let hour = -48; hour <= 24 * 3; hour++) {
        const d = new Date(Date.UTC(2026, 8, 24, hour));
        const key = ymd(d) + hhmm(d).slice(0, 2);
        const row = {date: ymd(d), time: hhmm(d), pop: 10, pty: 0, r06: 0, s06: 0, reh: 60, sky: 1, t3h: 22, tmn: 18, tmx: 27, uuu: 1, vvv: -2, wav: 0.8, vec: 270, wsd: 2};
        for (const [table, field] of [[pcp, 'r06'], [sno, 's06']]) {
            const value = table[key];
            if (value === undefined) continue;
            row[field] = Array.isArray(value) ? value[0] : value;
            if (Array.isArray(value)) row[field + 'Text'] = value[1];
            row.pty = field === 's06' ? 3 : 1; row.pop = 80; row.sky = 4;
        }
        fixture.short.push(row);
    }
    // Shortest window 10-12h: snow (pty 3) with hourly precipitation 1, 2 and "1mm 미만".
    fixture.shortest = fixture.shortest.map((row, i) => Object.assign(row, {pty: 3, sky: 4, rn1: [1, 2, 0.5][i]}, i === 2 ? {rn1Text: '1mm 미만'} : {}));
    // Past slot 06h: observed rain 1 mm per hour at 04-06h.
    fixture.current.forEach(row => { if (row.date === '20260924' && ['0400', '0500', '0600'].includes(row.time)) { row.rn1 = 1; row.pty = 1; } });
    // A newer RSS publication overwrites 15-24h slots with six-hour amounts.
    fixture.rss.forEach(row => { row.r06 = row.date.endsWith('1800') ? 5 : 0; row.s06 = -1; });
    return fixture;
}
const sum = values => Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10;
function dayForecast(date) {
    // Hours 01-24 of the date: the end-labelled slots 03h ... 24h.
    const values = [];
    for (let hour = 1; hour <= 24; hour++) {
        const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), hour));
        const value = pcp[ymd(d) + hhmm(d).slice(0, 2)];
        values.push(Array.isArray(value) ? value[0] : value || 0);
    }
    return sum(values);
}

async function main() {
    const output = [];
    for (const version of ['1.0', '2.0']) for (const policy of ['equal', 'newer']) for (const units of ['si', 'fahrenheit_kmh']) {
        const label = [version, policy, units].join('/');
        const harness = createHarness(version, mixedFixture(policy));
        const result = await harness.request(units === 'si' ? {windSpeedUnit: 'm/s', temperatureUnit: 'C'} : {windSpeedUnit: 'km/h', temperatureUnit: 'F'});
        const body = result.body;
        const at = (date, time) => body.short.find(s => s.date === date && s.time === time);
        const day = date => body.midData.dailyData.find(d => d.date === date);
        assert.deepEqual(result.traces, harness.methods, label + ': all v000903 coordinate middleware execute');

        // AC1: 2 + 4 + 1 in one slot, nothing in the neighbours.
        const s18 = at('20260924', 18);
        if (policy === 'equal') {
            assert.equal(s18.r06, 7, label + ': slot 18h total'); assert.equal(s18.r06Hours, 3); assert.equal(s18.r06Approx, false);
            assert.equal(s18.r06Str, '7mm', label + ': string from amount');
            assert.equal(at('20260924', 15).r06, 0, label + ': 15h gets no part of 16-18h');
            // Categories: "1mm 미만" + "30.0~50.0mm" + no rain.
            const s21 = at('20260924', 21);
            assert.equal(s21.r06, 40.5, label + ': category total'); assert.equal(s21.r06Approx, true); assert.equal(s21.r06Str, '30~51mm');
        }
        else {
            // RSS six-hour amounts are labelled as such and never mixed into daily totals.
            assert.equal(s18.r06, 5, label + ': newer RSS six-hour amount'); assert.equal(s18.r06Hours, 6);
            assert.equal(day('20260924').r06, undefined, label + ': daily total unknown with a six-hour amount');
        }
        // AC3: shortest window 10-12h, pty 3.
        const s12 = at('20260924', 12);
        assert.equal(s12.pty, 3, label + ': shortest pty');
        assert.equal(s12.r06, 3.5, label + ': shortest rain stays in r06'); assert.equal(s12.r06Hours, 3); assert.equal(s12.r06Approx, true);
        assert.equal(s12.r06Str, '3~4mm');
        assert.equal(s12.s06, 10, label + ': SNO 1 cm becomes 10 mm; no x10 rain');
        assert.equal(s12.s06Str, '1cm');
        // Past row keeps the observed three-hour rain; r06 is the stored forecast total.
        const s06 = at('20260924', 6);
        assert.equal(s06.rn1, 3, label + ': observed rn1 on past row'); assert.equal(s06.r06, 2); assert.equal(s06.r06Hours, 3);
        // AC6: 10 mm stays 10 mm.
        const s1315 = at('20260925', 15);
        assert.equal(s1315.r06, 10, label + ': 13h hourly value reaches its slot'); assert.equal(s1315.r06Str, '10mm');
        assert.notEqual(s1315.r06Str, '5~9mm');
        const s0921 = at('20260925', 21);
        assert.equal(s0921.r06, 50); assert.equal(s0921.r06Approx, true); assert.equal(s0921.r06Str, '50~?mm');
        // Placeholders: no negative amounts reach installed apps.
        assert(body.short.every(s => s.r06 >= 0 && s.s06 >= 0 && Number.isInteger(s.r06Hours) && typeof s.r06Approx === 'boolean'), label + ': amounts and periods on every slot');
        // AC5: daily r06 is the sum of that day's hourly forecasts.
        assert.equal(day('20260925').r06, dayForecast('20260925'), label + ': 09-25 daily total');
        assert.equal(day('20260925').r06Hours, 24); assert.equal(day('20260925').r06Approx, true);
        assert.equal(day('20260926').r06, dayForecast('20260926'), label + ': 09-26 daily total');
        assert.equal(day('20260926').r06Approx, false); assert.equal(day('20260926').r06Str, '5.5mm');
        assert.equal(day('20260925').s06, 5, label + ': 09-25 daily snow 0.5 cm reported in mm');
        if (policy === 'equal') {
            const slots = body.short.filter(s => s.date === '20260924' && s.time > 0).map(s => s.r06);
            assert.equal(day('20260924').r06, sum(slots), label + ': 09-24 daily equals its slot totals');
        }
        // shortest[] rows state their one-hour period; stored category text never reaches the wire.
        // The DB 1.0 harness returns an empty shortest[] on the baseline too; its rows still
        // reach the short merge (the 12h assertions above).
        if (version === '2.0') {
            const last = body.shortest.find(s => s.time === 12 || s.time === '1200');
            assert(last, label + ': shortest 12h row');
            assert.equal(last.rn1Hours, 1); assert.equal(last.rn1Approx, true); assert.equal(last.rn1Str, '~1mm');
        }
        assert.equal(/"(r06|s06|rn1)Text"/.test(JSON.stringify(body)), false, label + ': no stored text in response');
        const thrown = result.logs.filter(x => x.args.some(a => typeof a === 'string' && /TypeError|ReferenceError|AssertionError/.test(a)));
        assert.deepEqual(thrown, [], label + ': no swallowed programming exceptions');
        output.push({version, policy, units, slots: ['0924/06', '0924/12', '0924/18', '0924/21', '0925/15', '0925/21'].map(k => {
            const [d, t] = k.split('/'); const s = at('2026' + d, +t);
            return {slot: k, pty: s.pty, rn1: s.rn1, r06: s.r06, r06Hours: s.r06Hours, r06Approx: s.r06Approx, r06Str: s.r06Str, s06: s.s06, s06Str: s.s06Str};
        }), daily: ['20260924', '20260925', '20260926'].map(d => ({date: d, r06: day(d).r06, r06Hours: day(d).r06Hours, r06Approx: day(d).r06Approx, r06Str: day(d).r06Str, s06: day(d).s06}))});
    }
    const report = {createdAt: new Date().toISOString(), hostTimezone: process.env.TZ || 'system', outcome: 'passed', scenarioCount: output.length, scenarios: output};
    fs.writeFileSync(path.join(outputDir, 'precipitation-evidence.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
