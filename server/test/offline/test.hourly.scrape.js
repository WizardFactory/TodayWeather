'use strict';
// Offline unit test for Manager.prototype.startHourlyScrape (issue #2573).
// Extracts only the function source into a VM so no app/DB/network is loaded.
// Usage: node server/test/offline/test.hourly.scrape.js [path/to/controllerManager.js]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = process.argv[2] || path.join(__dirname, '../../controllers/controllerManager.js');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('Manager.prototype.startHourlyScrape =');
assert(start > 0, 'startHourlyScrape not found in ' + file);
const end = src.indexOf('\nmodule.exports', start);
const fnSrc = src.slice(start, end);

function build(env) {
    const logs = { info: [], warn: [], error: [] };
    function Manager() {}
    const ctx = {
        Manager, Date, Array, String, parseInt, isNaN, clearInterval,
        process: { env: env || {} },
        log: { info: m => logs.info.push(m), warn: m => logs.warn.push(m), error: m => logs.error.push(m) },
        require: () => { throw new Error('require must not be called when scrape is injected'); },
        setInterval: () => { throw new Error('global setInterval must not be used when injected'); }
    };
    vm.runInNewContext(fnSrc, ctx);
    return { Manager, logs };
}

function clock(iso) { let t = new Date(iso); return { now: () => new Date(t.getTime()), set: iso2 => { t = new Date(iso2); } }; }

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

test('default run minutes 4,9,15,30; env override; invalid env falls back', () => {
    const fake = { getStnHourlyWeather: (d, cb) => cb(null, []) };
    let b = build({});
    let h = new b.Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1 });
    assert(/minutes=4,9,15,30/.test(b.logs.info[0]));
    b = build({ KMA_STN_HOURLY_MINUTES: '2, 7,61,x' });
    new b.Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1 });
    assert(/minutes=2,7$/.test(b.logs.info[0]), b.logs.info[0]);
    b = build({ KMA_STN_HOURLY_MINUTES: 'garbage' });
    new b.Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1 });
    assert(/minutes=4,9,15,30/.test(b.logs.info[0]));
});

test('tick runs only at configured minutes and once per minute', () => {
    let calls = 0;
    const fake = { getStnHourlyWeather: (d, cb) => { calls++; cb(null, [1, 2, 3]); } };
    const c = clock('2026-09-25T10:03:10Z');
    const { Manager, logs } = build({});
    const h = new Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1, now: c.now });
    assert.strictEqual(h.tick(), false); assert.strictEqual(calls, 0);
    c.set('2026-09-25T10:04:05Z'); assert.strictEqual(h.tick(), true); assert.strictEqual(calls, 1);
    c.set('2026-09-25T10:04:35Z'); assert.strictEqual(h.tick(), false, 'same minute → no rerun'); assert.strictEqual(calls, 1);
    c.set('2026-09-25T10:09:01Z'); assert.strictEqual(h.tick(), true); assert.strictEqual(calls, 2);
    c.set('2026-09-25T11:04:01Z'); assert.strictEqual(h.tick(), true, 'next hour same minute runs'); assert.strictEqual(calls, 3);
    assert(logs.info.some(m => /stations=3/.test(m)));
});

test('no immediate run by default; runImmediately=true runs once', () => {
    let calls = 0;
    const fake = { getStnHourlyWeather: (d, cb) => { calls++; cb(null, []); } };
    let b = build({});
    new b.Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1 });
    assert.strictEqual(calls, 0);
    new b.Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1, runImmediately: true });
    assert.strictEqual(calls, 1);
});

test('one run in flight; overlapping run skipped; resumes after completion', () => {
    const pending = [];
    const fake = { getStnHourlyWeather: (d, cb) => pending.push(cb) };
    const { Manager, logs } = build({});
    const h = new Manager().startHourlyScrape({ scrape: fake, setInterval: () => 1 });
    h.run(); assert.strictEqual(pending.length, 1); assert.strictEqual(h.isRunning(), true);
    h.run(); assert.strictEqual(pending.length, 1); assert.strictEqual(logs.warn.length, 1);
    pending[0](null, []); assert.strictEqual(h.isRunning(), false);
    h.run(); assert.strictEqual(pending.length, 2);
});

test("'skip' result is informational; Error is logged; sync throw resets flag", () => {
    let b = build({});
    let h = new b.Manager().startHourlyScrape({ scrape: { getStnHourlyWeather: (d, cb) => cb('skip') }, setInterval: () => 1 });
    h.run(); assert.strictEqual(b.logs.error.length, 0); assert(b.logs.info.some(m => /already updated/.test(m)));
    b = build({});
    h = new b.Manager().startHourlyScrape({ scrape: { getStnHourlyWeather: (d, cb) => cb(new Error('boom')) }, setInterval: () => 1 });
    h.run(); assert(/boom/.test(b.logs.error[0])); assert.strictEqual(h.isRunning(), false);
    b = build({});
    h = new b.Manager().startHourlyScrape({ scrape: { getStnHourlyWeather: () => { throw new Error('sync'); } }, setInterval: () => 1 });
    h.run(); assert(/sync/.test(b.logs.error[0])); assert.strictEqual(h.isRunning(), false);
});

test('passes undefined day to getStnHourlyWeather (current KST hour)', () => {
    let seen = 'unset';
    const { Manager } = build({});
    new Manager().startHourlyScrape({ scrape: { getStnHourlyWeather: (d, cb) => { seen = d; cb(null, []); } }, setInterval: () => 1, runImmediately: true });
    assert.strictEqual(seen, undefined);
});

test('app.js gate: only KMA_STN_HOURLY_ENABLED=true and gather mode start it', () => {
    const appSrc = fs.readFileSync(path.join(path.dirname(file), '../app.js'), 'utf8');
    const m = appSrc.match(/if \(process\.env\.KMA_STN_HOURLY_ENABLED[\s\S]*?\n}/);
    assert(m, 'gate not found in app.js');
    const cases = [
        [{ KMA_STN_HOURLY_ENABLED: 'true' }, 'gather', 1],
        [{ KMA_STN_HOURLY_ENABLED: 'true' }, 'service', 0],
        [{}, 'gather', 0],
        [{ KMA_STN_HOURLY_ENABLED: 'false' }, 'gather', 0]
    ];
    for (const [env, mode, expected] of cases) {
        let calls = 0;
        vm.runInNewContext(m[0], { process: { env }, config: { mode }, manager: { startHourlyScrape: () => calls++ } });
        assert.strictEqual(calls, expected, JSON.stringify({ env, mode }));
    }
});

console.log('# ' + passed + ' tests passed');
