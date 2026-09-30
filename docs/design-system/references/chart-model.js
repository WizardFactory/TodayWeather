// Normalized reference contract: explicit offset timestamps; Korea yesterday uses 24h.
// Provider sentinel/unit normalization belongs to the production adapter, not this module.
const finite = v => typeof v==='number' && Number.isFinite(v);
const number = v => v===null || v===undefined ? null : finite(v) ? v : (()=>{throw Error('Invalid numeric measurement');})();
const timestamp = time => {
 if(typeof time!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(time)||!Number.isFinite(Date.parse(time)))throw Error(`Invalid time ${time}`);
 return Date.parse(time);
};
const domain = values => {
 const clean=values.filter(finite);if(!clean.length)return [0,1];
 const min=Math.min(...clean),max=Math.max(...clean);return min===max?[min-1,max+1]:[min,max];
};
export function hourlyModel(today,yesterday=[],observation=null,comparisonOffsetMs=86400000) {
 if(!finite(comparisonOffsetMs)||comparisonOffsetMs<=0)throw Error('Invalid comparison offset');
 const normalize=list=>{
  const seen=new Set();return list.map(r=>{const epoch=timestamp(r.time);if(seen.has(epoch))throw Error('Duplicate hourly time');seen.add(epoch);return {...r,epoch,temperature:number(r.temperature),pop:number(r.pop),rainMm:number(r.rainMm),wsd:number(r.wsd),vec:number(r.vec),reh:number(r.reh)};}).sort((a,b)=>a.epoch-b.epoch);
 };
 const old=new Map(normalize(yesterday).map(r=>[r.epoch+comparisonOffsetMs,r.temperature]));
 const rows=normalize(today).map(r=>({...r,yesterday:old.get(r.epoch)??null}));
 let current=null;
 if(observation) {
  const epoch=timestamp(observation.time),temperature=number(observation.temperature);
  if(temperature!==null&&rows.length&&epoch>=rows[0].epoch&&epoch<=rows.at(-1).epoch)current={epoch,time:observation.time,temperature};
 }
 const series=rows.map(r=>({epoch:r.epoch,temperature:r.temperature}));
 if(current) {const at=series.findIndex(r=>r.epoch===current.epoch);if(at>=0)series[at]={...current};else series.push({...current});series.sort((a,b)=>a.epoch-b.epoch);}
 return {rows,series,current,domain:domain([...rows.flatMap(r=>[r.temperature,r.yesterday]),current?.temperature])};
}
function date(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error(`Invalid date ${value}`);
 return value;
}
export function dailyModel(days,today,currentTemperature=null) {
 date(today);const seen=new Set();
 const rows=days.map(r=>{
  date(r.date);if(seen.has(r.date))throw Error('Duplicate daily date');seen.add(r.date);
  const low=number(r.low),high=number(r.high);if(low!==null&&high!==null&&low>high)throw Error('Inverted temperature range');
  return {...r,low,high,pop:number(r.pop),rainMm:number(r.rainMm),past:r.date<today,today:r.date===today,hasRange:low!==null&&high!==null};
 }).sort((a,b)=>a.date.localeCompare(b.date));
 const temperature=number(currentTemperature),index=rows.findIndex(r=>r.today);
 const current=index>=0&&temperature!==null?{index,temperature}:null;
 return {rows,current,domain:domain([...rows.flatMap(r=>[r.low,r.high]),current?.temperature])};
}
