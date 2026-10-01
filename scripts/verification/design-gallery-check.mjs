import {chromium,webkit} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {startGallery} from '../design-gallery.mjs';
import {checkTokenCSS} from './design-token-css-check.mjs';
const args=process.argv.slice(2),arg=(k,f)=>args.includes(k)?args[args.indexOf(k)+1]:f;
const out=resolve(arg('--out','reports/sdlc/issue-2651-docs-type/gallery'));
if(!out.startsWith(resolve('reports')+sep))throw Error('Output must stay under reports/');
mkdirSync(out,{recursive:true});
const service=await startGallery();
const sizes=[{width:402,height:874,touch:true,tier:'mobile',name:'mobile'},{width:820,height:1180,touch:true,tier:'tablet',name:'tablet'},{width:1440,height:900,touch:false,tier:'desktop',name:'desktop'},{width:320,height:694,touch:true,tier:'mobile',name:'compact'}];
const engines=arg('--engines','chromium,webkit').split(',');
const result={versions:{},cases:[],controls:[],tokenCSS:[],systemAppearance:[],captures:{},errors:[]};
const sourcePaths=['packages/design-tokens/tokens.json','packages/design-tokens/resolver.mjs','packages/design-tokens/generate.mjs','docs/design-system/references/gallery.html','docs/design-system/references/gallery.css','docs/design-system/references/gallery.js','docs/design-system/references/chart-model.js','docs/design-system/references/charts.js','docs/design-system/references/fixtures.js','scripts/design-gallery.mjs','scripts/verification/design-gallery-check.mjs','scripts/verification/design-token-css-check.mjs'];
result.sourceDigests=Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
try {
 assert.equal((await fetch(service.url+'/package.json')).status,404);
 assert.equal((await fetch(service.url+'/docs/design-system/references/..%2f..%2f..%2fpackage.json')).status,404);
 for(const engineName of engines) {
  const browser=await ({chromium,webkit}[engineName]).launch();result.versions[engineName]=browser.version();
  try {
   const css=await checkTokenCSS(browser,engineName);result.tokenCSS.push(...css.cases);assert.deepEqual(css.errors,[],engineName+' generated CSS cascade');
   for(const size of sizes) {
   const context=await browser.newContext({viewport:size,isMobile:size.touch,hasTouch:size.touch,colorScheme:'dark'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===service.url?route.continue():route.abort());
   const page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
   await page.goto(service.url);await page.waitForFunction(()=>window.galleryReady);await page.evaluate(()=>document.fonts.ready);
   await page.selectOption('#appearance','system');
   const system=await page.evaluate(()=>({osDark:matchMedia('(prefers-color-scheme: dark)').matches,appearance:document.documentElement.dataset.appearance,body:parseFloat(getComputedStyle(document.body).fontSize),bodyToken:getComputedStyle(document.documentElement).getPropertyValue('--tw-type-body-size').trim()}));
   assert.equal(system.osDark,true);assert.equal(system.appearance,'system');assert.equal(system.body,{mobile:17,tablet:18,desktop:16}[size.tier]);if(size.tier==='desktop')assert.equal(system.bodyToken,'1rem');result.systemAppearance.push({engineName,tier:size.tier,...system});
   for(const lang of ['ko','de'])for(const appearance of ['light','dark'])for(const scale of ['1','1.3'])for(const root of [16,32]) {
    const id=`${engineName}/${size.name}/${lang}/${appearance}/${scale}/${root}`;
    await page.selectOption('#language',lang);await page.selectOption('#appearance',appearance);await page.selectOption('#text-scale',scale);
    await page.evaluate(root=>{document.documentElement.style.fontSize=root+'px';dispatchEvent(new Event('resize'));},root);
    await page.waitForFunction(({tier,lang,scale,root})=>window.galleryState?.tier===tier&&window.galleryState.lang===lang&&window.galleryState.scale===Number(scale)&&window.galleryState.root===root,{tier:size.tier,lang,scale,root});
    await page.waitForTimeout(30);
    const geometry=await page.evaluate(()=>{
     const root=document.documentElement;const overflow=root.scrollWidth>innerWidth+1;
     const scrollers=[...document.querySelectorAll('.chart-scroll')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}));
     const textOverflow=[...document.querySelectorAll('main h1, main h2, main h3, main label, .controls select, .button-row button')].filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.textContent);
     const badSvg=[...document.querySelectorAll('svg.plot text')].filter(e=>{const b=e.getBBox(),s=e.ownerSVGElement.viewBox.baseVal;return b.x<-.5||b.y<-.5||b.x+b.width>s.width+.5||b.y+b.height>s.height+.5;}).map(e=>e.textContent);
     const expected=window.galleryModels;const equal=Object.entries(expected).every(([kind,m])=>{const rows=[...document.querySelectorAll(`#${kind}-content [data-model-row]`)];return rows.length===m.rows.length&&rows.every((tr,i)=>{const vals=[...tr.querySelectorAll('td')].map(e=>e.textContent);const compare=kind==='hourly'?[m.rows[i].temperature,m.rows[i].yesterday,m.rows[i].pop,m.rows[i].rainMm,m.rows[i].wsd,m.rows[i].vec,m.rows[i].reh]:[m.rows[i].low,m.rows[i].high,m.rows[i].pop,m.rows[i].rainMm];return compare.every((v,j)=>(kind==='hourly'?vals[j]:vals[j+2])===(v===null?'—':Number.isInteger(v)?String(v):v.toFixed(1)));});});
     return {overflow,textOverflow,badSvg,scrollers,equal,body:parseFloat(getComputedStyle(document.body).fontSize),font:document.fonts.check('16px "Pretendard Variable"')};
    });
    assert.equal(geometry.overflow,false,id+' global overflow');assert.deepEqual(geometry.textOverflow,[],id+' control text');assert.deepEqual(geometry.badSvg,[],id+' SVG bounds');assert.equal(geometry.equal,true,id+' table parity');assert.equal(geometry.font,true,id+' font');
    const baseline={mobile:17,tablet:18,desktop:16}[size.tier];assert.ok(Math.abs(geometry.body-baseline*Number(scale)*root/16)<.15,id+' body tier');
    const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact));
    assert.deepEqual(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],id+' axe');
    result.cases.push({id,geometry,seriousCritical:0});
    if(engineName==='chromium'&&size.name!=='compact'&&lang==='ko'&&scale==='1'&&root===16) {
     const filename=`${size.name}-${appearance}.png`;await page.evaluate(()=>window.referenceCapture=true);await page.screenshot({path:resolve(out,filename),fullPage:true});
     const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:size.touch,maxTouchPoints:1});
     await page.evaluate(()=>{window.referenceCapture=false;dispatchEvent(new Event('resize'));});await page.waitForFunction(t=>window.galleryState.tier===t,size.tier);
     result.captures[filename]={engine:engineName,viewport:{width:size.width,height:size.height},tier:size.tier,lang,appearance,scale:1,root:16,sha256:createHash('sha256').update(readFileSync(resolve(out,filename))).digest('hex')};
    }
   }
   await page.selectOption('#chart-state','ready');await page.selectOption('#text-scale','1');await page.evaluate(()=>{document.documentElement.style.fontSize='16px';dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>window.galleryState.root===16&&window.galleryState.scale===1);await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
   const chart=page.locator('#hourly-content .chart-scroll');await chart.focus();await chart.press('End');assert.equal(await chart.getAttribute('data-cursor'),'12');await chart.press('Home');assert.equal(await chart.getAttribute('data-cursor'),'0');await chart.press('ArrowRight');assert.equal(await chart.getAttribute('data-cursor'),'1');
   await page.evaluate(()=>dispatchEvent(new Event('resize')));await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));assert.equal(await chart.evaluate(e=>e===document.activeElement),true);await chart.press('ArrowRight');assert.equal(await chart.getAttribute('data-cursor'),'2');
   await page.locator('#expand-hourly').click();assert.equal(await page.locator('#hourly-wind').isVisible(),true);
   await page.locator('#tab-wind').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-uv').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#panel-uv').isVisible(),true);
   await page.locator('#search-form button').click();assert.equal(await page.locator('#search').getAttribute('aria-invalid'),'true');await page.locator('#search').fill('Berlin');await page.locator('#search-form button').click();assert.equal(await page.locator('#search').getAttribute('aria-invalid'),'false');
   await page.locator('#delete').click();assert.equal(await page.locator('#confirm').evaluate(e=>e.open),true);assert.equal(await page.locator('#cancel').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#delete').evaluate(e=>e===document.activeElement),true);
   for(const state of ['loading','empty','error','stale']){await page.selectOption('#chart-state',state);assert.equal(await page.locator('#hourly-content [role=status]').count()>=1,true);}
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.skeleton').first().evaluate(e=>getComputedStyle(e).animationName),'none');await page.emulateMedia({forcedColors:'active'});assert.equal(await page.evaluate(()=>matchMedia('(forced-colors: active)').matches),true);
   assert.deepEqual(pageErrors,[]);result.controls.push(`${engineName}/${size.name}: chart/expander/tabs/input/dialog/states/reduced/forced`);await context.close();
  }} finally {await browser.close();}
 }
} catch(error) {result.errors.push(error.stack);process.exitCode=1;}
finally {await service.close();writeFileSync(resolve(out,'results.json'),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({renders:result.cases.length,controls:result.controls.length,errors:result.errors},null,2));
