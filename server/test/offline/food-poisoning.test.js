'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const food = require('../../lib/foodPoisoning');
const fixture = require('./fixtures/mfds-risk-20261003.json');
const at = new Date('2026-09-29T09:30:00Z');
const clone = x => JSON.parse(JSON.stringify(x));
const parse = x => food.parse(x, at);
const read = (service, town, days, now=at) => new Promise(resolve => service.append(town, days, now, resolve));
const collect = (service, now=at) => new Promise(resolve => service.collect(now, resolve));
const row = (sd, sgg, date='20260929', value=31.5) => ({sd,sgg,date,value,risk:Number((value/100).toFixed(8)),grade:1,baseDate:'20260929',publication:'2026-09-291700'});

test('recorded publication creates exact regional dates, percentages and inclusive grades', () => {
    const rows = parse(fixture);
    assert.equal(rows.length, 267*3);
    const input=clone(fixture);input.data=input.data.slice(0,1);
    for (const [risk,grade] of [[0,0],[0.314999,0],[0.315,1],[0.558999,1],[0.559,2],[0.742999,2],[0.743,3],[1,3]]) {
        input.data[0].todayRisk=risk;
        const result=parse(input)[0];assert.equal(result.grade,grade);assert.equal(result.value,Number((risk*100).toFixed(4)));
    }
    assert.deepEqual(rows.slice(0,3).map(r=>r.date), ['20260929','20260930','20261001']);
    const month=clone(input);month.data[0].baseDate='20261231';month.data[0].regDatetime='2026-12-310800';
    assert.deepEqual(food.parse(month,new Date('2026-12-31T00:00:00Z')).map(r=>r.date),['20261231','20270101','20270102']);
});

test('malformed responses reject before writes; invalid risks are omitted without coercion', () => {
    for(const change of [x=>x.success=false,x=>x.data=[],x=>x.data[0].baseDate='20260230',
        x=>x.data[0].sd='',x=>x.data[0].regDatetime='invalid',x=>x.data.push(clone(x.data[0]))]) {
        const input=clone(fixture);change(input);assert.throws(()=>parse(input));
    }
    for(const risk of [null,'',false,[],{},-1,1.01]) {
        const input=clone(fixture);input.data=input.data.slice(0,1);input.data[0].todayRisk=risk;
        assert.equal(parse(input).some(r=>r.date==='20260929'),false);
    }
});

test('parse-to-append preserves authoritative grades immediately below and at boundaries', async () => {
    const input=clone(fixture);input.data=input.data.filter(r=>r.sd==='서울특별시' && r.sgg==='종로구');
    for(const [risk,expected] of [[0.3149999,0],[0.315,1],[0.5589999,1],[0.559,2],[0.7429999,2],[0.743,3]]) {
        input.data[0].todayRisk=risk;
        const data=parse(input), days=[{date:'20260929'}];
        const service=food.create({store:{find:()=>({lean(){return this;},exec(cb){cb(null,data);}})}});
        await read(service,{first:'서울특별시',second:'종로구'},days);
        assert.equal(days[0].fsnGrade,expected,'risk='+risk);
        assert.equal(days[0].fsn,Number((risk*100).toFixed(4)));
    }
});

test('district match and province fallback are independent per date and never use a neighboring district', async () => {
    const data=[row('서울특별시','종로구'),row('서울특별시','', '20260930',55.9),row('서울특별시','도봉구','20261001',90)];
    data[1].grade=2;
    const service=food.create({store:{find:()=>({lean(){return this;},exec(cb){cb(null,data);}})}});
    const days=[{date:'20260928',tmx:23},{date:'20260929',tmx:24},{date:'20260930'},{date:'20261001'}];
    await read(service,{first:'서울특별시',second:'종로구'},days,new Date('2026-09-29T09:00:00Z'));
    assert.equal(days[1].fsn,31.5);assert.equal(days[1].fsnGrade,1);assert.equal(days[2].fsn,55.9);
    assert.equal('fsn' in days[0],false);assert.equal('fsn' in days[3],false);assert.equal(days[1].tmx,24);
});

test('merged province resolves Gwangju districts and Jeonnam counties without ambiguous guesses', () => {
    for(const district of ['동구','서구','남구','북구','광산구']) assert.deepEqual(food.region({first:'전남광주통합특별시',second:district}),{sd:'광주광역시',sgg:district});
    assert.deepEqual(food.region({first:'전남광주통합특별시',second:'순천시'}),{sd:'전라남도',sgg:'순천시'});
    assert.equal(food.region({first:'전남광주통합특별시',second:''}),null);
    assert.equal(food.region({first:'전남광주통합특별시',second:'알수없는구'}),null);
});

test('read filters expired, future and corrupt stored values; store failures and late callbacks do not mutate', async () => {
    const data=parse(fixture);let callback;
    const service=food.create({readTimeoutMs:15,store:{find:()=>({lean(){return this;},exec(cb){callback=cb;}})}});
    const days=[{date:'20261003',tmx:24}];
    const waiting=read(service,{first:'서울특별시',second:'종로구'},days,new Date('2026-10-03T01:00:00Z'));
    await waiting;callback(null,data);assert.deepEqual(days,[{date:'20261003',tmx:24}]);
    const bad=[row('서울특별시','종로구')];bad[0].grade=3;
    const corrupt=food.create({store:{find:()=>({lean(){return this;},exec(cb){cb(null,bad);}})}});
    const current=[{date:'20260929'}];await read(corrupt,{first:'서울특별시',second:'종로구'},current,new Date('2026-09-29T09:00:00Z'));assert.equal('fsn'in current[0],false);
    const future=clone(bad);future[0].grade=1;future[0].baseDate='20260930';
    corrupt.store.find=()=>({lean(){return this;},exec(cb){cb(null,future);}});
    await read(corrupt,{first:'서울특별시',second:'종로구'},current,new Date('2026-09-29T09:00:00Z'));assert.equal('fsn'in current[0],false);
});

test('scheduled requests run after publication slots with no tight-loop retry or overlap', async () => {
    let calls=0, pending;
    const service=food.create({fetch:cb=>{calls++;pending=cb;},store:{updateOne(q,u,o,cb){cb(null);}}});
    const first=collect(service,at);await collect(service,at);assert.equal(calls,1);
    pending(new Error('provider unavailable'));assert.ok(await first);
    await collect(service,at);assert.equal(calls,1);
    const later=collect(service,new Date('2026-09-30T00:00:00Z'));assert.equal(calls,2);pending(new Error('offline'));await later;
    assert.equal(food.due(new Date('2026-09-28T22:20:00Z'),false),false);
    assert.equal(food.due(new Date('2026-09-28T23:20:00Z'),false),true);
    assert.equal(food.due(new Date('2026-09-29T03:20:00Z'),false),true);
    assert.equal(food.due(new Date('2026-09-29T08:20:00Z'),false),true);
    assert.equal(food.due(new Date('2026-09-29T01:30:00Z'),true),true);
});

test('collection waits for all writes after one fails; stale fixtures make no writes', async () => {
    const callbacks=[];let completed=false;
    const service=food.create({fetch:cb=>cb(null,fixture),store:{updateOne(q,u,o,cb){callbacks.push(cb);}}});
    const pending=collect(service).then(err=>{completed=true;assert.ok(err);});
    assert.equal(callbacks.length,801);callbacks[0](new Error('store unavailable'));
    assert.equal(completed,false);callbacks.slice(1).forEach(cb=>cb(null));await pending;
    const stale=food.create({fetch:cb=>cb(null,fixture),store:{updateOne(){throw new Error('must not write');}}});
    assert.ok(await collect(stale,new Date('2026-10-03T01:00:00Z')));
});

test('existing current and localization hooks restore fsn zero without changing other indices', () => {
    const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../controllers/controllerTown.js'),'utf8'),
        {module,exports:module.exports,require:()=>function(){},log:{},Date,console});
    const town=new module.exports();const current={date:'20260929'};
    town._appendLifeIndexToCurrent(current,[],[{date:'20260929',fsn:0,fsnGrade:0,ultrv:2,ultrvGrade:0}]);
    assert.equal(current.fsn,0);assert.equal(current.fsnGrade,0);assert.equal(current.ultrv,2);
    assert.match(fs.readFileSync(path.resolve(__dirname,'../../controllers/controllerTown.js'),'utf8'),/LifeIndexKmaController\.fsnStr/);
});

test('current provider province names and concatenated city/district names match geocoder output', () => {
    assert.deepEqual(food.region({first:'전북특별자치도',second:'전주시 덕진구'}),{sd:'전북특별자치도',sgg:'전주시덕진구'});
    assert.deepEqual(food.region({first:'강원도',second:'춘천시'}),{sd:'강원특별자치도',sgg:'춘천시'});
    assert.deepEqual(food.region({first:'경기도',second:'수원시 장안구'}),{sd:'경기도',sgg:'수원시장안구'});
});

test('gather Manager queues the direct MFDS job only at its slots and startup', () => {
    function loadManager(instant) {
        class Clock extends Date {constructor(...args){super(...(args.length?args:[instant]));}}
        const calls=[];
        const deps={};
        const source=fs.readFileSync(path.resolve(__dirname,'../../controllers/controllerManager.js'),'utf8');
        for(const match of source.matchAll(/require\('([^']+)'\)/g))deps[match[1]]=function(){};
        deps['../config/config']={keyString:{dongnae_forecast_keys:'[]'},history:{enabled:false}};
        deps['../config/gather']={tasks:{airForecast:false,past:false}};
        deps['../lib/foodPoisoning']={due:food.due,shared:()=>({collect:(now,cb)=>{calls.push(now.toISOString());cb(null,801);}})};
        const module={exports:{}};
        vm.runInNewContext(source,{module,exports:module.exports,require:name=>deps[name],Date:Clock,log:{info(){},warn(){},verbose(){},debug(){},error(){}},console});
        const manager=Object.create(module.exports.prototype);manager.asyncTasks=[];manager._requestApi=(name,cb)=>cb();
        return {manager,calls};
    }
    const exact=loadManager('2026-09-28T23:20:00Z');exact.manager.checkTimeAndRequestTask(false);
    const job=exact.manager.asyncTasks.find(fn=>fn.name==='FoodPoisoning');assert.ok(job);let finished=false;job(()=>{finished=true;});
    assert.equal(finished,true);assert.equal(exact.calls.length,1);
    const other=loadManager('2026-09-29T01:30:00Z');other.manager.checkTimeAndRequestTask(false);
    assert.equal(other.manager.asyncTasks.some(fn=>fn.name==='FoodPoisoning'),false);
    other.manager.checkTimeAndRequestTask(true);assert.equal(other.manager.asyncTasks.filter(fn=>fn.name==='FoodPoisoning').length,1);
});
