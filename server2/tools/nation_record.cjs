// Offline S17c oracle. Execute legacy collector, NationAir and nation route with bounded
// dependency doubles; never load private configuration, connect to Mongo, or call a provider.
// TZ=UTC NODE_PATH=<pinned legacy deps>/node_modules node16 nation_record.cjs <repo> <output>
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
if(process.version!=='v16.20.2')throw Error('Node16.20.2 required');
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const dependencies={mongoose:require('mongoose/package.json').version,async:require('async/package.json').version,jade:require('jade/package.json').version};
for(const [name,version] of Object.entries({mongoose:'5.1.2',async:'2.6.2',jade:'1.11.0'}))if(dependencies[name]!==version)throw Error('Pinned '+name+' '+version+' required');
const now='2026-10-16T00:10:00.000Z', hash={};
const log={info(){},debug(){},error(){},warn(){}};
class FixedDate extends Date {constructor(...a){super(...(a.length?a:[now]));} static now(){return Date.parse(now);}}
function source(file){const b=fs.readFileSync(path.join(root,file),'utf8');hash[file]=crypto.createHash('sha256').update(b).digest('hex');return b;}
function run(file,require,extra={}){const module={exports:{}};vm.runInNewContext(source(file),{module,exports:module.exports,require,log,Date:FixedDate,setTimeout,clearTimeout,console,...extra},{filename:file});return module.exports;}
const policy=run('server/config/air.js',()=>{throw Error('unexpected dependency')});
const converter=run('server/lib/aqi.converter.js',()=>{throw Error('unexpected dependency')});
const mongoose=require('mongoose');
const stationModel=run('server/models/arpltnKeco.js',n=>{if(n==='mongoose')return mongoose;throw Error(n);},{Date});
const observationApi=run('server/lib/airkoreaObservation.js',n=>{if(['https','url'].includes(n))return require(n);throw Error(n);});
const names=run('server/lib/AQI/waqiStationName.js',()=>{throw Error('dependency')});
const observation=run('server/lib/air/observation.js',n=>n.includes('aqi.converter')?converter:n.includes('waqiStationName')?names:n.includes('config/air')?policy:(()=>{throw Error(n)})());
const units=run('server/lib/unitConverter.js',()=>{throw Error('unexpected dependency')});
const controllerSource=source('server/controllers/kecoController.js');
const recalc=controllerSource.slice(controllerSource.indexOf('arpltnController.recalculateValue ='),controllerSource.indexOf('arpltnController._mregeData ='));
const Keco={};vm.runInNewContext(recalc,{arpltnController:Keco,AqiConverter:converter,log});
const parse=controllerSource.slice(controllerSource.indexOf('arpltnController._parseDateTime ='),controllerSource.indexOf('arpltnController._checkDateTime ='));
vm.runInNewContext(parse,{arpltnController:Keco,Date:FixedDate,log});
const validationSource=source('server/controllers/controllerTown24h.js');
const validation=validationSource.slice(validationSource.indexOf('    this.checkQueryValidation ='),validationSource.indexOf('\n    /**\n     * adjust tmn'));
function Controller(){vm.runInNewContext('(function(){'+validation+'}).call(target)',{target:this,UnitConverter:units,log});}
const averageSource=source('server/lib/kecoRequester.js');
const average=averageSource.slice(averageSource.indexOf('Keco.prototype.saveAvgSidoArpltn ='),averageSource.indexOf('\n/**\n *',averageSource.indexOf('Keco.prototype.saveAvgSidoArpltn =')));
const averages=[];function Collector(){}
vm.runInNewContext(average,{Keco:Collector,observationApi:{failure:c=>Error(c)},SidoArpltn:{update(q,set,opt,cb){averages.push({query:q,set});cb(null,{ok:1});}},log});
const items=[
 {stationName:'A',sidoName:'서울',mangName:'도시대기',dataTime:'2026-10-16 09:00',pm10Value:21,o3Value:0.025,date:new Date('2026-10-16T00:00:00Z')},
 {stationName:'B',sidoName:'서울',mangName:'도시대기',dataTime:'2026-10-16 09:00',pm10Value:24,date:new Date('2026-10-16T00:00:00Z')},
 {stationName:'C',sidoName:'서울',mangName:'도로변대기',dataTime:'2026-10-16 10:00',pm10Value:200,date:new Date('2026-10-16T01:00:00Z')},
 {stationName:'A',sidoName:'서울',mangName:'도시대기',dataTime:'2026-10-16 08:00',pm10Value:400,date:new Date('2026-10-15T23:00:00Z')}
];
new Collector().saveAvgSidoArpltn('서울',observationApi.parseRows({list:items,parm:{sidoName:'서울'}},observationApi.STATION,stationModel.getKeyList()),e=>{if(e)throw e;});
// Run the actual Mongoose update cast and schema field selection (no database connection).

const model=run('server/models/sido.arpltn.keco.model.js',n=>{if(n==='mongoose')return mongoose;throw Error(n);},{Date});
function document(avg){const q=model.update(avg.query,avg.set,{upsert:true});const cast=q._castUpdate(q._update);const out={...avg.query,...cast.$setOnInsert};for(const k of Object.keys(cast.$set))out[k]=cast.$set[k];delete out._id;delete out.__v;return out;}
let stored=[],fallbacks={},cityError=null,cityCalls=[];
Keco.getSidoArpltn=cb=>cb(null,stored,[]);
const fallback={getArpltn(coord,time,cb){
 const row=fallbacks[coord.lat];if(!row)return cb(null,undefined,'no-provider');
 const pollutants={};observation.POLLUTANTS.forEach(k=>{if(row[k+'Value']!==undefined)pollutants[k]=row[k+'Value'];});
 const evaluated=observation.evaluate({provider:row.source,observedAt:new Date(Keco._parseDateTime(row.dataTime)),pollutants,attribution:row.attribution,stationBased:false},coord,time);
 cb(null,evaluated.arpltn,evaluated.reason);
}};
const nationAir=run('server/lib/air/nationAir.js',n=>n.includes('kecoController')?Keco:n.includes('airFallback')?fallback:n.includes('config/air')?policy:(()=>{throw Error(n)})());
let stack;
const router={use(){},get(p,handlers,last){stack=[...handlers,last];}};
run('server/routes/v000803/route.nation.js',n=>{
 if(n==='express')return{Router:()=>router};if(n==='async')return require('async');
 if(n==='request')return (url,opts,cb)=>{const name=new URL(url).pathname.split('/').slice(4).map(decodeURIComponent).join('/');cityCalls.push({url,lang:opts.headers['Accept-Language']});process.nextTick(()=>cb(null,{statusCode:cityError||200},{cityName:name,current:{t1h:20},airInfo:{private:true},airInfoList:[{}]}));};
 if(n.includes('config/config'))return{apiServer:{url:'http://127.0.0.1:1'}};
 if(n.includes('controllerTown24h'))return Controller;if(n.includes('kecoController'))return Keco;if(n.includes('nationAir'))return nationAir;throw Error(n);
});
async function scenario(id,{rows=[],fallback={},version='v000903',query={},error=null}={}){
 stored=rows;fallbacks=fallback;cityError=error;cityCalls=[];
 const req={baseUrl:'/'+version+'/nation',headers:{'accept-language':'ko'},params:{nation:'KR'},query:{...query}};
 return new Promise(resolve=>{let i=0,done=false;const res={send(body){if(!done){done=true;resolve({id,version,query,stored:rows,fallback,body:JSON.stringify(body),cityCalls});}},status(c){this.code=c;return this;}};function next(err){if(done)return;if(err){done=true;resolve({id,version,query,stored:rows,fallback,error:{status:500,message:err.message},cityCalls});return;}const fn=stack[i++];fn(req,res,next);}next();});
}
(async()=>{
 const avg=document(averages[0]);
 const cases=[];
 const nationwideInputs=nationAir.regions.map((r,i)=>({stationName:r[0]+'-1',sidoName:r[0],mangName:'도시대기',dataTime:'2026-10-16 09:00',pm10Value:20+i,pm25Value:10+i,date:new Date('2026-10-16T00:00:00Z')}));
 const before=averages.length;
 nationwideInputs.forEach(row=>new Collector().saveAvgSidoArpltn(row.sidoName,observationApi.parseRows({list:[row],parm:{sidoName:row.sidoName}},observationApi.STATION,stationModel.getKeyList()),e=>{if(e)throw e;}));
 const all=nationwideInputs.map((_,i)=>document(averages[before+i]));
 const allCase=await scenario('all-provinces',{rows:all});allCase.nationwideInputs=nationwideInputs;cases.push(allCase);

 cases.push(await scenario('fresh-province',{rows:[avg]}));
 for(const unit of ['airkorea_who','airnow','aqicn','invalid'])cases.push(await scenario('unit-'+unit,{rows:[avg],query:{airUnit:unit}}));
 cases.push(await scenario('empty-no-provider'));
 cases.push(await scenario('v901-success',{version:'v000901',rows:[avg]}));
 cases.push(await scenario('v901-child-500',{version:'v000901',error:500}));
 cases.push(await scenario('v903-child-404',{error:404}));
 for(const [id,date] of [['stale','2026-10-16 01:10'],['future','2026-10-16 10:11']])cases.push(await scenario(id,{rows:[{...avg,dataTime:date}]}));
 cases.push(await scenario('representative',{fallback:{37.5665:{source:'openweather',dataTime:'2026-10-16 09:00',pm10Value:25,pm25Value:12,attribution:'OpenWeather'}}}));
 const jade=require('jade');
 source('server/views/error.jade');source('server/views/layout.jade');
 for(const c of cases)if(c.error)c.error.html=jade.renderFile(path.join(root,'server/views/error.jade'),{message:c.error.message,error:{}});
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({node:process.version,dependencies,now,hash,averageInputs:items,averages:[{...averages[0],stored:avg}],scenarios:cases},null,2)+'\n');
 console.log(JSON.stringify({scenarios:cases.length,files:Object.keys(hash).length}));
})();
