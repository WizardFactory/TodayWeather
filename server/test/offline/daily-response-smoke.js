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
            assert.equal(b.midData.dailyStatus.healthy,true);
        } else {
            assert(!dates.includes('20260928'));assert.equal(b.midData.dailyStatus.healthy,false);
        }
        assert.equal(b.midData.rssPubDate,undefined);
        assert(!JSON.stringify(b).includes('NaN'));
        assert(!result.logs.some(row=>row.args.some(arg=>/TypeError|ReferenceError/.test(String(arg)))));
        summaries.push({version,scenario,units,dates,status:b.midData.dailyStatus,middlewareCount:result.traces.length});
    }
    const result={fixedClock:process.env.TW_SMOKE_NOW,scenarioCount:summaries.length,outcome:'passed',scenarios:summaries};
    if(process.env.TW_DAILY_EVIDENCE)fs.writeFileSync(process.env.TW_DAILY_EVIDENCE,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
}
main().catch(err=>{console.error(err.stack);process.exitCode=1;});
