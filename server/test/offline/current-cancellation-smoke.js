'use strict';
// Actual request transport/collector/Manager; synthetic direct-loopback provider, fixture storage.
const assert=require('assert'),http=require('http'),h=require('./harness'),mh=require('./current-manager-harness');
let provider,requests=0,closed=0;const sockets=new Set();
(async()=>{
    provider=http.createServer((req,res)=>{
        requests++;
        if(requests===1){res.on('close',()=>closed++);return;}
        const u=new URL(req.url,'http://127.0.0.1'),values={T1H:'0',RN1:'0',UUU:'0',VVV:'0',REH:'50',PTY:'0',VEC:'0',WSD:'0'};
        const items=Object.keys(values).map(category=>({baseDate:[u.searchParams.get('base_date')],baseTime:[u.searchParams.get('base_time')],nx:[u.searchParams.get('nx')],ny:[u.searchParams.get('ny')],category:[category],obsrValue:[values[category]]}));
        res.end(h.xml(h.response(items)));
    });
    provider.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s))});
    await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
    const coords=[{mx:60,my:127},{mx:61,my:127}];let rows=[],slot={date:'20261003',time:'0000'};
    const model={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,rows)}}}};
    function Collector(){
        const collector=h.collector(require('request'));
        collector.DATA_URL=Object.freeze({TOWN_CURRENT:'http://127.0.0.1:'+provider.address().port+'/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'});
        return collector;
    }
    const f=mh.load({'../lib/collectTownForecast':Collector,'../models/town':{getCoord:cb=>cb(null,coords)},'../models/kma/kma.town.current.model':model,
        '../config/gather':require('../../config/gather').load({GATHER_CURRENT_DEADLINE_MS:'100',GATHER_REQUEST_CONCURRENCY:'1'})});
    f.m.getCurrentQueryTime=()=>slot;f.m.getSaveFunc=()=>function(data,cb){rows.push({mCoord:{mx:data[0].mx,my:data[0].my},currentData:data[0]});cb()};
    const run=()=>new Promise(resolve=>f.m.getTownCurrentData(9,'synthetic',e=>resolve(e)));
    const err=await run();assert.match(err.message,/deadline/i);assert.strictEqual(requests,1);
    await new Promise(resolve=>setTimeout(resolve,30));assert.strictEqual(closed,1,'real stalled HTTP socket was aborted');assert.strictEqual(rows.length,0);
    f.m._currentCollection.options.collectTimeoutMs=2000;slot={...slot,time:'0100'};
    assert.ifError(await run());assert.strictEqual(requests,3);assert.strictEqual(rows.length,2);
    assert.ifError(await run());assert.strictEqual(requests,3,'completed later publication is not refetched');
    assert(f.records.some(r=>JSON.parse(r).event==='current-collection-stop'));
    assert(!f.records.join('').includes('SYNTHETIC_CURRENT_KEY'));
    console.log(JSON.stringify({result:'passed',node:process.version,stalledRequests:1,abortedSockets:closed,laterPublicationGrids:2,provider:'synthetic loopback',storage:'fixture writes'}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{sockets.forEach(s=>s.destroy());if(provider)await new Promise(resolve=>provider.close(resolve))});
