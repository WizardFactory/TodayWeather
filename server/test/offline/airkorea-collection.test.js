'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {harness} = require('./airkorea-harness');
test('station and sido use supported services and correctly encoded credentials', () => {
    const {keco, logs} = harness();
    keco.setServiceKeys(['synthetic+key/=']);
    const u = new URL(keco.getUrlCtprvn('서울', undefined, 'getCtprvnRltmMesureDnsty'));
    assert.equal(u.origin, 'https://apis.data.go.kr');
    assert.equal(u.pathname, '/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty');
    assert.equal(u.searchParams.get('serviceKey'), 'synthetic+key/=');
    assert.equal(u.searchParams.get('returnType'), 'json');
    assert.equal(u.searchParams.get('sidoName'), '서울');
    const s = new URL(keco.getUrlCtprvn('서울', 'synthetic%2Bkey%2F%3D', 'getCtprvnMesureSidoLIst'));
    assert.equal(s.pathname, '/B552584/ArpltnStatsSvc/getCtprvnMesureSidoLIst');
    assert.equal(s.searchParams.get('serviceKey'), 'synthetic+key/=');
    assert.equal(s.searchParams.get('searchCondition'), 'HOUR');
    assert(!JSON.stringify(logs).includes('synthetic'));
});
const {invoke} = require('./airkorea-harness');
const Api = require('../../lib/airkoreaObservation');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
function fixture(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/airkorea', name + '.json'))); }
function transport(responder) {
    const state = {calls: [], destroyed: 0};
    state.get = (url, options, cb) => {
        state.calls.push(url);
        const request = new EventEmitter(); request.destroy = () => { state.destroyed++; };
        setImmediate(() => {
            const answer = responder(url, state.calls.length);
            if (answer.hang) return;
            if (answer.error) return request.emit('error', answer.error);
            const response = new EventEmitter(); response.statusCode = answer.status || 200;
            response.destroy = () => { state.destroyed++; };
            cb(response);
            setTimeout(() => {
                response.emit('data', Buffer.from(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body || {})));
                response.emit('end');
            }, answer.delay || 0);
        });
        return request;
    };
    return state;
}
function fetch(api, operation = Api.STATION) { return invoke(api, 'fetch', '서울', 'synthetic+key/=', operation); }
test('supported station/sido fixtures preserve KST, grade mapping, unavailable stations and aggregate values', async () => {
    const h = harness();
    const t = transport(url => ({body: fixture(url.includes('ArpltnStatsSvc') ? 'sido' : 'stations')}));
    h.keco._observationApi = Api.create({transport: t}); h.keco.setServiceKeys(['synthetic']);
    const raw = await invoke(h.keco, 'getRLTMCtprvn', '서울');
    const rows = await invoke(h.keco, 'parseRLTMCtprvn', raw);
    assert.equal(rows.length, 3); assert.equal(rows.unavailable[0], '점검중');
    assert.equal(rows[0].date.toISOString(), '2026-09-29T14:00:00.000Z');
    assert.equal(rows[0].pm10Grade, 1); assert.equal(rows[0].pm10Grade24, 2);
    const aggregate = await invoke(h.keco, 'saveAvgSidoArpltn', '서울', rows);
    assert.equal(aggregate.cityName, ''); assert.equal(aggregate.sidoName, '서울');
    assert.equal(aggregate.pm10Value, 30); assert.equal(aggregate.pm25Value, 15);
    assert.equal(aggregate.no2Value, 0.02); assert.equal(aggregate.dataTime, '2026-09-29 23:00');
    const city = await invoke(h.keco, 'parseSidoCtprvn', await fetch(h.keco._observationApi, Api.SIDO));
    assert.equal(city[0].date.toISOString(), '2026-09-29T15:00:00.000Z');
    assert.equal(city[0].sidocityName, '서울/중구');
});
test('invalid identity/time rejects entire batch; invalid concentration/grade omitted, no NaN or numeric prefix', async () => {
    const h = harness();
    for (const bad of ['bad','2026-02-30 01:00','2026-09-29 24:01']) {
        const list = fixture('stations').response.body.items; list[1].dataTime = bad;
        await assert.rejects(invoke(h.keco, 'parseRLTMCtprvn', {list, parm:{sidoName:'서울'}}), /INVALID_OBSERVATION/);
    }
    for (const value of ['', null, {}, '-1','Infinity','10junk', true]) {
        const list = fixture('stations').response.body.items; list[0].pm10Value = value;
        const rows = await invoke(h.keco,'parseRLTMCtprvn',{list}); assert.equal(rows[0].pm10Value, undefined);
    }
    const list = fixture('stations').response.body.items; delete list[0].stationName;
    await assert.rejects(invoke(h.keco,'parseRLTMCtprvn',{list}), /INVALID_OBSERVATION/);
    assert.equal(h.stationWrites.length + h.sidoWrites.length,0);
});
test('KST and 24:00 parser is calendar strict', () => {
    assert.equal(new Date(Api.kstInstant('2026-12-31 24:00')).toISOString(),'2026-12-31T15:00:00.000Z');
    assert.equal(new Date(Api.kstInstant('2024-02-29 24:00')).toISOString(),'2024-02-29T15:00:00.000Z');
    for (const value of [undefined, '', '2026-02-29 00:00','2026-13-01 00:00']) assert(Number.isNaN(Api.kstInstant(value)));
});
test('pagination assembled completely, no changed total or incomplete page accepted', async () => {
    const t = transport(url => {
        const page = Number(new URL(url).searchParams.get('pageNo'));
        const data = fixture('stations'); data.response.body.numOfRows = 2; data.response.body.pageNo = page;
        data.response.body.items = data.response.body.items.slice((page - 1) * 2, page * 2);
        return {body:data};
    });
    assert.equal((await fetch(Api.create({transport:t,pageSize:2}))).list.length,4);
    assert.equal(t.calls.length,2);
    for (const kind of ['short','changed','limit']) {
        const broken = transport(url => {
            const page = Number(new URL(url).searchParams.get('pageNo'));
            const data = fixture('stations'); data.response.body.numOfRows=2; data.response.body.pageNo=page;
            data.response.body.items=data.response.body.items.slice(0,kind==='short'?1:2);
            if(kind==='changed' && page===2) data.response.body.totalCount=5;
            return {body:data};
        });
        await assert.rejects(fetch(Api.create({transport:broken,pageSize:2,maxPages:kind==='limit'?1:20})),/INCOMPLETE_PAGE|CHANGED_TOTAL|COLLECTION_LIMIT/);
    }
});
test('authentication, XML/plain gateway errors, invalid envelopes and empty items terminate without retry or writes', async () => {
    for (const body of [
        {response:{header:{resultCode:'30',resultMsg:'synthetic+key/='}}},
        '<OpenAPI_ServiceResponse><returnAuthMsg>synthetic+key/=</returnAuthMsg></OpenAPI_ServiceResponse>',
        'SERVICE_KEY_IS_NOT_REGISTERED_ERROR synthetic+key/=', {},
        {response:{header:{resultCode:'00'},body:{items:[],totalCount:0,pageNo:1,numOfRows:100}}}
    ]) {
        const h=harness(), t=transport(()=>({body})); h.keco._observationApi=Api.create({transport:t});
        h.keco.setServiceKeys(['synthetic+key/=']); h.keco._sidoList=['서울'];
        await assert.rejects(invoke(h.keco,'cbKecoProcess',h.keco),/PARTIAL_COLLECTION/);
        assert.equal(t.calls.length,1);assert.equal(h.stationWrites.length+h.sidoWrites.length,0);
        assert(!JSON.stringify(h.logs).includes('synthetic'));
        assert(JSON.stringify(h.logs).includes('finishedAt'));
    }
});
test('whole attempt timeout aborts and calls back once, bounded transient retry, no late writes', async () => {
    for (const responder of [()=>({hang:true}),()=>({body:fixture('stations'),delay:70}),()=>({status:503})]) {
        const t=transport(responder), api=Api.create({transport:t,timeoutMs:12}); let count=0;
        await new Promise(resolve=>api.fetch('서울','synthetic',Api.STATION,(err)=>{count++;assert(err);resolve();}));
        await new Promise(resolve=>setTimeout(resolve,85));
        assert.equal(count,1);assert.equal(t.calls.length,2);assert(t.destroyed>=2);
    }
    const t=transport((url,n)=>n===1?{status:503}:{body:fixture('stations')});
    assert.equal((await fetch(Api.create({transport:t}))).list.length,4); assert.equal(t.calls.length,2);
});
test('parallel province collection <=4 preserves other regions and awaits aggregate acknowledgement/error', async () => {
    let active=0,max=0;
    const h=harness({saveSido(q,row,opts,cb){setTimeout(()=>cb(row.sidoName==='부산'?new Error('private-db-error'):null),10);}});
    h.keco._sidoList=['서울','부산','대구','인천','광주','대전'];
    h.keco.getCtprvn=(sido,op,cb)=>{active++;max=Math.max(max,active);setTimeout(()=>{
        active--; const list=fixture('stations').response.body.items.map(r=>({...r,sidoName:sido}));
        cb(null,{list,parm:{sidoName:sido}});
    },5);};
    const results=await new Promise(resolve=>h.keco.getAllCtprvn((err,rows)=>resolve({err,rows})));
    assert.equal(max,4);assert(results.err);assert.equal(results.rows.length,6);
    assert.equal(results.rows.filter(r=>r.outcome==='success').length,5);
    assert.equal(h.sidoWrites.length,6);
    assert(!JSON.stringify(h.logs).includes('private-db-error'));
});
test('scheduled collection overlap rejected without starting another provider batch', async () => {
    const h=harness();let complete,calls=0;h.keco.getAllCtprvn=cb=>{calls++;complete=cb;};
    const first=invoke(h.keco,'cbKecoProcess',h.keco);
    await assert.rejects(invoke(h.keco,'cbKecoProcess',h.keco),/ALREADY_RUNNING/);
    complete();await first;assert.equal(calls,1);
});
test('no key, malformed key and unknown operation cause zero HTTP calls', async()=>{
    const t=transport(()=>assert.fail('network forbidden')),api=Api.create({transport:t});
    for(const key of [undefined,'','key1','%zz']) await assert.rejects(invoke(api,'fetch','서울',key,Api.STATION),/NO_KEY|INVALID_KEY_ENCODING/);
    await assert.rejects(invoke(api,'fetch','서울','synthetic','unknown'),/INVALID_OPERATION/);
    assert.equal(t.calls.length,0);
});
test('redirects, authentication HTTP and quota responses never retry; huge bodies abort',async()=>{
    for(const status of [301,302,400,401,403,404,429]) {
        const t=transport(()=>({status,body:'synthetic-private-url'}));
        await assert.rejects(fetch(Api.create({transport:t})),new RegExp('HTTP_'+status));assert.equal(t.calls.length,1);
    }
    const t=transport(()=>({body:'x'.repeat(101)}));
    await assert.rejects(fetch(Api.create({transport:t,maxBytes:100})),/BODY_TOO_LARGE/);assert.equal(t.calls.length,1);
});
test('JSON/XML expired key and quota codes are sanitized and terminal',async()=>{
    for(const code of ['20','22','30','31','32']) {
        for(const body of [{response:{header:{resultCode:code,resultMsg:'synthetic-secret'}}},
            '<OpenAPI_ServiceResponse><returnReasonCode>'+code+'</returnReasonCode><returnAuthMsg>synthetic-secret</returnAuthMsg></OpenAPI_ServiceResponse>']) {
            const t=transport(()=>({body}));await assert.rejects(fetch(Api.create({transport:t})),new RegExp('PROVIDER_'+code));
            assert.equal(t.calls.length,1);
        }
    }
});
test('whole province budget terminates retries even when per-attempt timeout is longer',async()=>{
    const t=transport(()=>({hang:true})),start=Date.now();
    await assert.rejects(fetch(Api.create({transport:t,timeoutMs:200,budgetMs:15})),/TIMEOUT|COLLECTION_LIMIT/);
    assert(Date.now()-start<120);assert(t.calls.length<=2);
});
test('duplicate station/timestamp and mismatched province reject before any write',async()=>{
    const h=harness();
    for(const change of [list=>list.push({...list[0]}),list=>list[0].sidoName='부산']) {
        const list=fixture('stations').response.body.items;change(list);
        h.keco.getCtprvn=(sido,op,cb)=>cb(null,{list,parm:{sidoName:'서울'}});h.keco._sidoList=['서울'];
        await assert.rejects(invoke(h.keco,'getAllCtprvn'),/PARTIAL_COLLECTION/);
        assert.equal(h.stationWrites.length+h.sidoWrites.length,0);
    }
});
test('station save error prevents aggregate write; missing urban rows is a failed province',async()=>{
    for(const scenario of ['db','no-urban']) {
        const h=harness({stationError:scenario==='db'?new Error('private-db-uri'):null});
        const list=fixture('stations').response.body.items;
        if(scenario==='no-urban')list.forEach(r=>r.mangName='도로변대기');
        h.keco.getCtprvn=(sido,op,cb)=>cb(null,{list,parm:{sidoName:'서울'}});h.keco._sidoList=['서울'];
        await assert.rejects(invoke(h.keco,'getAllCtprvn'),/PARTIAL_COLLECTION/);
        assert.equal(h.sidoWrites.length,0);assert(!JSON.stringify(h.logs).includes('private-db-uri'));
    }
});
test('empty province list and all-unavailable rows never report collection success',async()=>{
    const h=harness();await assert.rejects(invoke(h.keco,'getAllCtprvn'),/NO_PROVINCES/);
    await assert.rejects(invoke(h.keco,'parseRLTMCtprvn',{list:[fixture('stations').response.body.items[3]]}),/NO_USABLE_OBSERVATIONS/);
    assert.equal(h.stationWrites.length+h.sidoWrites.length,0);
});
