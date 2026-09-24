// Read-only public catalog-location smoke. No API server or AWS mutation.
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4189';
const server=spawn(process.execPath,['scripts/web-static-preview.mjs'],{env:{...process.env,PORT:'4189'},stdio:'ignore'});
let browser;
try {
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/index.html')).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,headless:true});
 const page=await browser.newPage();const requests=[],responses=[],errors=[];
 page.on('request',r=>requests.push(new URL(r.url()).pathname));
 page.on('response',r=>{const u=new URL(r.url());if(u.hostname==='todayweather.wizardfactory.net')responses.push({path:u.pathname,status:r.status()});});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/weather/seoul/hourly');
 await expect(page.locator('.temperature')).toBeVisible({timeout:30000});
 for(const route of ['/nation/weather','/nation/air','/warnings']){
  const reply=page.waitForResponse(r=>r.url().includes(route==='/warnings'?'/v000903/kma/special':'/v000903/nation/KR'),{timeout:30000});
  await page.goto(origin+route);assert.equal((await reply).status(),200);
  if(route!=='/warnings')await expect(page.locator('.region-row').first()).toBeVisible({timeout:30000});
  await expect(page.getByRole('heading',{name:'자료를 불러오지 못했어요'})).toHaveCount(0);
 }
 const geocode=await page.evaluate(async()=>{
  const base='https://todayweather.wizardfactory.net/geocode/v000903/';
  const results=[];
  for(const p of ['coord/37.567,126.978','addr/'+encodeURIComponent('서울')]){
   const r=await fetch(base+p,{credentials:'omit',headers:{Accept:'application/json','Accept-Language':'ko'}});
   const json=await r.json();results.push({status:r.status,validCoordinates:Number.isFinite(json.location?.lat)&&Number.isFinite(json.location?.long)});
  }return results;
 });
 assert(geocode.every(x=>x.status===200&&x.validCoordinates));
 assert(!requests.some(p=>p.startsWith('/api/')));assert.equal(errors.length,0);
 assert(responses.some(r=>r.path==='/v000903/nation/KR'&&r.status===200));assert(responses.some(r=>r.path==='/v000903/kma/special'&&r.status===200));
 console.log(JSON.stringify({passed:true,at:new Date().toISOString(),origin,mocked:false,apiServer:false,responses,geocode,pageErrors:errors,localApiRequests:0,limits:'Local origin browser CORS and public reads only; no app.tdywx.xyz hosting/DNS/device verification; HTTP success does not establish data freshness.'},null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
