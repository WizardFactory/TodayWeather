/**
 * A SQLite database file shared by several processes (#2626).
 *
 * The service host runs Node 10.15.3 on glibc 2.17, so the file is opened with sql.js 1.8.0 (SQLite compiled to
 * WebAssembly, see #2623) instead of a native binding. sql.js keeps a database in memory: a writer takes the lock
 * file, re-reads the file, applies its change and replaces the file (temp file, fsync, rename, directory fsync).
 * Readers keep an in-memory copy until the file's inode, size or mtime change.
 *
 * Writers are HTTP workers, so waiting for the lock uses timers and never blocks the event loop. A lock left by a
 * dead process (or older than STALE_LOCK_MS) is removed by one waiter at a time under a short takeover lock.
 * Keep to Node 10 syntax and APIs.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var LOCK_WAIT_MS = 5 * 1000;
var LOCK_POLL_MS = 20;
var STALE_LOCK_MS = 30 * 1000;
var STALE_TAKEOVER_MS = 10 * 1000;

var sqlPromise = null;
var lockSeq = 0;

/** Load the sql.js WebAssembly module once per process. */
function init() {
    if (!sqlPromise) {
        sqlPromise = require('sql.js')();
        sqlPromise.catch(function () { sqlPromise = null; });
    }
    return sqlPromise;
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === 'EPERM';
    }
}

/** Create `target` with `content` only if it does not exist; the content is complete once the name appears. */
function createExclusive(target, content) {
    var tmp = target + '.' + process.pid + '.' + (++lockSeq) + '.tmp';
    fs.writeFileSync(tmp, content);
    try {
        fs.linkSync(tmp, target);
        return true;
    }
    catch (err) {
        if (err.code === 'EEXIST') {
            return false;
        }
        throw err;
    }
    finally {
        fs.unlinkSync(tmp);
    }
}

function readLock(lockPath) {
    try {
        var stat = fs.statSync(lockPath);
        var owner = {};
        try {
            owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                return null;
            }
        }
        return {ino: stat.ino, mtimeMs: stat.mtime.getTime(), owner: owner};
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

function isStale(lock, now) {
    var owner = lock.owner;
    if (owner.host === os.hostname() && typeof owner.pid === 'number' && !isAlive(owner.pid)) {
        return true;
    }
    var since = typeof owner.at === 'number' ? owner.at : lock.mtimeMs;
    return now - since > STALE_LOCK_MS;
}

/**
 * Remove a stale lock. Only the holder of `<lock>.takeover` may remove it, and only if the lock is still the same
 * stale file, so a waiter can never delete a lock another writer has just taken.
 */
function takeOver(lockPath, seen) {
    var takeoverPath = lockPath + '.takeover';
    var takeover = readLock(takeoverPath);
    if (takeover && Date.now() - takeover.mtimeMs > STALE_TAKEOVER_MS) {
        try { fs.unlinkSync(takeoverPath); } catch (err) { /* removed by another waiter */ }
    }
    if (!createExclusive(takeoverPath, JSON.stringify({pid: process.pid, host: os.hostname(), at: Date.now()}))) {
        return;
    }
    try {
        var current = readLock(lockPath);
        if (current && current.ino === seen.ino && isStale(current, Date.now())) {
            fs.unlinkSync(lockPath);
            (global.log || console).warn('sqlite store: removed stale lock ' + lockPath + ' pid=' + current.owner.pid);
        }
    }
    finally {
        fs.unlinkSync(takeoverPath);
    }
}

function acquireLock(lockPath) {
    var deadline = Date.now() + LOCK_WAIT_MS;
    var token = process.pid + ':' + Date.now() + ':' + (++lockSeq);
    var content = JSON.stringify({pid: process.pid, host: os.hostname(), at: Date.now(), token: token});

    function release() {
        var current = readLock(lockPath);
        if (current && current.owner.token === token) {
            fs.unlinkSync(lockPath);
        }
    }

    return new Promise(function (resolve, reject) {
        (function attempt() {
            try {
                if (createExclusive(lockPath, content)) {
                    return resolve(release);
                }
                var lock = readLock(lockPath);
                if (lock && isStale(lock, Date.now())) {
                    takeOver(lockPath, lock);
                    return setImmediate(attempt);
                }
                if (Date.now() >= deadline) {
                    return reject(new Error('sqlite store is locked by another writer: ' + lockPath));
                }
                setTimeout(attempt, LOCK_POLL_MS);
            }
            catch (err) {
                reject(err);
            }
        })();
    });
}

function writeAtomically(file, bytes) {
    var tmp = file + '.' + process.pid + '.tmp';
    var fd = fs.openSync(tmp, 'w', 384); // 0600: the file holds device tokens
    try {
        fs.writeSync(fd, Buffer.from(bytes), 0, bytes.length, 0);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    try {
        fs.renameSync(tmp, file);
    }
    catch (err) {
        try { fs.unlinkSync(tmp); } catch (unlinkErr) { /* nothing to clean */ }
        throw err;
    }
    var dir = fs.openSync(path.dirname(file), 'r');
    try {
        fs.fsyncSync(dir);
    }
    finally {
        fs.closeSync(dir);
    }
}

function userVersion(db) {
    return db.exec('PRAGMA user_version')[0].values[0][0];
}

/**
 * @param options {file, schemaSql, version, name}
 * @returns {{mutate: function(function(db)): Promise, read: function(function(db)): Promise}}
 */
function create(options) {
    var file = options.file;
    var name = options.name || 'sqlite store';
    var queue = Promise.resolve();
    var cache = {key: null, db: null};

    function open(SQL, bytes) {
        var db = bytes ? new SQL.Database(bytes) : new SQL.Database();
        try {
            if (!bytes) {
                db.exec(options.schemaSql);
                db.exec('PRAGMA user_version = ' + options.version);
            }
            var version = userVersion(db);
            if (version !== options.version) {
                throw new Error(name + ': ' + file + ' has user_version ' + version + ', expected ' + options.version);
            }
            return db;
        }
        catch (err) {
            db.close();
            throw err;
        }
    }

    /** Run fn(db) on the latest file under the writer lock and replace the file; nothing is written if fn throws. */
    function mutate(fn) {
        var run = function () {
            return init().then(function (SQL) {
                fs.mkdirSync(path.dirname(file), {recursive: true});
                return acquireLock(file + '.lock').then(function (release) {
                    try {
                        var db = open(SQL, fs.existsSync(file) ? fs.readFileSync(file) : null);
                        try {
                            var result = fn(db);
                            writeAtomically(file, db.export());
                            return result;
                        }
                        finally {
                            db.close();
                        }
                    }
                    finally {
                        release();
                    }
                });
            });
        };
        // One write at a time per process; the lock orders writes between processes.
        var next = queue.then(run, run);
        queue = next.catch(function () {});
        return next;
    }

    /** Run fn(db) on an in-memory copy that is reloaded when the file changes. fn must not modify db. */
    function read(fn) {
        return init().then(function (SQL) {
            var key = 'missing';
            var bytes = null;
            try {
                var stat = fs.statSync(file);
                key = [stat.ino, stat.size, stat.mtime.getTime()].join(':');
            }
            catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }
            if (key !== cache.key) {
                try {
                    if (key !== 'missing') {
                        bytes = fs.readFileSync(file);
                    }
                    var db = open(SQL, bytes);
                    if (cache.db) {
                        cache.db.close();
                    }
                    cache = {key: key, db: db};
                }
                catch (err) {
                    if (!cache.db) {
                        throw err;
                    }
                    (global.log || console).error(name + ': keeping the previous copy; cannot load ' + file + ': ' +
                        err.message);
                }
            }
            return fn(cache.db);
        });
    }

    return {file: file, mutate: mutate, read: read};
}

module.exports = {
    create: create,
    init: init,
    LOCK_WAIT_MS: LOCK_WAIT_MS,
    STALE_LOCK_MS: STALE_LOCK_MS
};
