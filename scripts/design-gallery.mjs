import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile} from '../packages/design-tokens/resolver.mjs';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function startGallery({port=0}={}) {
 // Validation before serving makes a clean checkout work and never starts collectors.
 compile(JSON.parse(readFileSync(resolve(root,'packages/design-tokens/tokens.json'),'utf8')));
 execFileSync(process.execPath,[resolve(root,'packages/design-tokens/generate.mjs')],{stdio:'pipe'});
 const allowed=['docs/design-system/references/','packages/design-tokens/generated/'];
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2'};
 const server=createServer((req,res)=>{
  try {
   const raw=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
   if(raw==='/'){res.writeHead(302,{Location:'/docs/design-system/references/gallery.html'});res.end();return;}
   const file=raw==='/'?'docs/design-system/references/gallery.html':raw.slice(1);
   const target=resolve(root,file);
   if(!target.startsWith(root+sep)||!allowed.some(p=>target.startsWith(resolve(root,p)+sep))||!types[extname(file)]){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(readFileSync(target));
  }catch {res.writeHead(404);res.end();}
 });
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(ok=>server.close(ok))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const port=Number(process.env.DESIGN_GALLERY_PORT??4175);const service=await startGallery({port});console.log(`TodayWeather reference gallery: ${service.url}`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await service.close();process.exit(0);});
}
