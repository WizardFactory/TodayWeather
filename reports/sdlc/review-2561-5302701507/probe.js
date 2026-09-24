'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=process.cwd(),h=require(root+'/server/test/offline/harness'),time=require(root+'/server/lib/kmaTimeLib');
const instant='2026-09-24T07:27:00Z';
class Clock extends Date{constructor(...args){super(...(args.length?args:[instant]));}static now(){return new Date(instant).getTime();}}
const policy=h.load('lib/midForecastPolicy.js',{}, {Date:Clock});
const app=fs.readFileSync(root+'/server/app.js','utf8'); // declarations only; never execute app
const rssString=vm.runInNewContext(app.match(/global\.rssString = (\[[^;]+);/)[1]);
const shortString=vm.runInNewContext(app.match(/global\.shortString = (\[[^;]+);/)[1]);
const currentSource=fs.readFileSync(root+'/server/controllers/controllerTown.js','utf8');
const baseSource=cp.execFileSync('git',['show','01eb787b:server/controllers/controllerTown.js'],{encoding:'utf8'});
function run(version, sourceKind, primary='202609161400', variant='full'){
 const pubDate='202609241400',config={db:{version}},logs=[],log=h.logger(logs),noop=function(){};
 let rows=['0600','1500'].map(t=>({ftm:pubDate,date:'20260925'+t,temp:20,tmn:10,tmx:24,sky:1,pty:0,reh:50,pop:0,r06:0,s06:0,ws:1,wd:0}));
 if(variant==='no-match') rows=rows.map(r=>({...r,date:r.date.replace('20260925','20260926')}));
 if(variant==='partial') rows=rows.map(r=>({date:r.date,ftm:r.ftm,ws:1,wd:0}));
 const model={find(){const q={sort(){return q},batchSize(){return q},limit(){return q},lean(){return q},exec(cb){cb(null,version==='1.0'?[{pubDate,shortData:rows}]:rows.map(row=>({pubDate:time.getKoreaDateObj(pubDate),fcsDate:time.getKoreaDateObj(row.date),shortData:row})));}};return q;}};
 const Rss=h.load('controllers/kma/kma.town.short.rss.controller.js',{
  events:require('events'),async:{},request:{},xml2js:{},dnscache:noop,'../../config/config':config,'../../models/modelShortRss':model,'../../models/town':{},'../../models/kma/kma.town.short.rss.model.js':model,'../../lib/kmaTimeLib':time
 },{Date:Clock,log,rssString});
 let source=sourceKind==='base'?baseSource:currentSource;
 if(sourceKind==='gate-only') source=source.replace('midPolicy.freshShort(req.shortPubDate)','midPolicy.freshShort(req.shortRssPubDate)');
 if(sourceKind==='naive-fresh-rss'){
  const start=source.indexOf('    this.mergeMidWithShort  ='),end=source.indexOf('    this.updateMidTempMaxMin',start);
  source=source.slice(0,start)+source.slice(start,end).replaceAll('req.shortPubDate','req.shortRssPubDate')+source.slice(end);
 }
 const deps={};for(const m of source.matchAll(/require\('([^']+)'\)/g))deps[m[1]]=function(){throw new Error('Unexpected dependency '+m[1]);};
 for(const n of ['./kma/kma.town.current.controller.js','./kma/kma.town.short.controller.js','./kma/kma.town.shortest.controller.js','./kma/kma.town.mid.controller.js'])deps[n]=noop;
 Object.assign(deps,{'../config/config':config,'../models/modelShortRss':model,'../lib/kmaTimeLib':time,'../lib/midForecastPolicy':policy,'./kma/kma.town.short.rss.controller.js':Rss});
 const mod={exports:{}};vm.runInNewContext(source,{module:mod,exports:mod.exports,require:n=>{assert(Object.hasOwn(deps,n));return deps[n]},Date:Clock,log,rssString,shortString,commonString:['date','time'],setTimeout(){throw new Error('Unexpected timer')},setInterval(){throw new Error('Unexpected timer')}});
 const town=new mod.exports();town._getCoord=(r,c,t,cb)=>cb(null,{mx:60,my:127});town._getTimeValue=()=>({date:'20260924',time:'1627'});
 const staleValid=variant!=='full';
 const short=['0600','1500'].map(t=>({date:'20260925',time:t,t3h:staleValid?35:-50,tmn:staleValid?30:-50,tmx:staleValid?40:-50,sky:staleValid?1:-1,pty:staleValid?0:-1,reh:staleValid?50:-1,pop:staleValid?0:-1,r06:staleValid?0:-1,s06:staleValid?0:-1,wsd:-1,vec:-1,lgt:-1}));
 const req={params:{},short,midData:{dailyData:[]}};if(primary!=='missing')req.shortPubDate=primary;
 let callbacks=0;town.getShortRss(req,{},()=>callbacks++);assert.equal(callbacks,1);
 const merged=JSON.parse(JSON.stringify(req.short));town.mergeMidWithShort(req,{},()=>callbacks++);assert.equal(callbacks,2);
 assert(!logs.some(l=>/TypeError|ReferenceError|Unexpected dependency/.test(l)),logs.join('\n'));
 return {version,sourceKind,primary,variant,shortRssPubDate:req.shortRssPubDate,afterRss:merged,daily:Array.from(req.midData.dailyData,r=>({date:r.date,taMin:r.taMin,taMax:r.taMax}))};
}
const results=[];
for(const version of ['1.0','2.0']){
 for(const primary of ['202609161400','missing','202609241400'])for(const kind of ['base','head']){
  const r=run(version,kind,primary);assert.deepEqual(r.daily.map(d=>d.date),kind==='head'&&primary!=='202609241400'?[]:['20260925']);results.push(r);
 }
 for(const primary of ['202609161400','missing']) { const r=run(version,'gate-only',primary);assert.equal(r.daily.length,0);results.push(r); }
 for(const variant of ['partial','no-match']){
  const r=run(version,'naive-fresh-rss','202609161400',variant);assert.equal(r.daily[0].taMax,40);results.push(r);
 }
}
console.log(JSON.stringify({head:'95fe711eee09f021c266303195badb1d4c612ad5',fixedClock:instant,assertions:'All 20 scenario expectations confirmed; head rejects fresh RSS with stale/missing primary; naive switch accepts untouched stale data.',results},null,2));
