// Actual TabCtrl popups, invoked on the fixture-backed Hourly page. The capture
// uses real screen pixels, recording full popup and scroll-body geometry.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connect, sleep} from '../emulator/devtools.mjs';
import {Screen} from '../emulator/screen.mjs';
import {BLOCKS} from '../emulator/page-blocks.mjs';
import {referenceRoot, recordView} from '../emulator/reference-view.mjs';

const [serial, lang, root] = process.argv.slice(2);
const out = path.join(referenceRoot(root, 'dialog'), lang);
const shots = new Screen(serial);
const dt = await connect(serial);
await dt.settled();
await recordView(dt, shots, out);
await dt.evaluate(BLOCKS);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'core-domain/src/test/resources/corpus/inputs/kma-seoul.json')));
await dt.evaluate(`(async function () {
    var inj = angular.element(document.body).injector();
    var wi = inj.get('WeatherInfo'), wu = inj.get('WeatherUtil');
    var data = wu.convertWeatherData([{data: ${JSON.stringify(fixture)}}]);
    var city = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat:37.56,long:126.98}, currentPosition:false};
    Object.keys(data).forEach(function(k){city[k]=data[k];});
    wi.addCity(city); wi.setCityIndex(wi.getCityCount()-1);
    await twBlocks.closePopups();
    await inj.get('$state').go('tab.forecast');
    await twBlocks.wait(2000); await twBlocks.closePopups();
    window.twDialogScope = angular.element(document.querySelector('ion-tabs')).scope();
    window.twDialogTranslate = inj.get('$translate');
})()`);
const origin = shots.webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
fs.mkdirSync(out, {recursive: true});
// A fixed backdrop isolates the popup's translucency from a separately tested
// weather page. Native popup tests use this same pre-popup screen underneath it.
const view = await dt.evaluate('({width:innerWidth,height:innerHeight})');
fs.writeFileSync(path.join(out, 'background.png'), shots.png(shots.screen(), {
    x:origin.x, y:origin.y, width:Math.round(view.width*dpr), height:Math.round(view.height*dpr)}));
const pollen = {pollenGrade: 2, flowerWoodyGrade: 2, flowerWoodyStr: '높음', flowerPineGrade: 2, flowerPineStr: '높음', flowerWeedsGrade: 2, flowerWeedsStr: '높음'};
for (const name of ['retry', 'source-kaq', 'source-airkorea', 'pollen', 'exit']) {
    if (name === 'exit') {
        // Enter the registered Ionic dispatcher. Synthetic DOM events do not
        // traverse Cordova's special backbutton channel.
        const priority = await dt.evaluate(`angular.element(document.body).injector().get('$ionicPlatform')
            .hardwareBackButtonClick({preventDefault:function(){}}).priority`);
        if (priority !== 100) throw new Error(`Exit dispatcher was intercepted at priority ${priority}`);
    }
    else {
        const action = name === 'retry' ? "twDialogScope.showRetryConfirm(twDialogTranslate.instant('LOC_ERROR'),twDialogTranslate.instant('LOC_FAIL_TO_GET_WEATHER_INFO'),'weather')"
            : name === 'pollen' ? `twDialogScope.showPollenInfo(${JSON.stringify(pollen)})`
            : `twDialogScope.popUpAirForecastInfo(${JSON.stringify(name.slice(7))})`;
        // Do not await the promise that resolves only after the user closes it.
        await dt.evaluate(`(function(){ ${action}; return true; })()`);
    }
    await sleep(1000);
    const record = await dt.evaluate(`(function(){
        function rect(e){var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}
        function part(e){var s=getComputedStyle(e);return {cls:e.className,text:e.textContent,rect:rect(e),style:{color:s.color,background:s.backgroundColor,fontSize:s.fontSize,lineHeight:s.lineHeight,fontWeight:s.fontWeight,padding:s.padding,margin:s.margin}};}
        var p=twBlocks.shown('.popup-container .popup'); if(!p) throw new Error('Popup missing');
        var body=p.querySelector('.popup-body');
        return {view:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenHeight:screen.height},popup:part(p),
            parts:Array.from(p.querySelectorAll('.popup-head,.popup-title,.popup-body,.popup-buttons,.button,section,p,small')).map(part),
            body:{clientHeight:body.clientHeight,scrollHeight:body.scrollHeight}};
    })()`);
    const expected = {retry:'LOC_FAIL_TO_GET_WEATHER_INFO', 'source-kaq':'LOC_KAQ_DESCRIPTION',
        'source-airkorea':'LOC_AIRKOREA_DESCRIPTION', pollen:'LOC_POLLEN_RISK', exit:'LOC_DO_YOU_WANT_TO_EXIT'};
    const wanted = await dt.evaluate(`twDialogTranslate.instant(${JSON.stringify(expected[name])})`);
    if (!record.popup.text.includes(wanted)) throw new Error(`Wrong ${name} popup: ${record.popup.text}`);
    const r = record.popup.rect;
    const area = {x: origin.x + Math.round(r.x*dpr), y:origin.y + Math.round(r.y*dpr),
        width:Math.round((r.x+r.w)*dpr)-Math.round(r.x*dpr),height:Math.round((r.y+r.h)*dpr)-Math.round(r.y*dpr)};
    fs.writeFileSync(path.join(out, `${name}.png`), shots.png(shots.screen(), area));
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({name, lang, ...record, clip:area})+'\n');
    console.log(`${lang} ${name}: ${r.w}x${r.h}; body ${record.body.clientHeight}/${record.body.scrollHeight}`);
    // Use the actual Close/Cancel button. A platform-back event can race Ionic's
    // transition and reach the underlying tab's exit handler.
    const button = record.parts.find(p => /(?:^| )button(?: |$)/.test(p.cls)).rect;
    execFileSync('adb', ['-s', serial, 'shell', 'input', 'tap',
        String(Math.round(origin.x + (button.x+button.w/2)*dpr)),
        String(Math.round(origin.y + (button.y+button.h/2)*dpr))]);
    await sleep(900);
    if (await dt.evaluate("!!twBlocks.shown('.popup-container .popup')")) throw new Error(`${name} did not close`);
}
dt.close();
