// Drive the real KMA middleware with the shared September 24 weather fixture and
// a movable annual date to verify both sides of an official date correction.
'use strict';
process.env.TZ = 'UTC'; // The existing RSS fixture clock models KST from a UTC host.
const assert = require('assert');
const {createHarness, makeFixture, locations} = require('./rss-response-smoke');
const strings = require('../../locales/ko.json');

async function run() {
    for (const db of ['1.0','2.0']) {
        const fixture = makeFixture(locations[0],'newer');
        fixture.zoneRows = [];
        let date = '2026-09-24';
        const calendar = {readYear:year => date && {year,terms:[{id:'solar-315',nameKo:'입춘',date}]}};
        const env = createHarness(db,fixture,{modules:{'./calendar':calendar}, translate:key=>strings[key] || key});
        async function current(locale,unit,addr=false) {
            return (await env.request({temperatureUnit:unit},{locale,addr})).body.current;
        }
        const ko = await current('ko','C');
        assert.equal(ko.summaryForDate, '2026-09-24');
        assert.match(ko.summary,/최저 .+℃, 최고 .+℃, 입춘/);
        // The merged province maps Dong-gu, but a missing district leaves warning coverage unknown.
        async function combinedProvinceSummary(second, third) {
            const changed = makeFixture(Object.assign({}, locations[0], {
                town: {first: '전남광주통합특별시', second, third}
            }), 'newer');
            changed.zoneRows = [];
            changed.townRows = [changed.place];
            const local = createHarness(db, changed, {modules: {'./calendar': calendar}, translate: key => strings[key] || key});
            return (await local.request({temperatureUnit: 'C'}, {locale: 'ko'})).body.current;
        }
        assert.match((await combinedProvinceSummary('동구', '충장동')).summary, /입춘/);
        const uncoveredWeather = await combinedProvinceSummary('', '');
        assert.equal(uncoveredWeather.summaryForDate, ko.summaryForDate);
        assert.match(uncoveredWeather.summary,/최저 .+℃, 최고 .+℃/);
        assert.doesNotMatch(uncoveredWeather.summary,/입춘/);
        const areaCode = require('../../lib/kmaWarningZones').zonesForTown(fixture.place.town)[0];
        fixture.zoneRows.push({active:true, areaCode, warnVar:3, warnStress:0});
        const air = {stationName:'중구',dataTime:'2026-09-24 09:00',pm25Value:200,pm25Grade:4};
        fixture.arpltnInfo = {arpltn:air,list:[air],stnList:[[air]]};
        const hazardous = await current('ko','C');
        assert.match(hazardous.summary,/한파주의보/);
        assert.match(hazardous.summary,/먼지/);
        assert.doesNotMatch(hazardous.summary,/입춘/);
        fixture.zoneRows.length = 0;
        delete fixture.arpltnInfo;
        const en = await current('en','C');
        assert.equal(en.summaryForDate,ko.summaryForDate);
        assert.doesNotMatch(en.summary,/입춘/);
        assert.equal(en.summaryWeather,ko.summaryWeather);
        assert.equal(en.summaryAir,ko.summaryAir);
        const inF = await current('ko','F',true);
        assert.match(inF.summary,/℉/);
        date = '2026-09-25';
        assert.doesNotMatch((await current('ko','C')).summary,/입춘/);
        date = null;
        assert.equal((await current('ko','C')).summaryForDate,undefined);
        date = '2026-09-24';
        fixture.country = 'JP';
        assert.equal((await current('ko','C')).summaryForDate,undefined);
    }
    console.log('KR coord/address, units, locale, correction, unavailable year and foreign country passed');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
