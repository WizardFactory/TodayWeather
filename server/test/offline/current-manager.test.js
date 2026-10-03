'use strict';
const assert=require('assert'),h=require('./current-manager-harness');
const grids=Array.from({length:2032},(_,i)=>({mx:i%149,my:Math.floor(i/149)}));
const slot={date:'20261003',time:'0000'};
const data={...slot,t1h:0,rn1:0,uuu:-2,vvv:0,reh:50,pty:0,vec:0,wsd:0};
let calls=0,rows=[];
function Collector(){}
Collector.prototype.requestData=function(list,type,key,date,time,cb){
    calls++;cb(false,list.map(mCoord=>({mCoord,isCompleted:true,data:[{...data,mx:mCoord.mx,my:mCoord.my}]})));
};
const model={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,rows)}}}};
const f=h.load({'../models/town':{getCoord:cb=>cb(null,grids)},'../lib/collectTownForecast':Collector,
    '../models/kma/kma.town.current.model':model});
f.m.getCurrentQueryTime=()=>slot;
f.m.getSaveFunc=()=>function(list,cb){rows.push({mCoord:{mx:list[0].mx,my:list[0].my},currentData:list[0]});cb()};
let callbacks=0;
f.m.getTownCurrentData(9,'unused',e=>{assert.ifError(e);callbacks++});
f.m.getTownCurrentData(9,'unused',e=>{assert.ifError(e);callbacks++});
assert.strictEqual(callbacks,2);
assert.strictEqual(calls,1,'second poll must not fetch 2,032 already stored current grids again');
assert.strictEqual(rows.length,2032);
console.log('current Manager: repeated publication fetched once, 2032 grids stored');
