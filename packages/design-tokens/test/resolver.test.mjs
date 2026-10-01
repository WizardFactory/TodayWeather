import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTokens, compile, contrast } from '../resolver.mjs';

const color = hex => ({ $type:'color', $value:{colorSpace:'srgb',components:hex.match(/\w\w/g).map(x=>parseInt(x,16)/255)} });
const fixture = () => ({
 primitive: {white:color('ffffff'), ink:color('000000')},
 semantic: {
  bg: {surface:{$type:'color',$value:'{primitive.white}'}},
  text: {primary:{$type:'color',$value:'{primitive.ink}',$extensions:{'org.todayweather':{contrast:{surfaces:['semantic.bg.surface'],minimum:4.5}}}}}
 }
});
test('alias resolution retains declared type and mode',()=>{
  const d=fixture();d.semantic.text.primary.$extensions['org.todayweather'].modes={dark:'{primitive.white}'};
  assert.equal(resolveTokens(d,{appearance:'light'})['semantic.text.primary'].cssValue,'#000000');
  assert.equal(resolveTokens(d,{appearance:'dark'})['semantic.text.primary'].cssValue,'#ffffff');
});
test('missing refs and cycles reject',()=>{
  const d=fixture();d.semantic.text.primary.$value='{primitive.absent}';assert.throws(()=>resolveTokens(d),/Unknown reference/);
  d.semantic.text.primary.$value='{semantic.text.primary}';assert.throws(()=>resolveTokens(d),/Cycle/);
});
test('type mismatch, malformed dimensions/colors, CSS collisions reject',()=>{
  const d=fixture();d.semantic.text.primary.$type='dimension';assert.throws(()=>resolveTokens(d),/Type mismatch/);
  for(const value of [{value:NaN,unit:'rem'},{value:2,unit:'em'}]) assert.throws(()=>resolveTokens({primitive:{x:{$type:'dimension',$value:value}}}),/Invalid dimension/);
  assert.throws(()=>resolveTokens({primitive:{x:{$type:'color',$value:{colorSpace:'srgb',components:[2,0,0]}}}}),/Invalid color/);
  assert.throws(()=>compile({semantic:{'a-b':{$type:'number',$value:1},a:{b:{$type:'number',$value:2}}}}),/CSS name collision/);
});
test('component aliases cannot skip semantic; unsupported modes fail',()=>{
  const d=fixture();d.component={bad:{$type:'color',$value:'{primitive.white}'}};assert.throws(()=>resolveTokens(d),/Component must reference semantic/);
  delete d.component;d.semantic.text.primary.$extensions['org.todayweather'].modes={sepia:'{primitive.ink}'};assert.throws(()=>compile(d),/Unsupported mode/);
  assert.throws(()=>resolveTokens(fixture(),{appearance:'sepia'}),/Unsupported context/);
});
test('contrast threshold violation rejects instead of rounding up',()=>{
  const d=fixture();d.primitive.ink=color('888888');assert.throws(()=>compile(d),/Contrast/);
  assert.equal(contrast('#000000','#ffffff'),21);
});
test('required roles, full tiers and deterministic outputs',()=>{
  const d=fixture();d.$extensions={'org.todayweather':{required:['semantic.type.body.size']}};assert.throws(()=>compile(d),/Missing required/);
  delete d.$extensions;const a=compile(d);const b=compile(JSON.parse(JSON.stringify(d)));assert.deepEqual(a,b);assert.match(a['tokens.css'],/--tw-text-primary/);assert.match(a['tokens.ts'],/as const/);assert.ok(JSON.parse(a['contrast-report.json']).pairs.every(p=>p.ratio>=p.minimum));
});
