import {hourlyModel,dailyModel} from './chart-model.js';
import * as fixture from './fixtures.js';
const escaped=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=(v,suffix='')=>v===null||v===undefined?'—':`${Number.isInteger(v)?v:v.toFixed(1)}${suffix}`;
const icons={clear:'☀',cloudy:'☁',rain:'☂'};
const words={ko:{today:'오늘',yesterday:'어제',past:'지난 날',temp:'기온',old:'전일',rain:'강수',wind:'바람',humidity:'습도',am:'오전',pm:'오후',table:'표로 보기',expand:'바람·습도 펼치기',keys:'← → / Home / End로 날짜와 시각을 이동하세요',observation:'현재 관측',missing:'자료 없음',clear:'맑음',cloudy:'흐림',rainCondition:'비',stale:'마지막 예보 · 10월 1일 06:00 발표',loading:'예보를 불러오는 중',empty:'표시할 예보가 없습니다',error:'예보를 불러오지 못했습니다'},de:{today:'Heute',yesterday:'Gestern',past:'Vergangen',temp:'Temperatur',old:'Vortag',rain:'Niederschlag',wind:'Wind',humidity:'Feuchtigkeit',am:'Vormittag',pm:'Nachmittag',table:'Als Tabelle anzeigen',expand:'Wind und Feuchtigkeit erweitern',keys:'Mit ← → / Pos1 / Ende Uhrzeit und Datum auswählen',observation:'Aktuelle Beobachtung',missing:'Keine Daten',clear:'Sonnig',cloudy:'Bewölkt',rainCondition:'Regen',stale:'Letzte Vorhersage · 1. Oktober 06:00',loading:'Vorhersage wird geladen',empty:'Keine Vorhersage verfügbar',error:'Vorhersage konnte nicht geladen werden'}};
export const chartModels={hourly:hourlyModel(fixture.hourly,fixture.yesterday,fixture.observation),daily:dailyModel(fixture.daily,fixture.today,fixture.observation.temperature)};
const cursor={hourly:0,daily:0},expanded={hourly:false};
const measure=(name)=>{const v=getComputedStyle(document.documentElement).getPropertyValue('--tw-'+name);return parseFloat(v)*(v.trim().endsWith('rem')?parseFloat(getComputedStyle(document.documentElement).fontSize):1);};
export function renderCharts({lang='ko',scale=1,state='ready',models=chartModels}={}) {
 const w=words[lang];const locale=lang==='ko'?'ko-KR':'de-DE';
 const date=t=>new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',timeZone:'Asia/Seoul'}).format(new Date(t));
 const hour=t=>new Intl.DateTimeFormat(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Seoul'}).format(new Date(t));
 const condition=k=>k==='rain'?w.rainCondition:w[k]??w.missing;
 const icon=k=>`<span class="chart-icon" aria-hidden="true">${icons[k]??'?'}</span>`;
 document.querySelector('#hourly-legend').innerHTML=`<span><i class="swatch" aria-hidden="true"></i>${w.today}</span>${models.hourly.rows.some(r=>r.yesterday!==null)?`<span><i class="swatch yesterday" aria-hidden="true"></i>${w.yesterday}</span>`:''}`;
 const root=parseFloat(getComputedStyle(document.documentElement).fontSize);const font=Math.max(root*.8125,measure('type-chart-value-size')*scale);
 const col=Math.max(measure('chart-column')*scale,font*3.6),plotHeight=measure('chart-height')*scale+font*3;
 for(const kind of ['hourly','daily']) {
  const host=document.querySelector(`#${kind}-content`);const model=models[kind];
  if(!model.rows.length&&state!=='loading'&&state!=='error'){host.innerHTML=`<p role="status">${w.empty}</p>`;continue;}
  cursor[kind]=Math.min(cursor[kind],model.rows.length-1);
  if(['loading','empty','error'].includes(state)) {host.innerHTML=`<p role="status">${w[state]}</p>${state==='loading'?'<div class="skeleton" aria-hidden="true"></div>':''}`;continue;}
  const focused=host.querySelector('.chart-scroll')===document.activeElement;
  const oldScroll=host.querySelector('.chart-scroll')?.scrollLeft;const n=model.rows.length;
  const intervals=kind==='hourly'?model.rows.slice(1).map((r,i)=>r.epoch-model.rows[i].epoch):[];
  const step=kind==='hourly'&&intervals.length?Math.min(...intervals):1;
  const units=kind==='hourly'?(model.rows.at(-1).epoch-model.rows[0].epoch)/step+1:n;
  const width=Math.max(col*units,host.clientWidth),column=width/units;
  const x=i=>kind==='hourly'?column/2+(model.rows[i].epoch-model.rows[0].epoch)/step*column:width/n*(i+.5);
  const xTime=epoch=>column/2+(epoch-model.rows[0].epoch)/step*column;
  const y=v=>font*2+(model.domain[1]-v)/(model.domain[1]-model.domain[0])*(plotHeight-font*4);
  const fmt=r=>kind==='hourly'?`${date(r.time)} ${hour(r.time)}`:new Intl.DateTimeFormat(locale,{weekday:'short',day:'numeric',timeZone:'UTC'}).format(new Date(r.date+'T00:00:00Z'));
  const describe=r=>kind==='hourly'?`${fmt(r)} · ${w.today} ${value(r.temperature,'°')} · ${w.yesterday} ${value(r.yesterday,'°')} · ${condition(r.condition)} · ${w.rain} ${value(r.pop,'%')}, ${value(r.rainMm,' mm')} · ${w.wind} ${value(r.wsd,' m/s')}, ${value(r.vec,'°')} · ${w.humidity} ${value(r.reh,'%')}`:`${fmt(r)} · ${r.past?w.past:r.today?w.today:''} · ${w.am} ${condition(r.am)}, ${w.pm} ${condition(r.pm??r.am)} · ${value(r.low,'°')}–${value(r.high,'°')} · ${w.rain} ${value(r.pop,'%')}, ${value(r.rainMm,' mm')}`;
  const headers=model.rows.map((r,i)=>{
   const sky=kind==='hourly'?icon(r.condition):r.am===r.pm||!r.pm?icon(r.am):`${icon(r.am)} ${icon(r.pm)}`;
   const rain=kind==='hourly'?value(r.pop,'%'):!r.past&&r.pop?value(r.pop,'%'):'—';
   const amount=r.rainMm!==null&&r.rainMm!==undefined?value(r.rainMm,' mm'):'—';
   return `<div class="chart-column ${r.today?'today-column':''}" data-row="${i}" ${kind==='hourly'?`style="position:absolute;left:${x(i)-column/2}px;width:${column}px"`:''}><p class="caption current-label">${r.past?w.past:r.today?w.today:kind==='hourly'?date(r.time):'&nbsp;'}</p><p class="axis">${escaped(kind==='hourly'?hour(r.time):fmt(r))}</p><p>${sky}</p><p class="caption">${kind==='daily'?w.am+' / '+w.pm:condition(r.condition)}</p><p class="caption">${rain}</p><p class="caption">${amount}</p></div>`;
  }).join('');
  let graph=`<line class="grid" x1="0" x2="${width}" y1="${y(model.domain[0])}" y2="${y(model.domain[0])}"/>`;
  if(kind==='hourly') {
   const path=list=>{let started=false;return list.map(r=>{if(r.temperature===null){started=false;return '';}const s=`${started?'L':'M'}${xTime(r.epoch)},${y(r.temperature)}`;started=true;return s;}).join(' ');};
   graph+=`<path class="yesterday-line" d="${path(model.rows.map(r=>({epoch:r.epoch,temperature:r.yesterday})))}"/><path class="today-line" d="${path(model.series)}"/>`;
   for(const [i,r] of model.rows.entries()) {
    if(r.yesterday!==null&&(r.temperature===null||Math.abs(y(r.temperature)-y(r.yesterday))>font*3))graph+=`<circle class="yesterday-point" cx="${x(i)}" cy="${y(r.yesterday)}" r="${font*1.35}"/><text class="yesterday-text" x="${x(i)}" y="${y(r.yesterday)}" dominant-baseline="central" text-anchor="middle">${value(r.yesterday,'°')}</text>`;
    if(r.temperature!==null)graph+=`<circle class="today-point" cx="${x(i)}" cy="${y(r.temperature)}" r="${font*1.35}"/><text class="today-text" x="${x(i)}" y="${y(r.temperature)}" dominant-baseline="central" text-anchor="middle">${value(r.temperature,'°')}</text>`;
   }
   if(model.current)graph+=`<circle class="now" cx="${xTime(model.current.epoch)}" cy="${y(model.current.temperature)}" r="${font*.32}"/>`;
  } else {
   graph+=`<defs><linearGradient id="daily-gradient" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="var(--tw-chart-range-cool)"/><stop offset="1" stop-color="var(--tw-chart-range-warm)"/></linearGradient></defs>`;
   for(const [i,r] of model.rows.entries()) {
    if(r.hasRange)graph+=`<rect class="range ${r.past?'past':''}" x="${x(i)-measure('chart-bar-width')/2}" y="${y(r.high)}" width="${measure('chart-bar-width')}" height="${Math.max(1,y(r.low)-y(r.high))}" rx="3" fill="url(#daily-gradient)"/>`;
    const cls=r.past?'past-label':'';
    graph+=`<text class="${cls}" text-anchor="middle" x="${x(i)}" y="${r.high===null?font*2:y(r.high)-font*.8}">${value(r.high,'°')}</text><text class="${cls}" text-anchor="middle" x="${x(i)}" y="${r.low===null?plotHeight-font:y(r.low)+font*1.5}">${value(r.low,'°')}</text>`;
   }
   if(model.current)graph+=`<circle class="now" cx="${x(model.current.index)}" cy="${y(model.current.temperature)}" r="${font*.32}"/>`;
  }
  const tableHeaders=kind==='hourly'?[w.temp,w.old,w.rain+' %','mm',w.wind+' m/s','°',w.humidity+' %']:[w.am,w.pm,'Min °','Max °',w.rain+' %','mm'];
  const cells=r=>kind==='hourly'?[r.temperature,r.yesterday,r.pop,r.rainMm,r.wsd,r.vec,r.reh]:[condition(r.am),condition(r.pm??r.am),r.low,r.high,r.pop,r.rainMm];
  const table=`<details><summary>${w.table}</summary><div class="table-scroll"><table><caption>${kind==='hourly'?w.temp:'Min / Max'} · ${w.observation} ${fixture.observation.temperature}°</caption><thead><tr><th scope="col">${lang==='ko'?'시각 / 날짜':'Zeit / Datum'}</th>${tableHeaders.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${model.rows.map((r,i)=>`<tr data-model-row="${i}"><th scope="row">${escaped(fmt(r))}</th>${cells(r).map(v=>`<td>${typeof v==='string'?escaped(v):value(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  const wind=kind==='hourly'?`<div class="chart-actions"><button type="button" class="secondary" id="expand-hourly" aria-expanded="${expanded.hourly}" aria-controls="hourly-wind">${w.expand}</button></div><div id="hourly-wind" ${expanded.hourly?'':'hidden'} class="table-scroll"><table><caption>${w.wind} / ${w.humidity}</caption><tbody>${model.rows.map(r=>`<tr><th scope="row">${escaped(fmt(r))}</th><td>${value(r.wsd,' m/s')} · ${value(r.vec,'°')}</td><td>${value(r.reh,'%')}</td></tr>`).join('')}</tbody></table></div>`:'';
  host.innerHTML=`${state==='stale'?`<p class="notice chart-caption" role="status">${w.stale}</p>`:''}<p class="caption chart-caption">${w.observation} ${date(fixture.observation.time)} ${hour(fixture.observation.time)} · ${fixture.observation.temperature}°</p><div class="chart-scroll" role="group" tabindex="0" aria-label="${kind==='hourly'?w.temp:'Min / Max'}. ${w.keys}"><div class="chart-drawing" style="width:${width}px;--column:${col}px;--count:${n};--chart-font:${font}px"><div class="${kind==='hourly'?'hour-headers':'columns'}" style="${kind==='hourly'?'position:relative;min-height:11em;':''}">${headers}</div><svg class="plot" aria-hidden="true" width="${width}" height="${plotHeight}" viewBox="0 0 ${width} ${plotHeight}">${graph}<line class="cursor-marker" x1="${x(cursor[kind])}" x2="${x(cursor[kind])}" y1="0" y2="${plotHeight}"/></svg></div></div><p class="cursor-readout" role="status" aria-live="polite"></p>${wind}${table}`;
  const scroller=host.querySelector('.chart-scroll'),readout=host.querySelector('.cursor-readout');
  const select=(i,scroll=true)=>{cursor[kind]=Math.max(0,Math.min(n-1,i));const k=cursor[kind],line=host.querySelector('.cursor-marker');line.setAttribute('x1',x(k));line.setAttribute('x2',x(k));readout.textContent=describe(model.rows[k]);if(scroll)scroller.scrollLeft=Math.max(0,x(k)-scroller.clientWidth/2);scroller.dataset.cursor=String(k);};
  readout.textContent=describe(model.rows[cursor[kind]]);scroller.dataset.cursor=String(cursor[kind]);
  scroller.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();select(e.key==='Home'?0:e.key==='End'?n-1:cursor[kind]+(e.key==='ArrowLeft'?-1:1));}});
  host.querySelectorAll('[data-row]').forEach(cell=>{cell.addEventListener('click',()=>select(Number(cell.dataset.row)));cell.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&document.activeElement!==scroller)select(Number(cell.dataset.row),false);});});
  if(oldScroll!==undefined)scroller.scrollLeft=oldScroll;
  else scroller.scrollLeft=kind==='daily'?Math.max(0,(model.rows.findIndex(r=>r.today)-2)*width/n):Math.max(0,xTime(model.current?.epoch??model.rows[0].epoch)-col-scroller.clientWidth*.1);
  if(focused)scroller.focus({preventScroll:true});
  if(kind==='hourly')host.querySelector('#expand-hourly').addEventListener('click',e=>{expanded.hourly=!expanded.hourly;e.currentTarget.setAttribute('aria-expanded',String(expanded.hourly));host.querySelector('#hourly-wind').hidden=!expanded.hourly;});
 }
 return {lang,scale,state};
}
