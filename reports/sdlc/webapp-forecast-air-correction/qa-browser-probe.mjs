import {chromium,expect} from '/root/.paseo/worktrees/08mqediz/shiny-elephant/node_modules/@playwright/test/index.mjs';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const root='/root/.paseo/worktrees/08mqediz/shiny-elephant/';
const server=spawn(process.execPath,['scripts/web-static-preview.mjs'],{cwd:root,env:{...process.env,PORT:'4176'},stdio:'ignore'});
let browser;
try {
for(let i=0;i<100;i++){try {if((await fetch('http://127.0.0.1:4176/index.html')).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
browser=await chromium.launch({executablePath:'/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();let errors=[],api=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
const raw=JSON.parse(readFileSync(root+'docs/rewrite/examples/client-kma-response.json','utf8')).response;
raw.current.summaryAir='<img src=x onerror="window.__bad=true"> 관측시각이 없는 공급사 요약';raw.airInfoList=[];delete raw.airInfo;delete raw.current.arpltn;
await page.route('https://todayweather.wizardfactory.net/**',r=>r.fulfill({json:raw}));
await page.goto('http://127.0.0.1:4176/weather/seoul/hourly');const note=page.getByRole('note');await expect(note).toContainText('관측 시각 미확인');await expect(note.locator('img')).toHaveCount(0);assert(await page.evaluate(()=>window.__bad)!==true,'escaped text');
await page.getByRole('button',{name:'미세먼지',exact:true}).click();await expect(note).toContainText('측정값이 아닌 제공사 요약');await page.screenshot({path:root+'reports/sdlc/webapp-forecast-air-correction/qa-air-fallback-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile no horizontal overflow');
raw.current.summaryAir=' ';await page.reload();await expect(page.getByText('대기질 관측 자료가 없습니다',{exact:true})).toBeVisible();await expect(page.getByRole('note')).toHaveCount(0);assert(errors.length===0,'no page errors');assert(api.length===0,'no local API');console.log(JSON.stringify({status:'passed',checks:['mobile fallback and unknown-time caveat','provider markup escaped as text','no horizontal overflow','removed summary disappears on new response','zero local API/page errors']},null,2));
} finally {if(browser)await browser.close();server.kill('SIGTERM');}
function assert(v,msg){if(!v)throw Error(msg);}
