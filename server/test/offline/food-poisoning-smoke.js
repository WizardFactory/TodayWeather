'use strict';
// Distinct functional smoke: actual HTTP transport, Mongo documents and Express coordinate middleware.
// NODE_PATH=<mongoose@5.13, mongodb-memory-server-core, express, async, xml2js, sprintf> TZ=UTC node this-file
// Mongoose 5.1.2 needs Mongo <=5.0 (modern Mongo removes OP_QUERY); test its API separately.
process.env.TW_SMOKE_NOW='2026-09-24T00:10:00Z';
const assert=require('assert');
const http=require('http');
const fs=require('fs');
const mongoose=require('mongoose');
const {MongoMemoryServer}=require('mongodb-memory-server-core');
const food=require('../../lib/foodPoisoning');
const Model=require('../../models/modelFoodPoisoning');
const route=require('./rss-response-smoke');
const fixture=JSON.parse(JSON.stringify(require('./fixtures/mfds-risk-20261003.json')));
fixture.data.forEach(r=>{r.baseDate='20260924';r.regDatetime='2026-09-240800';});
const now=new Date(process.env.TW_SMOKE_NOW);
const collect=(service,time=now)=>new Promise((resolve,reject)=>service.collect(time,(err,count)=>err?reject(err):resolve(count)));
async function main(){
    let db,provider,server;
    try {
        db=await MongoMemoryServer.create({binary:{systemBinary:process.env.MONGOMS_SYSTEM_BINARY},instance:{ip:'127.0.0.1'}});
        // Disable TTL index creation in this historical fixture database; production schema still declares it.
        await mongoose.connect(db.getUri('food_poisoning_smoke'),{useNewUrlParser:true,autoIndex:false});
        await Model.createCollection();
        let calls=0,mode='valid',agent;
        provider=http.createServer((req,res)=>{
            calls++;agent=req.headers['user-agent'];
            if(mode==='error'){res.writeHead(503);res.end('unavailable');return;}
            if(mode==='slow')return;
            if(mode==='large'){res.end('x'.repeat(2048));return;}
            if(mode==='redirect'){res.writeHead(307,{Location:'/other'});res.end();return;}
            res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));
        });
        await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
        const url='http://127.0.0.1:'+provider.address().port+'/risk';
        const fetch=cb=>food.fetch(cb,{url,transport:http,timeoutMs:300,maxBytes:1000000});
        const service=food.create({store:Model,fetch});
        assert.equal(await collect(service),801);assert.equal(await Model.countDocuments({}),801);
        assert.ok(agent.includes('TodayWeather'));assert.equal(calls,1);
        await collect(service);assert.equal(calls,1,'no duplicate in the same slot');
        // Older publication cannot replace an accepted newer publication (_id duplicate handled).
        const jongno=await Model.findOne({sd:'서울특별시',sgg:'종로구',date:'20260924'}).lean();
        assert.ok(jongno);
        fixture.data.forEach(r=>{r.regDatetime='2026-09-240700';r.todayRisk=0;});
        await collect(food.create({store:Model,fetch}));
        assert.equal((await Model.findById(jongno._id).lean()).value,jongno.value);
        fixture.data.forEach(r=>{r.regDatetime='2026-09-240800';});
        // Real HTTP request traverses the production Express coordinate route, with real MFDS model.
        const f=route.makeFixture(route.locations[0],'newer');
        const env=route.createHarness('2.0',f,{modules:{'../models/modelFoodPoisoning':Model}});
        server=http.createServer((req,res)=>{
            req.query={};req.sessionID='isolated-food-poisoning-smoke';
            res.__=key=>key;res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
            res.status=code=>{res.statusCode=code;return res;};res.send=body=>res.end(String(body));
            env.router.handle(req,res,err=>{res.statusCode=500;res.end(err?String(err):'no response');});
        });
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const request=()=>new Promise((resolve,reject)=>http.get('http://127.0.0.1:'+server.address().port+'/coord/37.567,126.978',res=>{
            let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
        }).on('error',reject));
        const result=await request();assert.equal(result.status,200);
        for(const date of ['20260924','20260925','20260926']) {
            const daily=result.body.midData.dailyData.find(r=>r.date===date);
            const saved=await Model.findOne({sd:'서울특별시',sgg:'종로구',date}).lean();
            assert.equal(daily.fsn,saved.value);assert.equal(daily.fsnGrade,saved.grade);assert.ok(daily.fsnStr);
        }
        assert.equal(result.body.current.fsn,jongno.value);
        if(process.env.FOOD_POISONING_CAPTURE)fs.writeFileSync(process.env.FOOD_POISONING_CAPTURE,JSON.stringify({status:result.status,clock:process.env.TW_SMOKE_NOW,syntheticDate:true,providerFixture:'mfds-risk-20261003.json',daily:result.body.midData.dailyData.filter(r=>r.fsn!==undefined),current:result.body.current,providerCalls:calls,mongoose:mongoose.version},null,2));
        // HTTP status/redirect/size/deadline failures are one bounded attempt each.
        for(mode of ['error','redirect','large','slow']) {
            const before=calls;
            const err=await new Promise(resolve=>food.fetch(resolve,{url,transport:http,timeoutMs:40,maxBytes:1024}));
            assert.ok(err);assert.equal(calls,before+1);
        }
        await Model.deleteMany({});
        const unavailable=await request();assert.equal(unavailable.status,200);
        assert.ok(unavailable.body.midData.dailyData.every(r=>r.fsn===undefined));
        const removeFsn=body=>{for(const row of [body.current,...body.midData.dailyData]){delete row.fsn;delete row.fsnGrade;delete row.fsnStr;}return body;};
        assert.deepEqual(removeFsn(result.body),unavailable.body);
        console.log('PASS: real HTTP/Mongo '+mongoose.version+' collect/read/conditional-upsert; production Express route returns three dated rows/current and 200 unchanged weather when absent; bounded 503/307/size/deadline failures.');
    } finally {
        if(server)await new Promise(resolve=>server.close(resolve));
        if(provider){if(provider.closeAllConnections)provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
        await mongoose.disconnect();if(db)await db.stop();
    }
}
main().catch(err=>{console.error(err.stack);process.exitCode=1;});
