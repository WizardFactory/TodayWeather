'use strict';
var assert = require('assert'), Dispatcher = require('../../lib/pushCoordinator/dispatcher').Dispatcher;
var runner = require('./push-harness').runner();
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function until(fn) { for (var i=0;i<100;i++) { if(fn()) return; await wait(5); } throw new Error('Condition did not settle'); }
function fixture(send, extra) {
    var time=1000, releases=[];
    var d=new Dispatcher(Object.assign({concurrency:8, rate:10000, timeoutMs:20, recoveryMs:100, recoveryProbes:2,
        now:function(){return time;}, send:send || function(){return new Promise(function(r){releases.push(r);});}},extra));
    return {d:d, releases:releases, advance:function(ms){time+=ms;}, close:async function(){d.close(); releases.forEach(function(r){r();}); await wait(10);}};
}
function job(project,extra){return Object.assign({project:project||'one',priority:'normal',deadline:100000},extra);}
runner.test('late settlement recovers a fresh job without replaying ambiguous original', async function(){
    var calls=0, release, f=fixture(function(){calls++; if(calls===1)return new Promise(function(r){release=r;});return Promise.resolve();});
    try {
        var first=await f.d.enqueue(job()); assert.equal(first.error,'transport-timeout-ambiguous'); assert.equal(first.attempts,1);
        assert.equal(f.d.inflight,1); release(); await until(function(){return f.d.inflight===0;});
        var next=f.d.enqueue(job()); await wait(20); assert.equal(calls,1); f.advance(101);
        assert.equal((await next).status,'accepted'); assert.equal(calls,2); assert(f.d.health().ready);
    } finally {await f.close();}
});
runner.test('never-settling original permits only two spaced fresh probes and retains physical slot',async function(){
    var calls=0, release, f=fixture(function(){calls++; if(calls===1)return new Promise(function(r){release=r;});return Promise.resolve();});
    try {
        await f.d.enqueue(job());
        for(var i=0;i<2;i++){ f.advance(101); assert.equal((await f.d.enqueue(job())).status,'accepted'); assert.equal(f.d.inflight,1); }
        f.advance(10000); var result=await f.d.enqueue(job()); assert.equal(result.error,'project-paused'); assert.equal(calls,3);
        assert.equal(f.d.health().reasons['recovery-exhausted'],1); assert.equal(f.d.inflight,1);
        assert.equal((await f.d.enqueue(job('other',{priority:'warning'}))).status,'accepted');
        release(); await until(function(){return f.d.inflight===0;}); f.advance(101);
        assert.equal((await f.d.enqueue(job())).status,'accepted'); assert(f.d.health().ready);
    } finally {if(release)release();await f.close();}
});
runner.test('never-settling probes cannot exceed the physical concurrency cap',async function(){
    var f=fixture(null,{concurrency:4});
    try {
        await f.d.enqueue(job()); f.advance(101); await f.d.enqueue(job()); f.advance(101); await f.d.enqueue(job());
        assert.equal(f.releases.length,3); assert.equal(f.d.inflight,3); assert.equal(f.d.active.normal,3);
        f.advance(10000); var p=f.d.enqueue(job('other',{priority:'warning'})); await until(function(){return f.releases.length===4;});
        assert.equal(f.d.inflight,4); f.d.close(); await p;
    } finally {await f.close();}
});
runner.test('only one probe runs at a time, and queued registration guard is rechecked',async function(){
    var calls=0, releaseFirst, releaseProbe, fresh=true, f=fixture(function(){calls++;return new Promise(function(r){if(calls===1)releaseFirst=r;else releaseProbe=r;});},{timeoutMs:100});
    try {
        await f.d.enqueue(job()); releaseFirst(); await until(function(){return f.d.inflight===0;}); f.advance(101);
        var p=f.d.enqueue(job()), q=f.d.enqueue(job('one',{guard:function(){return fresh;}}));
        await until(function(){return calls===2;}); await wait(20); assert.equal(calls,2);
        fresh=false; releaseProbe(); assert.equal((await p).status,'accepted'); assert.equal((await q).status,'superseded'); assert.equal(calls,2);
    } finally {if(releaseFirst)releaseFirst();if(releaseProbe)releaseProbe();await f.close();}
});
runner.test('late authentication rejection cannot be cleared by later recovery',async function(){
    var rejectFirst, calls=0, f=fixture(function(){calls++;if(calls===1)return new Promise(function(_,r){rejectFirst=r;});return Promise.resolve();});
    try {
        await f.d.enqueue(job()); var e=new Error('private');e.statusCode=401;rejectFirst(e);await until(function(){return f.d.inflight===0;});f.advance(10000);
        assert.equal((await f.d.enqueue(job())).error,'project-paused');assert.equal(calls,1); assert.equal(f.d.health().reasons.authentication,1);
    } finally {await f.close();}
});
runner.test('late 429 retains the project cooldown even after original job is done',async function(){
    var rejectFirst,calls=0,f=fixture(function(){calls++;if(calls===1)return new Promise(function(_,r){rejectFirst=r;});return Promise.resolve();},{retryFloorMs:0});
    try {
        await f.d.enqueue(job());var e=new Error('private');e.statusCode=429;e.retryAfterMs=500;rejectFirst(e);await until(function(){return f.d.inflight===0;});
        f.advance(101);var next=f.d.enqueue(job());await wait(30);assert.equal(calls,1);f.advance(500);assert.equal((await next).status,'accepted');assert.equal(calls,2);
    } finally {await f.close();}
});
runner.test('probe authentication remains paused and health excludes project identifiers',async function(){
    var calls=0,f=fixture(function(){calls++; if(calls===1){var e=new Error('private');e.code='transport-timeout-ambiguous';return Promise.reject(e);}var auth=new Error('private');auth.statusCode=403;return Promise.reject(auth);});
    try {
        var first=await f.d.enqueue(job('SECRET-PROJECT'));assert.equal(first.error,'transport-timeout-ambiguous');f.advance(101);
        assert.equal((await f.d.enqueue(job('SECRET-PROJECT'))).error,'authentication');
        var health=f.d.health();assert(!health.ready);assert.equal(health.reasons.authentication,1);assert(!JSON.stringify(health).includes('SECRET'));
    } finally {await f.close();}
});
runner.test('recovery waiting expires at deadline without submitting a probe',async function(){
    var calls=0,f=fixture(function(){calls++;var e=new Error();e.code='transport-timeout-ambiguous';return Promise.reject(e);});
    try {
        await f.d.enqueue(job());var p=f.d.enqueue(job('one',{deadline:1050}));f.advance(60);assert.equal((await p).status,'expired');assert.equal(calls,1);
    } finally {await f.close();}
});
runner.test('health distinguishes transport-ready, waiting and active recovery, then close',async function(){
    var calls=0, release, f=fixture(function(){calls++;if(calls===1){var e=new Error();e.code='transport-timeout-ambiguous';return Promise.reject(e);}return new Promise(function(r){release=r;});});
    try {
        assert(f.d.health().ready);await f.d.enqueue(job());assert.equal(f.d.health().paused,1);assert(!f.d.health().ready);f.advance(101);
        var next=f.d.enqueue(job());await until(function(){return calls===2;});assert.equal(f.d.health().recovering,1);release();await next;assert(f.d.health().ready);
        f.d.close();assert(!f.d.health().ready);assert.equal(f.d.timers.size,0);
    } finally {if(release)release();await f.close();}
});
runner.test('same invalid token remains fenced; rotation and changed-token POST restore only new generation', async function () {
    var fixture = require('./push-s3.test'), storage = fixture.memory(), registry = await fixture.registry(storage);
    var Engine = require('../../lib/pushCoordinator/engine').Engine;
    var engine = new Engine({registry: registry, storage: storage});
    await registry.upsert([fixture.record({category: 'alarm', pushTime: 0})]); await registry.settled();
    var r = Array.from(registry.records.values())[0], campaign = {kind: 'alarm', createdAt: 0};
    engine.setState(r.ref, {disabled: true, generation: r.generation});
    assert(r.enable); assert(!engine.eligible(campaign, registry.get(r.ref)));
    await registry.upsert([fixture.record({category: 'alarm', pushTime: 0})]); await registry.settled();
    assert(!engine.eligible(campaign, registry.get(r.ref)), 'unchanged invalid token must stay fenced');
    await registry.rotate('token1', 'rotated-token'); await registry.settled();
    var rotated = registry.get(r.ref); assert(rotated.generation > r.generation); assert(engine.eligible(campaign, rotated));
    engine.setState(r.ref, {disabled: true, generation: rotated.generation});
    await registry.upsert([fixture.record({category: 'alarm', pushTime: 0, fcmToken: 'changed-token'})]); await registry.settled();
    assert(engine.eligible(campaign, registry.get(r.ref))); assert.equal(registry.get(r.ref).fcmToken, 'changed-token');
});
runner.test('late old probe settlement cannot release a newer probe or reopen the circuit', async function () {
    var calls = 0, releases = [], f = fixture(function () {
        calls++;
        return new Promise(function (r) { releases.push(r); });
    }, {timeoutMs: 100});
    try {
        await f.d.enqueue(job());
        f.advance(101); await f.d.enqueue(job());
        f.advance(101); var current = f.d.enqueue(job());
        await until(function () { return calls === 3; });
        releases[1](); await wait(10);
        assert.equal(f.d.health().recovering, 1);
        assert(!f.d.health().ready);
        var valid = true, waiting = f.d.enqueue(job("one", {guard: function () { return valid; }}));
        await wait(10); assert.equal(calls, 3); valid = false;
        releases[2](); assert.equal((await current).status, 'accepted');
        assert.equal((await waiting).status, 'superseded');
        releases[0](); await until(function () { return f.d.inflight === 0; });
        assert(f.d.health().ready); f.d.close(); await waiting;
    } finally { releases.forEach(function (r) { r(); }); await f.close(); }
});
runner.test('HTTP 429 transport health reports cooldown without losing registration readiness', async function () {
    var f = fixture(function () { var e = new Error(); e.statusCode = 429; e.retryAfterMs = 500; return Promise.reject(e); }, {retryFloorMs: 0});
    try {
        await f.d.enqueue(job('one', {deadline: 1100}));
        assert(!f.d.health().ready); assert.equal(f.d.health().cooldown, 1);
        f.advance(501); assert(f.d.health().ready);
    } finally { await f.close(); }
});
runner.test('warning owns the recovery probe even on a normal fairness turn', async function () {
    var calls = [], f = fixture(function (_, j) {
        calls.push(j.priority);
        if (calls.length === 1) { var e = new Error(); e.code = 'transport-timeout-ambiguous'; return Promise.reject(e); }
        return Promise.resolve();
    });
    try {
        await f.d.enqueue(job()); f.advance(101); f.d.laneTurn = 4;
        var normal = f.d.enqueue(job()), warning = f.d.enqueue(job('one', {priority: 'warning'}));
        await Promise.all([normal, warning]);
        assert.deepEqual(calls, ['normal', 'warning', 'normal']);
    } finally { await f.close(); }
});
runner.run().then(function(failed){process.exitCode=failed?1:0;});
