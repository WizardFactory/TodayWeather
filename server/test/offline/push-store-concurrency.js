'use strict';
// Several processes writing one SQLite push file (#2626): 10 writers × 20 records, the event loop of a writer that
// waits for a held lock, a lock left by a dead process, and two waiters on that stale lock. Real sql.js and file system;
// each writer is a separate Node process like a PM2 cluster worker. Node 10 compatible.
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var WRITERS = 10;
var RECORDS = 20;
var mode = process.argv[2];

global.log = {debug: function () {}, info: function () {}, warn: function () {}, error: console.error};

function upsert(store, token, index) {
    return new Promise(function (resolve, reject) {
        store.upsertAlarm({type: 'android', fcmToken: token, cityIndex: index, id: index, pushTime: 3600,
            geo: [127, 37.5], updatedAt: new Date()}, function (err) { return err ? reject(err) : resolve(); });
    });
}

if (mode === 'writer') {
    // argv: writer <file> <token> <count>
    var store = require('../../lib/pushStore/sqlite').create(process.argv[3]);
    var maxLag = 0;
    var probe;
    var started;
    // Measure after the one-time WebAssembly compile: the check is about waiting for the lock.
    require('../../lib/sqliteFileStore').init().then(function () {
        var last = Date.now();
        probe = setInterval(function () {
            var now = Date.now();
            maxLag = Math.max(maxLag, now - last - 10);
            last = now;
        }, 10);
        var jobs = [];
        for (var i = 0; i < Number(process.argv[5]); i++) {
            jobs.push(upsert(store, process.argv[4], i));
        }
        started = Date.now();
        if (process.env.TW_PUSH_WAIT_MARK) {
            fs.writeFileSync(process.env.TW_PUSH_WAIT_MARK, String(process.pid));
        }
        return Promise.all(jobs);
    }).then(function () {
        clearInterval(probe);
        console.log(JSON.stringify({maxLagMs: maxLag, elapsedMs: Date.now() - started}));
    }, function (err) {
        console.error(err.stack || err);
        process.exit(1);
    });
    return;
}

function spawnWriter(file, token, count, env) {
    return new Promise(function (resolve, reject) {
        var p = child.spawn(process.execPath, [__filename, 'writer', file, token, String(count)],
            {env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe']});
        var out = '';
        var err = '';
        p.stdout.on('data', function (d) { out += d; });
        p.stderr.on('data', function (d) { err += d; });
        p.on('close', function (code) {
            if (code !== 0) {
                return reject(new Error('writer ' + token + ' exit ' + code + ': ' + err));
            }
            resolve(JSON.parse(out.trim().split('\n').pop()));
        });
    });
}

function deadPid() {
    var p = child.spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {encoding: 'utf8'});
    return Number(p.stdout.trim());
}

function staleLock(file) {
    fs.writeFileSync(file + '.lock', JSON.stringify({pid: deadPid(), host: os.hostname(), at: Date.now(),
        token: 'dead'}));
}

require('sql.js')().then(function (SQL) {
    function inspect(file) {
        var db = new SQL.Database(fs.readFileSync(file));
        try {
            return {
                tokens: db.exec('SELECT fcm_token, COUNT(*) FROM alarms GROUP BY fcm_token ORDER BY fcm_token')[0].values,
                integrity: db.exec('PRAGMA integrity_check')[0].values[0][0],
                version: db.exec('PRAGMA user_version')[0].values[0][0]
            };
        }
        finally {
            db.close();
        }
    }

    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-push-concurrency-'));
    var file = path.join(tmp, 'push.sqlite');
    var writers = [];
    for (var w = 0; w < WRITERS; w++) {
        writers.push(spawnWriter(file, 'writer' + w, RECORDS));
    }
    var started = Date.now();
    return Promise.all(writers).then(function (results) {
        var state = inspect(file);
        assert.strictEqual(state.tokens.length, WRITERS);
        state.tokens.forEach(function (row) { assert.strictEqual(row[1], RECORDS, JSON.stringify(row)); });
        assert.strictEqual(state.integrity, 'ok');
        assert.strictEqual(state.version, 1);
        // Informational only: with 10 processes on a few CPUs this includes OS scheduling delay.
        var lag = Math.max.apply(null, results.map(function (r) { return r.maxLagMs; }));
        console.log('PASS ' + WRITERS + ' processes x ' + RECORDS + ' records: ' + (WRITERS * RECORDS) +
            ' rows, integrity ok, user_version 1 (max timer delay ' + lag + ' ms, ' + (Date.now() - started) + ' ms)');
        assert.ok(!fs.existsSync(file + '.lock'), 'lock released');

        // A live lock held for 800 ms after the writer starts writing: its timers keep running while it waits.
        fs.writeFileSync(file + '.lock', JSON.stringify({pid: process.pid, host: os.hostname(), at: Date.now(),
            token: 'held'}));
        var mark = path.join(tmp, 'waiting');
        var poll = setInterval(function () {
            if (fs.existsSync(mark)) {
                clearInterval(poll);
                setTimeout(function () { fs.unlinkSync(file + '.lock'); }, 800);
            }
        }, 10);
        return spawnWriter(file, 'waiter', 1, {TW_PUSH_WAIT_MARK: mark});
    }).then(function (result) {
        fs.unlinkSync(path.join(tmp, 'waiting'));
        assert.ok(result.elapsedMs >= 700, 'writer waited for the held lock: ' + result.elapsedMs + ' ms');
        assert.ok(result.maxLagMs < 100, 'event loop blocked for ' + result.maxLagMs + ' ms while waiting');
        console.log('PASS writer waited ' + result.elapsedMs + ' ms for a held lock; max timer delay ' +
            result.maxLagMs + ' ms');

        staleLock(file);
        return spawnWriter(file, 'afterDead', 1);
    }).then(function () {
        assert.deepStrictEqual(inspect(file).tokens.filter(function (r) { return r[0] === 'afterDead'; }),
            [['afterDead', 1]]);
        assert.ok(!fs.existsSync(file + '.lock'));
        console.log('PASS lock of a dead process is recovered');

        staleLock(file);
        return Promise.all([spawnWriter(file, 'waiterA', 5), spawnWriter(file, 'waiterB', 5)]);
    }).then(function () {
        var state = inspect(file);
        var counts = {};
        state.tokens.forEach(function (r) { counts[r[0]] = r[1]; });
        assert.strictEqual(counts.waiterA, 5);
        assert.strictEqual(counts.waiterB, 5);
        assert.strictEqual(state.integrity, 'ok');
        assert.ok(!fs.existsSync(file + '.lock') && !fs.existsSync(file + '.lock.takeover'));
        console.log('PASS two waiters on a stale lock: both writes kept, integrity ok');

        var python = child.spawnSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); ' +
            'print(c.execute("PRAGMA user_version").fetchone()[0], c.execute("PRAGMA integrity_check").fetchone()[0], ' +
            'c.execute("SELECT COUNT(*) FROM alarms").fetchone()[0])', file], {encoding: 'utf8'});
        if (python.error || python.status !== 0) {
            console.log('SKIP Python sqlite3 check: ' + (python.error ? python.error.message : python.stderr.trim()));
        }
        else {
            var parts = python.stdout.trim().split(' ');
            assert.deepStrictEqual(parts.slice(0, 2), ['1', 'ok']);
            console.log('PASS Python sqlite3 opens the file: user_version ' + parts[0] + ', integrity ' + parts[1] +
                ', ' + parts[2] + ' alarms');
        }
        fs.readdirSync(tmp).forEach(function (name) { fs.unlinkSync(path.join(tmp, name)); });
        fs.rmdirSync(tmp);
    });
}).then(function () {
    process.exit(0);
}, function (err) {
    console.error(err.stack || err);
    process.exit(1);
});
