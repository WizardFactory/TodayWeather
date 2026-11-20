'use strict';
const assert = require('assert');
const summary = require('../../lib/solarTerms/summary');
const config = require('../../config/solar-terms/kr.json');

const input = {id:'solar-315', nameKo:'입춘', date:'2026-02-04'};
const current = {date:'20260204', time:10, t1h:2};
const ranked = items => summary.select(items, current, {temperatureUnit:'C'}, input, null, {__:x=>x});
const clear = {kind:'weather', str:'맑음', grade:2.5};
const breeze = {kind:'wind', str:'약한 바람', grade:2};
assert.equal(ranked([clear,breeze]), '입춘, 맑음');
assert(summary.activate(config));

function copyConfig() { return JSON.parse(JSON.stringify(config)); }
for (const mutate of [p => p.terms.pop(), p => { p.terms[0].id = 'solar-500'; },
    p => {p.terms[0] = p.terms[1];}, p => {p.terms[0].group = 'none';}]) {
    const bad = copyConfig();
    mutate(bad);
    assert.strictEqual(summary.activate(bad), false);
    assert.equal(ranked([clear]),'입춘, 맑음');
}
const spare = {id:'solar-345', nameKo:'경칩'};
const excluded = {id:'solar-30', nameKo:'곡우'};
const labels = {__:s=>s};
function choose(term, items, reported = {}, range = null) {
    return summary.select(items, Object.assign({},current,reported), {temperatureUnit:'C'},term,range,labels);
}
assert.equal(choose(spare,[clear]), '맑음, 경칩');
assert.equal(choose(spare,[clear,breeze]), '맑음, 약한 바람');
assert.equal(choose(excluded,[clear]),'맑음');
const alternate = copyConfig();
alternate.terms.find(row=>row.id==='solar-30').group = 'featured';
assert(summary.activate(alternate));
assert.equal(choose(excluded,[clear]),'곡우, 맑음');
assert(summary.activate(config));
const warning = {weather:9, weatherStr:'한파', level:1, levelStr:'주의보'};
const hazards = [{kind:'air', str:'미세먼지 매우 나쁨', grade:4},
    {kind:'feels', str:'체감온도 -25˚', grade:8}];
assert.equal(choose(input,hazards,{specialInfo:[warning,warning],sensorytem:-25}), '한파주의보, 미세먼지 매우 나쁨');
assert.equal(choose(input,[clear,{kind:'uv',str:'자외선 높음',grade:2}],{ultrvGrade:2}),
    '자외선 높음, 입춘');
const {remainingSeconds} = require('../../lib/solarTerms/summaryCache');
assert.equal(remainingSeconds('2026-02-04', Date.parse('2026-02-04T14:59:58.900Z')),1);
assert.equal(remainingSeconds('2026-02-04', Date.parse('2026-02-04T15:00:00Z')),0);
assert.equal(remainingSeconds('2026-02-05', Date.parse('2026-02-04T14:59:59Z')),0);
console.log('solar-term summary priorities, KST expiry and policy validation passed');
