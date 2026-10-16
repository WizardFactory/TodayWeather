'use strict';
// Offline oracle only. Executes actual committed legacy modules with synthetic stores;
// deliberately unavailable constructors/network are isolated, never used as expectations.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm');
const {createRequire}=require('module'),{EventEmitter}=require('events');
const repo=path.resolve(process.argv[2]||'.'), revision=process.argv[3]||'working-tree';
const files=['server/lib/pushCoordinator/warningFeed.js','server/lib/pushCoordinator/registry.js',
 'server/lib/pushCoordinator/engine.js','server/lib/pushCoordinator/runtime.js',
 'server/lib/pushCoordinator/transport.js','server/lib/kmaWarningZones.js',
 'server/utils/data/kma_warning_zones.csv'];
const sourceHashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,f))).digest('hex')]));
const actualRequire=createRequire(path.join(repo,'server/lib/pushCoordinator/warningFeed.js'));
const {Feed,eventId,publishedAt}=actualRequire('./warningFeed'),{Engine}=actualRequire('./engine');
const registry=actualRequire('./registry'),zones=actualRequire('../kmaWarningZones');
function load(relative,replacements){
 const absolute=path.join(repo,relative),real=createRequire(absolute),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(absolute,'utf8'),{module,exports:module.exports,
  require:(name)=>Object.prototype.hasOwnProperty.call(replacements,name)?replacements[name]:real(name),
  Date,URL,Buffer,console,setTimeout,clearTimeout,setImmediate,process:{env:{NODE_ENV:'production'}}},{filename:absolute});
 return module.exports;
}
const runtime=load('server/lib/pushCoordinator/runtime.js',{
 '../../controllers/controllerPush':class {},'../../controllers/alert.push.controller':class {},
 '../pushProviders':{},'./weatherSource':{create:()=>({get:()=>{throw Error('Not used in warning oracle')}})},
 './transport':{create:()=>({})}
}).create({});
function clone(v){return JSON.parse(JSON.stringify(v))}
class Store{constructor(){this.data=new Map()}async get(k){return this.data.has(k)?clone(this.data.get(k)):null}async put(k,v){this.data.set(k,clone(v))}}
const now=Date.parse('2026-10-16T01:02:00Z');
const row=(overrides={})=>Object.assign({areaCode:'L1010100',areaName:'서울',warnVar:2,warnStress:0,command:'1',cancel:'0',tmFc:202610161000,tmSeq:1,endTime:0,allEndTime:0},overrides);
async function feedCase(name,publications){
 const store=new Store(),feed=new Feed({storage:store,now:()=>now});const states=[];
 for(const rows of publications){await feed.publish(rows);states.push({head:await store.get('warning-feed/head.json'),items:await feed.read()})}
 return {name,publications,states};
}
async function groups(items){
 const created=[],context={warnings:true,feed:{read:async()=>clone(items)},polling:false,seen:new Set(),activeZones:{},now:()=>now,
 registry:{warningRefs:(ids)=>ids.map(id=>'ref:'+id)},create:async(id,kind,refs,event,at)=>created.push({id,kind,refs,event,at})};
 await Engine.prototype.pollWarnings.call(context);return {created,activeZones:context.activeZones,seen:[...context.seen]};
}
(async()=>{
 const feed=[];
 for(const [name,pubs] of [
  ['silent-baseline',[[row()]]],['duplicate',[[row()],[row()]]],
  ['fresh-issue',[[],[row()]]],['fresh-change',[[],[row({tmSeq:2,warnStress:1,command:'3'})]]],
  ['two-zones',[[],[row(),row({areaCode:'L1010200',areaName:'인천'})]]],
  ['release',[[],[row(),row({command:'2',tmSeq:2})]]],
  ['cancelled',[[],[row({cancel:'1'})]]],['exact-five-minutes',[[],[row({tmFc:202610160957})]]],
  ['within-five-minutes',[[],[row({tmFc:202610160958})]]],['future-one-minute',[[],[row({tmFc:202610161003})]]],
  ['future-two-minutes',[[],[row({tmFc:202610161004})]]],['invalid-short-date',[[],[row({tmFc:123})]]],
  ['stable-order',[[],[row({command:'1',tmSeq:2}),row({command:'2'}),row({command:'1'}),row({command:'1'})]]]
 ])feed.push(await feedCase(name,pubs));
 const messages=[];
 for(const warnVar of [1,2,3,4,5,6,7,8,9,12,13,99])for(const warnStress of [0,1,2])for(const lang of ['ko','en','fr']){
  const e=zones.prepareEvents([row({warnVar,warnStress})])[0],r={lang,zoneIds:['L1010100']};messages.push({event:e,record:r,message:runtime.warning(e,r)});
 }
 const dates=[0,null,'',202610161000,'202610161000','202613010000','000001010000','202602300000','202610162400','123456789012'].map(input=>({input,output:Number.isFinite(publishedAt(input))?publishedAt(input):null}));
 const grouped=[];for(const f of feed){const last=f.states[f.states.length-1];grouped.push({name:f.name,items:last.items,result:await groups(last.items)})}
 const eligible=[];
 const event=zones.prepareEvents([row()])[0];event.zones=['L1010100'];const active={};zones.applyEvents(active,[event]);
 for(const startTime of [0,3600,3601,7200,80000])for(const endTime of [0,3600,3601,7200,80000])for(const category of ['alert','alarm']){
  const record={startTime,endTime,category,zoneIds:['L1010100'],ref:'synthetic'};
  const context={state:{},now:()=>now,activeZones:active};eligible.push({record,event,activeZones:active,result:Engine.prototype.eligible.call(context,{kind:'warning',event},record)});
 }
 let payload;const protocol={Agent:class{destroy(){}},request:(_opts,answer)=>{const req=new EventEmitter();req.destroy=()=>req.emit('close');req.end=body=>{payload=JSON.parse(body);setImmediate(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={};answer(res);res.emit('data',Buffer.from('{"name":"synthetic"}'));res.emit('end')})};return req}};
 const transport=load('server/lib/pushCoordinator/transport.js',{http:protocol,https:protocol}).create();
 const old=Date.now;Date.now=()=>now;
 try{await transport.send({notification:{title:'Heavy rain advisory',text:'Synthetic zone'},record:{cityIndex:0,fcmToken:'synthetic-warning-token'},eventId:'synthetic-event',urgent:true,authorization:{projectId:'synthetic',token:'synthetic'}})}finally{Date.now=old;transport.close()}
 process.stdout.write(JSON.stringify({schema:1,revision,node:process.version,now,sourceHashes,feed,messages,dates,grouped,eligible,payload})+'\n');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
