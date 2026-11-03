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
