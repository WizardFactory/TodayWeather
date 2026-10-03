'use strict';
const assert=require('assert'),mh=require('./current-manager-harness'),h=require('./harness'),fx=require('./forecast-grid-fixtures'),policy=require('../../config/gather');
const coords=[{mx:60,my:127},{mx:61,my:127}],empty={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
            assert.strictEqual(writes,1);control.cancelled=true;late();assert.strictEqual(writes,1);assert(callbackError);
            control.cancelled=false;callbackError=null;c[product==='short'?'saveShort':'saveShortest'](rows,e=>{callbackError=e},control);
            late(new Error('write failed'));assert(callbackError);assert.strictEqual(writes,2,'write failure stops before another slot');
        }
    }
 }
 console.log('PASS forecast lifecycle: joined HTTP deadline, late-write fencing, incomplete batch rejection, quota/key bounds and DB1/DB2 writer fences/errors');
})().catch(e=>{console.error(e);process.exitCode=1});
