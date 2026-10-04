'use strict';
// Real Mongo4.4 / Mongoose5.1.2 check of forecast coverage reads (#2676 rollback):
// the Mongo completeness query must agree with the JS rule, and a production-sized DB2
// short read must finish within the default wait. Run with TW_MONGOD; never loads app/config.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),cp=require('child_process');
const mongoose=require('mongoose'),h=require('./harness'),fx=require('./forecast-grid-fixtures'),Forecast=require('../../lib/forecastGridCollection');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let dbProcess,connection,scratch,logFd;
const pending=(model,version,product,slot,coords,ms)=>new Promise((res,rej)=>Forecast.pending(model,version,product,slot,coords,(e,p)=>e?rej(e):res(p),ms));
const key=c=>c.mx+':'+c.my;
(async()=>{
 assert.strictEqual(mongoose.version,'5.1.2','do not substitute a newer Mongoose driver');
 const binary=process.env.TW_MONGOD;assert(binary,'TW_MONGOD must identify a local Mongo4.4 binary');
 assert.match(cp.execFileSync(binary,['--version'],{encoding:'utf8'}),/v4\.4\./);
 scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tw-2676-coverage-'));logFd=fs.openSync(path.join(scratch,'mongo.log'),'w');
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
 dbProcess=cp.spawn(binary,['--dbpath',scratch,'--port',String(port),'--bind_ip','127.0.0.1','--storageEngine','wiredTiger','--quiet'],{stdio:['ignore',logFd,logFd]});
 for(let i=0;i<200;i++){
    if(dbProcess.exitCode!==null)throw new Error('Temporary Mongo exited: '+dbProcess.exitCode);
    const ready=await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false))});
    if(ready)break;if(i===199)throw new Error('Temporary Mongo startup deadline');await wait(50);
 }
 connection=mongoose.createConnection('mongodb://127.0.0.1:'+port+'/coverage2676',{autoIndex:false});
 await new Promise((res,rej)=>{connection.once('open',res);connection.once('error',rej)});
 const api={Schema:mongoose.Schema,model:connection.model.bind(connection)},models={};
 for(const product of ['short','shortest']){
    models[product+'1.0']=h.load('models/model'+product[0].toUpperCase()+product.slice(1)+'.js',{mongoose:api});
    models[product+'2.0']=h.load('models/kma/kma.town.'+product+'.model.js',{mongoose:api});
 }
 for(const model of Object.values(models))await new Promise((res,rej)=>model.ensureIndexes(e=>e?rej(e):res()));
 // 1. Differential: each grid carries one mutation; Mongo and the JS rule must select the same pending grids.
 const differential=[];
 for(const product of ['short','shortest'])for(const version of ['1.0','2.0']){
    const slot={date:'20261004',time:product==='short'?'0200':'1530'},field=product+'Data',model=models[product+version];
    const base=fx.rows(product,slot,{mx:0,my:0});
    const numeric=Object.keys(base[0]).filter(k=>typeof base[0][k]==='number'&&!['mx','my'].includes(k)).concat(product==='short'?['tmn','tmx']:[]);
    // Non-string payload date/time must leave a slot pending, never fail the whole read.
    const cases=[{name:'complete'},{name:'literal-echo',pub:slot.time},{name:'previous-hour',pub:fx.parts(fx.publication(slot)-fx.hour).time},{name:'numeric-time',field:'time',value:1600},
        {name:'duplicate-invalid-after',dup:'after'},{name:'duplicate-invalid-before',dup:'before'},{name:'duplicate-valid',dup:'valid'},
        {name:'missing-slot',drop:true},{name:'moved-slot',move:true}];
    for(const f of numeric)for(const v of [undefined,null,NaN,'0',-900,900,-50,-100,-1,0,4,5,9,101,361])cases.push({name:f+'='+String(v),field:f,value:v});
    const coords=cases.map((c,i)=>({mx:i%149,my:200+Math.floor(i/149)})),oracle=new Set();
    for(let i=0;i<cases.length;i++){
        const c=cases[i],coord=coords[i];let data=fx.rows(product,slot,coord,c.pub);
        if(c.field&&c.field!=='time'){const at=data.findIndex(r=>r[c.field]!==undefined||!['tmn','tmx'].includes(c.field));data[at]={...data[at],[c.field]:c.value};if(c.value===undefined)delete data[at][c.field]}
        if(c.drop)data=data.slice(1);
        const docs=fx.documents(product,version,slot,coord,data);
        if(c.move&&version==='2.0')docs[0].fcsDate=new Date(+docs[0].fcsDate+fx.hour);
        if(c.move&&version==='1.0')docs[0][field][0]={...docs[0][field][0],time:'0000'};
        // Review R1-01: a slot with a conflicting duplicate document is incomplete in both orders.
        if(c.dup&&version==='2.0'){const extra={...docs[0],[field]:{...docs[0][field],...(c.dup==='valid'?{}:{wsd:-1})}};
            if(c.dup==='before')docs.unshift(extra);else docs.push(extra)}
        if(c.dup&&version==='1.0'){const extra={...docs[0][field][0],...(c.dup==='valid'?{}:{wsd:-1})};
            docs[0][field]=c.dup==='before'?[extra,...docs[0][field]]:docs[0][field].concat(extra)}
        if(c.field==='time'){if(version==='1.0')docs[0][field][0]={...docs[0][field][0],time:c.value};else docs[0][field]={...docs[0][field],time:c.value}}
        await model.collection.insertMany(docs);
        const stored=version==='1.0'?docs[0][field]:docs.filter(d=>typeof d[field].time==='string'&&+d.fcsDate===fx.publication(d[field])-9*fx.hour).map(d=>d[field]);
        if(!(Forecast.canonical(product,Forecast.identities(product,slot)[0])===data[0].pubDate&&Forecast.complete(product,slot,stored)))oracle.add(key(coord));
    }
    const actual=new Set((await pending(model,version,product,slot,coords)).map(key));
    const disagree=cases.filter((c,i)=>actual.has(key(coords[i]))!==oracle.has(key(coords[i]))).map(c=>c.name);
    assert.deepStrictEqual(disagree,[],product+' DB'+version+' Mongo coverage differs from the JS rule');
    assert(!actual.has(key(coords[0])),'the canonical publication covers');
    assert.strictEqual(actual.has(key(coords[1])),product==='shortest','a stored literal HH30 ultra-short grid is rewritten as HH00');
    assert(actual.has(key(coords[2])),'previous hour never covers');
    differential.push({product,version,cases:cases.length,pending:actual.size});
 }
 // 2. Production volume: 2,033 grids x 285 hourly slot documents (~579k); the target publication owns its 74 slots.
 const grids=Array.from({length:2033},(_,i)=>({mx:i%149,my:Math.floor(i/149)})),model=models['short2.0'];
 const slot={date:'20261004',time:'0500'},older={date:'20261004',time:'0200'},start=fx.publication(slot);
 const seedStart=Date.now();
 for(const g of grids){
    const own=new Map(fx.rows('short',slot,g).map(r=>[r.date+r.time,r])),docs=[];
    for(let k=-184;k<=100;k++){
        const t=start+k*fx.hour,p=fx.parts(t),r=own.get(p.date+p.time);
        const row=r||{...p,...g,pubDate:older.date+older.time,t3h:1,sky:1,reh:1,pty:0,pop:0,r06:0,s06:0,uuu:1,vvv:1,vec:1,wsd:1};
        docs.push({mCoord:g,pubDate:new Date(fx.publication(r?slot:older)-9*fx.hour),fcsDate:new Date(t-9*fx.hour),
            shortData:{...row,r06Text:'강수없음',s06Text:'적설없음',wav:-1,tmn:row.tmn===undefined?-50:row.tmn,tmx:row.tmx===undefined?-50:row.tmx}});
    }
    await model.collection.insertMany(docs,{ordered:false});
 }
 const total=await model.collection.count({'mCoord.my':{$lt:200}}),matched=await model.collection.count({pubDate:new Date(start-9*fx.hour)});
 const readMs=[];
 for(let i=0;i<5;i++){const t=Date.now();assert.strictEqual((await pending(model,'2.0','short',slot,grids)).length,0);readMs.push(Date.now()-t)}
 await model.collection.updateOne({'mCoord.mx':grids[7].mx,'mCoord.my':grids[7].my,pubDate:new Date(start-9*fx.hour)},{$set:{'shortData.reh':-1}});
 assert.deepStrictEqual(await pending(model,'2.0','short',slot,grids),[grids[7]],'one damaged slot leaves exactly its grid pending');
 console.log(JSON.stringify({result:'passed',node:process.versions.node,mongoose:mongoose.version,mongo:'4.4',differential,
    volume:{documents:total,publicationDocuments:matched,expectedSlots:fx.rows('short',slot,grids[0]).length,seedMs:Date.now()-seedStart,readTimeoutMs:10000,maxTimeMS:9000,readMs}}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 if(connection)await connection.close();
 if(dbProcess&&dbProcess.exitCode===null){dbProcess.kill('SIGTERM');await new Promise(r=>dbProcess.once('exit',r))}
 if(logFd!==undefined)fs.closeSync(logFd);if(scratch)fs.rmSync(scratch,{recursive:true,force:true});
});
