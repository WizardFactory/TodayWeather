import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile} from './resolver.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const outputs=compile(JSON.parse(readFileSync(resolve(root,'tokens.json'),'utf8')));
mkdirSync(resolve(root,'generated'),{recursive:true});
for(const [name,content] of Object.entries(outputs))writeFileSync(resolve(root,'generated',name),content);
console.log(`Generated ${Object.keys(outputs).length} token outputs`);
