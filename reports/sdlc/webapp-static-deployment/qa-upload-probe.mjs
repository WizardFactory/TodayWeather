import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync('/tmp/static-qa-upload-');
const fake=dir+'/aws'; const log=dir+'/calls';
writeFileSync(fake,`#!/usr/bin/env node
const fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.QA_CALLS,JSON.stringify(args)+'\\n');
if(args[0]==='cloudfront'&&args[1]==='get-distribution-config') console.log(JSON.stringify({DistributionConfig:{Aliases:{Items:[process.env.QA_ALIAS||'app.tdywx.xyz']},Origins:{Items:[{Id:'static',DomainName:'qa-bucket.s3.ap-northeast-2.amazonaws.com',OriginAccessControlId:'OAC'}]},DefaultCacheBehavior:{TargetOriginId:'static',ViewerProtocolPolicy:'redirect-to-https'}}}));
if(args[0]==='s3' && process.env.QA_FAIL==='yes'){console.error('synthetic upload failure');process.exit(2);}
`,{mode:0o700});
function run(extra={}){writeFileSync(log,''); const r=spawnSync(process.execPath,['scripts/deploy-web-static.mjs','--bucket','qa-bucket','--distribution','EQA123','--execute'],{encoding:'utf8',env:{...process.env,AWS_CLI:fake,QA_CALLS:log,...extra}}); const calls=readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);return {r,calls};}
const good=run(); assert.equal(good.r.status,0,JSON.stringify(good.r)); assert.equal(good.calls[0][1],'get-distribution-config');assert.equal(good.calls.at(-1)[1],'create-invalidation');assert.match(good.calls.at(-2)[3],/\/sw.js$/);assert.match(good.calls.at(-3)[3],/\/index.html$/); assert(!JSON.stringify(good.calls).includes('--delete'));
const reject=run({QA_ALIAS:'other.example'});assert.equal(reject.r.status,1);assert.equal(reject.calls.length,1);
const failure=run({QA_FAIL:'yes'});assert.equal(failure.r.status,1);assert.equal(failure.calls.length,2);assert.equal(failure.calls[1][0],'s3');assert.match(failure.calls[1][3],/\/assets\//);
console.log(JSON.stringify({mockOnly:true,actualAwsCalls:0,validUploadSequence:good.calls.length,destinationMismatchStoppedBeforeUpload:true,firstAssetFailureStoppedBeforeShellAndInvalidation:true},null,2));rmSync(dir,{recursive:true,force:true});
