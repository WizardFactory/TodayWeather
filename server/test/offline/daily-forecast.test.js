'use strict';
// Captured land item: issue #2560. Every other input is synthetic.
// No app/config/model/network/timer initialization; execute real module bodies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./harness');
const captured = require('./fixtures/mid-land-captured.json');
const clone = value => JSON.parse(JSON.stringify(value));
const options = {date:'20260924', time:'0600'};
function parse(kind, item, response) {
    const c = h.prepare(h.collector());
    const events = [];
    c.on('recvData',(index,records)=>events.push({name:'recvData',records}));
    c.on('recvFail',()=>events.push({name:'recvFail'}));
    c[kind](0,response || h.response([item]),options);
    return events;
}
test('captured day 4–10 succeeds with original values and no invented day 3',()=>{
    const events=parse('organizeLandData',captured);
    assert.equal(events.length,1); assert.equal(events[0].name,'recvData');
    const r=events[0].records[0];
    for(const k of Object.keys(captured)) assert.equal(String(r[k]),captured[k][0],k);
    assert.equal(r.pubDate,'202609240600'); assert.equal(r.wf3Am,undefined);
});
test('synthetic legacy day 3 remains supported',()=>{
    const item=Object.assign(clone(captured),{wf3Am:['흐림'],wf3Pm:['맑음']});
    const e=parse('organizeLandData',item); assert.equal(e[0].name,'recvData');
    assert.equal(e[0].records[0].wf3Am,'흐림');
});
test('missing optional fields never become sentinel temperatures or defaults',()=>{
    const e=parse('organizeTempData',{regId:['11B10101'],taMin4:['0'],taMax4:['23'],taMin5:['-999'],taMax5:['oops']});
    assert.equal(e[0].name,'recvData'); const r=e[0].records[0];
    assert.equal(r.taMin4,0); assert.equal(r.taMax4,23);
    for(const k of ['taMin3','taMax3','taMin5','taMax5']) assert.equal(r[k],undefined,k);
});
for(const kind of ['organizeLandData','organizeTempData']) {
    test(kind+' malformed envelopes and empty/invalid items fail once',()=>{
        for(const response of [{},h.response([]),h.response([{}]),h.response([{regId:['X']}]),
            h.response([{regId:[''],wf4Am:['맑음'],taMin4:['10']}]),
            {response:{header:[{resultCode:['30']}],body:[{totalCount:['1'],items:[{item:[captured]}]}]}}]) {
            assert.doesNotThrow(()=>assert.deepEqual(parse(kind,null,response).map(e=>e.name),['recvFail']));
        }
    });
}
const dh=require('./daily-harness');
function land(date='20260924',time='0600',legacy=false) {
    const result={date,time,pubDate:date+time};
    for(const [k,v] of Object.entries(captured))result[k]=k.startsWith('rnSt')?+v[0]:v[0];
    if(legacy){result.wf3Am='흐림';result.wf3Pm='맑음';}
    return result;
}
function merge(env,landRows,tempRows,pubs) {
    let result, calls=0;
    env.town._mergeLandWithTemp(landRows,tempRows,(err,rows)=>{assert.ifError(err);result=rows;calls++;},pubs);
    assert.equal(calls,1);return result;
}
for(const version of ['1.0','2.0']) {
    test(version+' real schemas + Manager handoff + storage projection + service round trip',()=>{
        const env=dh.environment(version);
        let saved=0;
        env.manager.saveMidLand(parse('organizeLandData',captured)[0].records,err=>{assert.ifError(err);saved++;});
        env.manager.saveMidTemp([dh.temperature()],err=>{assert.ifError(err);saved++;});
        assert.equal(saved,2);
        let l,t;
        env.town._getMidDataFromDB(env.model('modelMidLand'),'11B00000',{},(err,r)=>{assert(!err);l=r;});
        env.town._getMidDataFromDB(env.model('modelMidTemp'),'11B10101',{},(err,r)=>{assert(!err);t=r;});
        assert.equal(l.ret[0].regId,'11B00000');assert.equal(l.ret[0].rnSt4Am,20);
        assert.equal(l.ret[0].wf3Am,undefined);
        assert.equal(env.policy.timestamp(l.pubDate),Date.parse('2026-09-23T21:00:00Z'));
        const rows=merge(env,l.ret,t.ret,{land:l.pubDate,temp:t.pubDate});
        assert.deepEqual(Array.from(rows,r=>r.date),['20260928','20260929','20260930','20261001','20261002','20261003','20261004']);
        assert.equal(rows[0].rnStAm,20);assert.equal(rows[0].taMin,14);
    });
    test(version+' partial valid horizons persist without requiring day 10',()=>{
        const env=dh.environment(version), l={date:'20260924',time:'0600',pubDate:'202609240600',regId:'11B00000',wf4Am:'맑음',wf4Pm:'맑음'};
        const t={date:l.date,time:l.time,pubDate:l.pubDate,regId:'11B10101',taMin4:0,taMax4:12};
        env.manager.saveMidLand([l],assert.ifError);env.manager.saveMidTemp([t],assert.ifError);
        for(const [name,id] of [['modelMidLand',l.regId],['modelMidTemp',t.regId]]) {
            let calls=0;env.town._getMidDataFromDB(env.model(name),id,{},(err,r)=>{assert(!err);assert.equal(r.ret.length,1);calls++;});assert.equal(calls,1);
        }
        const dst=env.manager.dupMid(l,{wf3Am:'old'});assert.equal(dst.wf4Am,'맑음');assert.equal(dst.wf3Am,undefined);
    });
}
test('KST publication, 06/18 cycles, mixed timestamp representations and year/month boundaries',()=>{
    for(const [date,time,now,expected] of [
        ['20260924','0600','2026-09-24T07:27:00Z','20260928'],
        ['20260924','1800','2026-09-24T15:00:00Z','20260928'],
        ['20261229','1800','2026-12-29T10:00:00Z','20270102'],
        ['20260225','0600','2026-02-24T22:00:00Z','20260301']]) {
        const env=dh.environment('2.0',now),l=land(date,time),t=dh.temperature(date,time);
        const rows=merge(env,[l],[t],{land:new Date(env.policy.timestamp(date+time)),temp:new Date(env.policy.timestamp(date+time)).toISOString()});
        assert.equal(rows[0].date,expected);
    }
    const env=dh.environment();
    const rows=merge(env,[land('20260923','1800',true)],[dh.temperature('20260924','0600',3)]);
    assert.equal(rows[0].date,'20260927');assert.equal(rows[0].wfAm,captured.wf4Am[0]);assert.equal(rows[0].taMin,13);
    assert.equal(env.policy.timestamp('202609240600'),env.policy.timestamp(new Date('2026-09-23T21:00:00Z')));
    for(const invalid of ['202602300600','202613010600','202609242500',202609240600,null,'bad']) assert.equal(env.policy.fresh(invalid),false);
});
test('legacy day 3, honest captured gap, no NaN/sentinel/unknown sky output',()=>{
    const env=dh.environment();
    assert.equal(merge(env,[land('20260924','0600',true)],[dh.temperature('20260924','0600',3)])[0].date,'20260927');
    const t=dh.temperature();t.taMin4=-999;t.taMax5=NaN;t.taMin6=null;
    const l=land();l.wf7Am='unrecognized';delete l.wf8;
    assert.deepEqual(Array.from(merge(env,[l],[t]),r=>r.date),['20261003','20261004']);
    const req={params:{},midData:{dailyData:[{date:'20260928',taMin:0,taMax:12,wfAm:'',wfPm:'맑음'}]}};
    env.town.convertMidKorStrToSkyInfo(req,{},()=>{});assert.equal(req.midData.dailyData.length,0);
});
test('stale or future publication, identity mismatch, latest partial never uses older forecast',()=>{
    const env=dh.environment();
    for(const l of [land('20241128'),land('20260924','1800'),land('20260922')]) assert.equal(merge(env,[l],[dh.temperature()]).length,0);
    assert.equal(merge(env,[land()],[dh.temperature()],{land:'202609231800',temp:'202609240600'}).length,0);
    assert.equal(merge(env,[land(),{date:'20260924',time:'0600'}],[dh.temperature()]).length,7,'same publication duplicates resolved deterministically');
    assert.equal(merge(env,[land('20260923','1800'),{date:'20260924',time:'0600'}],[dh.temperature()]).length,0);
    const p=env.policy; const pub='202609230600',ms=p.timestamp(pub);
    assert(p.fresh(pub,ms+36*3600000));assert(!p.fresh(pub,ms+36*3600000+1));assert(!p.fresh(pub,ms-1));
});
test('short merge sorts/deduplicates, keeps seven-day recent history and declares boundary gap',()=>{
    const env=dh.environment(),rows=merge(env,[land()],[dh.temperature()]);
    const short=[];
    for(let day=24;day<=26;day++)for(const time of ['0900','1500'])short.push({date:'202609'+day,time,tmn:10,tmx:24,t3h:20,reh:50,sky:1,pty:0,pop:0,r06:0,s06:0,wsd:1,lgt:0});
    const history=Object.assign({},rows[0],{date:'20260917'});
    const req={params:{},shortPubDate:'202609241400',short,midData:{landPubDate:'202609240600',tempPubDate:new Date('2026-09-23T21:00:00Z'),dailyData:[...rows,history,{...history,date:'20250407'},{...history,date:'20260916'},rows[0]]}};
    env.town.convertMidKorStrToSkyInfo(req,{},()=>{});
    let done=0;env.town.mergeMidWithShort(req,{},()=>done++);assert.equal(done,1);
    const dates=req.midData.dailyData.map(r=>r.date);
    assert.equal(dates[0],'20260917');assert.equal(dates.length,new Set(dates).size);assert(!dates.includes('20260927'));assert(!dates.includes('20250407'));
    assert(req.midData.dailyStatus.unavailableDates.includes('20260927'));assert.equal(req.midData.dailyStatus.healthy,false);
    assert.equal(req.midData.dailyData.find(r=>r.date==='20260924').taMax,24);
});
test('dedicated daily health fails captured polluted list while short is current',()=>{
    const env=dh.environment();const mid={landPubDate:'2024-11-27T21:00:00.000Z',tempPubDate:'2026-09-23T21:00:00.000Z',rssPubDate:'202504030600',dailyData:['20250407','20250408','20250409','20250410','20250411','20250412','20250413','20260924','20260925','20260926'].map(date=>({date}))};
    assert.equal(env.policy.date(env.policy.timestamp('202609241400')),'20260924');
    assert.equal(env.policy.dailyHealth(mid).healthy,false);
    assert(env.policy.dailyHealth(mid).reasons.includes('target-out-of-window'));
});
test('RSS retirement ignores older/equal/newer mixed publications and empty targets',()=>{
    for(const version of ['1.0','2.0'])for(const pub of ['202504030600','202609231800','202609240600',new Date('2026-09-24T09:00:00Z')])for(const dailyData of [[],[{date:'20260928',taMin:10,taMax:20,wfAm:'맑음',wfPm:'맑음'}]]) {
        const env=dh.environment(version),req={landPubDate:'202609240600',tempPubDate:new Date('2026-09-23T21:00:00Z'),dailyData};
        env.Rss.getData=()=>{throw new Error('Retired cache must not be read: '+pub);};
        const before=JSON.stringify(req);let done=0;env.Rss.overwriteData(req,'11B10101',err=>{assert.ifError(err);done++;});assert.equal(done,1);assert.equal(JSON.stringify(req),before);
    }
});
test('401/error envelopes emit only controlled failure without key-bearing diagnostics',()=>{
    const secret='OFFLINE_SYNTHETIC_SECRET';
    for(const status of [401,200]) {
        const logs=[];const c=h.prepare(h.collector({get:(url,options,cb)=>cb(null,{statusCode:status},status===401?secret:'<response><header><resultCode>30</resultCode><resultMsg>'+secret+'</resultMsg></header></response>')},logs));
        let fails=0,success=0;c.on('recvFail',()=>fails++);c.on('recvData',()=>success++);
        c.getData(0,c.DATA_TYPE.MID_LAND,'http://synthetic.invalid?serviceKey='+secret,options);
        assert.equal(fails,1);assert.equal(success,0);assert(!logs.join('').includes(secret));assert(!logs.join('').includes('serviceKey'));
    }
});
test('RSS HTML/malformed XML never publishes or persists; retired schedules never fetch',()=>{
    const env=dh.environment();
    for(const body of ['<html><title>기상청</title></html>','<rss><broken>','<rss></rss>']) {
        let http=0;const Requester=env.load('lib/midRssKmaRequester.js',{request:(url,cb)=>{http++;cb(null,{statusCode:200},body);}});
        const r=new Requester(), before=+r._nextGetTime;
        let done=0;r.parseMidRss(body,err=>{assert(err);done++;});assert.equal(done,1);
        r.getMidRss(null,(err,text)=>{if(body.includes('html'))assert(err);else assert.equal(text,body);});
        assert.equal(http,1);assert.equal(+r._nextGetTime,before);
        r.processGetMidRss('109',err=>assert(err));r.start();assert.equal(http,1);assert.equal(r.checkGetTime(new Date()),false);
    }
});
test('unknown land text alone is invalid rather than a successful empty forecast',()=>{
    assert.equal(parse('organizeLandData',{regId:['11B00000'],wf4Am:['not weather']})[0].name,'recvFail');
});
test('invalid short weather never erases a valid mid row or invents zero precipitation',()=>{
    const env=dh.environment(),rows=merge(env,[land()],[dh.temperature()]);
    const req={params:{},shortPubDate:'202609241400',short:['0900','1500'].map(time=>({date:'20260928',time,sky:1,pty:-1,tmn:10,tmx:24,t3h:20,reh:50,pop:-1,r06:-1,s06:-1,wsd:-1,lgt:-1})),midData:{dailyData:rows}};
    const original=JSON.stringify(rows[0]);env.town.mergeMidWithShort(req,{},()=>{});
    assert.equal(JSON.stringify(req.midData.dailyData[0]),original);
});
test('short-only missing average temperature stays absent, valid negative temperature remains real',()=>{
    for(const t3h of [-50,-999,NaN,null,undefined,-1]) {
        const env=dh.environment();
        const req={params:{},shortPubDate:'202609241400',short:['0900','1500'].map(time=>({date:'20260925',time,sky:1,pty:0,tmn:10,tmx:24,t3h,reh:50,pop:-1,r06:-1,s06:-1,wsd:-1,lgt:-1})),midData:{dailyData:[]}};
        env.town.mergeMidWithShort(req,{},()=>{});
        const row=req.midData.dailyData[0];assert(row);assert.equal(row.t1d,t3h===-1?-1:undefined);
        assert.equal(row.r06,undefined);assert.equal(row.s06,undefined);assert.equal(row.lgtAm,undefined);
    }
});
test('stale/missing/future short publication cannot extend forecast; recent history survives',()=>{
    for(const pub of [undefined,'202609221400','202609241800']) {
        const env=dh.environment(),history={date:'20260923',taMin:10,taMax:20,wfAm:'맑음',wfPm:'맑음'};
        const req={params:{},shortPubDate:pub,short:[{date:'20260925',time:'0900',sky:1,pty:0,tmn:10,tmx:24,t3h:20,reh:50}],midData:{dailyData:[history]}};
        env.town.mergeMidWithShort(req,{},()=>{});assert.deepEqual(Array.from(req.midData.dailyData,r=>r.date),['20260923']);
    }
});
test('failed primary DB write reports failure without pruning older records',()=>{
    const env=dh.environment(),db=env.model('kma.town.mid.land.model');let removed=0,done=0;
    db.update=(q,d,o,cb)=>cb(new Error('synthetic write failure'));
    db.remove=()=>{removed++;return {exec(){}};};
    env.manager.saveMidLand(parse('organizeLandData',captured)[0].records,err=>{assert(err);done++;});
    assert.equal(done,1);assert.equal(removed,0);
});
