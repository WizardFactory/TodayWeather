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
