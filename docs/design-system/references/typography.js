/* Isolated reference fixtures. Spec §3 is authoritative until shared token JSON exists. */
const ROLES = {
  'hero-temp': { sizes: [72, 72, 72], weight: 300, leading: 1 },
  'data-xl': { sizes: [48, 56, 48], weight: 600, leading: 1.05 },
  display: { sizes: [24, 28, 28], weight: 700, leading: 1.25 },
  'title-1': { sizes: [20, 22, 20], weight: 650, leading: 1.3 },
  'title-2': { sizes: [17, 18, 17], weight: 600, leading: 1.35 },
  body: { sizes: [17, 18, 16], weight: 400, leading: 1.55 },
  data: { sizes: [17, 18, 16], weight: 600, leading: 1.2 },
  'chart-axis': { sizes: [16, 17, 15], weight: 500, leading: 1.2 },
  'chart-value': { sizes: [15, 16, 15], weight: 600, leading: 1 },
  'body-sm': { sizes: [15, 16, 14], weight: 400, leading: 1.5 },
  label: { sizes: [15, 16, 14], weight: 600, leading: 1.25 },
  caption: { sizes: [13, 14, 13], weight: 500, leading: 1.35 },
  micro: { sizes: [12, 12, 12], weight: 500, leading: 1.3 },
};
const COPY = {
  ko: { place: '서울 종로구', note: '고정 예시 · 10월 1일 15:00', condition: '구름 조금 · 어제보다 2° 높아요', summary: '오후에는 비가 내릴 수 있어요. 시간별 기온과 어제 기온을 함께 비교해 보세요.', highlow: '최고 27° · 최저 18°', hourly: '시간별 날씨', daily: '일별 날씨', today: '당일 기온', yesterday: '전일 기온', hourlyNote: '음수·두 자리 기온값과 가까운 두 선을 포함한 글자 크기 검증 예시', dailyNote: '아래는 최저, 위는 최고 · 모든 날짜는 같은 온도 축을 사용', range: '최저–최고 기온', wind: '바람·습도 펼치기', windDetails: '↗ 3.5 m/s · 습도 65% · 참조용 예시 값', table: '표로 보기', day: '오늘', weekdays: ['월','화','수','목','금','토','일'], sample: '기온과 강수확률을 한눈에 확인하세요', value: '−12° / 27° / 100%', headersHourly: ['시각','당일','전일','강수확률'], headersDaily: ['요일','최저','최고','강수확률'] },
  de: { place: 'Frankfurt am Main', note: 'Feste Beispieldaten · 1. Oktober, 15:00', condition: 'Leicht bewölkt · 2° wärmer als gestern', summary: 'Am Nachmittag kann es regnen. Vergleichen Sie die stündlichen Temperaturen mit den Werten des Vortages.', highlow: 'Höchsttemperatur 27° · Tiefsttemperatur 18°', hourly: 'Stündliche Wettervorhersage', daily: 'Tägliche Wettervorhersage', today: 'Temperatur heute', yesterday: 'Temperatur gestern', hourlyNote: 'Schriftprüfung mit negativen Temperaturen, zweistelligen Werten und nahen Kurven', dailyNote: 'Unten Minimum, oben Maximum · gemeinsame Temperaturskala für alle Tage', range: 'Tiefst- und Höchsttemperatur', wind: 'Wind und Luftfeuchtigkeit anzeigen', windDetails: '↗ 3,5 m/s · Luftfeuchtigkeit 65% · Beispielwerte', table: 'Als Tabelle anzeigen', day: 'Heute', weekdays: ['Mo','Di','Mi','Do','Fr','Sa','So'], sample: 'Temperatur und Niederschlagswahrscheinlichkeit auf einen Blick', value: '−12° / 27° / 100%', headersHourly: ['Zeit','Heute','Gestern','Regenchance'], headersDaily: ['Tag','Minimum','Maximum','Regenchance'] },
};
const hourly = [18,20,22,24,27,25,21,19,17,15,13,10,5,-9,-12].map((value, i) => ({ value, yesterday: value + (i % 3 === 0 || i > 10 ? 1 : -16), hour: `${(i * 3) % 24}`, rain: i % 4 === 0 ? 100 : 0 }));
const daily = [[-12,-3],[-9,1],[3,12],[18,27],[17,28],[16,24],[15,25]].map(([min,max],i) => ({ min,max,rain: i % 2 ? 30 : 0 }));
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text = '') => { const node = document.createElementNS(NS, tag); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value); node.textContent = text; return node; };
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
for (const id of ['language','scale','appearance','root']) if ([...$(id).options].some(o => o.value === params.get(id))) $(id).value = params.get(id);
if (!params.has('scale')) $('scale').value = '1';
let state;
function tier() {
  if (innerWidth < 768 || (matchMedia('(pointer: coarse)').matches && innerHeight < 540)) return 'mobile';
  if (matchMedia('(pointer: coarse) and (hover: none)').matches) return 'tablet';
  return 'desktop';
}
function sizeRoles() {
  const typeTier = tier(), index = ['mobile','tablet','desktop'].indexOf(typeTier), scale = Number($('scale').value), root = Number($('root').value);
  document.documentElement.style.fontSize = root === 16 ? '' : `${root}px`; // Reference-only browser text preference simulation.
  const heroMax = typeTier === 'tablet' || (typeTier === 'desktop' && innerWidth >= 1600) ? 112 : 96;
  const hero = Math.max(72, Math.min(heroMax, typeTier === 'mobile' ? Math.min(innerWidth * .2, innerHeight * .12) : innerHeight * .14));
  const sizes = {};
  for (const [role,def] of Object.entries(ROLES)) {
    const base = role === 'hero-temp' ? hero : role === 'title-1' && typeTier === 'desktop' && innerWidth >= 1600 ? 22 : def.sizes[index];
    const final = Math.max(role === 'micro' ? 12 : 13, base * scale);
    sizes[role] = final * root / 16;
    document.documentElement.style.setProperty(`--size-${role}`, `${final / 16}rem`);
  }
  state = { tier: typeTier, scale, root, sizes, heroBaseline: hero };
  document.documentElement.dataset.tier = typeTier;
  $('measurement').textContent = `${typeTier} · ${innerWidth}×${innerHeight} · body ${sizes.body.toFixed(1)} px · chart ${sizes['chart-axis'].toFixed(1)} / ${sizes['chart-value'].toFixed(1)} px`;
}
function text(svg, x, y, value, role, extra = {}) { const node = el('text',{x,y,'data-role':role,'data-chart-label':'true','dominant-baseline':'middle',...extra},value); svg.append(node); return node; }
function icon(svg,x,y,size) { const group = el('g',{transform:`translate(${x-size/2} ${y-size/2}) scale(${size/32})`,'aria-hidden':'true'}); group.append(el('circle',{cx:14,cy:12,r:7,fill:'#f0c77f'}),el('path',{d:'M9 27a6 6 0 0 1 0-12 9 9 0 0 1 17 0 6 6 0 0 1 0 12Z',fill:'#9bcdf0'})); svg.append(group); }
function chartBase(svg, count, id, copy) {
  svg.replaceChildren(el('title',{id:`${id}-svg-title`},copy));
  const unit = state.root / 16 * Math.max(1,state.scale);
  const col = (state.tier === 'mobile' ? Math.max(52,Math.min(64,innerWidth/7)) : state.tier === 'tablet' ? 72 : 64) * unit;
  const width = Math.max(col * count, svg.parentElement.clientWidth);
  const height = (state.tier === 'tablet' ? 390 : 350) * unit;
  svg.setAttribute('width',width); svg.setAttribute('height',height);
  const column = width/count, top = 138*unit, bottom = height-40*unit;
  for (let i=0;i<count;i++) svg.append(el('line',{x1:(i+.5)*column,x2:(i+.5)*column,y1:20*unit,y2:height-15*unit,stroke:'var(--line)'}));
  return {unit,column,width,height,top,bottom};
}
function renderHourly(copy) {
  const svg = $('hourly-chart'), g = chartBase(svg,hourly.length,'hourly',copy.hourly);
  const y = value => g.bottom - (value+20)/52*(g.bottom-g.top);
  for (const [name,key,color] of [['yesterday','yesterday','var(--yesterday)'],['today','value','var(--today)']]) {
    svg.append(el('polyline',{points:hourly.map((p,i)=>`${(i+.5)*g.column},${y(p[key])}`).join(' '),fill:'none',stroke:color,'stroke-width':name==='today'?2.5:1.5,'stroke-dasharray':name==='yesterday'?'4 4':'none'}));
  }
  const radius = state.sizes['chart-value'] * 1.25;
  hourly.forEach((p,i)=>{
    const x=(i+.5)*g.column;
    if (i===0 || i===8) text(svg,x,16*g.unit,i===0?copy.day:(document.documentElement.lang==='ko'?'내일':'Morgen'),'caption');
    text(svg,x,44*g.unit,document.documentElement.lang==='ko'?`${p.hour}시`:`${p.hour}:00`,'chart-axis');
    icon(svg,x,77*g.unit,28*g.unit);
    text(svg,x,109*g.unit,`${p.rain}%`,'caption',{class:p.rain?'amount':''});
    const close = Math.abs(y(p.value)-y(p.yesterday)) < radius*2+3*g.unit;
    svg.append(el('circle',{cx:x,cy:y(p.yesterday),r:close?4*g.unit:radius,fill:'var(--yesterday)'}));
    if (!close) text(svg,x,y(p.yesterday),`${p.yesterday}°`,'chart-value',{class:'yesterday-value','data-series':'yesterday'});
    svg.append(el('circle',{cx:x,cy:y(p.value),r:radius,fill:'var(--today)'}));
    text(svg,x,y(p.value),`${p.value}°`,'chart-value',{class:'today-value','data-series':'today'});
  });
  svg.append(el('circle',{cx:3.5*g.column,cy:y(hourly[3].value),r:4*g.unit,fill:'var(--now)',stroke:'var(--panel)','stroke-width':1}));
  table($('hourly-table'),copy.headersHourly,hourly.map(p=>[`${p.hour}:00`,`${p.value}°`,`${p.yesterday}°`,`${p.rain}%`]));
}
function renderDaily(copy) {
  const svg=$('daily-chart'),g=chartBase(svg,daily.length,'daily',copy.daily);
  const defs=el('defs'), gradient=el('linearGradient',{id:'range-gradient',x1:'0',y1:'1',x2:'0',y2:'0'});
  gradient.append(el('stop',{offset:'0%', 'stop-color':'#9bcdf0'}),el('stop',{offset:'100%', 'stop-color':'#f0c77f'})); defs.append(gradient); svg.append(defs);
  const y = value => g.bottom-(value+16)/48*(g.bottom-g.top);
  daily.forEach((p,i)=>{
    const x=(i+.5)*g.column,past=i<3;
    if(i===3) { svg.append(el('rect',{x:i*g.column+2,y:0,width:g.column-4,height:g.height,fill:'var(--subtle)',rx:8*g.unit})); text(svg,x,16*g.unit,copy.day,'caption'); }
    text(svg,x,44*g.unit,copy.weekdays[i],'chart-axis');
    text(svg,x,66*g.unit,`${28+i>30?28+i-30:28+i}`,'chart-axis');
    icon(svg,x,91*g.unit,24*g.unit);
    if(!past) text(svg,x,116*g.unit,`${p.rain}%`,'caption',{class:'amount'});
    svg.append(el('rect',{x:x-3*g.unit,y:y(p.max),width:6*g.unit,height:y(p.min)-y(p.max),rx:3*g.unit,fill:'url(#range-gradient)',stroke:'var(--bar-edge)','stroke-width':1,'fill-opacity':past?.55:1,'data-range-bar':'true'}));
    text(svg,x,y(p.max)-state.sizes['chart-value']*.9,`${p.max}°`,'chart-value',{class:past?'past-value':''});
    text(svg,x,y(p.min)+state.sizes['chart-value']*.9,`${p.min}°`,'chart-value',{class:past?'past-value':''});
    if(i===3) svg.append(el('circle',{cx:x,cy:y(24),r:4*g.unit,fill:'var(--now)'}));
  });
  table($('daily-table'),copy.headersDaily,daily.map((p,i)=>[copy.weekdays[i],`${p.min}°`,`${p.max}°`,`${p.rain}%`]));
}
function table(node,headers,rows) { node.replaceChildren(); const head=node.createTHead().insertRow(); headers.forEach(value=>{const th=document.createElement('th'); th.scope='col'; th.textContent=value; head.append(th);}); const body=node.createTBody(); rows.forEach(values=>{const row=body.insertRow(); values.forEach(value=>row.insertCell().textContent=value);}); }
function render() {
  if (window.referenceCapture) return; // Capture-only guard: Chromium capture temporarily changes touch media.
  const lang=$('language').value, copy=COPY[lang];
  document.documentElement.lang=lang; document.documentElement.dataset.appearance=$('appearance').value;
  sizeRoles();
  for(const [id,key] of Object.entries({'place':'place','sample-note':'note','condition':'condition','summary':'summary','highlow':'highlow','hourly-title':'hourly','daily-title':'daily','today-label':'today','yesterday-label':'yesterday','hourly-note':'hourlyNote','daily-note':'dailyNote','daily-key':'range','wind-summary':'wind','wind-details':'windDetails','hourly-table-title':'table','daily-table-title':'table'})) $(id).textContent=copy[key];
  $('role-samples').replaceChildren();
  for(const [role,def] of Object.entries(ROLES)) {
    const row=document.createElement('div'); row.className='role-example';
    const name=document.createElement('p'); name.className='role-name'; name.dataset.role='caption'; name.textContent=`${role} · ${state.sizes[role].toFixed(1)}px / ${def.leading}`;
    const sample=document.createElement('p'); sample.dataset.role=role; sample.textContent=role==='hero-temp'?'24°':['data','data-xl','chart-value'].includes(role)?copy.value:copy.sample;
    if(['data','data-xl','chart-axis','chart-value','caption','micro'].includes(role)) sample.style.fontVariantNumeric='tabular-nums';
    row.append(name,sample); $('role-samples').append(row);
  }
  renderHourly(copy); renderDaily(copy);
  for(const node of document.querySelectorAll('[data-role]')) { const def=ROLES[node.dataset.role]; node.style.setProperty('--role-size',`var(--size-${node.dataset.role})`); node.style.setProperty('--role-weight',def.weight); node.style.setProperty('--role-leading',def.leading); }
  window.typographyReference={...state,roles:ROLES,fixture:true};
}
for(const id of ['language','scale','appearance','root']) $(id).addEventListener('change',render);
let resizeTimer; addEventListener('resize',()=>{clearTimeout(resizeTimer); resizeTimer=setTimeout(render,50);});
for(const query of ['(pointer: coarse)','(hover: none)']) matchMedia(query).addEventListener('change',render);
render();
document.fonts.ready.then(render);
