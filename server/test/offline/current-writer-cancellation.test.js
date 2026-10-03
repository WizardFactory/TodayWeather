const assert=require('assert');
const mh=require('./current-manager-harness'),h=require('./harness');
const slot={date:'20261003',time:'0000'},coords=[{mx:60,my:127}];
const wait=ms=>new Promise(r=>setTimeout(r,ms));const results=[];
function Col(){}Col.prototype.requestData=function(list,type,key,date,time,cb){cb(null,list.map(mCoord=>({mCoord,isCompleted:true,data:[{...slot,mx:mCoord.mx,my:mCoord.my,pubDate:'202610030000',t1h:0}]})))};
(async()=>{for(const version of ['1.0','2.0']){
let late,writes=0,finished=0;
function Model(data){this.save=cb=>{writes++;cb()}};
Model.find=function(query,arg){if(typeof arg==='function'){late=arg;return;}return{setOptions(){return this},lean(){return this},exec(cb){if(query.fcsDate&&query['currentData.date']===undefined)late=cb;else cb(null,[])}}};
Model.remove=function(){return {exec(cb){if(cb)cb()}}};
Model.update=function(query,data,opts,cb){writes++;cb()};
const config={db:{version},keyString:{dongnae_forecast_keys:'["SYNTHETIC_CURRENT_KEY_A"]'},history:{enabled:false}};
const overrides={'../config/config':config,'../lib/collectTownForecast':Col,'../models/town':{getCoord:cb=>cb(null,coords)},'../models/modelCurrent':Model,'../models/kma/kma.town.current.model':Model,'../config/gather':require('../../config/gather').load({GATHER_CURRENT_DEADLINE_MS:'10'})};
if(version==='2.0'){
const Controller=h.load('controllers/kma/kma.town.current.controller.js',{'async':require('async'),'../../models/kma/kma.town.current.model.js':Model,'../../lib/kmaTimeLib':require('../../lib/kmaTimeLib')},{log:h.logger([])});
overrides['./kma/kma.town.current.controller.js']=Controller;
}
const f=mh.load(overrides);f.m.getCurrentQueryTime=()=>slot;f.m.getDataTypeName=()=> 'TOWN_CURRENT';f.m.getTownCurrentData(9,'synthetic',e=>{assert(e);console.log('finish',version,e.message);finished++});
await wait(30);assert.strictEqual(finished,1);assert.strictEqual(writes,0);assert(late,'actual save lookup must be waiting');
late(null,[]);results.push({version,writes});
console.log(JSON.stringify({version,deadlineCallbacks:finished,writesBeforeLateRead:0,writesAfterLateRead:writes,actualWriter:true}));
}assert.deepStrictEqual(results,[{version:'1.0',writes:0},{version:'2.0',writes:0}],'cancelled writer find callback must not admit a new Mongo write');})().catch(e=>{console.error(e);process.exitCode=1});
