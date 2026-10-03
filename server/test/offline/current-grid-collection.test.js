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

// Real producer accepts these useful partial observations; coverage must remain truthful.
const organizer = require('./harness');
function observation(s, missing) {
    const values = {T1H:'-12',RN1:'0',UUU:'0',VVV:'0',REH:'50',PTY:'0',VEC:'0',WSD:'0'};
    const items=Object.keys(values).filter(category=>category!==missing).map(category=>({baseDate:[s.date],baseTime:[s.time],nx:['60'],ny:['127'],category:[category],obsrValue:[values[category]]}));
    const c=organizer.prepare(organizer.collector());c.organizeCurrentData(0,organizer.response(items));
    assert(c.resultList[0].isCompleted,'actual producer accepts optional-field partial rows');
    const row={};for(const key in c.resultList[0].data[0]){row[key]=c.resultList[0].data[0][key]}return row;
}
function partialFixture(version, missing, repairAt, extraCoords) {
    let rows=[],calls=0,release;
    const points=extraCoords||[{mx:60,my:127}],events=[];
    const model={find(){return{setOptions(){return this},lean(){return this},exec(cb){cb(null,rows)}}}};
    const c=new Current({model,version,collectTimeoutMs:100,coords:cb=>cb(null,points),emit:r=>events.push(r),collect:(list,s,k,cb)=>{
        calls++;release=()=>{rows=list.map(mCoord=>({mCoord,currentData:version==='1.0'?[observation(s,calls===repairAt?undefined:missing)]:observation(s,calls===repairAt?undefined:missing)}));cb()};
    }});
    return {c,model,events,points,get calls(){return calls},release:()=>release(),rows:r=>{rows=r}};
}
for (const version of ['1.0','2.0']) {
    for(const missing of ['VEC','UUU','REH']) {
        test(version+': persistent '+missing+' partial is pending but only admits two same-hour collections',()=>{
            const f=partialFixture(version,missing);let finished=0;
            for(let i=0;i<6;i++) {
                f.c.run(slot,'synthetic',(err,r)=>{assert(err);assert.strictEqual(r.pending,1);assert.strictEqual(r.deferred,i>=2?1:0);finished++});
                if(i<2){assert.strictEqual(f.calls,i+1);f.release()}
                else{assert.strictEqual(f.calls,2)}
            }
            assert.strictEqual(finished,6);assert.strictEqual(f.events.at(-1).deferred,1);
            assert(f.events.some(e=>e.event==='current-coverage'&&e.pending===1&&e.complete===0));
            assert(f.events.some(e=>e.event==='current-repair-plan'&&e.eligible===0&&e.deferred===1&&e.limit===2));
            let done=0;f.c.run({...slot,time:'0100'},'synthetic',(err,r)=>{assert(err);assert.strictEqual(r.deferred,0);done++});f.release();assert.strictEqual(f.calls,3);assert.strictEqual(done,1);
        });
    }
    test(version+': overlap shares admission; a complete second observation repairs and then skips',()=>{
        const f=partialFixture(version,'VEC',2);let callbacks=0;
        f.c.run(slot,'synthetic',e=>{assert(e);callbacks++});f.c.run(slot,'synthetic',e=>{assert(e);callbacks++});assert.strictEqual(f.calls,1);f.release();assert.strictEqual(callbacks,2);
        f.c.run(slot,'synthetic',(e,r)=>{assert.ifError(e);assert.strictEqual(r.pending,0);callbacks++});f.release();
        for(let i=0;i<4;i++){f.c.run(slot,'synthetic',e=>{assert.ifError(e);callbacks++})}
        assert.strictEqual(f.calls,2);assert.strictEqual(callbacks,7);
    });
    test(version+': absent and invalid temperature/rain/type stay eligible beyond two admissions',()=>{
        for(const invalid of [null,{t1h:-50},{rn1:-1},{pty:-1}]) {
            let calls=0;
            const row=invalid?{...valid(),...invalid}:null;
            const model={find(){return{setOptions(){return this},lean(){return this},exec(cb){cb(null,row?[{mCoord:{mx:60,my:127},currentData:version==='1.0'?[row]:row}]:[])}}}};
            const c=new Current({model,version,coords:cb=>cb(null,[{mx:60,my:127}]),emit:()=>{},collect:(p,s,k,cb)=>{calls++;cb()}});
            for(let i=0;i<6;i++){c.run(slot,'synthetic',(e,r)=>{assert(e);assert.strictEqual(r.pending,1);assert.strictEqual(r.deferred,0)})}
            assert.strictEqual(calls,6);
        }
    });
    test(version+': a deferred partial does not suppress a missing grid and restart has a fresh budget',()=>{
        const points=[{mx:60,my:127},{mx:61,my:127}],row={...valid(),vec:-1};let collected=[];
        const model={find(){return{setOptions(){return this},lean(){return this},exec(cb){cb(null,[{mCoord:points[0],currentData:version==='1.0'?[row]:row}])}}}};
        const options={model,version,coords:cb=>cb(null,points),emit:()=>{},collect:(p,s,k,cb)=>{collected.push(p);cb()}};
        const c=new Current(options);
        for(let i=0;i<6;i++){c.run(slot,'synthetic',(e,r)=>{assert(e);assert.strictEqual(r.pending,2);assert.strictEqual(r.deferred,i>=2?1:0)})}
        assert.deepStrictEqual(collected.slice(0,2),[points,points]);assert(collected.slice(2).every(p=>p.length===1&&p[0]===points[1]));
        new Current(options).run(slot,'synthetic',e=>assert(e));assert.deepStrictEqual(collected.at(-1),points);
    });
}
(async()=>{for(const t of tests){await t.fn();console.log('ok - '+t.name)}console.log('current coverage: '+tests.length+' passed')})().catch(e=>{console.error(e);process.exitCode=1});
