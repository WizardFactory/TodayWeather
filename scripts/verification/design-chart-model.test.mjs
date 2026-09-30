import test from 'node:test';
import assert from 'node:assert/strict';
import {hourlyModel,dailyModel} from '../../docs/design-system/references/chart-model.js';
const day=24*60*60*1000;
const time='2026-10-01T03:00:00+09:00';
test('yesterday is aligned by exact comparison offset, not row position',()=>{
 const m=hourlyModel([{time,temperature:10,pop:0,rainMm:0}], [{time:new Date(Date.parse(time)-day).toISOString(),temperature:4}],null);
 assert.equal(m.rows[0].yesterday,4);assert.equal(m.rows[0].pop,0);assert.equal(m.rows[0].rainMm,0);
});
test('null breaks a line, current observation joins today and shared domain',()=>{
 const current={time:'2026-10-01T04:30:00+09:00',temperature:-12};
 const m=hourlyModel([{time,temperature:10},{time:'2026-10-01T06:00:00+09:00',temperature:null}],[],current);
 assert.equal(m.series[2].temperature,null);assert.equal(m.series[1].temperature,-12);assert.ok(m.domain[0]<=-12);assert.equal(m.current.temperature,-12);
 const outside=hourlyModel([{time,temperature:10}],[],current);assert.equal(outside.current,null);
});
test('daily shared scale includes observation and missing ranges remain absent',()=>{
 const m=dailyModel([{date:'2026-09-30',low:4,high:8},{date:'2026-10-01',low:5,high:10},{date:'2026-10-02',low:null,high:12}], '2026-10-01',20);
 assert.equal(m.rows[0].past,true);assert.equal(m.rows[1].today,true);assert.ok(m.domain[1]>=20);assert.equal(m.rows[2].hasRange,false);assert.equal(m.current.temperature,20);
});
test('invalid times, duplicate columns and inverted ranges reject',()=>{
 assert.throws(()=>hourlyModel([{time:'unknown',temperature:1}],[],null),/Invalid time/);
 assert.throws(()=>hourlyModel([{time,temperature:1},{time,temperature:2}],[],null),/Duplicate/);
 assert.throws(()=>dailyModel([{date:'2026-10-01',low:10,high:4}],'2026-10-01',null),/Inverted/);
});

test('one-row/empty/equal-valued input and invalid daily dates have explicit behavior',()=>{
 assert.deepEqual(hourlyModel([],[],null).domain,[0,1]);
 assert.deepEqual(hourlyModel([{time,temperature:5}],[],null).domain,[4,6]);
 assert.equal(dailyModel([], '2026-10-01',16).current,null);
 assert.throws(()=>dailyModel([{date:'2026-99-99',low:1,high:2}], '2026-10-01'),/Invalid date/);
});
