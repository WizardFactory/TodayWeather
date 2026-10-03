'use strict';
// Synthetic data. Real pinned Mongoose query construction; no connection.
const assert = require('assert');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const filename = path.resolve(__dirname, '../../lib/currentGridCollection.js');
assert(fs.existsSync(filename), 'current collection must filter exact-hour stored coverage before issuing HTTP');
const Current = require(filename);
assert.strictEqual(mongoose.version, '5.1.2', 'use pinned production query API');
const slot = {date: '20261003', time: '0000'};
const coords = Array.from({length: 2032}, (_, i) => ({mx: i % 149, my: Math.floor(i / 149)}));
const valid = () => ({date: slot.date, time: slot.time, t1h: 0, rn1: 0, uuu: -2, vvv: 0, reh: 0, pty: 0, vec: 0, wsd: 0});
const tests = [];
function test(name, fn) { tests.push({name, fn}); }
for (const version of ['1.0', '2.0']) {
    test(version + ': real pinned query filters incomplete and wrong-hour grids; valid zero/negative remain complete', async () => {
        const model = mongoose.model('coverage_' + version, new mongoose.Schema({}, {strict: false}));
        let calls = 0;
        const rows = coords.slice(0, 2029).map((c, i) => {
            const data = valid(); if (i === 0) { data.t1h = -12; }
            return {mCoord: c, currentData: version === '1.0' ? [data] : data};
        });
        rows.push({mCoord:coords[2029],currentData:version === '1.0' ? [{...valid(), t1h:-50}] : {...valid(), t1h:-50}});
        rows.push({mCoord:coords[2030],currentData:version === '1.0' ? [{...valid(), time:'2300'}] : {...valid(),time:'2300'}});
        model.Query.prototype.exec = function(cb) {
            calls++;
            assert.strictEqual(this.options.maxTimeMS, 2000);
            assert.strictEqual(this._mongooseOptions.lean, true);
            const filter = this.getQuery();
            if (version === '1.0') { assert.deepStrictEqual(filter.currentData.$elemMatch, slot); }
            else { assert.deepStrictEqual(filter, {fcsDate:new Date('2026-10-02T15:00:00Z'),'currentData.date':slot.date, 'currentData.time':slot.time}); }
            cb(null, rows);
        };
        const pending = await new Promise((res, rej) => Current.pending(model,version,slot,coords,(e,p)=>e?rej(e):res(p)));
        assert.strictEqual(calls,1);
        assert.deepStrictEqual(pending,coords.slice(2029));
        mongoose.deleteModel ? mongoose.deleteModel(model.modelName) : delete mongoose.models[model.modelName];
    });
}
test('every core field missing/non-finite/sentinel stays pending; zero and negative temperature are valid', () => {
    assert(Current.complete(valid(),slot));
    assert(Current.complete({...valid(),t1h:-20},slot));
    for (const field of ['t1h','rn1','uuu','vvv','reh','pty','vec','wsd']) {
        const data=valid();delete data[field];assert(!Current.complete(data,slot),field+' missing');
        assert(!Current.complete({...valid(),[field]:NaN},slot),field+' NaN');
        assert(!Current.complete({...valid(),[field]:Infinity},slot),field+' Infinity');
    }
    for (const [field,value] of [['t1h',-50],['rn1',-1],['uuu',-100],['vvv',-100],['reh',-1],['pty',-1],['vec',-1],['wsd',-1]]) {
        assert(!Current.complete({...valid(),[field]:value},slot),field+' sentinel');
    }
});
function fixture() {
    let rows=[], reads=0, collectCalls=0, release, readError;
    const model={find(){return {setOptions(o){assert.strictEqual(o.maxTimeMS,2000);return this},lean(){return this},exec(cb){reads++;cb(readError,rows)}}}};
    const records=[];
    const c=new Current({model,version:'2.0',coords:cb=>cb(null,coords),emit:r=>records.push(r),
        collect:(pending,s,key,cb)=>{collectCalls++;release=()=>{rows=pending.map(mCoord=>({mCoord,currentData:valid()}));cb()}}});
    return {c,records,get reads(){return reads},get calls(){return collectCalls},release:()=>release(),setError:e=>{readError=e},setRows:r=>{rows=r}};
}
test('joins same-hour callers, reports different-hour busy, reads storage after completion and does not refetch', () => {
    const f=fixture();let finished=0;
    f.c.run(slot,'synthetic',e=>{assert.ifError(e);finished++});
    f.c.run(slot,'synthetic',e=>{assert.ifError(e);finished++});
    f.c.run({...slot,time:'0100'},'synthetic',e=>{assert(e);finished++});
    assert.strictEqual(f.calls,1);assert.strictEqual(finished,1);
    f.release();assert.strictEqual(finished,3);assert.strictEqual(f.reads,2);
    f.c.run(slot,'synthetic',e=>{assert.ifError(e);finished++});
    assert.strictEqual(f.calls,1);assert.strictEqual(finished,4);
    assert.strictEqual(f.records.at(-1).pending,0);
});
test('DB read failure issues no provider call and releases guard', () => {
    const f=fixture();f.setError(new Error('storage unavailable'));
    f.c.run(slot,'synthetic',e=>assert(e));assert.strictEqual(f.calls,0);
    f.setError(null);f.c.run(slot,'synthetic',()=>{});assert.strictEqual(f.calls,1);f.release();
});
test('successful callback with unacknowledged storage remains incomplete and eligible later', () => {
    let walks=0;
    const model={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}}};
    const c=new Current({model,version:'2.0',coords:cb=>cb(null,coords),emit:()=>{},collect:(p,s,k,cb)=>{walks++;cb()}});
    c.run(slot,'synthetic',e=>assert(e));c.run(slot,'synthetic',e=>assert(e));assert.strictEqual(walks,2);
});
test('stalled read releases the guard without HTTP and ignores late completion', async () => {
    let late,done=0,walks=0;
    const model={find(){return {setOptions(){return this},lean(){return this},exec(cb){late=cb}}}};
    const c=new Current({model,version:'2.0',readTimeoutMs:5,coords:cb=>cb(null,coords),emit:()=>{},collect:()=>walks++});
    c.run(slot,'synthetic',e=>{assert(e);done++});
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.strictEqual(done,1,'stalled storage must report a bounded failure');
    assert.strictEqual(c.active,null);
    late(null,[]);assert.strictEqual(done,1);assert.strictEqual(walks,0);
});
(async()=>{for(const t of tests){await t.fn();console.log('ok - '+t.name)}console.log('current coverage: '+tests.length+' passed')})().catch(e=>{console.error(e);process.exitCode=1});
