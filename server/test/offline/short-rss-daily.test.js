'use strict';
// Synthetic fixtures; real short RSS DB adapters and Town middleware, all I/O stubbed.
const test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),h=require(root+'/server/test/offline/harness'),time=require(root+'/server/lib/kmaTimeLib');
const instant='2026-09-24T07:27:00Z';
class Clock extends Date{constructor(...args){super(...(args.length?args:[instant]));}static now(){return new Date(instant).getTime();}}
const policy=h.load('lib/midForecastPolicy.js',{}, {Date:Clock});
const app=fs.readFileSync(root+'/server/app.js','utf8'); // declarations only; never execute app
const rssString=vm.runInNewContext(app.match(/global\.rssString = (\[[^;]+);/)[1]);
const shortString=vm.runInNewContext(app.match(/global\.shortString = (\[[^;]+);/)[1]);
const currentSource=fs.readFileSync(root+'/server/controllers/controllerTown.js','utf8');

function run(version, primary='202609161400', variant='full', pubDate='202609241400', targetDate='20260925'){
 const sourceKind='head',config={db:{version}},logs=[],log=h.logger(logs),noop=function(){};
 let rows=['0600','1500'].map(t=>({ftm:pubDate,date:targetDate+t,temp:20,tmn:10,tmx:24,sky:1,pty:0,reh:50,pop:0,r06:0,s06:0,ws:1,wd:0}));
 if(variant==='no-match') rows=rows.map(r=>({...r,date:r.date.replace('20260925','20260926')}));
 if(variant==='partial') rows=rows.map(r=>({date:r.date,ftm:r.ftm,ws:1,wd:0}));
 const model={find(){const q={sort(){return q},batchSize(){return q},limit(){return q},lean(){return q},exec(cb){cb(null,version==='1.0'?[{pubDate,shortData:rows}]:rows.map(row=>({pubDate:time.getKoreaDateObj(pubDate),fcsDate:time.getKoreaDateObj(row.date),shortData:row})));}};return q;}};
 const Rss=h.load('controllers/kma/kma.town.short.rss.controller.js',{
  events:require('events'),async:{},request:{},xml2js:{},dnscache:noop,'../../config/config':config,'../../models/modelShortRss':model,'../../models/town':{},'../../models/kma/kma.town.short.rss.model.js':model,'../../lib/kmaTimeLib':time
 },{Date:Clock,log,rssString});
 const source=currentSource;
 const deps={};for(const m of source.matchAll(/require\('([^']+)'\)/g))deps[m[1]]=function(){throw new Error('Unexpected dependency '+m[1]);};
 for(const n of ['./kma/kma.town.current.controller.js','./kma/kma.town.short.controller.js','./kma/kma.town.shortest.controller.js','./kma/kma.town.mid.controller.js'])deps[n]=noop;
 Object.assign(deps,{'../config/config':config,'../models/modelShortRss':model,'../lib/kmaTimeLib':time,'../lib/midForecastPolicy':policy,'./kma/kma.town.short.rss.controller.js':Rss});
 const mod={exports:{}};vm.runInNewContext(source,{module:mod,exports:mod.exports,require:n=>{assert(Object.hasOwn(deps,n));return deps[n]},Date:Clock,log,rssString,shortString,commonString:['date','time'],setTimeout(){throw new Error('Unexpected timer')},setInterval(){throw new Error('Unexpected timer')}});
 const town=new mod.exports();town._getCoord=(r,c,t,cb)=>cb(null,{mx:60,my:127});town._getTimeValue=()=>({date:'20260924',time:'1627'});
 const staleValid=variant!=='empty-base';
 const short=['0600','1500'].map(t=>({date:targetDate,time:t,t3h:staleValid?35:-50,tmn:staleValid&&t==='0600'?30:-50,tmx:staleValid&&t==='1500'?40:-50,sky:staleValid?1:-1,pty:staleValid?0:-1,reh:staleValid?50:-1,pop:staleValid?0:-1,r06:staleValid?0:-1,s06:staleValid?0:-1,wsd:-1,vec:-1,lgt:-1}));
 const req={params:{},short,midData:{dailyData:[]}};if(primary!=='missing')req.shortPubDate=primary;
 let callbacks=0;town.getShortRss(req,{},()=>callbacks++);assert.equal(callbacks,1);
 // Later middleware must not authorize stale values or taint the RSS snapshot.
 if(variant==='mutated') req.short.forEach(r=>{r.tmn=30;r.tmx=40;r.t3h=35;});
 const merged=JSON.parse(JSON.stringify(req.short));town.mergeMidWithShort(req,{},()=>callbacks++);assert.equal(callbacks,2);
 assert(!logs.some(l=>/TypeError|ReferenceError|Unexpected dependency/.test(l)),logs.join('\n'));
 return {version,sourceKind,primary,variant,shortRssPubDate:req.shortRssPubDate,afterRss:merged,daily:JSON.parse(JSON.stringify(req.midData.dailyData))};
}

for(const version of ['1.0','2.0']) {
 for(const primary of ['202609161400','missing','202609241800']) {
  for(const variant of ['full','empty-base','mutated']) test(version+' '+primary+' fresh RSS '+variant,()=>{
   const r=run(version,primary,variant);
   assert.deepEqual(r.daily.map(d=>d.date),['20260925']);
   assert.equal(r.daily[0].taMin,10); assert.equal(r.daily[0].taMax,24);
   assert.equal(r.daily[0].r06,undefined); assert.equal(r.daily[0].s06,undefined);
   assert.equal(r.daily[0].wfAm,'맑음'); assert.equal(r.daily[0].lgtAm,undefined);
  });
  for(const variant of ['partial','no-match']) test(version+' '+primary+' RSS '+variant+' cannot revive base',()=>{
   assert.deepEqual(run(version,primary,variant).daily,[]);
  });
 }
 for(const pub of ['202609231626','202609241628','bad']) test(version+' invalid RSS publication '+pub,()=>{
  assert.deepEqual(run(version,'202609161400','full',pub).daily,[]);
 });
 test(version+' RSS age and target bound use its own publication',()=>{
  assert.equal(run(version,'missing','full','202609231627','20260927').daily.length,1);
  assert.equal(run(version,'missing','full','202609231627','20260928').daily.length,0);
 });
 for(const pub of ['202609241300','202609241400','202609241500']) test(version+' fresh primary precedence '+pub,()=>{
  const r=run(version,'202609241400','full',pub);
  assert.equal(r.daily.length,1); assert.equal(r.daily[0].taMax,pub>'202609241400'?24:40);
 });
}
