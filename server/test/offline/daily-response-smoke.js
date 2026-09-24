'use strict';
// Actual Express v000903 middleware, XML parser, collector and service modules.
// Model, provider, geocoder and timer boundaries are isolated before module load.
process.env.TW_SMOKE_NOW='2026-09-24T07:27:00.000Z';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const route=require('./rss-response-smoke');
const h=require('./harness');
const captured=require('./fixtures/mid-land-captured.json');
const summaries=[];
async function main(){
    for(const version of ['1.0','2.0'])for(const scenario of ['captured','stale','missing-text','missing-temp'])for(const units of ['C','F']) {
        const f=route.makeFixture(route.locations[0],'newer');
        // Capture starts at day 4; near-term sample ends at September 26.
        f.short=f.short.filter(row=>row.date<='20260926');
        const c=h.prepare(h.collector());
        c.organizeLandData(0,h.response([captured]),{date:'20260924',time:'0600'});
        assert(c.resultList[0].isCompleted);f.land=c.resultList[0].data[0];
        delete f.temp.taMin3;delete f.temp.taMax3;
        if(scenario==='stale') {f.land.date='20241128';f.land.time='0600';}
        if(scenario==='missing-text') f.forecast=null;
        if(scenario==='missing-temp')f.temp=null;
        const env=route.createHarness(version,f);
        const result=await env.request({temperatureUnit:units,windSpeedUnit:'m/s'});
        assert.deepEqual(result.traces,env.methods);
        const b=result.body, rows=b.midData.dailyData, dates=rows.map(row=>row.date);
        assert.equal(b.source,'KMA');assert.equal(dates.length,new Set(dates).size);assert.deepEqual(dates,[...dates].sort());
        assert(dates.includes('20260923'),'yesterday remains available');assert(dates.includes('20260917'),'seven-day observation window');
        assert(dates.includes('20260926'),'short forecast survives');assert(!dates.includes('20260927'),'no invented boundary day');
        assert(!dates.some(date=>date<'20260917'));
        assert(b.midData.dailyStatus.unavailableDates.includes('20260927'));
        if(['captured','missing-text'].includes(scenario)) {
            assert(dates.includes('20260928'));assert(dates.includes('20261004'));
            const day=rows.find(row=>row.date==='20260928');
            assert.equal(day.tmn,units==='C'?18:64);assert.equal(day.tmx,units==='C'?27:80);
            assert.equal(day.wfAm,'구름많음');assert.equal(day.rnStAm,20);
            assert.equal(b.midData.dailyStatus.healthy,false);assert(b.midData.dailyStatus.reasons.includes('forecast-gap'));
        } else {
            assert(!dates.includes('20260928'));assert.equal(b.midData.dailyStatus.healthy,false);
        }
        assert.equal(b.midData.rssPubDate,undefined);
        assert(!JSON.stringify(b).includes('NaN'));
        assert(!result.logs.some(row=>row.args.some(arg=>/TypeError|ReferenceError/.test(String(arg)))));
        summaries.push({version,scenario,units,dates,status:b.midData.dailyStatus,middlewareCount:result.traces.length});
    }
    // Synthetic review regression: RSS must contribute daily fields independently.
    for(const version of ['1.0','2.0'])for(const scenario of ['stale-primary','missing-primary','partial-rss','unmatched-rss','rain-rss','no-humidity'])for(const units of ['C','F']) {
        const f=route.makeFixture(route.locations[0],'newer');
        f.basePub='202609161400';f.rssPub='202609241400';
        f.missingShort=scenario==='missing-primary';
        f.short.forEach(r=>{r.t3h=35;r.tmn=30;r.tmx=40;});
        // Every forecast slot is synthetic. Tomorrow includes both extrema slots.
        f.rss=f.rss.map(r=>({...r,ftm:f.rssPub,date:r.date.replace('20260924',scenario==='unmatched-rss'?'20260930':'20260925')}));
        if(scenario==='no-humidity')f.rss.forEach(r=>{r.reh=-1;});
        if(scenario==='rain-rss')f.rss.forEach(r=>{r.pty=1;r.r06=6;r.s06=2;});
        if(scenario==='partial-rss')f.rss.forEach(r=>{
            for(const key of ['temp','tmn','tmx'])r[key]=-999;
            for(const key of ['sky','pty','reh','pop','r06','s06'])r[key]=-1;
        });
        const env=route.createHarness(version,f);
        const result=await env.request({temperatureUnit:units,windSpeedUnit:'m/s'});
        assert.deepEqual(result.traces,env.methods);
        const b=result.body,rows=b.midData.dailyData,dates=rows.map(r=>r.date),tomorrow=rows.find(r=>r.date==='20260925');
        if(['stale-primary','missing-primary','rain-rss','no-humidity'].includes(scenario)) {
            assert(tomorrow,scenario+' retains fresh RSS daily forecast');
            assert.equal(tomorrow.tmn,units==='C'?19:66);assert.equal(tomorrow.tmx,units==='C'?28:82);
            assert.equal(tomorrow.wfAm,scenario==='rain-rss'?'구름적고 비':'맑음');assert.equal(b.shortRssPubDate,f.rssPub);
            if(scenario==='no-humidity')assert.equal(tomorrow.reh,undefined);
            assert.equal(tomorrow.r06,undefined);assert.equal(tomorrow.s06,undefined);
            if(scenario==='rain-rss')assert(b.short.some(r=>r.r06>0),'hourly precipitation remains usable');
        } else assert.equal(tomorrow,undefined,'untouched stale fields cannot become fresh daily weather');
        assert(dates.includes('20260923'));assert(dates.includes('20260917'));assert(dates.includes('20260928'));
        assert.equal(dates.length,new Set(dates).size);assert.deepEqual(dates,[...dates].sort());
        assert(!JSON.stringify(b).includes('_dailyShortRss'),'provenance stays request-local');
        assert(!result.logs.some(row=>row.args.some(arg=>/TypeError|ReferenceError/.test(String(arg)))));
        summaries.push({version,scenario,units,dates,middlewareCount:result.traces.length});
    }
    for(const version of ['1.0','2.0'])for(const scenario of ['stored-day3','stale-day3','partial-day3','absent-day3','legacy-db1','shower-cloudy','shower-overcast'])for(const units of ['C','F']) {
        const f=route.makeFixture(route.locations[0],'newer');
        const c=h.prepare(h.collector());c.organizeLandData(0,h.response([captured]),{date:'20260924',time:'0600'});f.land=c.resultList[0].data[0];
        if(scenario.startsWith('shower-'))f.land.wf4Am=f.land.wf4Pm=scenario==='shower-cloudy'?'구름많고 소나기':'흐리고 소나기';
        if(scenario==='partial-day3')f.short.forEach(r=>{if(r.date==='20260927')r.tmn=-50;});
        if(scenario==='absent-day3')f.short=f.short.filter(r=>r.date<'20260927');
        const pub=scenario==='stale-day3'?'202609161400':f.basePub;
        f.shortPublications={'20260927':pub};
        if(scenario!=='legacy-db1')f.dailySource={pubDate:pub,rows:f.short};
        const result=await route.createHarness(version,f).request({temperatureUnit:units,windSpeedUnit:'m/s'});
        const b=result.body,rows=b.midData.dailyData,d3=rows.find(r=>r.date==='20260927');
        const available=!['stale-day3','partial-day3','absent-day3'].includes(scenario) && !(scenario==='legacy-db1'&&version==='1.0');
        assert.equal(!!d3,available,version+' '+scenario);
        assert.equal(b.midData.dailyStatus.healthy,available);
        if(d3){assert.equal(d3.tmn,units==='C'?18:64);assert.equal(d3.tmx,units==='C'?27:80);assert.equal(d3.r06,undefined);}
        assert(!b.short.some(r=>r.date==='20260927'),'hourly contract unchanged');
        if(scenario.startsWith('shower-')){
            const d4=rows.find(r=>r.date==='20260928');assert.equal(d4.wfAm,f.land.wf4Am);assert.equal(d4.ptyAm,1);assert.equal(d4.skyAm,scenario==='shower-cloudy'?'sun_bigcloud_rain':'cloud_rain');
        }
        assert(!JSON.stringify(b).includes('dailySource'));assert(!JSON.stringify(b).includes('dailyRows'));
        assert(!result.logs.some(row=>row.args.some(arg=>/TypeError|ReferenceError/.test(String(arg)))));
        summaries.push({version,scenario,units,day3:available,status:b.midData.dailyStatus});
    }
    const result={fixedClock:process.env.TW_SMOKE_NOW,scenarioCount:summaries.length,outcome:'passed',scenarios:summaries};
    if(process.env.TW_DAILY_EVIDENCE)fs.writeFileSync(process.env.TW_DAILY_EVIDENCE,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
}
main().catch(err=>{console.error(err.stack);process.exitCode=1;});
