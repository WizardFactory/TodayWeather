import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,webkit} from '@playwright/test';
import {compile,resolveTokens} from '../../packages/design-tokens/resolver.mjs';

const source=JSON.parse(readFileSync(new URL('../../packages/design-tokens/tokens.json',import.meta.url),'utf8'));
const profiles=[
 {name:'mobile',width:402,height:874,touch:true,tier:'mobile'},
 {name:'tablet',width:820,height:1180,touch:true,tier:'tablet'},
 {name:'desktop',width:1440,height:900,touch:false,tier:'desktop'},
 {name:'wide',width:1600,height:900,touch:false,tier:'desktop',wide:true},
 {name:'compact',width:1600,height:530,touch:true,tier:'mobile'},
 // Playwright touch contexts have hover:none. Synthesize only input capabilities
 // in CSSOM for this combination; viewport, cascade and computed values stay real.
 {name:'compact-coarse-hover',width:1600,height:530,touch:true,tier:'mobile',syntheticHover:true}
];
const probes=['semantic.type.body.size','semantic.type.hero-temp.size','semantic.type.title-1.size','component.chart.column','semantic.layout.columns','semantic.bg.canvas'];
const property=path=>'--tw-'+path.replace(/^(semantic|component)\./,'').replaceAll('.','-');

export async function checkTokenCSS(browser,engineName) {
 const stylesheet=compile(source)['tokens.css'],result={cases:[],errors:[]};
 for(const profile of profiles) {
  const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},isMobile:profile.touch,hasTouch:profile.touch});
  try {
   const page=await context.newPage();await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>Token cascade probe</body></html>');await page.addStyleTag({content:stylesheet});
   const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
   if(viewport.width!==profile.width||viewport.height!==profile.height)throw Error(`${engineName}/${profile.name}: unexpected layout viewport ${JSON.stringify(viewport)}`);
   if(profile.syntheticHover)await page.evaluate(()=>{
    for(const sheet of document.styleSheets)for(const rule of sheet.cssRules)if(rule instanceof CSSMediaRule) {
     rule.media.mediaText=rule.media.mediaText.replaceAll('(pointer: coarse)','(min-width: 0px)').replaceAll('(pointer: fine)','(max-width: 0px)').replaceAll('(hover: hover)','(min-width: 0px)').replaceAll('(hover: none)','(max-width: 0px)');
    }
   });
   for(const colorScheme of ['light','dark'])for(const appearance of [null,'system','light','dark']) {
    await page.emulateMedia({colorScheme});
    await page.evaluate(value=>{if(value===null)document.documentElement.removeAttribute('data-appearance');else document.documentElement.dataset.appearance=value;},appearance);
    const effective=['light','dark'].includes(appearance)?appearance:colorScheme;
    const expected=resolveTokens(source,{appearance:effective,tier:profile.tier,wide:profile.wide??false});
    const actual=await page.evaluate(names=>Object.fromEntries(names.map(name=>[name,getComputedStyle(document.documentElement).getPropertyValue(name).trim()])),probes.map(property));
    const id=`${engineName}/${profile.name}/os-${colorScheme}/${appearance??'unset'}`;
    const mismatches=probes.filter(path=>actual[property(path)]!==expected[path].cssValue).map(path=>({path,expected:expected[path].cssValue,actual:actual[property(path)]}));
    const record={id,syntheticCapabilities:profile.syntheticHover??false,actual,mismatches};result.cases.push(record);
    if(mismatches.length)result.errors.push(record);
   }
  } finally {await context.close();}
 }
 return result;
}

if(import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const args=process.argv.slice(2),index=args.indexOf('--out'),out=resolve(index<0?'reports/sdlc/issue-2651-docs-type/token-css':args[index+1]);
 if(!out.startsWith(resolve('reports')+sep))throw Error('Output must stay under reports/');mkdirSync(out,{recursive:true});
 const result={cases:[],errors:[]};
 for(const [name,engine] of Object.entries({chromium,webkit})) {
  const browser=await engine.launch();try {const r=await checkTokenCSS(browser,name);result.cases.push(...r.cases);result.errors.push(...r.errors);}finally{await browser.close();}
 }
 writeFileSync(resolve(out,'results.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({cases:result.cases.length,failures:result.errors.length,examples:result.errors.slice(0,2)},null,2));if(result.errors.length)process.exitCode=1;
}
