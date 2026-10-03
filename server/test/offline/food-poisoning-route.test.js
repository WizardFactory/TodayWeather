'use strict';
// Full production Express coordinate middleware with isolated provider/model boundaries.
process.env.TW_SMOKE_NOW = '2026-09-24T00:10:00Z';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const route = require('./rss-response-smoke');
const food = require('../../lib/foodPoisoning');
const recorded = require('./fixtures/mfds-risk-20261003.json');
function rows() {
    const input=JSON.parse(JSON.stringify(recorded));
    // Recorded provider values, explicitly shifted only for the fixed weather fixture's calendar.
    input.data.forEach(r=>{r.baseDate='20260924';r.regDatetime='2026-09-240800';});
    return food.parse(input,new Date(process.env.TW_SMOKE_NOW));
}
function strip(body) {
    const result=JSON.parse(JSON.stringify(body));
    for(const row of [result.current,...result.midData.dailyData]) {
        delete row.fsn;delete row.fsnGrade;delete row.fsnStr;
    }
    return result;
}
async function main() {
    const summary=[];
    const cases=[['Seoul','서울특별시','종로구','서울특별시','종로구'],
        ['Seoul','전남광주통합특별시','광산구','광주광역시','광산구'],
        ['Seoul','전남광주통합특별시','순천시','전라남도','순천시']];
    for(const version of ['1.0','2.0']) for(const [,first,second,sd,sgg] of cases) {
        const place=JSON.parse(JSON.stringify(route.locations[0]));place.town.first=first;place.town.second=second;
        if(sd==='광주광역시'){place.gCoord={lat:35.1601,lon:126.8514};place.mCoord={mx:58,my:74};}
        const build=()=>{const f=route.makeFixture(place,'newer');f.dailySource={pubDate:f.basePub,rows:f.short};f.townRows=[place];return f;};
        const baseline=await route.createHarness(version,build()).request({});
        for(const scenario of ['exact','province','store-failure','expired','future']) {
            const fixture=build();fixture.foodPoisoningRows=rows();
            if(scenario==='province')fixture.foodPoisoningRows=fixture.foodPoisoningRows.filter(r=>r.sgg==='');
            if(scenario==='store-failure')fixture.modelErrors={modelFoodPoisoning:'isolated read failure'};
            if(scenario==='expired')fixture.foodPoisoningRows.forEach(r=>{r.date='20260923';});
            if(scenario==='future')fixture.foodPoisoningRows.forEach(r=>{r.baseDate='20260925';});
            const env=route.createHarness(version,fixture);const result=await env.request({});
            assert.deepEqual(result.traces,env.methods);assert.deepEqual(strip(result.body),baseline.body);
            const valid=['exact','province'].includes(scenario);
            for(const date of ['20260924','20260925','20260926']) {
                const daily=result.body.midData.dailyData.find(r=>r.date===date);assert.ok(daily,JSON.stringify({version,first,second,scenario,date,dates:result.body.midData.dailyData.map(r=>r.date)}));
                if(valid) {
                    const expected=fixture.foodPoisoningRows.find(r=>r.sd===sd && r.sgg===(scenario==='province'?'':sgg) && r.date===date);assert.ok(expected);
                    assert.equal(daily.fsn,expected.value);assert.equal(daily.fsnGrade,expected.grade);
                    assert.equal(daily.fsnStr,['LOC_ATTENTION','LOC_CAUTION','LOC_WARNING','LOC_HAZARD'][expected.grade]);
                } else assert.equal('fsn' in daily,false);
            }
            if(valid)assert.equal(result.body.current.fsn,result.body.midData.dailyData.find(r=>r.date==='20260924').fsn);
            else assert.equal('fsn' in result.body.current,false);
            summary.push({version,first,second,scenario,status:200});
        }
    }
    assert.ok(!/var list = \[[^\]]*'fsn'/.test(fs.readFileSync(path.resolve(__dirname,'../../lib/lifeIndexKmaRequester.js'),'utf8')));
    const manager=fs.readFileSync(path.resolve(__dirname,'../../controllers/controllerManager.js'),'utf8');
    assert.match(manager,/foodPoisoning\.due\(riskNow, putAll\)/);
    assert.match(manager,/function FoodPoisoning\(callback\)/);
    const out=process.env.FOOD_POISONING_CAPTURE;
    if(out)fs.writeFileSync(out,JSON.stringify(summary,null,2));
    console.log('Food-poisoning coordinate path: '+summary.length+' DB-version/region/failure scenarios passed; no legacy fsn scheduled.');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
