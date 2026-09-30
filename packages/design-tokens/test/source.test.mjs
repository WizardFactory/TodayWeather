import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compile,resolveTokens} from '../resolver.mjs';
const source=JSON.parse(readFileSync(new URL('../tokens.json',import.meta.url),'utf8'));
test('production source covers 13 type roles, tiers, floors and D8/D4',()=>{
 const e=source.$extensions['org.todayweather'];assert.equal(e.tierSizes.length,13);
 for(const appearance of ['light','dark'])for(const tier of ['mobile','tablet','desktop']) {
  const v=resolveTokens(source,{appearance,tier});
  for(const p of e.tierSizes){assert.equal(v[p].value.unit,'rem');assert.ok(v[p].value.value>=v[p].extension.floor);assert.ok(v[p.replace('.size','.weight')]);assert.ok(v[p.replace('.size','.leading')]);}
  assert.equal(v['semantic.chart.range.cool'].cssValue,'#9bcdf0');assert.equal(v['semantic.chart.range.warm'].cssValue,'#f0c77f');assert.equal(v['semantic.air.kr6.5.fill'].cssValue,'#b4004b');
 }
 const outputs=compile(source);assert.deepEqual(outputs,compile(JSON.parse(JSON.stringify(source))));
 const pairs=JSON.parse(outputs['contrast-report.json']).pairs;assert.ok(pairs.length>300);assert.ok(pairs.every(p=>p.ratio>=p.minimum));
 assert.match(outputs['tokens.css'],/--tw-chart-column: 4.5rem/);assert.match(outputs['tokens.css'],/prefers-color-scheme: dark/);
});
