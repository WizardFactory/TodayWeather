'use strict';
const assert=require('assert'),mh=require('./current-manager-harness'),h=require('./harness'),fx=require('./forecast-grid-fixtures'),Forecast=require('../../lib/forecastGridCollection'),policy=require('../../config/gather');
const coords=[{mx:60,my:127},{mx:61,my:127}],empty={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// A test that stops before its final PASS (e.g. a swallowed assertion) must fail, not exit 0.
let passed=false;process.on('exit',()=>{if(!passed){console.error('FAIL: ended before final PASS');process.exitCode=1}});
(async()=>{
 for(const product of ['short','shortest']){
    const slot={date:'20261003',time:product==='short'?'1700':'0030'},method=product==='short'?'getTownShortData':'getTownShortestData';
    let late,writes=0,walks=0,finished=0;
    function Col(){}Col.prototype.requestData=function(list,type,key,date,time,cb){walks++;late=()=>cb(null,list.map(mCoord=>({mCoord,isCompleted:true,data:fx.rows(product,slot,mCoord)})))};
    Col.prototype.cancel=function(){};
    const f=mh.load({'../lib/collectTownForecast':Col,'../models/town':{getCoord:cb=>cb(null,coords)},
        '../models/kma/kma.town.short.model':empty,'../models/kma/kma.town.shortest.model':empty,
        '../config/gather':policy.load({GATHER_FORECAST_DEADLINE_MS:'15'})});
    f.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;f.m.getSaveFunc=()=>function(rows,cb){writes++;cb()};
    f.m[method](9,'dummy',e=>{assert(e);finished++});f.m[method](9,'dummy',e=>{assert(e);finished++});
    await wait(35);assert.strictEqual(finished,2);assert.strictEqual(walks,1);late();assert.strictEqual(writes,0);
    f.m[method](9,'dummy',e=>{assert(e);finished++});late();assert.strictEqual(writes,2);assert.strictEqual(finished,3,'readback remains incomplete');
    // A full transport result with a missing slot is rejected before any write.
    function Missing(){}Missing.prototype.requestData=function(list,type,key,date,time,cb){cb(null,list.map(mCoord=>({mCoord,isCompleted:true,data:fx.rows(product,slot,mCoord).slice(1)})))};
    const missing=mh.load({'../lib/collectTownForecast':Missing});let saves=0;
    missing.m.getSaveFunc=()=>function(rows,cb){saves++;cb()};
    const control={product,slot,cancelled:false,httpAttempts:0};
    missing.m._recursiveRequestData(coords,product==='short'?2:1,'dummy',slot,1,undefined,e=>assert(e),{keysTried:1,control});assert.strictEqual(saves,0);
    function Partial(){}Partial.prototype.requestData=function(list,type,key,date,time,cb){cb(null,list.map((mCoord,i)=>({mCoord,isCompleted:true,data:i===0?fx.rows(product,slot,mCoord).slice(1):fx.rows(product,slot,mCoord)})))};
    const partial=mh.load({'../lib/collectTownForecast':Partial});let goodSaves=0;
    partial.m.getSaveFunc=()=>function(rows,cb){goodSaves++;cb()};
    partial.m._recursiveRequestData(coords,product==='short'?2:1,'dummy',slot,1,undefined,e=>assert(e),{keysTried:1,control:{product,slot,cancelled:false,httpAttempts:0}});
    assert.strictEqual(goodSaves,1,'an incomplete grid must not discard subsequent complete grids');
    // Provider rows outside the expected horizon are dropped before saves; the grid still completes.
    function Extra(){}Extra.prototype.requestData=function(list,type,key,date,time,cb){cb(null,list.map(mCoord=>({mCoord,isCompleted:true,data:fx.rows(product,slot,mCoord).concat({...fx.rows(product,slot,mCoord)[0],date:'20261020',time:'0300'})})))};
    const extra=mh.load({'../lib/collectTownForecast':Extra});const saved=[];
    extra.m.getSaveFunc=()=>function(rows,cb){saved.push(rows);cb()};
    await new Promise(res=>extra.m._recursiveRequestData(coords,product==='short'?2:1,'dummy',slot,1,undefined,e=>{assert(!e,e&&e.message);res()},{keysTried:1,control:{product,slot,cancelled:false,httpAttempts:0}}));
    assert.strictEqual(saved.length,coords.length,'out-of-horizon rows do not block admission');
    assert(saved.every(rows=>rows.length===fx.rows(product,slot,coords[0]).length&&rows.every(r=>r.date!=='20261020')));
    // The Manager wires strict raw-value validation: a '12junk' value parseFloat would accept is never saved.
    function Junk(){}Junk.prototype.requestData=function(list,type,key,date,time,cb){const self=this;cb(null,list.map((mCoord,i)=>{
        const items=fx.items(product,slot,mCoord);items[0].fcstValue=['12junk'];
        return self.validateForecastItems&&!self.validateForecastItems(items,i)?{mCoord,isCompleted:false,invalidForecast:true}:{mCoord,isCompleted:true,data:fx.rows(product,slot,mCoord)};
    }))};
    const junk=mh.load({'../lib/collectTownForecast':Junk});let junkSaves=0;
    junk.m.getSaveFunc=()=>function(rows,cb){junkSaves++;cb()};
    await new Promise(res=>junk.m._recursiveRequestData(coords,product==='short'?2:1,'dummy',slot,1,undefined,e=>{assert(e);res()},{keysTried:1,control:{product,slot,cancelled:false,httpAttempts:0}}));
    assert.strictEqual(junkSaves,0,'Manager must pass raw items through strict validation');
    // Deterministic content failure remains pending without consuming transport retries.
    let contentCalls=0,contentSaves=0;
    function InvalidContent(){return h.collector({get(url,opts,cb){
        contentCalls++;const items=fx.items(product,slot,coords[0]);items.find(i=>i.category[0]==='REH').fcstValue=['900'];
        const response=h.response(items);response.response.body[0].totalCount=[String(items.length)];response.response.body[0].numOfRows=[String(items.length)];
        setImmediate(()=>cb(null,{statusCode:200},h.xml(response)));return {abort(){}};
    }})}
    const bad=mh.load({'../lib/collectTownForecast':InvalidContent,'../models/town':{getCoord:cb=>cb(null,[coords[0]])},
        '../models/kma/kma.town.short.model':empty,'../models/kma/kma.town.shortest.model':empty,'../config/gather':policy.load({})});
    bad.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;bad.m.getSaveFunc=()=>function(rows,cb){contentSaves++;cb()};
    await new Promise(resolve=>bad.m[method](9,'dummy',(e,r)=>{assert(e);assert.strictEqual(r.pending,1);resolve()}));
    assert.strictEqual(contentCalls,1,'invalid content must not use the default 70 transport attempts');assert.strictEqual(contentSaves,0);
    // One writer error must not prevent another grid's transient HTTP recovery.
    let mixedPasses=0,mixedSaves=0;
    function Mixed(){}Mixed.prototype.requestData=function(list,type,key,date,time,cb){mixedPasses++;cb(null,list.map((mCoord,i)=>({mCoord,isCompleted:mixedPasses>1||i===0,data:fx.rows(product,slot,mCoord)})))};
    const mixed=mh.load({'../lib/collectTownForecast':Mixed});mixed.m.getSaveFunc=()=>function(rows,cb){mixedSaves++;cb(mixedSaves===1?new Error('write failed'):null)};
    await new Promise(resolve=>mixed.m._recursiveRequestData(coords,product==='short'?2:1,'dummy',slot,2,undefined,e=>{assert(e);resolve()},
        {keysTried:1,control:{product,slot,cancelled:false,httpAttempts:0}}));
    assert.strictEqual(mixedPasses,2);assert.strictEqual(mixedSaves,2);
    // Real collector + Manager quota handling must stop each configured key once.
    let attempts=0;
    function Quota(){return h.collector({get(url,opts,cb){attempts++;setImmediate(()=>cb(null,{statusCode:200},'<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'));return {abort(){}}}})}
    const q=mh.load({'../lib/collectTownForecast':Quota,'../models/town':{getCoord:cb=>cb(null,coords)},
        '../models/kma/kma.town.short.model':empty,'../models/kma/kma.town.shortest.model':empty,
        '../config/gather':policy.load({GATHER_REQUEST_CONCURRENCY:'1',GATHER_TOWN_RETRY:'5'})});
    q.m[product==='short'?'getShortQueryTime':'getShortestQueryTime']=()=>slot;
    await new Promise(resolve=>q.m[method](9,'dummy',(e,r)=>{assert(e);assert.strictEqual(r.pending,2);assert.strictEqual(r.httpAttempts,2);resolve()}));
    assert.strictEqual(attempts,2,'one attempt per rejected key, no outer retry storm');
 }
 // DB1 real writer keeps earlier conditional extrema/WAV while replacing required fields.
 const slot05={date:'20261003',time:'0500'},newRows=fx.rows('short',slot05,coords[0]);
 const oldRows=fx.rows('short',{date:slot05.date,time:'0200'},coords[0]);
 oldRows.find(r=>r.time==='0600').wav=0.5;newRows[0].tmn=-50;newRows[0].wav=-1;
 let oldDoc={shortData:oldRows,pubDate:slot05.date+'0200',save(cb){cb()}};
 function OldModel(){}OldModel.find=(query,cb)=>cb(null,[oldDoc]);
 OldModel.update=(query,update,options,cb)=>{assert.strictEqual(query.pubDate,slot05.date+'0200');Object.assign(oldDoc,update.$set);cb(null,{n:1})};
 const db1=mh.load({'../models/modelShort':OldModel,'../lib/midForecastPolicy':require('../../lib/midForecastPolicy')});db1.m.MAX_SHORT_COUNT=192;
 await new Promise((resolve,reject)=>db1.m.saveShort(newRows,e=>e?reject(e):resolve(),{product:'short',slot:slot05,cancelled:false}));
 const six=oldDoc.shortData.find(r=>r.date===slot05.date&&r.time==='0600');
 assert.strictEqual(six.tmn,-20);assert.strictEqual(six.wav,0.5);assert.strictEqual(six.pubDate,slot05.date+'0500');
 // DB2 writers stop serial admission after an expired first update, and propagate failure.
 for(const product of ['short','shortest']){
    const slot={date:'20261003',time:product==='short'?'1700':'0030'},rows=fx.rows(product,slot,coords[0]);
    for(const version of ['1.0','2.0']){
        let late,writes=0;
        function Model(data){this.save=cb=>{writes++;cb()}}
        Model.find=(query,cb)=>{late=cb};
        Model.update=(query,data,options,cb)=>{assert.strictEqual(query['mCoord.mx'],coords[0].mx);assert.strictEqual(query['mCoord.my'],coords[0].my);assert(query.fcsDate);writes++;late=cb};
        const control={product,slot,cancelled:false};let callbackError;
        if(version==='1.0'){
            const f=mh.load({'../models/modelShort':Model,'../models/modelShortest':Model,'../lib/midForecastPolicy':require('../../lib/midForecastPolicy')});
            f.m[product==='short'?'saveShort':'saveShortest'](rows,e=>{callbackError=e},control);
            control.cancelled=true;late(null,[]);assert.strictEqual(writes,0);assert(callbackError);
        }else{
            const Controller=h.load('controllers/kma/kma.town.'+product+'.controller.js',{
                async:require('async'),['../../models/kma/kma.town.'+product+'.model.js']:Model,
                '../../lib/kmaTimeLib':require('../../lib/kmaTimeLib'),'../../lib/kmaPrecipitation':require('../../lib/kmaPrecipitation'),
                '../../lib/midForecastPolicy':require('../../lib/midForecastPolicy')},{log:h.logger([])});
            const c=new Controller();c[product==='short'?'saveShort':'saveShortest'](rows,e=>{callbackError=e},control);
            assert.strictEqual(writes,1);control.cancelled=true;late(null,{n:1});assert.strictEqual(writes,1);assert(callbackError);
            control.cancelled=false;callbackError=null;c[product==='short'?'saveShort':'saveShortest'](rows,e=>{callbackError=e},control);
            late(new Error('write failed'));assert(callbackError);assert.strictEqual(writes,2,'write failure stops before another slot');
        }
    }
 }
 // A write admitted before the deadline but executed by the DB after a newer publication completes
 // cannot replace that publication: DB2 fences on pubDate, DB1 compares-and-sets the read pubDate.
 for(const product of ['short','shortest']){
    const field=product+'Data',oldSlot={date:'20261003',time:product==='short'?'0200':'1730'},newSlot={...oldSlot,time:product==='short'?'0500':'1830'};
    const shared=fx.rows(product,newSlot,coords[0])[0],oldPub=oldSlot.date+oldSlot.time,newPub=newSlot.date+newSlot.time;
    const stored=new Map();let held,inserts=0;
    function Model(){}
    Model.find=query=>({setOptions(){return this},lean(){return this},exec(cb){cb(null,[...stored.values()].filter(d=>Number(d.pubDate)===Number(query.pubDate)))}});
    Model.update=(query,data,options,cb)=>{
        const key=Number(query.fcsDate);
        const apply=()=>{const doc=stored.get(key);
            if(data.$setOnInsert){if(!doc){inserts++;stored.set(key,{...data.$setOnInsert,mCoord:coords[0],fcsDate:query.fcsDate})}return cb(null,{n:doc?1:0})}
            if(query.$or&&(!doc||!(doc.pubDate==null||Number(doc.pubDate)<=Number(query.$or[0].pubDate.$lte))))return cb(null,{n:0});
            stored.set(key,data);cb(null,{n:1});
        };
        const row=data.$setOnInsert?data.$setOnInsert[field]:data[field];
        if(row.pubDate===oldPub&&row.date+row.time===shared.date+shared.time&&!held){held=apply}else{apply()}
    };
    const Controller=h.load('controllers/kma/kma.town.'+product+'.controller.js',{async:require('async'),['../../models/kma/kma.town.'+product+'.model.js']:Model,
        '../../lib/kmaTimeLib':require('../../lib/kmaTimeLib'),'../../lib/kmaPrecipitation':require('../../lib/kmaPrecipitation'),
        '../../lib/midForecastPolicy':require('../../lib/midForecastPolicy')},{log:h.logger([])});
    const writer=new Controller(),save=product==='short'?'saveShort':'saveShortest';
    const c=new Forecast({product,model:Model,version:'2.0',coords:cb=>cb(null,[coords[0]]),emit:()=>{},collectTimeoutMs:10,
        collect:(list,s,key,cb,control)=>writer[save](fx.rows(product,s,coords[0]),cb,control)});
    await new Promise(res=>c.run(oldSlot,'synthetic',e=>{assert(e);res()}));
    assert(held&&c.active===null);
    c.options.collectTimeoutMs=1000;
    await new Promise((res,rej)=>c.run(newSlot,'synthetic',(e,r)=>{if(e)return rej(e);assert.strictEqual(r.pending,0);res()}));
    const target=fx.publication(shared)-9*fx.hour,before=inserts;
    held();
    assert.strictEqual(stored.get(target)[field].pubDate,newPub,product+' DB2 old admitted write cannot overwrite');
    assert.strictEqual(inserts,before,'fenced miss on an existing slot inserts no duplicate');
    // DB1: the delayed older save loses its compare-and-set after the newer save advanced the document.
    const p0={date:'20261002',time:product==='short'?'2300':'1630'};
    let doc={_id:1,mCoord:coords[0],pubDate:p0.date+p0.time,[field]:fx.rows(product,p0,coords[0])},hold=true,release;
    function OldDoc(){}
    // Unfenced whole-document save, as the pre-#2678-review writer used it.
    function saveDoc(cb){const snapshot=this,apply=()=>{doc={...snapshot};cb()};if(hold){hold=false;release=apply}else{apply()}}
    OldDoc.find=(query,cb)=>cb(null,[{...doc,[field]:doc[field].map(r=>({...r})),save:saveDoc}]);
    OldDoc.update=(query,update,options,cb)=>{
        const apply=()=>{if(query.pubDate!==doc.pubDate)return cb(null,{n:0});doc={...doc,...update.$set};cb(null,{n:1})};
        if(hold){hold=false;release=apply}else{apply()}
    };
    const db1=mh.load({'../models/modelShort':OldDoc,'../models/modelShortest':OldDoc,'../lib/midForecastPolicy':require('../../lib/midForecastPolicy')});
    db1.m.MAX_SHORT_COUNT=192;db1.m.MAX_SHORTEST_COUNT=192;
    let oldError;
    db1.m[save](fx.rows(product,oldSlot,coords[0]),e=>{oldError=e},{product,slot:oldSlot,cancelled:false});
    await new Promise((res,rej)=>db1.m[save](fx.rows(product,newSlot,coords[0]),e=>e?rej(e):res(),{product,slot:newSlot,cancelled:false}));
    assert.strictEqual(doc.pubDate,newPub);release();
    assert.strictEqual(doc.pubDate,newPub,product+' DB1 delayed older save cannot replace newer document');assert(oldError);
    let staleError;db1.m[save](fx.rows(product,oldSlot,coords[0]),e=>{staleError=e},{product,slot:oldSlot,cancelled:false});
    assert(staleError);assert.strictEqual(doc.pubDate,newPub,'older publication never downgrades a newer document');
 }
 passed=true;
 console.log('PASS forecast lifecycle: joined HTTP deadline, late-write fencing, incomplete batch rejection, quota/key bounds and DB1/DB2 writer fences/errors');
})().catch(e=>{console.error(e);process.exitCode=1});
