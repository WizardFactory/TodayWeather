'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), assert = require('assert');
var root = '/root/.paseo/worktrees/08mqediz/eatable-whale';
var temp = fs.mkdtempSync('/tmp/tw-independent-env-');
var fixture = path.join(temp, 'server');
fs.mkdirSync(fixture); fs.mkdirSync(path.join(fixture, 'config')); fs.mkdirSync(path.join(fixture, 'bin'));
['app.js', 'bin/www', 'config/env.js', 'config/config.js'].forEach(function (p) { fs.copyFileSync(path.join(root,'server',p),path.join(fixture,p)); });
fs.writeFileSync(path.join(fixture,'package.json'),JSON.stringify({scripts:{start:JSON.parse(fs.readFileSync(path.join(root,'server/package.json'),'utf8')).scripts.start}}));
fs.writeFileSync(path.join(fixture,'.env'),'\ufeffSERVER_MODE=gather\r\nDB_DATA_VERSION=2.0\r\nPORT=4567\r\nDONGNAE_SECRET_KEYS=\'["synthetic-only"]\'\r\nINDEPENDENT_QUOTED="first\\nsecond"\r\nINDEPENDENT_LITERAL=${PORT}\r\n');
fs.writeFileSync(path.join(temp,'.env'),'SERVER_MODE=wrong-cwd\nPORT=9999');
// This preload only registers an intercept. Node itself loads the entrypoint.
fs.writeFileSync(path.join(temp,'hook.js'),[
"var Module=require('module'), assert=require('assert'), path=require('path');",
"var real=Module._load;",
"Module._load=function(name){ if(name==='newrelic'){",
"assert.strictEqual(process.env.SERVER_MODE,'gather');",
"var config=real(process.env.INDEPENDENT_FIXTURE+'/config/config.js',module,false);",
"assert.strictEqual(config.mode,'gather'); assert.strictEqual(config.port,'4567');",
"assert.strictEqual(config.db.version,'2.0');",
"assert.deepStrictEqual(JSON.parse(config.keyString.dongnae_forecast_keys),['synthetic-only']);",
"assert.strictEqual(process.env.INDEPENDENT_QUOTED,'first\\nsecond');",
"assert.strictEqual(process.env.INDEPENDENT_LITERAL,'${PORT}');",
"console.log('independent normal entrypoint passed '+path.basename(process.argv[1])); process.exit(0);",
"} return real.apply(this,arguments); };"
].join('\n'));
var env={PATH:process.env.PATH,NODE_PATH:'/tmp/issue-2563-deps/node_modules',NODE_OPTIONS:'--require='+path.join(temp,'hook.js'),INDEPENDENT_FIXTURE:fixture};
try {
[{cmd:process.execPath,args:[path.join(fixture,'app.js')],cwd:temp},
 {cmd:process.execPath,args:[path.join(fixture,'bin/www')],cwd:os.tmpdir()},
 {cmd:'npm',args:['--prefix',fixture,'start','--silent'],cwd:temp}].forEach(function(t){
 var r=cp.spawnSync(t.cmd,t.args,{env:env,cwd:t.cwd,encoding:'utf8',timeout:15000});
 assert.ifError(r.error); assert.strictEqual(r.status,0,r.stdout+r.stderr);
 assert.ok(r.stdout.indexOf('independent normal entrypoint passed ')>=0);
 console.log(r.stdout.trim());
});
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
