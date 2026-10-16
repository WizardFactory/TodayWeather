# S18b-2 conditional-alert oracle

Synthetic test data only. No real device token, user, location, service account, provider or database was accessed.

- Legacy revision: `9fed989e806408f3502867c01e111caca1188326`. All 98 loaded legacy source hashes are embedded in `source.files`.
- Runtime: Node.js v16.20.2, TZ=UTC, NODE_ENV=production; async 2.6.2, i18n 0.8.3, sprintf 0.1.5, Mongoose 5.1.2.
- Real source: `server/controllers/alert.push.controller.js` `_parseWeatherAirData`, `_compareWithLastInfo`, `_updateAlertPush`, `_convertToNotification`, `_makeRequestUrl`.
- Fixture: `alerts-oracle.json.gz`, SHA256 `1d7bdd7d29fc98cd63030d0730e63ff2dfd02f59ded1630cd0a3150b506f9a28`.
- Cases: 133 parse/compare/update/message cases and 6 URL cases. Every successful result is compared as ordered JSON bytes; thrown paths are checked as no-message failures, not as exact exception strings.
- Recording twice produced identical JSON bytes. Compression uses gzip mtime=0.

Reuse the offline loader and pinned package environment documented in [S18b-1 provenance](PROVENANCE.md#driver-source). Run this driver with `TW_REPO` pointing at the checkout, `TW_REVISION` set to the revision above, `NODE_PATH` pointing at those pinned packages, TZ=UTC and NODE_ENV=production. The loader stubs every network module and push store. Its fixed clock is 2026-10-16T00:07Z; case minutes select the parser branch independently. Pure parser cases intentionally call the parser before URL defaulting (including one missing-locale exception); runtime fetches default locale/units first.

## Driver

```js
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
```

## Supplemental S18B2-R1 malformed forecast rows

`alerts-malformed.json.gz` (SHA256 `456fa76275e70529d475ad6f2428af0d3e575e84b4fc6041f31bb2047e41807a`) preserves 11 additional actual-controller cases independently of the unchanged original 133-case fixture. Four null-row cases throw before a first match or fallback and `_sendAlertPush` submits zero notifications. The others cover first-match short-circuiting before trailing nulls, skipped fallback arrays and primitive rows that legally have no dateObj.

Recorded twice with the same Node v16.20.2/UTC environment and loader; JSON bytes are identical. Legacy source revision `8fdd765f0810ca2cc19cba5a9541ee06bb45a630` and all 98 loaded hashes are embedded. `_getWeatherData`, `_updateDb` and `_sendNotification` are synthetic recording callbacks, so the real `_sendAlertPush` orchestration executes without any network, store, OAuth or device submission. The first Rust regression failed both parser parity and worker submission count; no original oracle output was changed.

```js
'use strict';
// Supplemental R1 oracle: actual parser and actual _sendAlertPush, synthetic weather/store/send.
const L=require('./legacy2'),fs=require('fs');
if(process.version!=='v16.20.2'||process.env.TZ!=='UTC')throw Error('pinned Node16 UTC required');
const Alert=L.load('controllers/alert.push.controller.js');
global.manager={leadingZeros:(v,n)=>String(v).padStart(n,'0')};
const clone=v=>JSON.parse(JSON.stringify(v));
const at='2026-10-16T00:07:00.000Z';L.clock.now=L.RealDate.parse(at);
const record={type:'ios',fcmToken:'synthetic-malformed-alert',cityIndex:1,id:2,enable:true,reverseTime:false,startTime:0,endTime:86399,source:'KMA',lang:'en',name:'Synthetic town',geo:[127,37],airAlertsBreakPoint:3,precipAlerts:{lastState:0},airAlerts:{lastGrade:1}};
const body=(extra={})=>Object.assign({source:'KMA',name:'Response town',current:{pty:0,rns:false,dateObj:'2026.10.16 09:00'}},extra);
const wet={dateObj:'2026.10.16 13:00',pty:1};
const next={dateObj:'2026.10.16 10:00',pty:1};
const cases=[
 ['null-shortest-before-fallback',body({shortest:[null],short:[wet]})],
 ['null-shortest-before-match',body({shortest:[null,next,{dateObj:'2026.10.16 11:00',pty:1}]})],
 ['null-short-before-match',body({short:[null,wet]})],
 ['null-hourly-before-match',body({hourly:[null,wet]})],
 ['shortest-match-before-null',body({shortest:[next,null],short:[wet]})],
 ['short-match-before-null',body({short:[wet,null]})],
 ['hourly-match-before-null',body({hourly:[wet,null]})],
 ['shortest-match-skips-null-short',body({shortest:[next,{dateObj:'2026.10.16 11:00',pty:1}],short:[null]})],
 ['primitive-shortest-before-match',body({shortest:[42,next,{dateObj:'2026.10.16 11:00',pty:1}]})],
 ['primitive-short-before-match',body({short:[42,wet]})],
 ['primitive-hourly-before-match',body({hourly:[42,wet]})],
];
(async()=>{
 const out={schema:1,at,node:process.version,tz:process.env.TZ,cases:[]};
 for(const[id,input]of cases){
  const co=new Alert();co.time=7*60;let result;
  try {const info=co._parseWeatherAirData(clone(record),clone(input));result={info,send:co._compareWithLastInfo(clone(record),info)};}catch(e){result={error:e.message};}
  const notifications=[];
  co._getWeatherData=(_,cb)=>cb(null,clone(input));co._updateDb=(_,cb)=>cb(null,{ok:1});co._sendNotification=(_,notification,cb)=>{notifications.push(notification);cb(null);};
  await new Promise(resolve=>co._sendAlertPush(clone(record),resolve));
  out.cases.push({id,record,body:input,result,notifications});
 }
 out.source={revision:process.env.TW_REVISION,files:Object.fromEntries(Object.entries(L.sourceFiles).sort())};
 fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1)+'\n');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
```

## Supplemental S18B2-R2 air filter traversal

`alerts-air-filter.json.gz` (SHA256 `9cd6aa298c339a935260236947c7173b2cfbe51e4015aa5af398025e465a3b63`) records 12 additional actual-parser and `_sendAlertPush` cases. The original 133 and R1's 11 cases stay byte-identical. Filter traverses every row before find, so five malformed cases return a property-access error and submit nothing, including a null after the first matched air hour while precipitation would otherwise send. Seven positive cases cover ordinary/duplicate matches, empty/primitive/past/missing-date rows and the earlier-minute/high-current-grade branch skips.

Recorded twice with pinned Node v16.20.2, TZ=UTC and the established offline loader; JSON bytes are identical. All 98 loaded hashes equal the original oracle source map. Recorded checkout revision `cc607cda6a1e171c3eaae0458d044f8e1c11bcba`. The same synthetic weather/store/send callbacks as R1 execute actual `_sendAlertPush` without any network or real submission. Both Rust parser and worker regressions failed before correction (one local submission versus zero in legacy). No existing oracle was rewritten.

```js
'use strict';
// Supplemental R2 oracle: actual parser and actual _sendAlertPush, synthetic weather/store/send.
const L=require('./legacy2'),fs=require('fs');
if(process.version!=='v16.20.2'||process.env.TZ!=='UTC')throw Error('pinned Node16 UTC required');
const Alert=L.load('controllers/alert.push.controller.js');
global.manager={leadingZeros:(v,n)=>String(v).padStart(n,'0')};
const clone=v=>JSON.parse(JSON.stringify(v));
const at='2026-10-16T00:35:00.000Z';L.clock.now=L.RealDate.parse(at);
const record={type:'ios',fcmToken:'synthetic-malformed-alert',cityIndex:1,id:2,enable:true,reverseTime:false,startTime:0,endTime:86399,source:'KMA',lang:'en',name:'Synthetic town',geo:[127,37],airAlertsBreakPoint:3,precipAlerts:{lastState:0},airAlerts:{lastGrade:1}};
const body=(extra={})=>Object.assign({source:'KMA',name:'Response town',current:{pty:1,rns:true,dateObj:'2026.10.16 09:00'}},extra);
const wet={dateObj:'2026.10.16 13:00',pty:1};
const next={dateObj:'2026.10.16 10:00',pty:1};
const matched={date:'2026-10-16 10:00',grade:4};
const past={date:'2026-10-16 08:00',grade:1};
const later={date:'2026-10-16 11:00',grade:2};
const air=rows=>body({airInfo:{last:{},pollutants:{pm10:{hourly:rows}}}});
const cases=[
 ['air-match-before-null',air([matched,null])],
 ['air-null-before-match',air([null,matched])],
 ['air-past-match-null',air([past,matched,null])],
 ['air-unmatched-before-null',air([later,null])],
 ['air-valid-match-and-later',air([past,matched,later])],
 ['air-duplicate-matches',air([matched,{date:'2026-10-16 10:00',grade:2}])],
 ['air-empty-hourly',air([])],
 ['air-primitive-and-past',air([42,past])],
 ['air-earlier-minute-skips-filter',air([matched,null]),17],
 ['air-high-current-grade-skips-filter',body({airInfo:{last:{pm10Grade:3,pm10Value:80,pm10Str:'Bad',dataTime:'2026-10-16 09:00'},pollutants:{pm10:{hourly:[matched,null]}}}})],
 ['air-match-before-missing-date',air([matched,{}])],
 ['air-next-pollutant-null',body({airInfo:{last:{},pollutants:{pm10:{hourly:[matched]},pm25:{hourly:[matched,null]}}}})],
];
(async()=>{
 const out={schema:1,at,node:process.version,tz:process.env.TZ,cases:[]};
 for(const[id,input,minute=35]of cases){
  const co=new Alert();co.time=minute*60;let result;
  try {const info=co._parseWeatherAirData(clone(record),clone(input));result={info,send:co._compareWithLastInfo(clone(record),info)};}catch(e){result={error:e.message};}
  const notifications=[];
  co._getWeatherData=(_,cb)=>cb(null,clone(input));co._updateDb=(_,cb)=>cb(null,{ok:1});co._sendNotification=(_,notification,cb)=>{notifications.push(notification);cb(null);};
  await new Promise(resolve=>co._sendAlertPush(clone(record),resolve));
  out.cases.push({id,minute,record,body:input,result,notifications});
 }
 out.source={revision:process.env.TW_REVISION,files:Object.fromEntries(Object.entries(L.sourceFiles).sort())};
 fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1)+'\n');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
```
