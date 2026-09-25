'use strict';
// Synthetic/injected regression suite. No application, provider or database startup.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const policy = require('../../lib/awsMinute/policy');
const now = Date.parse('2026-09-25T05:10:00Z');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/aws-minute/valid.html'));
let checks = 0;
async function check(name, fn) {
    await fn();
    checks++;
    console.log('PASS ' + name);
}
async function run() {
    await check('explicit KST instant including midnight and invalid dates', () => {
        assert.strictEqual(policy.instant('2026.09.25.14:09'), Date.parse('2026-09-25T05:09:00Z'));
        assert.strictEqual(policy.instant('2026.09.25.00:01'), Date.parse('2026-09-24T15:01:00Z'));
        assert(Number.isNaN(policy.instant('2026.02.30.00:00')));
    });
    const parser = require('../../lib/awsMinute/parser');
    function parse(
        body = html,
        statusCode = 200,
        headers = { 'content-type': 'text/html; charset=utf-8' },
        clock = now,
    ) {
        return parser.parse({ body, statusCode, headers }, clock);
    }
    await check('legacy layout normalizes station, time, field zero and unknown rain', () => {
        const data = parse();
        assert.strictEqual(data.accepted, 2);
        assert.strictEqual(data.rejected, 0);
        assert.strictEqual(data.rows[0].stationId, '108');
        assert.strictEqual(data.rows[0].values.t1h, 22);
        assert.strictEqual(data.rows[0].observedAt.toISOString(), '2026-09-25T05:09:00.000Z');
        assert.strictEqual(data.rows[1].values.t1h, 0);
        assert.strictEqual(data.rows[1].values.reh, 0);
        assert.strictEqual(data.rows[1].values.wsd, 0);
        assert(!('rs1h' in data.rows[1].rain));
    });
    await check('malformed/status/encoding/empty/time failures cannot count as success', () => {
        for (const body of [
            '',
            '<html>error</html>',
            html
                .toString()
                .replace(/<tr><td>108[\s\S]*?<\/tr>/, '')
                .replace(/<tr><td>159[\s\S]*?<\/tr>/, ''),
        ]) {
            assert.throws(() => parse(Buffer.from(body)));
        }
        assert.throws(() => parse(html, 503));
        assert.throws(() => parse(Buffer.from(html.toString().replace(/<\/table>/g, ''))));
        assert.throws(() =>
            parse(Buffer.from(html.toString().replace('<td>159</td>', '<td>108</td>'))),
        );
        assert.throws(() => parse(Buffer.from([0xff]), 200));
        assert.throws(() => parse(html, 200, { 'content-type': 'text/html; charset=unknown' }));
        assert.throws(() => parse(html, 200, { 'content-type': 'application/json' }));
        assert.throws(() => parse(html, 200, undefined, now - 120000));
        assert.throws(() => parse(html, 200, undefined, now + 19 * 60000));
    });
    await check(
        'field rejection is independent; malformed identity cannot poison other rows',
        () => {
            const data = parse(
                Buffer.from(
                    html.toString().replace('<td>70</td><td>1010', '<td>Infinity</td><td>1010'),
                ),
            );
            assert.strictEqual(data.rows[0].values.t1h, 22);
            assert(!('reh' in data.rows[0].values));
            const invalid = parse(
                Buffer.from(html.toString().replace('<td>108</td>', '<td>108oops</td>')),
            );
            assert.strictEqual(invalid.accepted, 1);
            assert.strictEqual(invalid.rejected, 1);
            assert(!policy.valid('t1h', NaN));
            assert(!policy.valid('t1h', -50));
            assert(!policy.valid('reh', 101));
            assert(policy.valid('vec', 0));
        },
    );
    const row = parse().rows[0];
    const mapping = {
        stationId: '108',
        stationName: 'Seoul',
        method: 'city-planar-1deg',
        distanceDegrees: 0.1,
    };
    const current = {
        t1h: 23.5,
        reh: 60,
        vec: 90,
        wsd: 3,
        sky: 3,
        pty: 0,
        rn1: 0,
        date: '20260925',
        time: '1400',
    };
    const times = {};
    policy.fields.forEach((f) => {
        times[f] = { value: current[f], observedAt: '2026-09-25T05:00:00.000Z' };
    });
    await check('newer observation replaces valid current per field and retains sources', () => {
        const result = policy.overlay(current, row, mapping, times, now);
        assert.strictEqual(result.t1h, 22);
        assert.strictEqual(result.vec, 0);
        assert.strictEqual(result.wsd, 0);
        assert.strictEqual(result.date, current.date);
        assert.strictEqual(result.time, current.time);
        assert.strictEqual(result.liveTime, '1409');
        assert.strictEqual(result.sky, 3);
        assert.strictEqual(result.rn1, 0);
        assert.strictEqual(
            result.minuteObservation.fields.t1h.observedAt,
            row.observedAt.toISOString(),
        );
        assert.strictEqual(current.t1h, 23.5);
    });
    await check(
        'invalid/equal/older/future/stale/unknown provenance leaves independent fallback',
        () => {
            let copy = { ...row, values: { ...row.values, reh: -1 } };
            assert.strictEqual(policy.overlay(current, copy, mapping, times, now).reh, 60);
            assert.strictEqual(policy.overlay(current, copy, mapping, times, now).t1h, 22);
            for (const ms of [now, now - 1, now - 60000]) {
                const newer = { t1h: { value: 23.5, observedAt: new Date(ms).toISOString() } };
                assert.strictEqual(policy.overlay(current, row, mapping, newer, now).t1h, 23.5);
            }
            for (const ms of [now + 1, now - 20 * 60000, now - 21 * 60000]) {
                assert.deepStrictEqual(
                    policy.overlay(
                        current,
                        { ...row, observedAt: new Date(ms) },
                        mapping,
                        times,
                        now,
                    ),
                    current,
                );
            }
            assert.strictEqual(policy.overlay(current, row, mapping, {}, now).t1h, 23.5);
            assert.strictEqual(
                policy.overlay({ ...current, t1h: -50 }, row, mapping, {}, now).t1h,
                22,
            );
            assert.deepStrictEqual(policy.overlay(current, row, null, times, now), current);
        },
    );
    await check('station policy checks city, mountain, numeric metadata and range', () => {
        const town = { gCoord: { lon: 126.978, lat: 37.5665 } };
        const station = {
            stnId: '108',
            stnName: 'Seoul',
            isCityWeather: true,
            geo: [126.98, 37.57],
        };
        assert(policy.selectStation(town, [station]));
        assert(!policy.selectStation(town, [{ ...station, isMountain: true }]));
        assert(!policy.selectStation(town, [{ ...station, isCityWeather: false }]));
        assert(!policy.selectStation(town, [{ ...station, geo: [129, 37] }]));
        assert(!policy.selectStation(town, []));
    });
    console.log('AWS minute: ' + checks + ' checks, TZ=' + (process.env.TZ || 'host'));
}
run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
