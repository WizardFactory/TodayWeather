'use strict';
// Offline oracle: execute the actual legacy name-remap and _findTown functions with explicit
// provider-boundary answers. No network/database/module startup; never used by the runtime.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), zlib = require('zlib');
const repo = process.env.TW_REPO || path.resolve(__dirname, '../../../..');
const files = ['server/controllers/geo.controller.js', 'server/controllers/controllerTown.js', 'server/models/town.js', 'server/controllers/controllerTown24h.js', 'server/lib/unitConverter.js'];
const text = files.map(f => fs.readFileSync(path.join(repo, f), 'utf8'));
const method = (s, marker) => { const from=s.indexOf(marker); if(from<0)throw Error(marker); const to=s.indexOf('\n};',from); if(to<0)throw Error('end'); return s.slice(from,to+3); };
const silent = {info(){},warn(){},error(){},silly(){},debug(){}};
function waterfall(steps, done) { let i=0; const next=(err,...v)=> { if(err||i===steps.length)return done(err,...v); steps[i++](...v,next); }; next(); }
function retry(n, run, done) { const next=(err,v)=> {if(err&&--n>0)return run(next);done(err,v);};run(next); }
const remaps=[];
for(const address of ['대한민국 서울특별시 중구', '대한민국 서울특별시 중구 명동', '대한민국 경기도 수원시 영통구', '대한민국 경기도 수원시 영통구 매탄동', '대한민국 서울특별시 중구 이상명', '대한민국 서울특별시']) {
  const ctx={GeoController:function(){},googleApiKey:'',log:silent,async:{retry}};
  vm.runInNewContext(method(text[0],'GeoController.prototype.name2address ='),ctx);
  const geo=new ctx.GeoController();geo.googleUrl='https://provider.invalid';geo.lang='ko';geo._request=(_,cb)=>cb(null,{});geo._parseGoogleResult=()=>({address});
  const req={params:{region:'서울특별시',city:'중구'}};let result;
  geo.name2address(req,err=>{result={address,params:req.params,error:err?err.message:null};});remaps.push(JSON.parse(JSON.stringify(result)));
}
const towns=[];
for(const kind of ['same-grid','same-city','no-area','outside','provider-failure']) {
 const list=kind==='no-area'?[]:[{town:{first:'서울특별시',second:'중구',third:'기존동'},mCoord:{mx:kind==='same-grid'?60:61,my:127},areaNo:'11140'}];
 if(!list.length)list.push({town:{first:'다른시',second:'다른구',third:'기존동'},mCoord:{mx:61,my:128}});
 const converted={lat:kind==='outside'?'20':'37.566',lon:'126.978',mx:60,my:127}; let saves=0;
 const ctx={ControllerTown:function(){},log:silent,async:{waterfall},convertGeocode:(_,__,___,cb)=>cb(kind==='provider-failure'?Error('provider unavailable'):null,converted),_isKoreaArea:(lat,lon)=>39.3769>=lat&&lat>=32.6942&&131.88>=lon&&lon>=123.9523,dbTown:function(){this.save=cb=>{saves++;cb(null);};}};
 vm.runInNewContext(method(text[1],'ControllerTown.prototype._findTown ='),ctx);let result;
 new ctx.ControllerTown()._findTown(list,'서울특별시','중구','새동',(err,town)=>{result={kind,town:town||null,error:err?err.message:null,saves,listCount:list.length};});towns.push(JSON.parse(JSON.stringify(result)));
}
// Use the actual legacy Town schema and Mongoose 5.1.2, with only its collection boundary
// replaced by memory. No mongoose.connect, database socket or real save occurs.
async function lifecycle() {
 const mongoose=require(process.env.TW_MONGOOSE_MODULE || 'mongoose');
 if(mongoose.version!=='5.1.2')throw Error('pinned mongoose 5.1.2 required');
 const schema={require:n=>{if(n!=='mongoose')throw Error(n);return mongoose;},module:{exports:{}}};
 vm.runInNewContext(text[2],schema); const Town=schema.module.exports;
 let stored,writes=0,saveDone;const saved=new Promise(resolve=>saveDone=resolve);
 Town.collection.insertOne=(doc,options,cb)=>{writes++;stored=doc;process.nextTick(()=>{cb(null,{result:{ok:1,n:1},ops:[doc]});saveDone();});};
 Town.collection.find=(filter,options,cb)=>process.nextTick(()=>cb(null,{toArray:done=>process.nextTick(()=>done(null,[stored]))}));
 const ctx={ControllerTown:function(){},log:silent,async:{waterfall},convertGeocode:(_,__,___,cb)=>cb(null,{lat:'37.566',lon:'126.978',mx:60,my:127}),_isKoreaArea:()=>true,dbTown:Town};
 vm.runInNewContext(method(text[1],'ControllerTown.prototype._findTown ='),ctx);
 const controller=new ctx.ControllerTown();const list=[{town:{first:'서울특별시',second:'중구',third:'기존동'},mCoord:{mx:60,my:127},areaNo:'11140'}];
 const find=list=>new Promise((resolve,reject)=>controller._findTown(list,'서울특별시','중구','새동',(err,town)=>err?reject(err):resolve(town)));
 const first=await find(list);await saved;const same=await find(list);
 const lean=await Town.find({}, {_id:0}).lean().exec();const cold=await find(lean);
 const clean=o=>{o=JSON.parse(JSON.stringify(o));delete o._id;return o;};
 const at=text[3].indexOf('this.makeResult = function');const end=text[3].indexOf('\n    };',at);
 const responseCtx={log:silent,UnitConverter:require(path.join(repo,files[4]))};
 vm.runInNewContext(text[3].slice(at,end+7).replace('this.makeResult','makeResult'),responseCtx);
 const response=town=>{const req={params:town.town,query:{},version:'v000903',gCoord:town.gCoord};let error;responseCtx.makeResult(req,{},err=>{error=err;});return {status:error?500:200,location:req.result.location||null,errorType:error?error.name:null};};
 return {makeResult:{first:response(first),sameProcess:response(same),coldLean:response(cold)},mongoose:mongoose.version,connectionState:mongoose.connection.readyState,collectionWrites:writes,networkWrites:0,first:clean(first),sameProcess:clean(same),coldLean:clean(cold)};
}
lifecycle().then(lifecycle=>{
 const doc={oracle:{runtime:process.version,timezone:'UTC',scope:'Actual legacy name2address/_findTown and Town schema + Mongoose5.1.2 cast/save/lean; provider and Mongo collection boundaries replaced explicitly, no live network',files:Object.fromEntries(files.map((f,i)=>[f,crypto.createHash('sha256').update(text[i]).digest('hex')]))},remaps,towns,lifecycle};
 const body=JSON.stringify(doc);const out=process.argv[2];if(out)fs.writeFileSync(out,zlib.gzipSync(body,{mtime:0}));else process.stdout.write(body+'\n');
}).catch(err=>{console.error(err);process.exitCode=1;});
