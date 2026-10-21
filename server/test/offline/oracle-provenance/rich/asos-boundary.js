'use strict';
const EventEmitter = require('events');
// Exact native-collection and scripted HTTPS boundary functions from STATIONS-PROVENANCE.md.
function collection() {
    const docs = [];
    const get = (d, p) => p.split('.').reduce((c, k) => (c === undefined || c === null ? undefined : c[k]), d);
    function match(d, q) {
        return Object.keys(q).every(k => {
            const c = q[k], v = get(d, k);
            if (c && typeof c === 'object' && !(c instanceof Date)) {
                return Object.keys(c).every(op => {
                    if (op === '$gte') return v !== undefined && v >= c[op];
                    if (op === '$lte') return v !== undefined && (v instanceof Date ? +v <= +c[op] : v <= c[op]);
                    if (op === '$exists') return (v !== undefined) === c[op];
                    throw new Error('op ' + op);
                });
            }
            return v === c;
        });
    }
    function setPath(d, p, v) {
        const parts = p.split('.');
        let c = d;
        for (let i = 0; i < parts.length - 1; i++) { if (typeof c[parts[i]] !== 'object' || c[parts[i]] === null) c[parts[i]] = {}; c = c[parts[i]]; }
        c[parts[parts.length - 1]] = v instanceof Date ? new Date(+v) : (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
    }
    return {
        docs,
        find(q) {
            let list = docs.filter(d => match(d, q));
            const cursor = {
                sort(s) { const k = Object.keys(s)[0]; list = list.slice().sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)); return cursor; },
                maxTimeMS() { return cursor; },
                toArray() { return Promise.resolve(list.map(d => JSON.parse(JSON.stringify(d), (k, v) => (k === 'date' || k === 'fetchedAt' || k === 'expiresAt') && typeof v === 'string' ? new Date(v) : v))); }
            };
            return cursor;
        },
        async updateOne(q, u, o) {
            const hit = docs.find(d => match(d, q));
            if (hit) { if (u.$set) for (const k of Object.keys(u.$set)) setPath(hit, k, u.$set[k]); return {matchedCount: 1}; }
            if (o && o.upsert) {
                const d = {};
                for (const k of Object.keys(q)) { const c = q[k]; if (!(c && typeof c === 'object' && !(c instanceof Date))) setPath(d, k, c); }
                for (const op of ['$setOnInsert', '$set']) if (u[op]) for (const k of Object.keys(u[op])) setPath(d, k, u[op][k]);
                if (docs.some(x => x._id === d._id)) { const e = new Error('dup'); e.code = 11000; throw e; }
                docs.push(d);
                return {upsertedCount: 1};
            }
            return {matchedCount: 0};
        },
        async deleteOne(q) { const i = docs.findIndex(d => match(d, q)); if (i >= 0) docs.splice(i, 1); return {}; }
    };
}
// Scripted data.go.kr transport: `script(kind, params)` returns {status, items} or {status, body}.
function transport(script, log) {
    return {
        get(url, cb) {
            const u = new URL(url);
            const params = Object.fromEntries(u.searchParams.entries());
            const kind = u.pathname.includes('Hourly') ? 'hourly' : 'daily';
            const answer = script(kind, params);
            const page = +params.pageNo, size = +params.numOfRows;
            let body;
            if (answer.body !== undefined) body = answer.body;
            else if (answer.code) body = JSON.stringify({response: {header: {resultCode: answer.code, resultMsg: answer.msg || 'NO_DATA'}}});
            else {
                const slice = answer.items.slice((page - 1) * size, page * size);
                body = JSON.stringify({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
                    body: {dataType: 'JSON', items: {item: slice}, pageNo: page, numOfRows: size, totalCount: answer.items.length}}});
            }
            const q = Object.assign({}, params); delete q.serviceKey;
            log.push({kind, query: q, status: answer.status || 200, body});
            const req = new EventEmitter();
            req.destroy = () => {};
            setImmediate(() => {
                const res = new EventEmitter();
                res.statusCode = answer.status || 200;
                res.destroy = () => {};
                cb(res);
                res.emit('data', Buffer.from(body));
                res.emit('end');
            });
            return req;
        }
    };
}
module.exports = {collection, transport};
