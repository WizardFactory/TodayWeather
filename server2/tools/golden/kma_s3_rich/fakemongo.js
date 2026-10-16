/* In-memory MongoDB collection double for the S15b store oracle (task evidence, not a repository
 * tool). Implements the driver calls the legacy savers make through Mongoose 5.1.2 (find with
 * sort/limit/projection, update with upsert/multi, updateMany, remove) with MongoDB < 5.0 field
 * order (existing fields keep their position, new fields are appended in update order) and a
 * BSON round trip (undefined -> null, integral numbers in int32 lose -0). */
'use strict';
let nextId = 1;
function bson(v) {
    if (v === undefined) return null;
    if (v === null) return null;
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number') return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? (v === 0 ? 0 : v) : v;
    if (Array.isArray(v)) return v.map(bson);
    if (typeof v === 'object') {
        if (v._bsontype === 'ObjectID' || v._bsontype === 'ObjectId') return v;
        const o = {};
        for (const k of Object.keys(v)) o[k] = bson(v[k]);
        return o;
    }
    return v;
}
function get(doc, path) {
    let cur = doc;
    for (const p of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}
function cmp(a, b) {
    const n = x => x instanceof Date ? x.getTime() : x;
    a = n(a); b = n(b);
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    return a < b ? -1 : 1;
}
function eq(a, b) {
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if (a && typeof a === 'object' && b && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    if ((a === undefined || a === null) && b === null) return true;
    return a === b;
}
function matchValue(v, cond) {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) &&
        Object.keys(cond).length && Object.keys(cond).every(k => k[0] === '$')) {
        return Object.keys(cond).every(op => {
            const c = cond[op];
            switch (op) {
                case '$lte': return v !== undefined && v !== null && cmp(v, c) <= 0;
                case '$lt': return v !== undefined && v !== null && cmp(v, c) < 0;
                case '$gte': return v !== undefined && v !== null && cmp(v, c) >= 0;
                case '$gt': return v !== undefined && v !== null && cmp(v, c) > 0;
                case '$ne': return !eq(v, c);
                case '$in': return c.some(x => eq(v, x));
                case '$nin': return !c.some(x => eq(v, x));
                default: throw new Error('fakemongo: unsupported operator ' + op);
            }
        });
    }
    return eq(v, cond);
}
function matches(doc, q) {
    return Object.keys(q || {}).every(k => {
        if (k === '$or') return q[k].some(sub => matches(doc, sub));
        if (k === '$and') return q[k].every(sub => matches(doc, sub));
        return matchValue(get(doc, k), q[k]);
    });
}
function setPath(doc, path, value) {
    const parts = path.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined || cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = bson(value);
}
function unsetPath(doc, path) {
    const parts = path.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) { cur = cur && cur[parts[i]]; }
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
}
function apply(doc, update, inserting) {
    for (const op of Object.keys(update)) {
        const body = update[op];
        if (op === '$set' || (op === '$setOnInsert' && inserting)) {
            for (const k of Object.keys(body)) setPath(doc, k, body[k]);
        } else if (op === '$unset') {
            for (const k of Object.keys(body)) unsetPath(doc, k);
        } else if (op === '$inc') {
            for (const k of Object.keys(body)) setPath(doc, k, (get(doc, k) || 0) + body[k]);
        } else if (op === '$push' || op === '$pushAll') {
            for (const k of Object.keys(body)) {
                const v = body[k];
                const add = op === '$pushAll' ? v : (v && typeof v === 'object' && v.$each ? v.$each : [v]);
                const cur = get(doc, k);
                setPath(doc, k, (Array.isArray(cur) ? cur : []).concat(add));
            }
        } else if (op === '$setOnInsert') {
            // not inserting
        } else if (op[0] === '$') {
            throw new Error('fakemongo: unsupported update ' + op);
        }
    }
}
function project(doc, projection) {
    const out = {};
    const excluded = Object.keys(projection || {}).filter(k => !projection[k]);
    const included = Object.keys(projection || {}).filter(k => projection[k] && k !== '_id');
    for (const k of Object.keys(doc)) {
        if (included.length ? !(included.includes(k) || (k === '_id' && projection._id !== 0)) : excluded.includes(k)) continue;
        out[k] = bson(doc[k]);
    }
    return out;
}
class FakeCollection {
    constructor(name) { this.name = name; this.docs = []; this.log = []; }
    find(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        options = options || {};
        // 2d `$near` (S15b-3): planar distance over [lon, lat], `$maxDistance` inclusive, ascending
        // distance, natural order for ties; the remaining conditions filter as usual.
        let near = null;
        query = Object.assign({}, query || {});
        for (const k of Object.keys(query)) {
            const c = query[k];
            if (c && typeof c === 'object' && !Array.isArray(c) && c.$near) { near = {k, c}; delete query[k]; }
        }
        let list = this.docs.filter(d => matches(d, query));
        if (near) {
            const [x0, y0] = near.c.$near;
            const dist = d => { const g = get(d, near.k); return Array.isArray(g) ? Math.hypot(g[0] - x0, g[1] - y0) : Infinity; };
            list = list.map((d, i) => ({d, i, r: dist(d)}))
                .filter(e => e.r <= (near.c.$maxDistance === undefined ? Infinity : near.c.$maxDistance))
                .sort((a, b) => a.r - b.r || a.i - b.i).map(e => e.d);
        }
        const sort = options.sort;
        if (sort) {
            const keys = Array.isArray(sort) ? sort : Object.keys(sort).map(k => [k, sort[k]]);
            list = list.slice().sort((a, b) => {
                for (const [k, dir] of keys) { const c = cmp(get(a, k), get(b, k)); if (c) return dir < 0 ? -c : c; }
                return 0;
            });
        }
        if (options.limit) list = list.slice(0, options.limit);
        const out = list.map(d => project(d, options.projection || options.fields));
        const cursor = {toArray: done => done(null, out)};
        if (cb) cb(null, cursor);
        return cursor;
    }
    _update(query, update, options, many) {
        options = options || {};
        const hits = this.docs.filter(d => matches(d, query));
        const targets = many ? hits : hits.slice(0, 1);
        for (const d of targets) apply(d, update, false);
        if (!targets.length && options.upsert) {
            // S15b-3b: an upsert whose query names an existing _id is a duplicate key (E11000).
            if (query && query._id !== undefined && this.docs.some(d => d._id === query._id)) {
                const err = new Error('E11000 duplicate key error collection: ' + this.name);
                err.code = 11000;
                return {error: err};
            }
            const doc = {_id: 'oid' + (nextId++)};
            for (const k of Object.keys(query)) {
                if (k[0] === '$') continue;
                const v = query[k];
                if (v && typeof v === 'object' && !(v instanceof Date) && Object.keys(v).some(x => x[0] === '$')) continue;
                setPath(doc, k, v);
            }
            apply(doc, update, true);
            this.docs.push(doc);
            this.log.push({op: 'insert', query, update});
            return {result: {n: 1, nModified: 0, upserted: [doc._id]}, n: 1};
        }
        this.log.push({op: 'update', query, update, n: targets.length});
        return {result: {n: targets.length, nModified: targets.length}, n: targets.length, nModified: targets.length};
    }
    update(query, update, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const r = this._update(query, update, options, options && options.multi);
        if (cb) process.nextTick(() => cb(null, r));
        return Promise.resolve(r);
    }
    updateOne(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, false); if (cb) process.nextTick(() => r.error ? cb(r.error) : cb(null, r)); return r.error ? Promise.reject(r.error) : Promise.resolve(r); }
    updateMany(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, true); if (cb) process.nextTick(() => cb(null, r)); return Promise.resolve(r); }
    remove(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const before = this.docs.length;
        this.docs = this.docs.filter(d => !matches(d, query));
        const r = {result: {n: before - this.docs.length}};
        if (cb) process.nextTick(() => cb(null, r));
        return Promise.resolve(r);
    }
    deleteMany(q, o, cb) { return this.remove(q, o, cb); }
    ensureIndex(...args) { const cb = args.find(a => typeof a === 'function'); if (cb) process.nextTick(() => cb(null, 'idx')); }
    createIndex(...args) { return this.ensureIndex(...args); }
    insert(docs, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        (Array.isArray(docs) ? docs : [docs]).forEach(d => this.docs.push(bson(d)));
        if (cb) process.nextTick(() => cb(null, {result: {n: 1}}));
    }
    insertOne(doc, options, cb) { return this.insert(doc, options, cb); }
    insertMany(docs, options, cb) { return this.insert(docs, options, cb); }
}
/** Attach a fake driver collection to a Mongoose model (no connection, no buffering). */
function attach(model) {
    const fake = new FakeCollection(model.collection.name);
    model.collection.buffer = false;
    model.collection.collection = fake;
    return fake;
}
function ejson(v) {
    if (v instanceof Date) return {$date: v.getTime()};
    if (Array.isArray(v)) return v.map(ejson);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ejson(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$number: String(v)};
    return v;
}
module.exports = {FakeCollection, attach, ejson, bson};

