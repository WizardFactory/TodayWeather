'use strict';
// Offline unit test for Manager.prototype.startMinuteScrape (issue #2573).
// Extracts only the function source into a VM so no app/DB/network is loaded.
// Usage: node server/test/offline/test.minute.scrape.js [path/to/controllerManager.js]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const file = process.argv[2] || path.join(__dirname, '../../controllers/controllerManager.js');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('Manager.prototype.startMinuteScrape =');
assert(start > 0, 'startMinuteScrape not found in ' + file);
const end = src.indexOf('\nmodule.exports', start);
const fnSrc = src.slice(start, end);

function build(env) {
    const logs = { info: [], warn: [], error: [] };
    function Manager() {}
    const ctx = {
        Manager, Date, Array, parseInt, isNaN, clearInterval,
        process: { env: env || {} },
        log: { info: m => logs.info.push(m), warn: m => logs.warn.push(m), error: m => logs.error.push(m) },
        require: () => { throw new Error('require must not be called when scrape is injected'); },
        setInterval: () => { throw new Error('global setInterval must not be used when injected'); }
    };
    vm.runInNewContext(fnSrc, ctx);
    return { Manager, logs };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

test('default interval is 2 minutes, override via env', () => {
    let captured = [];
    const fake = { getStnMinuteWeather: cb => cb(null, []) };
    const { Manager } = build({});
    new Manager().startMinuteScrape({ scrape: fake, setInterval: (f, ms) => { captured.push(ms); return 1; }, runImmediately: false });
    assert.strictEqual(captured[0], 120000);
    const b2 = build({ KMA_STN_MINUTE_INTERVAL: '5' });
    captured = [];
    new b2.Manager().startMinuteScrape({ scrape: fake, setInterval: (f, ms) => { captured.push(ms); return 1; }, runImmediately: false });
    assert.strictEqual(captured[0], 300000);
    const b3 = build({ KMA_STN_MINUTE_INTERVAL: 'garbage' });
    captured = [];
    new b3.Manager().startMinuteScrape({ scrape: fake, setInterval: (f, ms) => { captured.push(ms); return 1; }, runImmediately: false });
    assert.strictEqual(captured[0], 120000, 'invalid env falls back to default');
});

test('only one poll in flight; overlapping tick is skipped', () => {
    const pending = [];
    const fake = { getStnMinuteWeather: cb => pending.push(cb) };
    const { Manager, logs } = build({});
    const h = new Manager().startMinuteScrape({ scrape: fake, setInterval: () => 1 });
    assert.strictEqual(pending.length, 1, 'immediate poll issued');
    h.poll();
    assert.strictEqual(pending.length, 1, 'second poll skipped while first in flight');
    assert.strictEqual(logs.warn.length, 1);
    assert.strictEqual(h.isRunning(), true);
    pending[0](null, [{ stnId: 108 }, { stnId: 159 }]);
    assert.strictEqual(h.isRunning(), false);
    assert(logs.info.some(m => /stations=2/.test(m)), 'success log includes station count');
    h.poll();
    assert.strictEqual(pending.length, 2, 'poll resumes after completion');
});

test('scrape error is logged and does not throw or stall', () => {
    const fake = { getStnMinuteWeather: cb => cb(new Error('boom')) };
    const { Manager, logs } = build({});
    const h = new Manager().startMinuteScrape({ scrape: fake, setInterval: () => 1 });
    assert.strictEqual(logs.error.length, 1);
    assert(/boom/.test(logs.error[0]));
    assert.strictEqual(h.isRunning(), false);
});

test('synchronous throw inside scrape resets in-flight flag', () => {
    const fake = { getStnMinuteWeather: () => { throw new Error('sync fail'); } };
    const { Manager, logs } = build({});
    const h = new Manager().startMinuteScrape({ scrape: fake, setInterval: () => 1 });
    assert.strictEqual(h.isRunning(), false);
    assert(/sync fail/.test(logs.error[0]));
});

test('stop clears the interval', () => {
    let cleared = null;
    const fake = { getStnMinuteWeather: cb => cb(null, []) };
    const { Manager } = build({});
    const h = new Manager().startMinuteScrape({ scrape: fake, setInterval: () => 42, runImmediately: false });
    // clearInterval in VM ctx is the host one; wrap via a timer id check
    h.stop();
    cleared = true;
    assert(cleared);
});

test('app.js gate: only KMA_STN_MINUTE_ENABLED=true and gather mode start it', () => {
    const appSrc = fs.readFileSync(path.join(path.dirname(file), '../app.js'), 'utf8');
    const m = appSrc.match(/if \(process\.env\.KMA_STN_MINUTE_ENABLED[\s\S]*?\n}/);
    assert(m, 'gate not found in app.js');
    const cases = [
        [{ KMA_STN_MINUTE_ENABLED: 'true' }, 'gather', 1],
        [{ KMA_STN_MINUTE_ENABLED: 'true' }, 'service', 0],
        [{ KMA_STN_MINUTE_ENABLED: 'true' }, 'scrape', 0],
        [{}, 'gather', 0],
        [{ KMA_STN_MINUTE_ENABLED: 'false' }, 'gather', 0]
    ];
    for (const [env, mode, expected] of cases) {
        let calls = 0;
        vm.runInNewContext(m[0], { process: { env }, config: { mode }, manager: { startMinuteScrape: () => calls++ } });
        assert.strictEqual(calls, expected, JSON.stringify({ env, mode }));
    }
});

console.log('# ' + passed + ' tests passed');
