'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../controllers/controllerTown.js'), 'utf8');
const source24 = fs.readFileSync(path.join(__dirname, '../../controllers/controllerTown24h.js'), 'utf8');
const policy = require('../../lib/history/policy');
const legacyComparison = require('./legacy-comparison-harness');
const helperPath = path.join(__dirname, '../../lib/history/observations.js');
const observations = fs.existsSync(helperPath) ? require(helperPath) : undefined;
function method(text, name, context, prototype = false) {
    const marker = prototype ? 'ControllerTown.prototype.' + name + ' = ' : 'this.' + name + ' = ';
    const start = text.indexOf(marker) + marker.length;
    const end = text.indexOf(prototype ? '\n};' : '\n    };', start) + (prototype ? 2 : 6);
    assert(start >= marker.length);
    return vm.runInNewContext('(' + text.slice(start, end) + ')', context);
}
const globals = {observations, log: {info(){}, warn(){}, error(){}}, sprintf: (s,n)=>s.replace('%s',n), setTimeout, clearTimeout};
const ts = {__: key=>key === 'LOC_THAN_YESTERDAY' ? 'yesterday %s' : key};
const diff = method(source, '_diffTodayYesterday', globals, true);
let passed = 0;
async function check(name, run) {await run(); passed++; console.log('PASS ' + name);}
(async()=>{
    await check('invalid Celsius temperatures never produce a difference', ()=>{
        for (const temp of [-50, null, undefined, NaN, Infinity, '22']) {
            assert.equal(diff({t1h:22.6}, {t1h:temp}, ts).str, '');
            assert.equal(diff({t1h:temp}, {t1h:22.6}, ts).str, '');
        }
        assert(diff({t1h:0}, {t1h:-5}, ts).str.includes('+5'));
    });
    await check('both yesterday selectors use current date and exact time, not wall clock', ()=>{
        for (const text of [source, source24]) {
            const current={date:'20260929',time:'1900',t1h:22};
            const rows=[{date:'20260928',time:'1900',t1h:20},{date:'20260928',time:'2000',t1h:19}];
            const self={_getCurrentTimeValue:()=>({date:'20260929',time:'1900'}),makeSummary:()=>'', _diffTodayYesterday:diff};
            const select=method(text,text === source ? 'getSummary' : 'setYesterday',Object.assign({},globals,{self,kmaTimeLib:{convert0Hto24H(){}}}));
            select({current,currentList:rows,params:{},query:{}},{},()=>{});
            assert.equal(current.yesterday.date,'20260928');
            assert.equal(current.yesterday.time,'1900');
            assert.equal(current.yesterday.t1h,20);
            const missing={date:'20260929',time:'1800',t1h:22};
            select({current:missing,currentList:rows,params:{},query:{}},{},()=>{});
            assert.equal(missing.yesterday.missing,true);
            assert.equal(missing.yesterday.t1h,undefined);
        }
    });
    await check('legacy BSON Date fills exact-hour missing fields without overwriting valid values', async()=>{
        const row={date:'20260929',time:'1900',t1h:-50,reh:55,rn1:0,vec:-1};
        const self={_getTownInfo:(a,b,c,cb)=>cb(null,{gCoord:{lat:37,lon:127}})};
        const stations={getCityHourlyList:(town,cb)=>cb(null,[{date:new Date('2026-09-29T19:00:00Z'),stnId:108,t1h:22.7,reh:65,rs1h:5,vec:0}])};
        const reader={loadLegacyForTown:(town,cb)=>stations.getCityHourlyList(town,cb),loadForTown:()=>{throw Error('disabled ASOS read')},mergeHourly(){}};
        const merge=method(source,'mergeCurrentByStnHourly',Object.assign({},globals,{self,config:{history:{readEnabled:false}},controllerKmaStnWeather:stations,kmaTimeLib:require('../../lib/kmaTimeLib'),require:id=>id.endsWith('/service')?reader:require(id)}));
        await new Promise(resolve=>merge({currentList:[row],params:{}},{},resolve));
        assert.equal(row.t1h,22.7);assert.equal(row.reh,55);assert.equal(row.rn1,0);assert.equal(row.vec,0);
        assert.equal(row.historyObservation.stationId,'108');
        assert.deepEqual(Array.from(row.historyObservation.fields).sort(),['t1h','vec']);
    });
    await check('station temperature provenance prevents mixed-source comparison, humidity provenance does not', ()=>{
        const provenance={source:'KMA_ASOS',stationId:'108',key:'202609291900',fields:['t1h']};
        assert.equal(diff({t1h:22},{t1h:20,historyObservation:provenance},ts).str,'');
        assert(diff({t1h:22,historyObservation:{...provenance,key:'202609301900'}},{t1h:20,historyObservation:provenance},ts).str);
        assert(diff({t1h:22},{t1h:20,historyObservation:{...provenance,fields:['reh']}},ts).str);
    });
    await check('midnight and wrong-hour legacy measurements are normalized conservatively',()=>{
        const req={currentList:[{date:'20260928',time:'2400',t1h:-50},{date:'20260929',time:'0100',t1h:-50}]};
        observations.mergeLegacy(req,[{stnId:108,date:new Date('2026-09-29T00:00Z'),t1h:0}]);
        assert.equal(req.currentList[0].t1h,0);assert.equal(req.currentList[1].t1h,-50);
        assert.equal(observations.yesterday({date:'20260929',time:'0000',t1h:2},req.currentList).time,'0000');
        assert.equal(policy.slot(req.currentList[0]),'202609290000');
    });
    await check('live temperature overwrites invalidate hourly provenance in current and history row', ()=>{
        const current={date:'20260930',time:'1900',liveTime:'1900',t1h:21};
        observations.record(current,{source:'KMA_ASOS',stationId:'108',key:'202609301900'},['t1h']);
        observations.record(current,{source:'KMA_STATION_LIVE',stationId:'108',key:'202609301927'},['t1h']);
        const rows=[{date:'20260930',time:'1900',t1h:19}];
        const update=method(source,'_updateCurrentFromMinWeather',Object.assign({},globals,{log:{debug(){}},modelCurrent:{getPropertyList:()=>['t1h']}}));
        update(rows,current);
        assert.equal(rows[0].fieldObservations.t1h.source,'KMA_STATION_LIVE');
        assert.equal(observations.canCompare(current,{t1h:20,fieldObservations:{t1h:{source:'KMA_ASOS',stationId:'108',key:'202609291900'}}}),false);
    });
    await check('Celsius eligibility survives Fahrenheit conversion including valid -50F', ()=>{
        const selected=observations.yesterday({date:'20260930',time:'1900',t1h:-40},[{date:'20260929',time:'1900',t1h:-45.555}]);
        selected.t1h=-50;
        assert(observations.canCompare({t1h:-40},selected));
    });
    await check('actual station middleware records dotted minute provenance', async()=>{
        const current={date:'20260930',time:'1900',t1h:-50};
        const logs=[];
        const self={_getTownInfo:(a,b,c,cb)=>cb(null,{}),_isValidObservation:(key,value)=>policy.valid(key,value),_updateCurrentFromMinWeather(){}};
        const stations={getStnHourlyAndMinRns:(town,time,row,cb)=>cb(null,{stnId:108,t1h:21,vec:180,wsd:2,stnDateTime:'2026.09.30.19:27'}),updateWeather(){}};
        const ctx=Object.assign({},globals,{self,controllerKmaStnWeather:stations,kmaTimeLib:require('../../lib/kmaTimeLib'),
            log:{info(){},warn(){},debug(){},error:err=>logs.push(err)},_convertCloud2SKy:()=>1,_convertStnWeather2Pty:()=>0,_convertStnWeather2Lgt:()=>0,ControllerWeatherDesc:{getWeatherStr:()=>''}});
        await new Promise(resolve=>method(source,'getKmaStnMinuteWeather',ctx)({current,currentList:[],params:{}},{},resolve));
        assert.equal(current.fieldObservations.t1h.key,'202609301927');
        assert.equal(current.fieldObservations.t1h.source,'KMA_STATION_LIVE');
        assert.equal(logs.length,0);
    });
    await check('fallback wait expires once and ignores late mutations', async()=>{
        let late, count=0;
        const row={date:'20260930',time:'1900',t1h:-50};
        const self={_getTownInfo:(a,b,c,cb)=>cb(null,{gCoord:{lat:37,lon:127}})};
        const reader={loadLegacyForTown:(town,cb)=>{late=cb;},mergeHourly(){}};
        const merge=method(source,'mergeCurrentByStnHourly',Object.assign({},globals,{self,config:{history:{readEnabled:false}},require:()=>reader}));
        const start=Date.now();
        await new Promise(resolve=>merge({currentList:[row],params:{}},{},()=>{count++;resolve();}));
        const elapsed=Date.now()-start;
        assert(elapsed>=200 && elapsed<600);
        late(null,[{date:new Date('2026-09-30T19:00Z'),stnId:108,t1h:23}]);
        assert.equal(row.t1h,-50);assert.equal(count,1);
        console.log(JSON.stringify({fallbackWaitMs:elapsed}));
    });
    await check('legacy app cannot compare incompatible sources or invalid current temperature', ()=>{
        const current={date:'20260930',time:'1900',t1h:22.6};
        const yesterday={date:'20260929',time:'1900',t1h:22.7};
        observations.record(yesterday,{source:'KMA_ASOS',stationId:'108',key:'202609291900'},['t1h']);
        for (const value of [current,{...current,t1h:-50},{...current,t1h:null}]) {
            const selected=observations.yesterday(value,[yesterday]);
            assert.equal(selected.comparisonAvailable,false);
            assert.equal(selected.t1h,undefined);
            assert.equal(legacyComparison(value,selected,'C'),'');
            assert.equal(legacyComparison(value,selected,'F'),'');
        }
        const pair=observations.yesterday({...current,t1h:0},[{date:'20260929',time:'1900',t1h:-5}]);
        assert(legacyComparison({t1h:0},pair,'C').includes('+5'));
        assert.equal(yesterday.t1h,22.7,'the underlying history observation is preserved');
    });
    await check('valid zero wins over an invalid duplicate midnight slot in either row order', ()=>{
        const current={date:'20260930',time:'0000',t1h:2};
        const rows=[{date:'20260928',time:'2400',t1h:-50},{date:'20260929',time:'0000',t1h:0}];
        for (const list of [rows,rows.slice().reverse()]) {
            const selected=observations.yesterday(current,list);
            assert.equal(selected.t1h,0);
            assert.equal(selected.comparisonAvailable,true);
            assert(legacyComparison(current,selected,'C').includes('+2'));
        }
    });
    await check('minute middleware followed by either selector retains accepted live comparisons', async()=>{
        for (const text of [source, source24]) {
            const current={date:'20260930',time:'1900',t1h:20};
            const self={_getTownInfo:(a,b,c,cb)=>cb(null,{}),_isValidObservation:(key,value)=>policy.valid(key,value),_updateCurrentFromMinWeather(){},makeSummary:()=>'',_diffTodayYesterday:diff};
            const stations={getStnHourlyAndMinRns:(town,time,row,cb)=>cb(null,{stnId:108,t1h:21,vec:180,wsd:2,stnDateTime:'2026.09.30.19:27'}),updateWeather(){}};
            const ctx=Object.assign({},globals,{self,controllerKmaStnWeather:stations,kmaTimeLib:require('../../lib/kmaTimeLib'),log:{info(){},warn(){},debug(){},error(){}},_convertCloud2SKy:()=>1,_convertStnWeather2Pty:()=>0,_convertStnWeather2Lgt:()=>0,ControllerWeatherDesc:{getWeatherStr:()=>''}});
            await new Promise(resolve=>method(source,'getKmaStnMinuteWeather',ctx)({current,currentList:[],params:{}},{},resolve));
            assert.equal(current.t1h,21);
            const select=method(text,text===source?'getSummary':'setYesterday',ctx);
            const row={date:'20260929',time:'1900',t1h:19};
            select({current,currentList:[row],params:{},query:{}},{},()=>{});
            assert.equal(current.yesterday.t1h,19);
            assert(legacyComparison(current,current.yesterday,'C').includes('+2'));
            for (const meta of [{source:'KMA_STATION_LIVE',stationId:'108',key:'202609291905'}, {source:'KMA_STATION_LIVE',stationId:'109',key:'202609291927'}, {source:'KMA_ASOS',stationId:'108',key:'202609291900'}]) {
                const previous={...row}; observations.record(previous,meta,['t1h']);
                select({current,currentList:[previous],params:{},query:{}},{},()=>{});
                assert.equal(current.yesterday.t1h,meta.source==='KMA_STATION_LIVE'&&meta.stationId==='108'?19:undefined);
            }
            current.t1h=-50;
            select({current,currentList:[row],params:{},query:{}},{},()=>{});
            assert.equal(current.yesterday.t1h,undefined);
        }
        const row={date:'20260929',time:'1900',t1h:19};
        for (const key of ['202609301827','202609301960','invalid']) {
            const current={date:'20260930',time:'1900',t1h:21};
            observations.record(current,{source:'KMA_STATION_LIVE',stationId:'108',key},['t1h']);
            assert.equal(observations.yesterday(current,[row]).t1h,undefined);
        }
    });
    await check('legacy BSON wall-clock convention is explicitly pinned to UTC ingestion', ()=>{
        const child=require('node:child_process').execFileSync(process.execPath,['-e',"const h=require('./server/lib/history/observations');process.stdout.write(h.legacyKey(new Date('2026/09/29 19:00')));"],{cwd:path.join(__dirname,'../../..'),env:{...process.env,TZ:'UTC'},encoding:'utf8'});
        assert.equal(child,'202609291900');
    });
    console.log(JSON.stringify({passed}));
})().catch(err=>{console.error(err.stack);process.exitCode=1;});
