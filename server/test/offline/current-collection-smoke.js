'use strict';
// Real Manager + collector + loopback HTTP + temporary Mongo. Synthetic provider.
// Mongo 7 requires mongoose5.13's driver; pinned5.1.2 construction is checked separately.
const assert=require('assert'),http=require('http'),fs=require('fs'),path=require('path');
const {MongoMemoryServer}=require('mongodb-memory-server-core');
const mongoose=require('mongoose-smoke');
const h=require('./harness'),mh=require('./current-manager-harness');
const grids=Array.from({length:2032},(_,i)=>({mx:i%149,my:Math.floor(i/149)}));
let mongo,connection,proxy,appServer,requests=0,foreign=0;
const partialRequests=new Map();
function get(port){return new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port,path:'/gather/current'},res=>{
        let body='';res.on('data',c=>{body+=c});res.on('end',()=>resolve({status:res.statusCode,body}));
    }).on('error',reject);
})}
(async()=>{
    const binary=process.env.TW_MONGOD;
    mongo=await MongoMemoryServer.create(binary?{binary:{systemBinary:binary}}:{});
    connection=mongoose.createConnection(mongo.getUri(),{dbName:'current2648',autoIndex:false});
    await new Promise((resolve,reject)=>{connection.once('open',resolve);connection.once('error',reject)});
    const log=h.logger([]);
    proxy=http.createServer((req,res)=>{
        const u=new URL(req.url);
        if(u.host!=='apis.data.go.kr'||!u.pathname.endsWith('/getUltraSrtNcst')){foreign++;res.writeHead(400);return res.end()}
        requests++;
        const values={T1H:'-12.5',RN1:'0',UUU:'-2',VVV:'0',REH:'50',PTY:'0',VEC:'0',WSD:'0'};
        // Three persistent optional omissions; a fourth repairs on its second walk.
        const coord=Number(u.searchParams.get('nx'))+':'+Number(u.searchParams.get('ny'));
        const index=grids.findIndex(g=>g.mx+':'+g.my===coord);
        if(u.searchParams.get('base_time')==='0200'&&index>=0&&index<4){
            const count=(partialRequests.get(coord)||0)+1;partialRequests.set(coord,count);
            if(index<3||count===1){delete values[['VEC','UUU','REH','WSD'][index]]}
        }
        const items=Object.keys(values).map(category=>({
            baseDate:[u.searchParams.get('base_date')],baseTime:[u.searchParams.get('base_time')],
            nx:[u.searchParams.get('nx')],ny:[u.searchParams.get('ny')],category:[category],obsrValue:[values[category]]
        }));
        res.writeHead(200,{'Content-Type':'text/xml'});res.end(h.xml(h.response(items)));
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    process.env.HTTP_PROXY='http://127.0.0.1:'+proxy.address().port;
    delete process.env.NO_PROXY;delete process.env.no_proxy;
    const modelApi={Schema:mongoose.Schema,model:connection.model.bind(connection)};
    const db1=h.load('models/modelCurrent.js',{mongoose:modelApi});
    const db2=h.load('models/kma/kma.town.current.model.js',{mongoose:modelApi});
    const CurrentController=h.load('controllers/kma/kma.town.current.controller.js',{
        async:require('async'),'../../models/kma/kma.town.current.model.js':db2,
        '../../lib/kmaTimeLib':require('../../lib/kmaTimeLib')
    },{log});
    function Collector(){return h.collector(require('request'),[])}
    const summary=[];
    for(const version of ['1.0','2.0']){
        let slot={date:'20261003',time:'0000'};
        const f=mh.load({'../lib/collectTownForecast':Collector,'../models/town':{getCoord:cb=>cb(null,grids)},
            '../models/modelCurrent':db1,'../models/kma/kma.town.current.model':db2,
            './kma/kma.town.current.controller.js':CurrentController});
        f.config.db.version=version;
        f.m.MAX_CURRENT_COUNT=192;f.m.getCurrentQueryTime=()=>slot;
        // Load actual gather route with inert unused collaborators.
        const source=fs.readFileSync(path.resolve(__dirname,'../../routes/v000001/routeGather.js'),'utf8'),deps={};
        for(const match of source.matchAll(/require\('([^']+)'\)/g)){deps[match[1]]=function Inert(){}}
        Object.assign(deps,{express:require('express'),'../../config/config':f.config});
        const router=h.load('routes/v000001/routeGather.js',deps,{manager:f.m,log});
        const app=require('express')();app.use('/gather',router);
        appServer=http.createServer(app);await new Promise(resolve=>appServer.listen(0,'127.0.0.1',resolve));
        const port=appServer.address().port,begin=requests;
        for(const hour of ['0000','0100']){
            slot={date:'20261003',time:hour};
            const answers=await Promise.all([get(port),get(port)]);
            answers.forEach(r=>assert.strictEqual(r.status,200));
            assert.strictEqual(requests-begin,hour==='0000'?2032:4064);
            const before=requests;await get(port);assert.strictEqual(requests,before,'repeated hour sends no HTTP');
            const pending=await new Promise((resolve,reject)=>require('../../lib/currentGridCollection').pending(version==='1.0'?db1:db2,version,slot,grids,(e,p)=>e?reject(e):resolve(p)));
            assert.strictEqual(pending.length,0,'DB readback, not HTTP200, proves full coverage');
        }
        // Missing field remains eligible; no successful grid is re-requested.
        if(version==='2.0'){
            await db2.collection.updateOne({'mCoord.mx':grids[0].mx,'mCoord.my':grids[0].my,'currentData.time':'0100'},{$unset:{'currentData.wsd':''}});
            const before=requests;await get(port);assert.strictEqual(requests,before+1);
            assert.strictEqual(await db2.countDocuments({'currentData.time':'0100'}),2032);
        }
        partialRequests.clear();slot={date:'20261003',time:'0200'};
        const partialStart=requests;
        await get(port);assert.strictEqual(requests-partialStart,2032);
        const storedPending=()=>new Promise((resolve,reject)=>require('../../lib/currentGridCollection').pending(version==='1.0'?db1:db2,version,slot,grids,(e,p)=>e?reject(e):resolve(p)));
        assert.strictEqual((await storedPending()).length,4);
        await get(port);assert.strictEqual(requests-partialStart,2036,'only four persisted partial rows receive a repair');
        assert.strictEqual((await storedPending()).length,3,'second response repaired WSD, three persistent omissions remain');
        for(let poll=0;poll<4;poll++){await get(port);assert.strictEqual(requests-partialStart,2036,'partial repair budget sends no further HTTP')}
        assert.strictEqual((await storedPending()).length,3,'deferred rows never count complete');
        const deferredRecord=f.records.map(JSON.parse).filter(r=>r.event==='current-repair-plan').at(-1);
        assert.strictEqual(deferredRecord.pending,3);assert.strictEqual(deferredRecord.deferred,3);assert.strictEqual(deferredRecord.eligible,0);
        slot={date:'20261003',time:'0300'};const rolloverStart=requests;
        await get(port);assert.strictEqual(requests-rolloverStart,2032,'new publication receives initial full walk');
        assert.strictEqual((await storedPending()).length,0);
        await get(port);assert.strictEqual(requests-rolloverStart,2032);
        const records=f.records.map(JSON.parse);
        assert(records.some(r=>r.event==='forecast-pass'&&Object.values(r.attemptsByKstHour).reduce((a,b)=>a+b,0)===2032));
        assert(records.some(r=>r.event==='current-coverage'&&r.pending===0&&r.total===2032));
        assert(!f.records.join('').includes('SYNTHETIC_A'));assert(!f.records.join('').includes('serviceKey'));
        summary.push({version,hours:4,grids:2032,httpAttempts:requests-begin,readback:'complete except three explicitly deferred optional-field rows at0200',partialWalks:2036,partialDeferred:3,secondWalkRepair:true,sameHourJoined:true});
        await new Promise(resolve=>appServer.close(resolve));appServer=null;
    }
    assert.strictEqual(foreign,0);
    console.log(JSON.stringify({result:'passed',summary,provider:'synthetic loopback',storage:'temporary Mongo / mongoose5.13.23',pinnedQuery:'separate mongoose5.1.2 test'}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
    if(appServer){await new Promise(resolve=>appServer.close(resolve))}
    if(proxy){await new Promise(resolve=>proxy.close(resolve))}
    if(connection){await connection.close()}
    if(mongo){await mongo.stop()}
});
