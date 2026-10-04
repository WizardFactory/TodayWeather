'use strict';
const assert=require('assert'),mongoose=require('mongoose'),Forecast=require('../../lib/forecastGridCollection'),f=require('./forecast-grid-fixtures');
const coord={mx:60,my:127};
const empty={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}},aggregate(){return {option(){return this},exec(cb){cb(null,[])}}}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// A test that stops before its final PASS (e.g. a swallowed assertion) must fail, not exit 0.
let passed=false;process.on('exit',()=>{if(!passed){console.error('FAIL: ended before final PASS');process.exitCode=1}});
(async()=>{
 assert.strictEqual(mongoose.version,'5.1.2');
 for(const product of ['short','shortest'])for(const time of product==='short'?['0200','0500','1100','1400','1700','2300']:['0030','2330']){
    const slot={date:'20261231',time},rows=f.rows(product,slot,coord);
    assert.deepStrictEqual(Forecast.expected(product,slot),rows.map(({date,time})=>({date,time})));
    assert(Forecast.complete(product,slot,rows));
    assert(!Forecast.complete(product,slot,rows.slice(1)),'missing first slot');
    assert(!Forecast.complete(product,slot,rows.slice(0,-1)),'missing final slot');
    for(const field of product==='short'?['t3h','sky','reh','pty','r06','s06','pop','uuu','vvv','vec','wsd']:['t1h','sky','reh','pty','rn1','lgt','pop','uuu','vvv','vec','wsd']){
        for(const value of [undefined,NaN,Infinity,'0',-900,900]){
            const bad=rows.map(r=>({...r}));bad[0][field]=value;assert(!Forecast.complete(product,slot,bad),field+' invalid '+value);
        }
    }
    for(const field of ['tmn','tmx'])if(product==='short'){
        const i=rows.findIndex(r=>r[field]!==undefined);if(i>=0){const bad=rows.map(r=>({...r}));delete bad[i][field];assert(!Forecast.complete(product,slot,bad))}
    }
    assert(!Forecast.batch(product,slot,coord,rows.map(r=>({...r,pubDate:'202701010000'}))));
    assert(!Forecast.batch(product,slot,{mx:61,my:127},rows));
    // Rows outside the expected horizon are filtered before writes and never admitted (#2678 review).
    const extra={...rows[0],date:'20270110',time:'0300'};
    assert(!Forecast.batch(product,slot,coord,rows.concat(extra)),'out-of-horizon row');
    assert(!Forecast.batch(product,slot,coord,rows.concat({...rows[0]})),'duplicate slot');
    assert.deepStrictEqual(Forecast.within(product,slot,rows.concat(extra)),rows);
    assert(Forecast.batch(product,slot,coord,Forecast.within(product,slot,rows.concat(extra))));
    // A valid row just past the documented horizon (provider counts show one) is kept; an invalid one is dropped.
    const last=rows[rows.length-1],next=f.parts(f.publication(last)+3*f.hour),tail={...last,...next};delete tail.tmn;delete tail.tmx;
    assert(Forecast.batch(product,slot,coord,rows.concat(tail)));
    assert.deepStrictEqual(Forecast.within(product,slot,rows.concat(tail,{...tail,...f.parts(f.publication(last)+2*f.day)})),rows.concat(tail));
    assert.deepStrictEqual(Forecast.within(product,slot,rows.concat({...tail,sky:-1})),rows,'invalid trailing row dropped');
    assert(!Forecast.batch(product,slot,coord,rows.concat({...tail,sky:-1})));
    // Ultra-short HH30 requests are answered with the HH00 base hour; both name the requested publication.
    const ids=product==='shortest'?[slot.date+time.slice(0,2)+'00',slot.date+time]:[slot.date+time];
    if(product==='shortest'){
        const literal=f.rows(product,slot,coord,time),other=f.rows(product,slot,coord,f.parts(f.publication(slot)-f.hour).time);
        assert(Forecast.batch(product,slot,coord,rows),'HH00 echo admitted');assert(Forecast.batch(product,slot,coord,literal),'literal HH30 admitted');
        assert(!Forecast.batch(product,slot,coord,other),'another hour is another publication');
        assert(!Forecast.batch(product,slot,coord,rows.map((r,i)=>i?r:literal[0])),'one batch carries one publication');
    }
    for(const version of ['1.0','2.0']){
        let docs=f.documents(product,version,slot,coord,rows),seen;
        const memory=f.memoryModel(()=>docs);
        const model=version==='1.0'?mongoose.model('forecast_'+product+time+version,new mongoose.Schema({}, {strict:false})):{
            aggregate(pipeline){seen=pipeline;const a=memory.aggregate(pipeline),option=a.option;a.option=o=>{assert.deepStrictEqual(o,{maxTimeMS:9000});return option.call(a,o)};return a},
            find(){throw new Error('DB2 coverage must not transfer every slot document')}};
        if(version==='1.0')model.Query.prototype.exec=function(cb){assert.strictEqual(this.options.maxTimeMS,9000);assert(this._mongooseOptions.lean);
            assert.deepStrictEqual(this.getQuery(),{pubDate:{$in:ids}});memory.find(this.getQuery()).exec(cb)};
        const pending=()=>new Promise((res,rej)=>Forecast.pending(model,version,product,slot,[coord],(e,p)=>e?rej(e):res(p)));
        assert.strictEqual((await pending()).length,0);
        if(version==='2.0'){
            const match=seen[0].$match,dates=rows.map(r=>+new Date(f.publication(r)-9*f.hour));
            assert.deepStrictEqual(match.pubDate.$in.map(Number),ids.map(id=>f.publication({date:id.slice(0,8),time:id.slice(8)})-9*f.hour));
            assert.deepStrictEqual(match.fcsDate.$in.map(Number),dates);assert.deepStrictEqual(Object.keys(match),['pubDate','fcsDate']);
            const saved=docs;docs=docs.map((d,i)=>i===0?{...d,fcsDate:new Date(+d.fcsDate+f.hour)}:d);
            assert.strictEqual((await pending()).length,1,'DB2 fcsDate must match the payload slot');docs=saved;
            for(const field of Object.keys(rows[0]).filter(k=>typeof rows[0][k]==='number'&&!['mx','my'].includes(k)))for(const value of [undefined,NaN,Infinity,-900,'0',-50,-100,-1,0,1,4,5,8,9,100,101,360,361]){
                docs=saved.map((d,i)=>i===0?{...d,[product+'Data']:{...d[product+'Data'],[field]:value}}:d);
                assert.strictEqual((await pending()).length,Forecast.complete(product,slot,docs.map(d=>d[product+'Data']))?0:1,'Mongo and JS rules agree: '+field+'='+value);
            }
            docs=saved;
        }
        if(product==='shortest'){
            const saved=docs;docs=f.documents(product,version,slot,coord,f.rows(product,slot,coord,time));
            assert.strictEqual((await pending()).length,0,'literal HH30 rows also cover the publication');
            docs=f.documents(product,version,slot,coord,f.rows(product,slot,coord,f.parts(f.publication(slot)-f.hour).time));
            assert.strictEqual((await pending()).length,1,'previous hour cannot cover the requested publication');docs=saved;
        }
        docs=docs.map(d=>({...d,pubDate:version==='1.0'?'202701010000':new Date('2027-01-01')}));
        assert.strictEqual((await pending()).length,1,'newer publication cannot cover requested publication');
    }
 }
 const optional=Forecast.preserveOptional({date:'20261003',time:'0600',tmn:-50,tmx:-50,wav:-1,t3h:0},{tmn:-3,tmx:25,wav:0.5,t3h:10},'short',{date:'20261003',time:'1400'});
 assert.strictEqual(optional.tmn,-3);assert.strictEqual(optional.tmx,25);assert.strictEqual(optional.wav,0.5);assert.strictEqual(optional.t3h,0);
 const required=Forecast.preserveOptional({date:'20261004',time:'0600',tmn:-50},{tmn:-3},'short',{date:'20261003',time:'1400'});
 assert.strictEqual(required.tmn,-50,'a required slot cannot inherit another publication value');
 // POP was conditional before official June 23 expansion; WAV remains conditional.
 const rawSlot={date:'20261003',time:'1700'};
 const raw=()=>f.items('short',rawSlot,coord);
 assert(Forecast.rawItems(raw(),'short',rawSlot,coord));
 for(const value of ['12junk','', 'NaN', 'Infinity','900','-900']){const items=raw();items[0].fcstValue=[value];assert(!Forecast.rawItems(items,'short',rawSlot,coord))}
 const outside=raw().find(i=>i.category[0]==='SKY');
 assert(Forecast.rawItems(raw().concat({...outside,fcstDate:['20261012'],fcstTime:['0300']}),'short',rawSlot,coord),'extra slot is filtered, not a failure');
 const moved=raw();moved[moved.indexOf(moved.find(i=>i.category[0]==='SKY'))]={...outside,fcstDate:['20261012'],fcstTime:['0300']};
 assert(!Forecast.rawItems(moved,'short',rawSlot,coord),'out-of-horizon item cannot satisfy an expected slot');
 // A malformed value in the storable trailing slot fails like an in-horizon value (parseFloat would accept it).
 const lastRaw=raw().at(-1),trailAt=f.parts(f.publication({date:lastRaw.fcstDate[0],time:lastRaw.fcstTime[0]})+3*f.hour);
 const trailItem=v=>({...raw().find(i=>i.category[0]==='SKY'),fcstDate:[trailAt.date],fcstTime:[trailAt.time],fcstValue:[v]});
 assert(Forecast.rawItems(raw().concat(trailItem('1')),'short',rawSlot,coord));
 assert(!Forecast.rawItems(raw().concat(trailItem('12junk')),'short',rawSlot,coord),'malformed trailing value');
 const wrong=raw();wrong[0].baseTime=['2000'];assert(!Forecast.rawItems(wrong,'short',rawSlot,coord));
 const ultraSlot={...rawSlot,time:'1730'},ultra=f.items('shortest',ultraSlot,coord);
 assert.strictEqual(ultra[0].baseTime[0],'1700','fixture uses the real HH00 echo');
 assert(Forecast.rawItems(ultra,'shortest',ultraSlot,coord),'HH30 request answered with HH00 is valid');
 assert(Forecast.rawItems(f.items('shortest',ultraSlot,coord,'1730'),'shortest',ultraSlot,coord),'literal HH30 echo stays valid');
 for(const other of ['1600','1800','1630'])assert(!Forecast.rawItems(f.items('shortest',ultraSlot,coord,other),'shortest',ultraSlot,coord),'echo '+other+' is another publication');
 assert(!Forecast.rawItems(ultra.map((r,i)=>i?r:{...r,baseTime:['1730']}),'shortest',ultraSlot,coord),'one response carries one publication');
 assert(!Forecast.rawItems(ultra.filter(r=>r.category[0]!=='LGT'),'shortest',ultraSlot,coord),'missing LGT cannot inherit schema -1 default');
 assert(Forecast.rawItems(ultra.map(r=>r.category[0]==='LGT'?{...r,fcstValue:['-1']}:r),'shortest',ultraSlot,coord),'actual signed lightning -1 is preserved');
 const old={date:'20260622',time:'0030'},oldRows=f.rows('shortest',old,coord).map(r=>{delete r.pop;return r});
 assert(Forecast.complete('shortest',old,oldRows));
 let controls=[],callbacks=[],finished=0,calls=0;
 const c=new Forecast({product:'shortest',model:empty,version:'2.0',readTimeoutMs:10,collectTimeoutMs:20,
    coords:cb=>cb(null,[coord]),emit:()=>{},collect:(list,s,k,cb,control)=>{calls++;callbacks.push(cb);controls.push(control)}});
 const slot={date:'20261003',time:'0030'};
 c.run(slot,'dummy',e=>{assert(e);finished++});c.run(slot,'dummy',e=>{assert.doesNotMatch(e.message,/busy/,'same publication joins');finished++});
 c.run({...slot,time:'0130'},'dummy',e=>{assert.match(e.message,/busy/);finished++});assert.strictEqual(calls,1);
 await wait(40);assert.strictEqual(finished,3);assert.strictEqual(c.active,null);assert(controls[0].cancelled);
 c.options.collectTimeoutMs=1000;c.run({...slot,time:'0130'},'dummy',e=>{assert(e);finished++});const newer=c.active;
 callbacks[0]();assert.strictEqual(c.active,newer);callbacks[1]();assert.strictEqual(c.active,null);assert.strictEqual(finished,4);
 let attempts=0;
 const bad=new Forecast({product:'short',version:'2.0',model:{find(){throw new Error('DB failed')},aggregate(){throw new Error('DB failed')}},coords:cb=>cb(null,[coord]),emit:()=>{},collect:()=>attempts++});
 bad.run({...slot,time:'0200'},'dummy',e=>assert(e));assert.strictEqual(attempts,0);assert.strictEqual(bad.active,null);
 bad.options.model={find(){return {setOptions(){return this},lean(){return this},exec(){}}},aggregate(){return {option(){return this},exec(){}}}};
 bad.options.readTimeoutMs=5;
 await new Promise(resolve=>bad.run({...slot,time:'0200'},'dummy',e=>{assert(e);resolve()}));assert.strictEqual(bad.active,null);assert.strictEqual(attempts,0);
 // Ultra-short: one full refresh walk per current publication from base+40min (KMA updates every 10 minutes).
 {
    const rs={date:'20261003',time:'1730'},base=f.publication(rs)-9*f.hour,min=60000;
    let docs=[],clock=base+18*min,walks=[];
    const model=f.memoryModel(()=>docs);
    const fill=()=>{docs=f.documents('shortest','2.0',rs,coord,f.rows('shortest',rs,coord))};
    const make=(after)=>new Forecast({product:'shortest',model,version:'2.0',coords:cb=>cb(null,[coord]),emit:()=>{},
        refreshAfterMs:after,now:()=>clock,collect:(list,s,k,cb)=>{walks.push(list.length);fill();cb()}});
    const go=c=>new Promise((res,rej)=>c.run(rs,'dummy',(e,r)=>e?rej(e):res(r)));
    const c=make(40*min);
    await go(c);assert.deepStrictEqual(walks,[1],'first walk');
    await go(c);assert.deepStrictEqual(walks,[1],'complete before refresh window');
    clock=base+44*min;const r=await go(c);assert.deepStrictEqual(walks,[1,1],'one refresh walk');assert.strictEqual(r.refresh,true);
    clock=base+50*min;await go(c);assert.deepStrictEqual(walks,[1,1],'refresh once per publication');
    await go(make(40*min));assert.deepStrictEqual(walks,[1,1,1],'process-local: a recreated coordinator may refresh once');
    clock=base+2*f.hour;await go(make(40*min));assert.deepStrictEqual(walks,[1,1,1],'no refresh once the publication is old');
    clock=base+44*min;await go(make(0));assert.deepStrictEqual(walks,[1,1,1],'0 disables refresh');
    docs=[];walks=[];const late=make(40*min);await go(late);await go(late);assert.deepStrictEqual(walks,[1],'a first walk inside the window counts as the refresh');
    // The refresh is consumed only by a successful full walk; a failed refresh stays due (review 5403438544).
    clock=base+44*min;fill();walks=[];let fail=true;
    const flaky=new Forecast({product:'shortest',model,version:'2.0',coords:cb=>cb(null,[coord]),emit:()=>{},
        refreshAfterMs:40*min,now:()=>clock,collect:(list,s,k,cb)=>{walks.push(list.length);cb(fail?new Error('provider'):null)}});
    await new Promise(res=>flaky.run(rs,'dummy',e=>{assert(e);res()}));
    fail=false;await go(flaky);assert.deepStrictEqual(walks,[1,1],'failed refresh is retried in the window');
    await go(flaky);assert.deepStrictEqual(walks,[1,1],'successful refresh is consumed');
 }
 // A failed after-collection coverage read is never reported as complete.
 let reads=0;const records=[];
 const afterModel={aggregate(){return {option(){return this},exec(cb){if(reads++===0)return cb(null,[]);cb(new Error('read failed'))}}}};
 const after=new Forecast({product:'shortest',model:afterModel,version:'2.0',coords:cb=>cb(null,[coord]),emit:r=>records.push(r),
    collect:(list,s,k,cb)=>cb()});
 await new Promise(resolve=>after.run({date:'20261003',time:'0330'},'dummy',(e,r)=>{
    assert(e);assert.strictEqual(r.complete,0);assert.strictEqual(r.pending,1);resolve()}));
 assert.strictEqual(records.at(-1).outcome,'incomplete');assert.strictEqual(records.find(r=>r.stage==='after').outcome,'read-failed');
 assert(records.filter(r=>r.event==='forecast-coverage').every(r=>typeof r.readMs==='number'));
 assert.strictEqual(after.active,null);
 passed=true;
 console.log('PASS forecast coverage: both horizons, all required fields, signed/zero/conditional values, pinned exact queries, overlap/read/run deadlines and late fencing');
})().catch(e=>{console.error(e);process.exitCode=1});
