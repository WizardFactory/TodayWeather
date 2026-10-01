import { readFileSync, writeFileSync } from "node:fs";
import { resolveTokens } from "../packages/design-tokens/resolver.mjs";
const source = JSON.parse(
  readFileSync(
    new URL("../packages/design-tokens/tokens.json", import.meta.url),
  ),
);
const colors = Object.fromEntries(
  ["light", "dark"].map((appearance) => [
    appearance,
    resolveTokens(source, { appearance, tier: "mobile" })["semantic.bg.canvas"]
      .cssValue,
  ]),
);
// Runs before the bundle or first paint, without an inline script/CSP exception.
const script = `/* Generated from the shared canvas tokens; regenerate with generate:tokens. */
(function(){
 var root=document.documentElement, colors=${JSON.stringify(colors)}, pref={appearance:'system',heroStyle:'sky',textScale:1,motion:false};
 try {
  var display;try{display=JSON.parse(localStorage.getItem('tw.web.v1.display')||'null');}catch(e){}
  if(display&&display.version===1){
   if(['system','light','dark'].indexOf(display.appearance)>=0)pref.appearance=display.appearance;
   if(['sky','plain','classic'].indexOf(display.heroStyle)>=0)pref.heroStyle=display.heroStyle;
   if([.9,1,1.15,1.3].indexOf(display.textScale)>=0)pref.textScale=display.textScale;
   pref.motion=display.motion===true;
  }else{
   var saved=JSON.parse(localStorage.getItem('tw.web.v1.preferences')||'null'), theme=saved&&saved.version===1&&saved.settings&&saved.settings.theme;
   if(['light','dark','photo','classic'].indexOf(theme)>=0){pref.appearance=theme==='dark'?'dark':'light';pref.heroStyle=theme==='photo'?'sky':theme==='classic'?'classic':'plain';}
  }
 }catch(e){}
 var resolved=pref.appearance==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):pref.appearance;
 root.dataset.appearance=pref.appearance;root.dataset.resolvedAppearance=resolved;root.dataset.heroStyle=pref.heroStyle;root.dataset.motion=String(pref.motion);
 root.dataset.theme=pref.heroStyle==='sky'?'photo':pref.heroStyle==='classic'?'classic':resolved;
 root.style.setProperty('--tw-text-scale',String(pref.textScale));
 var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',colors[resolved]);
})();\n`;
const destination = new URL("../web/public/theme.js", import.meta.url);
if (readFileSync(destination, "utf8") !== script)
  writeFileSync(destination, script);
