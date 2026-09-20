import {mkdtemp, rm, readFile, stat, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {seedPaseoConfigFile, runWorktreeSetupCommands} from '/root/.nvm/versions/node/v22.22.2/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/utils/worktree.js';
import {readPaseoConfigForEdit} from '/root/.nvm/versions/node/v22.22.2/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/utils/paseo-config-file.js';
const source='/root/workspace/TodayWeather';
assert.equal(readPaseoConfigForEdit(source).ok,true);
assert.equal(readPaseoConfigForEdit(process.cwd()).ok,true);
assert.deepEqual(await readFile(join(source,'paseo.json')),await readFile('paseo.json'));
const temp=await mkdtemp(join(tmpdir(),'tw-paseo-runtime-'));
const target=join(temp,'worktree');
try {
 execFileSync('git',['worktree','add','--detach',target,'HEAD'],{cwd:source,stdio:'pipe'});
 await seedPaseoConfigFile({sourceCwd:source,targetCwd:target});
 const result=await runWorktreeSetupCommands({worktreePath:target,branchName:'HEAD',repoRootPath:source,cleanupOnFailure:false});
 assert.equal(result.length,1);assert.equal(result[0].exitCode,0);
 for(const [name,mode] of [['aleckim.pem',0o400],['credentials',0o600]]) {
  const file=join(target,'.aws',name);
  assert.deepEqual(await readFile(file),await readFile(join(source,'.aws',name)));
  assert.equal((await stat(file)).mode & 0o777,mode);
  execFileSync('git',['check-ignore','--quiet',file],{cwd:target});
 }
 console.log('PASS installed Paseo parser, source config seeding, real worktree setup, byte equality, modes and Git exclusion.');
 console.log('No SSH or AWS call. Secret contents were not printed. Temporary worktree cleaned up.');
} finally {
 execFileSync('git',['worktree','remove','--force',target],{cwd:source,stdio:'pipe'});
 await rm(temp,{recursive:true,force:true});
}
