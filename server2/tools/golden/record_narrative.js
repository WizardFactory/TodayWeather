/* Test-only oracle: evaluate the named PR2805 legacy modules without Mongo/network. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const files = ['server/lib/kmaForecastRegions.js', 'server/lib/kmaForecastNarrative.js'];
const hashes = Object.fromEntries(files.map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
const regions = require(path.join(root, files[0]));
const sandbox = {module:{exports:{}}, Date, Number, String, Array, setTimeout, clearTimeout,
    log:{warn(){}}, require(name) { if(name === './kmaForecastRegions') return regions; throw Error('Unexpected dependency '+name); }};
vm.runInNewContext(fs.readFileSync(path.join(root,files[1]),'utf8'), sandbox, {filename:files[1]});
const Narrative = sandbox.module.exports;
const now = Date.parse('2026-10-17T03:00:00.000Z');
function read(stationId, doc) {
    const model = {find(){return {sort(){return this;},limit(){return this;},lean(){return this;},maxTimeMS(){return this;},exec(cb){cb(null,doc?[doc]:[]);}};}};
    return new Promise(resolve => new Narrative({model,now:()=>now}).read(stationId,(_,value)=>resolve(value)));
}
async function gather(stationId, items) {
    let doc;
    const model = {update(query, update, options, cb){doc=update.$setOnInsert;cb(null,{upserted:[{}]});}};
    const requester = {get(op,params,cb){if(op!=='getWthrSituation'||params.stnId!==stationId||params.numOfRows!==10)throw Error('request');cb(null,{items});}};
    const n = new Narrative({model,requester,stationIds:[stationId],now:()=>now});
    return new Promise(resolve=>n.gather(async err=>resolve({rejected:!!err,value:await read(stationId,doc)})));
}
(async function(){
    const cases=[];
    const base = {tmFc:'202610171100',wfSv1:'○ 전국 예보\r\n<안내>\r기온 0°C & 비',stnId:108};
    for(const office of regions.offices) {
        const items=[Object.assign({},base,{stnId:office.stationId})];
        cases.push({id:'office-'+office.stationId,stationId:office.stationId,items,...await gather(office.stationId,items)});
    }
    for(const [id,items] of [
        ['empty',[]],['null-row',[null]],['wrong-office',[Object.assign({},base,{stnId:109})]],
        ['invalid-date',[Object.assign({},base,{tmFc:'202602301100'})]],
        ['future',[Object.assign({},base,{tmFc:'202610171201'})]],
        ['expiry',[Object.assign({},base,{tmFc:'202610161200'})]],
        ['just-fresh',[Object.assign({},base,{tmFc:'202610161201'})]],
        ['no-text',[Object.assign({},base,{wfSv1:'\ufeff \u2000'})]],
        ['mixed-invalid',[base,Object.assign({},base,{stnId:109})]],
        ['too-many',Array(11).fill(base)],
        ['latest',[Object.assign({},base,{tmFc:'202610170500'}),Object.assign({},base,{stnId:'108'})]]
    ]) cases.push({id,stationId:108,items,...await gather(108,items)});
    for(const c of cases)c.value_json=JSON.stringify(c.value);
    const province_cases=[];
    for(const o of regions.offices)for(const p of o.provinces)for(const s of [p,' '+p+' ','\ufeff'+p+'\ufeff'])
        province_cases.push({input:s,stationId:regions.forProvince(s).stationId});
    const result={baseline:'9333d196846b1c04989b36128d3a7e06f74aa927',source_sha256:hashes,now_ms:now,
        offices:regions.offices,province_cases,cases};
    const output=process.argv[2]; if(!output)throw Error('Explicit fixture output path required');
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({cases:cases.length,offices:regions.offices.length,output}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
