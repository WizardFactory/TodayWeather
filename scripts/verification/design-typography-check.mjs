#!/usr/bin/env node
// Reference-only verification. No product server, provider requests or tracked output rewrites.
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index+1]; };
const out = resolve(ROOT, option('--out', 'reports/sdlc/issue-2651-docs-type/browser'));
if (!out.startsWith(resolve(ROOT,'reports')+sep)) throw new Error('--out must stay inside ignored reports/');
const engines = option('--engines','chromium,webkit').split(',');
const quick = args.includes('--quick');
const core = [
  {width:402,height:874,touch:true,tier:'mobile'},
  {width:820,height:1180,touch:true,tier:'tablet'},
  {width:1440,height:900,touch:false,tier:'desktop'},
];
const cases = quick ? core : [...core,
  {width:320,height:694,touch:true,tier:'mobile'}, {width:753,height:1205,touch:true,tier:'mobile'},
  {width:767,height:1024,touch:true,tier:'mobile'}, {width:768,height:1024,touch:true,tier:'tablet'},
  {width:1180,height:629,touch:true,tier:'tablet'}, {width:874,height:402,touch:true,tier:'mobile'},
  {width:800,height:465,touch:false,tier:'desktop'}, {width:768,height:539,touch:true,tier:'mobile'},
  {width:768,height:540,touch:true,tier:'tablet'}, {width:1600,height:900,touch:false,tier:'desktop'},
  {width:720,height:450,touch:false,tier:'mobile'},
];
// Numeric role table read from normative spec, not from the reference implementation.
const spec = readFileSync(resolve(ROOT,'specs/design-system.md'),'utf8');
const expected = {};
for(const line of spec.split('\n')) {
  const cells=line.split('|').map(c=>c.trim());
  const name=cells[1]?.match(/^`([^`]+)`$/)?.[1];
  if(!name || !/^\d+/.test(cells[3] ?? '') || !/^\d+/.test(cells[4] ?? '') || !/^\d+/.test(cells[5] ?? '') || !/^\d+/.test(cells[6] ?? '')) continue;
  expected[name] = {sizes:cells.slice(3,6).map(c=>parseFloat(c)),weight:parseFloat(cells[6]),leading:parseFloat(cells[7])};
}
if(Object.keys(expected).length!==12) throw new Error(`Spec type table: expected 12 numeric roles, got ${Object.keys(expected).length}`);
expected['hero-temp']={weight:300,leading:1};
const sourcePaths=['docs/design-system/references/typography.html','docs/design-system/references/typography.css','docs/design-system/references/typography.js','docs/design-system/references/fonts/PretendardVariable.woff2','scripts/verification/design-typography-check.mjs','specs/design-system.md'];
const digests=Object.fromEntries(sourcePaths.map(path=>[path,createHash('sha256').update(readFileSync(resolve(ROOT,path))).digest('hex')]));
mkdirSync(out,{recursive:true});
const server=createServer((request,response)=>{
  try {
    const path=resolve(ROOT,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname));
    if(!path.startsWith(resolve(ROOT,'docs/design-system')+sep)) {response.writeHead(403).end();return;}
    const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.md':'text/plain; charset=utf-8'};
    response.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'}).end(readFileSync(path));
  } catch {response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/docs/design-system/references/typography.html`;
const runs=[], unavailable=[], controls=[];
const startedAt=new Date().toISOString();
try {
  for(const name of engines) {
    if(!['chromium','webkit'].includes(name)) throw new Error(`Unknown engine ${name}`);
    let browser;
    try { browser=await ({chromium,webkit}[name]).launch(); }
    catch(error) {unavailable.push({engine:name,error:error.message});continue;}
    try {
      for(const viewport of cases) {
        const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},hasTouch:viewport.touch,deviceScaleFactor:1,serviceWorkers:'block',reducedMotion:'reduce'});
        const page=await context.newPage();
        const captureSession=name==='chromium'?await context.newCDPSession(page):null;
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        // All resources must be local; public-font/provider access is prohibited.
        await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
        const settings=quick ? [[1,16],[1.3,16],[1,32]] : [[.9,16],[1,16],[1.15,16],[1.3,16],[1,32],[1.3,32]];
        for(const language of ['ko','de']) for(const appearance of ['light','dark']) for(const [scale,root] of settings) {
          const query=new URLSearchParams({language,appearance,scale:String(scale),root:String(root)});
          await page.goto(base+'?'+query); await page.evaluate(()=>document.fonts.ready);
          await page.waitForFunction(()=>window.typographyReference && document.fonts.status==='loaded');
          const report=await page.evaluate(({viewport,scale,root,expected})=>{
            const findings=[], tolerance=.75, close=(a,b)=>Math.abs(a-b)<tolerance;
            const s=window.typographyReference;
            if(s.tier!==viewport.tier) findings.push(`tier: ${s.tier}, expected ${viewport.tier}`);
            if(![...document.fonts].some(font=>font.family.replaceAll('"','')==='Pretendard Variable'&&font.status==='loaded')) findings.push('Pretendard did not load');
            if(document.documentElement.scrollWidth>innerWidth+1) findings.push(`page overflow ${document.documentElement.scrollWidth}>${innerWidth}`);
            const tierIndex=['mobile','tablet','desktop'].indexOf(viewport.tier);
            const heroMax=viewport.tier==='tablet'||(viewport.tier==='desktop'&&viewport.width>=1600)?112:96;
            const hero=Math.max(72,Math.min(heroMax,viewport.tier==='mobile'?Math.min(viewport.width*.2,viewport.height*.12):viewport.height*.14));
            for(const node of document.querySelectorAll('[data-role]')) {
              const role=node.dataset.role, def=expected[role], style=getComputedStyle(node);
              let base=role==='hero-temp'?hero:def.sizes[tierIndex];
              if(role==='title-1'&&viewport.tier==='desktop'&&viewport.width>=1600) base=22;
              const size=Math.max(role==='micro'?12:13,base*scale)*root/16;
              if(!close(parseFloat(style.fontSize),size)) findings.push(`${role}: ${style.fontSize}, expected ${size}`);
              if(Number(style.fontWeight)!==def.weight) findings.push(`${role} weight ${style.fontWeight}, expected ${def.weight}`);
              if(!close(parseFloat(style.lineHeight),size*def.leading)) findings.push(`${role} leading ${style.lineHeight}`);
              if(node instanceof SVGElement) continue;
              // Text range checks measure actual wrapped glyph spans, rather than just element width.
              const range=document.createRange(); range.selectNodeContents(node);
              const box=node.getBoundingClientRect();
              for(const rect of range.getClientRects()) if(rect.left<box.left-1||rect.right>box.right+1) findings.push(`text escapes ${role}: ${node.textContent.slice(0,35)}`);
            }
            let suppressed=0;
            for(const svg of document.querySelectorAll('.chart-scroll svg')) {
              const box=svg.getBoundingClientRect(), labels=[...svg.querySelectorAll('[data-chart-label]')];
              for(const node of labels) {
                const rect=node.getBoundingClientRect();
                if(rect.left<box.left-1||rect.right>box.right+1||rect.top<box.top-1||rect.bottom>box.bottom+1) findings.push(`SVG label out of bounds: ${node.textContent}`);
                if(node.dataset.series) {
                  const circle=node.previousElementSibling.getBoundingClientRect();
                  if(rect.left<circle.left-1||rect.right>circle.right+1||rect.top<circle.top-1||rect.bottom>circle.bottom+1) findings.push(`value outside dot: ${node.textContent}`);
                }
              }
              for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
                const a=labels[i].getBoundingClientRect(),b=labels[j].getBoundingClientRect();
                if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1) findings.push(`overlap: ${labels[i].textContent} / ${labels[j].textContent}`);
              }
              const scroll=svg.parentElement;
              if(svg.id==='hourly-chart') {
                if(svg.querySelectorAll('[data-series="today"]').length!==15) findings.push('today labels were lost');
                suppressed=15-svg.querySelectorAll('[data-series="yesterday"]').length;
                if(suppressed<1) findings.push('close yesterday labels not suppressed');
                if(suppressed===15) findings.push('reference lacks visible yesterday values');
                const head=document.querySelector('.legend').getBoundingClientRect();
                if(head.bottom>box.top) findings.push('legend covers hourly plot');
              }
              if(svg.getBoundingClientRect().width>scroll.clientWidth+1) {
                scroll.scrollLeft=100000;
                if(scroll.scrollLeft<=0) findings.push('overflow chart cannot scroll');
                scroll.scrollLeft=0;
              }
            }
            return {findings:[...new Set(findings)],tier:s.tier,body:parseFloat(getComputedStyle(document.body).fontSize),hero:parseFloat(getComputedStyle(document.querySelector('#hero-value')).fontSize),suppressed,pointer:matchMedia('(pointer: coarse)').matches?'coarse':'fine'};
          },{viewport,scale,root,expected});
          const id=`${name}-${viewport.width}x${viewport.height}-${language}-${appearance}-s${scale}-r${root}`;
          const entry={id,engine:name,version:browser.version(),viewport,language,appearance,scale,root,...report,errors:[...errors]};
          if(core.includes(viewport)&&((scale===1&&root===16)||(scale===1.3&&root===16)||(scale===1&&root===32))) {
            entry.screenshot=id+'.png';
            // Chromium screenshot changes touch media during capture. Preserve the measured
            // reference rendering, then restore input emulation and assert state freshness.
            await page.evaluate(()=>{window.referenceCapture=true;});
            try { await page.screenshot({path:resolve(out,entry.screenshot),fullPage:true}); }
            finally {
              if(name==='chromium') {
                await captureSession.send('Emulation.setTouchEmulationEnabled',{enabled:viewport.touch});
              }
              await page.evaluate(()=>{window.referenceCapture=false; dispatchEvent(new Event('resize'));});
              await page.waitForFunction(({tier,touch})=>window.typographyReference.tier===tier&&matchMedia('(pointer: coarse)').matches===touch,{tier:viewport.tier,touch:viewport.touch});
              entry.captureState=await page.evaluate(()=>({tier:window.typographyReference.tier,body:parseFloat(getComputedStyle(document.body).fontSize),pointer:matchMedia('(pointer: coarse)').matches?'coarse':'fine'}));
              if(entry.captureState.tier!==report.tier||Math.abs(entry.captureState.body-report.body)>.75) entry.findings.push('capture changed measured tier/body');
            }
          }
          runs.push(entry);
        }
        // User control and live resize are verified separately from initial URL fixtures.
        await page.goto(base); await page.evaluate(()=>document.fonts.ready);
        await page.selectOption('#scale','1.3'); await page.selectOption('#appearance','dark'); await page.selectOption('#language','de');
        await page.setViewportSize({width:700,height:800});
        await page.waitForFunction(()=>window.typographyReference.tier==='mobile'&&window.typographyReference.scale===1.3);
        const ok=await page.evaluate(()=>document.documentElement.lang==='de'&&document.documentElement.dataset.appearance==='dark');
        controls.push({engine:name,from:`${viewport.width}x${viewport.height}`,passed:ok});
        await context.close();
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
const failures=runs.filter(run=>run.findings.length||run.errors.length);
const result={startedAt,finishedAt:new Date().toISOString(),sourceDigests:digests,expected,runCount:runs.length,failedCount:failures.length,unavailable,controls,runs};
writeFileSync(resolve(out,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({runs:runs.length,failed:failures.length,unavailable:unavailable.map(x=>x.engine),controls:controls.length,out},null,2));
for(const failure of failures.slice(0,8)) console.log(failure.id, failure.findings.slice(0,6), failure.errors);
if(failures.length||unavailable.length||controls.some(c=>!c.passed)||!runs.length) process.exitCode=1;
