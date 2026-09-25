/* Full v000903 KMA coordinate router smoke, with no HTTP socket or production calls.
 * Requires Node >=16.20.2, async 2.5, express 4.13, sprintf 0.1.5 and xml2js 0.4.23.
 * Run: TZ=UTC NODE_PATH=/tmp/issue-2554-response-smoke/node_modules \
 *      TW_REPO=/path/to/checkout node server/test/offline/rss-response-smoke.js
 * Optional TW_SMOKE_OUTPUT_DIR selects artifact directory outside the checkout.
 * UTC is intentional: existing collector calculateTime has unrelated non-UTC behavior.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');
const root = process.env.TW_REPO || process.cwd();
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(),'issue-2554-response-smoke-output');
fs.mkdirSync(outputDir,{recursive:true});
// Preserve Date/undefined values in fixtures on the Node 16 service runtime.
const v8 = require('v8');
const clone = value => v8.deserialize(v8.serialize(value));
const RealDate = Date;
const instant = process.env.TW_SMOKE_NOW || '2026-09-24T00:10:00.000Z'; // 09:10 KST, after 09:00 observation publication.
class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new RealDate(instant).getTime(); } }
const locations = [
  {name:'Seoul',town:{first:'서울특별시',second:'종로구',third:'청운효자동'},mCoord:{mx:60,my:127},gCoord:{lat:37.5665,lon:126.978}},
  {name:'Busan',town:{first:'부산광역시',second:'중구',third:'중앙동'},mCoord:{mx:98,my:76},gCoord:{lat:35.1796,lon:129.0756}},
  {name:'Jeju',town:{first:'제주특별자치도',second:'제주시',third:'일도1동'},mCoord:{mx:53,my:38},gCoord:{lat:33.4996,lon:126.5312}}
];
function ymd(date) {return date.toISOString().slice(0,10).replace(/-/g,'');}
function hhmm(date) {return date.toISOString().slice(11,16).replace(':','');}
function kstDate(str) { return new RealDate(str.slice(0,4)+'-'+str.slice(4,6)+'-'+str.slice(6,8)+'T'+str.slice(8,10)+':'+str.slice(10,12)+':00+09:00'); }
function makeFixture(place, policy) {
  const basePub = policy==='newer' ? '202609240500' : policy==='older' ? '202609240900' : '202609240800';
  const short=[];
  for(let day=-1;day<=3;day++) for(let hour=0;hour<24;hour+=3) {
    const d=new RealDate(Date.UTC(2026,8,24+day,hour));
    short.push({date:ymd(d),time:hhmm(d),pop:20,pty:0,r06:0,s06:0,reh:60,sky:1,t3h:22,tmn:18,tmx:27,uuu:1,vvv:-2,wav:0.8,vec:270,wsd:2});
  }
  const current=[];
  for(let offset=-7*24;offset<=0;offset++) {
    const d=new RealDate(Date.UTC(2026,8,24,9+offset));
    current.push({date:ymd(d),time:hhmm(d),t1h:20,rn1:0,sky:1,uuu:1,vvv:-2,reh:55,pty:0,lgt:0,vec:315,wsd:3});
  }
  const shortest=[1000,1100,1200].map(time=>({date:'20260924',time:String(time),pubDate:'202609240830',t1h:26,pty:0,rn1:0,sky:3,lgt:0,reh:70,vec:90,wsd:4,uuu:0,vvv:0}));
  const rss=[600,900,1200,1500,1800,2100,2400].map(time=>({ftm:'202609240800',date:'20260924'+String(time).padStart(4,'0'),temp:25,tmx:28,tmn:19,sky:1,pty:0,wfKor:0,wfEn:0,pop:30,r12:0,s12:0,ws:1.3,wd:({Seoul:0,Busan:5,Jeju:7})[place.name],wdKor:({Seoul:2,Busan:7,Jeju:4})[place.name],wdEn:({Seoul:2,Busan:7,Jeju:4})[place.name],reh:65,r06:0,s06:0}));
  const land={date:'20260924',time:'0600'},temp={date:'20260924',time:'0600'};
  for(let d=3;d<=10;d++){land['wf'+d]='맑음';land['wf'+d+'Am']='맑음';land['wf'+d+'Pm']='맑음';temp['taMax'+d]=27;temp['taMin'+d]=18;}
  return {place,basePub,short,current,shortest,rss,land,temp,forecast:{date:'20260924',time:'0600',cnt:1,wfsv:'Synthetic clear weather'}};
}
function createHarness(version, fixture, historyOptions = {}) {
  const traces=[],queries=[],logs=[],cache=new Map(),models=new Map();
  let activeMethod;
  const config={history:historyOptions.config,db:{version},apiServer:{url:'https://synthetic.invalid'},ipAddress:'127.0.0.1',port:1};
  const manager={MAX_CURRENT_COUNT:200,leadingZeros:(n,l)=>String(n).padStart(l,'0'),getRegIdByTown:(r,c,cb)=>cb(null,{pointNumber:'109',cityCode:'11B10101'})};
  const logger={};
  for(const level of ['info','silly','debug','verbose','warn','error']) logger[level]=(...args)=>{if(level==='error'||level==='warn')logs.push({method:activeMethod,level,args:args.map(a=>a&&a.stack||a)});};
  const sandbox={console,Buffer,Date:FixedDate,setTimeout(){throw new Error('Unexpected timer');},setInterval(){throw new Error('Unexpected interval');},clearTimeout,setImmediate,log:logger,manager,__:s=>s};
  if (historyOptions.db) { sandbox.setTimeout=setTimeout; sandbox.clearTimeout=clearTimeout; }
  sandbox.global=sandbox;
  const context=vm.createContext(sandbox);
  const managerCode=fs.readFileSync(path.join(root,'server/controllers/controllerManager.js'),'utf8');
  for(const method of ['getWorldTime','leadingZeros']) { const source=managerCode.match(new RegExp('Manager\\.prototype\\.'+method+' = (function[\\s\\S]*?\\n});'))[1]; manager[method]=vm.runInContext('('+source+')',context); }
  // Read the production projection lists without executing app startup/collection.
  const app=fs.readFileSync(path.join(root,'server/app.js'),'utf8');
  for(const match of app.matchAll(/global\.(\w+String)\s*=\s*(\[[\s\S]*?\]);/g)) vm.runInContext(match[0],context);
  function modelData(name) {
    if(name==='town') return locations;
    if(name==='modelKmaStnInfo') return historyOptions.stations || [];
    if(name==='modelAreaNo'||name==='modelHealthDay') return [];
    const isV2=name.startsWith('kma.');
    const map={'modelShort':'short','modelCurrent':'current','modelShortest':'shortest','modelShortRss':'rss','kma.town.short.model':'short','kma.town.current.model':'current','kma.town.shortest.model':'shortest','kma.town.short.rss.model':'rss'};
    if(map[name]) {
      const kind=map[name],dataKey={short:'shortData',current:'currentData',shortest:'shortestData',rss:'shortData'}[kind];
      if(kind==='short' && fixture.missingShort) return [];
      const pub={short:fixture.basePub,current:'202609240900',shortest:'202609240830',rss:fixture.rssPub || '202609240800'}[kind];
      if(isV2) return fixture[kind].map(item=>({mCoord:fixture.place.mCoord,pubDate:kstDate(kind==='short' && fixture.shortPublications && fixture.shortPublications[item.date] || pub),fcsDate:kstDate(kind==='rss'?item.date:item.date+item.time),[dataKey]:item}));
      return [{mCoord:fixture.place.mCoord,pubDate:pub,[dataKey]:fixture[kind],dailySource:kind==='short'?fixture.dailySource:undefined}];
    }
    const midMap={'modelMidForecast':'forecast','modelMidLand':'land','modelMidTemp':'temp','kma.town.mid.forecast.model':'forecast','kma.town.mid.land.model':'land','kma.town.mid.temp.model':'temp'};
    if(midMap[name]) { const row=fixture[midMap[name]]; if(!row)return []; const pub=row.date+row.time; return [{pubDate:isV2?kstDate(pub):pub,data:isV2?row:[row]}]; }
    return [];
  }
  function getModel(name) {
    if(models.has(name))return models.get(name);
    const obj={find:(query,projection,cb)=>{
      queries.push({model:name,query:clone(query)});
      const data=()=>clone(modelData(name));
      const q={sort(){return q;},batchSize(){return q;},limit(){return q;},lean(){return q;},exec(callback){callback(null,data());}};
      if(typeof projection==='function')projection(null,data());
      if(typeof cb==='function')cb(null,data());
      return q;
    }};models.set(name,obj);return obj;
  }
  const optional={
    'kecoController':{getArpLtnInfo:(town,date,cb)=>cb(null,{arpltn:{},list:[],stnList:[]}),getDustFrcst:(town,date,cb)=>cb(null,[])},
    'controllerKmaStnWeather':{getCityHourlyList:(town,cb)=>cb(null,[]),getStnHourlyAndMinRns:(town,date,current,cb)=>{
      const stn={t1h:20,vec:315,wsd:3,stnDateTime:'2026-09-24 08:50',rs1h:0};
      // Optional city weather text, typed exactly as getStnHourlyAndMinRns does before returning (#2576).
      if(fixture.stnWeather){Object.assign(stn,fixture.stnWeather);stn.weatherType=load(path.join(root,'server/controllers/controller.weather.desc.js')).makeWeatherType(stn.weather);}
      cb(null,stn);
    }},
    'kasi.riseset.controller':{getRiseSetList:(geo,dates,cb)=>cb(null,[])},
    'kma.town.mid.rss.controller':{overwriteData:(mid,code,cb)=>cb(null)},
    'kma.forecast.zone.controller':function(){this.findForecastZoneByName=()=>({exec:cb=>cb(null,[{regId:'11B10101'}])});},
    'geo.controller':function(){this._isKoreaArea=(lat,lon)=>lat>=33&&lat<=39&&lon>=124&&lon<=132;},
    'airkorea.hourly.forecast.controller':function(){this.getForecast=(stn,cb)=>cb(null,[]);},
    'kaq.hourly.forecast.controller':function(){this.getForecast=(stn,cb)=>cb(null,[]);},
    'kma.specialweather.controller':function(){this.getSpecialInfo=(town,stn,cb)=>cb(null,[]);}
  };
  function load(filename) {
    if(cache.has(filename))return cache.get(filename).exports;
    const mod={exports:{}};cache.set(filename,mod);
    function localRequire(id) {
      if(id==='mongoose' && historyOptions.db) return {connection:{db:historyOptions.db}};
      if(id==='dnscache')return ()=>({});
      if(id==='request')return (url,opts,cb)=>{
        assert(url.startsWith('https://synthetic.invalid/geocode/coord/'));
        cb(null,{statusCode:200},{kmaAddress:{name1:fixture.place.town.first,name2:fixture.place.town.second,name3:fixture.place.town.third}});
      };
      if(!id.startsWith('.'))return require(id);
      const resolved=path.resolve(path.dirname(filename),id)+(path.extname(id)==='.js'?'':'.js');
      if(resolved.endsWith('/config/config.js'))return config;
      const name=path.basename(resolved,'.js');
      if(resolved.includes('/models/'))return getModel(name);
      if(Object.hasOwn(optional,name)) { if(['controllerKmaStnWeather','kecoController'].includes(name)) return Object.assign(load(resolved),optional[name]); return optional[name]; }
      if(name==='kecoRequester') return function(){};
      if(name==='convertGeocode')return ()=>{throw new Error('Unexpected geocode fallback');};
      return load(resolved);
    }
    const code=fs.readFileSync(filename,'utf8');
    vm.runInContext('(function(require,module,exports,__filename,__dirname){'+code+'\n})',context,{filename})(localRequire,mod,mod.exports,filename,path.dirname(filename));
    return mod.exports;
  }
  // Exercise real XML parsing and collector conversion before presenting rows at the Mongo boundary.
  const direction={Seoul:['북','N',2],Busan:['남서','SW',7],Jeju:['북서','NW',4]}[fixture.place.name];
  const xmlRows=fixture.rss.map(row=>{
    const values=Object.assign({},row,{hour:Number(row.date.slice(8,10)),day:Math.round((kstDate(row.date.slice(0,8)+'0000')-kstDate((fixture.rssPub || '202609240800').slice(0,8)+'0000'))/86400000),wfKor:'맑음',wfEn:'Clear',wdKor:direction[0],wdEn:direction[1]});
    delete values.date;delete values.ftm;
    return '<data>'+Object.entries(values).map(([key,value])=>'<'+key+'>'+value+'</'+key+'>').join('')+'</data>';
  }).join('');
  const xml='<wid><header><tm>'+(fixture.rssPub || '202609240800')+'</tm><x>'+fixture.place.mCoord.mx+'</x><y>'+fixture.place.mCoord.my+'</y></header><body>'+xmlRows+'</body></wid>';
  const Rss=load(path.join(root,'server/controllers/kma/kma.town.short.rss.controller.js'));
  let parsed=false;
  require('xml2js').parseString(xml,(error,upstream)=>{
    assert.ifError(error);
    new Rss().parseShortRss(0,upstream,(code,converted)=>{
      assert.equal(code,0);assert.equal(converted.shortData.length,fixture.rss.length);
      for(const row of converted.shortData) {assert.equal(row.wdEn,direction[2]);assert.equal(row.wfEn,1);}
      fixture.rss=converted.shortData;parsed=true;
    });
  });
  assert(parsed,'Synchronous xml2js collector fixture completed');
  const routeFile=path.join(root,'server/routes/v000903/route.kma.v000903.js');
  const router=load(routeFile);
  const methods=['coord2addr',...fs.readFileSync(routeFile,'utf8').match(/var routerList = \[([\s\S]*?)\];/)[1].match(/cTown\.(\w+)/g).map(s=>s.slice(6))];
  const route=router.stack.find(l=>l.route&&l.route.path==='/coord/:loc').route;
  route.stack.forEach((layer,i)=>{const fn=layer.handle;layer.handle=(req,res,next)=>{activeMethod=methods[i];traces.push(activeMethod);fn(req,res,next);};});
  function request(query) { return new Promise((resolve,reject)=>{
    const url='/coord/'+fixture.place.gCoord.lat+','+fixture.place.gCoord.lon;
    const req={method:'GET',url,originalUrl:'/v000903/kma'+url,baseUrl:'/v000903/kma',headers:{},query,sessionID:'synthetic-smoke'};
    const res={__:s=>s,status(code){this.statusCode=code;return this;},send(body){reject(new Error('Unexpected response '+this.statusCode+': '+body));},json(body){resolve({body:JSON.parse(JSON.stringify(body)),traces,queries,logs});},redirect(url){reject(new Error('Unexpected redirect '+url));},setHeader(){}};
    router.handle(req,res,err=>reject(err||new Error('No JSON response')));
  }); }
  return {request,methods};
}
async function main(){
  assert.equal(new RealDate(instant).getTimezoneOffset(),0,'RSS collector full-path smoke requires TZ=UTC; non-UTC calculateTime behavior is a pre-existing limitation');
  const output=[];
  for(const version of ['1.0','2.0']) for(const place of locations) for(const policy of (process.env.SMOKE_POLICIES||'newer,equal,older').split(',')) for(const units of ['si','fahrenheit_kmh']) {
    const fixture=makeFixture(place,policy);
    const harness=createHarness(version,fixture);
    const result=await harness.request(units==='si'?{windSpeedUnit:'m/s',temperatureUnit:'C'}:{windSpeedUnit:'km/h',temperatureUnit:'F'});
    const body=result.body;
    fs.writeFileSync(path.join(outputDir,'latest-response.json'),JSON.stringify(result,null,2));
    assert.deepEqual(result.traces,harness.methods,'All actual v000903 coordinate middleware execute');
    const rssQuery=result.queries.find(q=>q.model===(version==='1.0'?'modelShortRss':'kma.town.short.rss.model'));
    assert(rssQuery,'RSS storage query executed');
    assert.deepEqual(rssQuery.query,{'mCoord.mx':place.mCoord.mx,'mCoord.my':place.mCoord.my},'Coordinate route selects the intended RSS grid');
    assert.equal(body.source,'KMA');assert.equal(body.units.windSpeedUnit,units==='si'?'m/s':'km/h');
    assert.deepEqual(body.location,{lat:Number(place.gCoord.lat.toFixed(3)),long:Number(place.gCoord.lon.toFixed(3))});
    assert.equal(body.shortPubDate,fixture.basePub);
    assert.equal(body.shortRssPubDate,policy==='older'?undefined:'202609240800');
    const future=body.short.find(s=>s.date==='20260924'&&s.time===15);
    assert(future,'15:00 forecast present');
    const expectedSpeed=policy==='newer'?1.3:2;
    assert.equal(future.wsd,units==='si'?expectedSpeed:Math.round(expectedSpeed*3.6*10)/10,`${version}/${place.name}/${policy}/${units} future wind speed`);
    assert.equal(future.vec,policy==='newer'?({Seoul:0,Busan:225,Jeju:315})[place.name]:270,'Numeric RSS direction maps independently of label codes');
    const midnight=body.short.find(s=>s.date==='20260924'&&s.time===24);
    assert(midnight,'Next-day 00:00 is presented as prior-day 24:00');
    assert.equal(midnight.vec,future.vec,'RSS midnight slot survives date/time normalization');
    assert.equal(midnight.wsd,future.wsd,'RSS midnight wind survives unit conversion');
    assert.equal(future.wav,0.8,'Missing RSS wave preserves base');
    assert.equal(future.uuu,1,'Missing RSS U preserves base');assert.equal(future.vvv,-2,'Missing RSS V preserves base');
    assert.equal(future.t3h,units==='si'?(policy==='newer'?25:22):Math.floor((policy==='newer'?25:22)*1.8+32));
    assert.equal(future.reh,policy==='newer'?65:60);
    assert.equal(body.currentPubDate,'202609240900');assert.equal(body.shortestPubDate,'202609240830');
    assert.equal(body.current.wsd,units==='si'?3:10.8,'Current observation keeps independent wind');
    assert.equal(typeof body.current.time,'number');assert(body.current.yesterday,'Yesterday attached');
    const near=body.short.find(s=>s.date==='20260924'&&s.time===12);
    assert.equal(near.t3h,units==='si'?26:78,'Real downstream shortest forecast overrides RSS temperature');
    assert(body.midData.dailyData.length>=17,'Actual medium forecast and observation composition');
    assert.equal(typeof future.skyIcon,'string','Sky icon formatting');assert.equal(typeof future.wsdStr,'string','Wind description formatting');
    const thrown=result.logs.filter(x=>x.args.some(a=>typeof a==='string'&&/TypeError|ReferenceError|AssertionError/.test(a)));
    assert.deepEqual(thrown,[],'No swallowed programming exceptions');
    output.push({version,location:place.name,grid:place.mCoord,rssGridQuery:rssQuery.query,policy,units,wind:{wsd:future.wsd,vec:future.vec},shortCount:body.short.length,midCount:body.midData.dailyData.length,executedMiddleware:result.traces.length,collectorRows:fixture.rss.length,queryModels:[...new Set(result.queries.map(q=>q.model))],warningSummary:Object.values(result.logs.reduce((groups,item)=>{const key=item.method+'/'+item.level;groups[key]=groups[key]||{method:item.method,level:item.level,count:0,example:String(item.args[0]).split('\n')[0].slice(0,180)};groups[key].count++;return groups;},{}))});
  }
  const candidate={};for(const p of ['server/controllers/controllerTown.js','server/controllers/kma/kma.town.short.rss.controller.js','server/controllers/controllerTown24h.js','server/routes/v000903/route.kma.v000903.js','server/test/offline/rss-wind.test.js','intent/issue-2554.md','specs/issue-2554.md','plans/issue-2554.md','docs/architecture/weather-collection.md','docs/architecture/mobile-api.md'])candidate[p]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
  const report={createdAt:new RealDate().toISOString(),fixedRequestTime:instant,hostTimezone:process.env.TZ||'system',executionContext:process.env.TW_SMOKE_CONTEXT||'local',candidate,scenarioCount:output.length,outcome:'passed',scenarios:output};
  fs.writeFileSync(path.join(outputDir,'evidence.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({outcome:report.outcome,scenarioCount:output.length,evidence:path.join(outputDir,'evidence.json'),candidate},null,2));
}
module.exports = {makeFixture,createHarness,locations};
if (require.main === module) main().catch(err=>{console.error(err.stack);process.exitCode=1;});
