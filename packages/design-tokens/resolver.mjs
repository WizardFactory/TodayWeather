const extension = node => node.$extensions?.['org.todayweather'] ?? {};
const ref = value => typeof value === 'string' && /^\{[^{}]+\}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const modes = ['light','dark','mobile','tablet','desktop','wide'];
export const tierQueries = Object.freeze({tablet:'(min-width: 768px) and (min-height: 540px) and (pointer: coarse) and (hover: none)',desktop:'(min-width: 768px)',compact:'(pointer: coarse) and (max-height: 539px)',wide:'(min-width: 1600px)'});
function flatten(doc, path='', result={}) {
  for (const [key,node] of Object.entries(doc)) {
    if(key.startsWith('$')) continue;
    if(!/^[a-zA-Z0-9-]+$/.test(key) || !node || typeof node!=='object') throw Error(`Invalid token key ${path}.${key}`);
    const name=path?`${path}.${key}`:key;
    if('$value' in node) result[name]=node;
    else flatten(node,name,result);
  }
  return result;
}
function css(type,v) {
  const bad=()=>{throw Error(`Invalid ${type} value`);};
  switch(type) {
    case 'color': {
      if(v?.colorSpace!=='srgb'||v.components?.length!==3||!v.components.every(x=>finite(x)&&x>=0&&x<=1)|| (v.alpha!==undefined&&(!finite(v.alpha)||v.alpha<0||v.alpha>1))) return bad();
      const h='#'+v.components.map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join('');
      return v.alpha===undefined||v.alpha===1?h:`rgb(${v.components.map(x=>Math.round(x*255)).join(' ')} / ${v.alpha})`;
    }
    case 'dimension': if(!finite(v?.value)||!['px','rem'].includes(v.unit)||v.value<0)return bad();return `${v.value}${v.unit}`;
    case 'duration': if(!finite(v?.value)||!['ms','s'].includes(v.unit)||v.value<0)return bad();return `${v.value}${v.unit}`;
    case 'number': if(!finite(v))return bad();return String(v);
    case 'fontWeight': if(!finite(v)||v<1||v>1000)return bad();return String(v);
    case 'fontFamily': if(!Array.isArray(v)||!v.length||!v.every(x=>typeof x==='string'&&!/[;{}\n]/.test(x)))return bad();return v.map(x=>['-apple-system','BlinkMacSystemFont','system-ui','sans-serif','serif','monospace'].includes(x)?x:JSON.stringify(x)).join(', ');
    case 'cubicBezier': if(!Array.isArray(v)||v.length!==4||!v.every(finite)||v[0]<0||v[0]>1||v[2]<0||v[2]>1)return bad();return `cubic-bezier(${v.join(',')})`;
    case 'shadow': {
      const list=Array.isArray(v)?v:[v];if(!list.length)return bad();
      return list.map(s=>{if(!s||typeof s!=='object')return bad();return `${css('dimension',s.offsetX)} ${css('dimension',s.offsetY)} ${css('dimension',s.blur)} ${css('dimension',s.spread)} ${css('color',s.color)}`;}).join(', ');
    }
    default: throw Error(`Unsupported type ${type}`);
  }
}
export function resolveTokens(doc,{appearance='light',tier='mobile',wide=false}={}) {
  if(!['light','dark'].includes(appearance)||!['mobile','tablet','desktop'].includes(tier)||typeof wide!=='boolean')throw Error('Unsupported context');
  const flat=flatten(doc),result={};
  function resolve(path,stack=[]) {
    if(stack.includes(path))throw Error(`Cycle: ${[...stack,path].join(' → ')}`);
    if(result[path])return result[path];
    const node=flat[path];if(!node)throw Error(`Unknown reference ${path}`);
    if(!node.$type)throw Error(`Missing explicit type ${path}`);
    const ex=extension(node);for(const k of Object.keys(ex.modes??{}))if(!modes.includes(k))throw Error(`Unsupported mode ${k}`);
    if(ex.floor!==undefined&&(!finite(ex.floor)||ex.floor<(path.includes('.micro.')?.75:.8125)))throw Error(`Invalid type floor ${path}`);
    const variant=wide&&ex.modes?.wide!==undefined?ex.modes.wide:ex.modes?.[tier]??ex.modes?.[appearance]??node.$value;
    const deref=(v)=>{
      if(ref(v)) {const target=v.slice(1,-1);if(path.startsWith('component.')&&!target.startsWith('semantic.'))throw Error(`Component must reference semantic: ${path}`);const r=resolve(target,[...stack,path]);return r;}
      return null;
    };
    if(path.startsWith('primitive.')&&ref(variant))throw Error(`Primitive must be raw: ${path}`);
    if(path.startsWith('component.')&&!ref(variant))throw Error(`Component must reference semantic: ${path}`);
    let value=variant;const alias=deref(value);
    if(alias) {if(alias.type!==node.$type)throw Error(`Type mismatch ${path}`);value=alias.value;}
    else if(node.$type==='shadow')value=(Array.isArray(value)?value:[value]).map(s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,deref(v)?.value??v])));
    const cssValue=css(node.$type,value);
    result[path]={type:node.$type,value,cssValue,extension:ex};return result[path];
  }
  for(const path of Object.keys(flat).sort())resolve(path);
  return result;
}
const luminance=h=>{
  if(!/^#[\da-f]{6}$/i.test(h))throw Error('Contrast needs opaque srgb colors');
  return h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
};
export function contrast(a,b) {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const cssName = p => '--tw-'+p.replace(/^(semantic|component)\./,'').replaceAll('.','-');
function block(values,selector) {
 return `${selector} {\n${Object.entries(values).filter(([p])=>!p.startsWith('primitive.')).map(([p,t])=>`  ${cssName(p)}: ${t.cssValue};`).join('\n')}\n}\n`;
}
export function compile(doc) {
 const flat=flatten(doc), names=new Set();
 for(const p of Object.keys(flat).filter(p=>!p.startsWith('primitive.'))) {const n=cssName(p);if(names.has(n))throw Error(`CSS name collision ${n}`);names.add(n);}
 const metadata=extension(doc);
 for(const p of metadata.required??[])if(!flat[p])throw Error(`Missing required ${p}`);
 for(const p of metadata.tierSizes??[]) {
  if(!flat[p])throw Error(`Missing required ${p}`);
  if(!['mobile','tablet','desktop'].every(t=>extension(flat[p]).modes?.[t]!==undefined))throw Error(`Missing required tier ${p}`);
 }
 const contexts={};const pairs=[];
 for(const appearance of ['light','dark']) for(const tier of ['mobile','tablet','desktop']) {
  const values=resolveTokens(doc,{appearance,tier});contexts[`${appearance}.${tier}`]=values;
  for(const [path,t] of Object.entries(values)) {
   const rule=t.extension.contrast;if(!rule)continue;
   if(!finite(rule.minimum)||rule.minimum<3||!Array.isArray(rule.surfaces)||!rule.surfaces.length)throw Error(`Invalid contrast contract ${path}`);
   for(const surface of rule.surfaces) {
    if(!values[surface])throw Error(`Unknown reference ${surface}`);
    const ratio=contrast(t.cssValue,values[surface].cssValue);const pair={appearance,tier,path,surface,ratio,minimum:rule.minimum};pairs.push(pair);
    if(ratio<rule.minimum)throw Error(`Contrast ${path} / ${surface} (${appearance}) ${ratio.toFixed(3)} < ${rule.minimum}`);
   }
  }
 }
 const light=contexts['light.mobile'];let stylesheet='/* Generated from tokens.json; do not edit. */\n'+block(light,':root');
 stylesheet+=block(contexts['dark.mobile'],'[data-appearance="dark"]');
 stylesheet+=`@media (prefers-color-scheme: dark) {\n${block(contexts['dark.mobile'],':root:not([data-appearance="light"]):not([data-appearance="dark"]), [data-appearance="system"]')}\n}\n`;
 // Tier blocks contain only tier-dependent tokens so they cannot overwrite appearance.
 const typeOnly=(v)=>Object.fromEntries(Object.entries(v).filter(([p])=>['mobile','tablet','desktop'].some(t=>contexts[`light.${t}`][p].cssValue!==light[p].cssValue)));
 stylesheet+=`@media ${tierQueries.desktop} {\n${block(typeOnly(contexts['light.desktop']),':root')}\n}\n`;
 stylesheet+=`@media ${tierQueries.tablet} {\n${block(typeOnly(contexts['light.tablet']),':root')}\n}\n`;
 stylesheet+=`@media ${tierQueries.compact} {\n${block(typeOnly(light),':root')}\n}\n`;
 stylesheet+=`@media (max-width: 767px) {\n${block(typeOnly(light),':root')}\n}\n`;
 const wideValues=resolveTokens(doc,{tier:'desktop',wide:true});const wideOnly=Object.fromEntries(Object.entries(wideValues).filter(([p])=>extension(flat[p]).modes?.wide!==undefined));
 stylesheet+=`@media (min-width: 1600px) and (pointer: fine), (min-width: 1600px) and (hover: hover) {\n${block(wideOnly,':root')}\n}\n`;
 const publicValues=Object.fromEntries(Object.entries(contexts).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).filter(([p])=>!p.startsWith('primitive.')).map(([p,t])=>[p.replace(/^(semantic|component)\./,''),t.cssValue]))]));
 const json=JSON.stringify({values:publicValues,tierQueries},null,2);
 const reference=Object.fromEntries(Object.entries(light).map(([p,t])=>[p,{type:t.type,value:t.value,cssName:cssName(p),description:flat[p].$description??'',extension:t.extension}]));
 return {'tokens.css':stylesheet,'tokens.js':`export const tokens = ${json};\n`,'tokens.ts':`export const tokens = ${json} as const;\nexport type TokenName = keyof typeof tokens.values['light.mobile'];\n`,'token-reference.json':JSON.stringify(reference,null,2)+'\n','contrast-report.json':JSON.stringify({pairs},null,2)+'\n'};
}
