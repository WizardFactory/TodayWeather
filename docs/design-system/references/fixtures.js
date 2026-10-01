// Fixed, normalized Korea (+09:00) reference weather. No provider/network dependency.
const start=Date.parse('2026-09-30T18:00:00+09:00');
const temperatures=[12,10,8,7,11,14,19,null,13,9,7,5,4];
export const hourly=temperatures.map((temperature,i)=>({time:new Date(start+i*10800000).toISOString(),temperature,pop:[0,0,10,20,30,60,80,70,50,20,10,0,0][i],rainMm:i>=5&&i<=8?[.5,3,8,2][i-5]:0,condition:i>=5&&i<=8?'rain':i%3===0?'cloudy':'clear',wsd:2+i%5,vec:(i*45)%360,reh:40+i*3}));
export const yesterday=hourly.map((r,i)=>({...r,time:new Date(Date.parse(r.time)-86400000).toISOString(),temperature:i===7?null:r.temperature===null?null:r.temperature+(i%3===0?7:.4)}));
export const observation={time:'2026-10-01T10:30:00+09:00',temperature:16};
export const today='2026-10-01';
export const daily=Array.from({length:11},(_,i)=>({date:new Date(Date.parse('2026-09-28T00:00:00Z')+i*86400000).toISOString().slice(0,10),low:[8,7,5,7,6,4,2,-3,-2,0,1][i],high:[18,17,16,15,14,12,13,null,9,10,12][i],am:i%3===0?'rain':'cloudy',pm:i%2===0?'clear':i%3===0?'rain':'cloudy',pop:[0,0,10,60,50,20,0,30,20,0,0][i],rainMm:i===3?3:0}));
