import {normalizeWeather,DEFAULT_UNITS,PLACES} from '../../../packages/weather-core/src/index.ts';
import {readJson,directApi} from '../../../web/src/direct-api.ts';
const root='https://todayweather.wizardfactory.net';
const units=new URLSearchParams({...DEFAULT_UNITS,airForecastSource:'kaq'}).toString();
const receipts:any={at:new Date().toISOString(),head:'84bb1af88eefa5e152da61142d9999443c0d1bfe',writes:false};
async function read(path:string){const r=await fetch(root+path,{signal:AbortSignal.timeout(20000),headers:{Origin:'https://app.tdywx.xyz',Accept:'application/json','Accept-Language':'ko'}});const meta={status:r.status,type:r.headers.get('content-type'),cors:r.headers.get('access-control-allow-origin')};if(!meta.type?.includes('json')){const text=await r.text();let safe='';try{await readJson(new Response(text,{status:r.status,headers:{'Content-Type':meta.type??''}}));}catch(e){safe=(e as Error).message;}return {meta,safeMessage:safe,bodySuppressed:true};}return{meta,data:await r.json()};}
const [weather,geo,nation,...world]=await Promise.all([read('/weather/v000903/coord/37.567,126.978?'+units),read('/geocode/v000903/coord/37.567,126.978'),read('/v000903/nation/KR?'+units),...['tokyo','london'].map(id=>{const p=PLACES.find(p=>p.id===id)!;return read(`/weather/v000903/coord/${p.lat},${p.lon}?${units}`);})]);
const raw=weather.data;const normalized=normalizeWeather(raw,{units:DEFAULT_UNITS});
receipts.weather={meta:weather.meta,name:raw.name,shortCount:raw.short?.length,shortestCount:raw.shortest?.length,shortTimes:raw.short?.slice(0,8).map((x:any)=>({date:x.date,time:x.time})),shortest:raw.shortest?.map((x:any)=>({date:x.date,time:x.time,t1h:x.t1h,rn1:x.rn1})),normalizedHourly:normalized.hourly.slice(0,8).map(x=>({at:x.at,temperature:x.temperature})),airInfoList:raw.airInfoList??null,arpltn:raw.current?.arpltn??null,summaryAir:raw.current?.summaryAir,normalizedAirCount:normalized.air.length,summaryPreserved:JSON.stringify(normalized).includes(raw.current?.summaryAir??'NO_SUMMARY')};
receipts.geocode={meta:geo.meta,name:geo.data?.name,kmaAddress:geo.data?.kmaAddress,country:geo.data?.country};
receipts.nation={meta:nation.meta,firstAir:nation.data?.air?.[0]};
receipts.world=world.map((v,i)=>({city:['tokyo','london'][i],meta:v.meta,safeMessage:v.safeMessage,bodySuppressed:v.bodySuppressed}));
// Feed captured real geocode response through the client without issuing a second request.
const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(geo.data);
try{receipts.geocode.clientResult=await directApi('/locations/reverse?lat=37.567&lon=126.978',{transport:'direct',mode:'live',apiOrigin:root},new AbortController().signal);}finally{globalThis.fetch=original;}
console.log(JSON.stringify(receipts,null,2));
