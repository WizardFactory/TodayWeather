'use strict';
// Offline actual legacy controller; no provider, OAuth or push calls.
const L=require('./legacy2'),fs=require('fs'),crypto=require('crypto');
if(process.version!=='v16.20.2'||process.env.TZ!=='UTC')throw Error('pinned Node16 UTC required');
const Alert=L.load('controllers/alert.push.controller.js');
global.manager={leadingZeros:(v,n)=>String(v).padStart(n,'0')};
const clone=v=>JSON.parse(JSON.stringify(v));
const at='2026-10-16T00:07:00.000Z';L.clock.now=L.RealDate.parse(at);
const record=(patch={})=>Object.assign({type:'ios',fcmToken:'synthetic-alert',cityIndex:1,id:2,enable:true,reverseTime:false,startTime:0,endTime:86399,source:'KMA',lang:'ko',name:'Synthetic town',geo:[127,37],airAlertsBreakPoint:3,precipAlerts:{lastState:0},airAlerts:{lastGrade:1}},patch);
const body=(patch={})=>Object.assign({source:'KMA',name:'Response town',current:{pty:0,rns:false,dateObj:'2026.10.16 09:00',weather:'맑음'},shortestPubDate:'2026.10.16 08:30',shortest:[{dateObj:'2026.10.16 10:00',pty:0},{dateObj:'2026.10.16 11:00',pty:0}]},patch);
const cases=[];function add(id,r,b,minute=7){cases.push({id,record:r,body:b,minute});}
for(const lang of ['ko','en','ja','zh-CN','zh-TW','de','fr']){
 for(const pty of [0,1,2,3,4])add(`current-${lang}-${pty}`,record({lang}),body({current:{pty,rns:true,dateObj:'2026.10.16 09:01',rnsStnName:'station'}}));
 for(const pty of [1,2,3])add(`forecast-${lang}-${pty}`,record({lang}),body({shortest:[{dateObj:'2026.10.16 10:00',pty},{dateObj:'2026.10.16 11:00',pty}]}));
 for(const name of ['pm10','pm25','o3','no2','co','so2'])add(`air-${lang}-${name}`,record({lang}),body({airInfo:{last:{[name+'Grade']:3,[name+'Value']:27,[name+'Str']:'Bad',dataTime:'2026-10-16 09:00',stationName:'station'}}}));
}
for(const minute of [7,17,35,50]){
 add('clear-'+minute,record(),body(),minute);
 add('shortest-only-one-'+minute,record(),body({shortest:[{dateObj:'2026.10.16 10:00',pty:1},{dateObj:'2026.10.16 11:00',pty:0}]}),minute);
 add('short-fallback-'+minute,record(),body({shortest:[],short:[{dateObj:'2026.10.16 13:00',pty:2}],shortPubDate:'2026.10.16 08:00'}),minute);
 add('air-forecast-discarded-'+minute,record(),body({airInfo:{last:{pm10Grade:1,pm10Value:10,pm10Str:'Good',dataTime:'2026-10-16 09:00',forecastPubDate:'x',forecastSource:'airkorea'},pollutants:{pm10:{hourly:[{date:'2026-10-16 10:00',grade:4,str:'Bad',val:100}]}}}}),minute);
}
for(const extra of [{precipAlerts:{lastState:1}},{precipAlerts:{lastState:0,pushTime:new L.RealDate(L.clock.now-21600000)}},{precipAlerts:{lastState:0,pushTime:new L.RealDate(L.clock.now-21600001)}},{airAlerts:{lastGrade:3}},{airAlertsBreakPoint:2},{name:''},{name:undefined},{lang:undefined}])add('state-'+cases.length,record(extra),body({current:{pty:1,rns:true,dateObj:'2026.10.16 09:00'},airInfo:{last:{pm10Grade:3,pm25Grade:4,pm10Str:'Bad',pm25Str:'Very bad',dataTime:'2026-10-16 09:00'}}}));
for(const source of ['VC','DSF'])for(const stale of [1800000,1800001])add(`overseas-${source}-${stale}`,record({source}),body({source,pubDate:{[source]:new L.RealDate(L.clock.now-stale).toISOString()},thisTime:[{}, {pty:1,dateObj:'2026.10.16 09:00',weather:'rain'}]}));
add('rns-false',record(),body({current:{pty:1,rns:false,dateObj:'2026.10.16 09:00'}}));
add('rns-no-pty',record(),body({current:{rns:true,dateObj:'2026.10.16 09:00'}}));
add('no-air-last',record(),body({airInfo:{}}));
add('tie-air-order',record(),body({airInfo:{last:{pm10Grade:3,pm25Grade:3,o3Grade:3,coGrade:3,no2Grade:3,so2Grade:3,dataTime:'2026-10-16 09:00'}}}));
add('invalid-source',record(),body({source:'OTHER'}));add('missing-current',record(),body({current:undefined}));add('missing-body',record(),undefined);
const co=new Alert();const results=[];
function revive(r){r=clone(r);for(const name of ['precipAlerts','airAlerts'])if(r[name]&&r[name].pushTime)r[name].pushTime=new Date(r[name].pushTime);return r;}
for(const c of cases){co.time=c.minute*60;const r=revive(c.record),b=c.body===undefined?undefined:clone(c.body);let result;
try{const info=co._parseWeatherAirData(r,b);const send=co._compareWithLastInfo(r,info);co._updateAlertPush(r,info,send);let message;try{message=co._convertToNotification(r,info);}catch(e){message={error:e.message};}result={info,send,updated:r,message};}catch(e){result={error:e.message};}
results.push({...c,record:clone(c.record),result});}
const urls=[];for(const r of [record(),record({source:'VC',lang:undefined,units:{temperatureUnit:'F'}}),record({source:'kma',geo:undefined,town:{first:'서울특별시',second:'송파구',third:'잠실본동'}}),record({source:''}),record({source:undefined}),record({source:'OTHER',geo:undefined,town:undefined})]){let result;try{result=co._makeRequestUrl(r);}catch(e){result={error:e.message};}urls.push({record:r,result});}
const out={schema:1,at,node:process.version,tz:process.env.TZ,cases:results,urls,source:{revision:process.env.TW_REVISION,files:Object.fromEntries(Object.entries(L.sourceFiles).sort())}};
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1)+'\n');process.exit(0);
