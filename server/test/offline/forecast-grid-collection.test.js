'use strict';
const assert=require('assert'),mongoose=require('mongoose'),Forecast=require('../../lib/forecastGridCollection'),f=require('./forecast-grid-fixtures');
const coord={mx:60,my:127};
const empty={find(){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,[])}}}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
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
    for(const version of ['1.0','2.0']){
        const model=mongoose.model('forecast_'+product+time+version,new mongoose.Schema({}, {strict:false}));
        let docs=f.documents(product,version,slot,coord,rows);
        model.Query.prototype.exec=function(cb){assert.strictEqual(this.options.maxTimeMS,2000);assert(this._mongooseOptions.lean);
            const query={pubDate:version==='1.0'?slot.date+slot.time:new Date(f.publication(slot)-9*f.hour)};
            if(version==='2.0')query.fcsDate={$gte:new Date(f.publication(rows[0])-9*f.hour),$lte:new Date(f.publication(rows[rows.length-1])-9*f.hour)};
            assert.deepStrictEqual(this.getQuery(),query);cb(null,docs)};
        const pending=()=>new Promise((res,rej)=>Forecast.pending(model,version,product,slot,[coord],(e,p)=>e?rej(e):res(p)));
        assert.strictEqual((await pending()).length,0);
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
 const wrong=raw();wrong[0].baseTime=['2000'];assert(!Forecast.rawItems(wrong,'short',rawSlot,coord));
 const ultraSlot={...rawSlot,time:'1730'},ultra=f.items('shortest',ultraSlot,coord);
 assert(Forecast.rawItems(ultra,'shortest',ultraSlot,coord));
 assert(!Forecast.rawItems(ultra.filter(r=>r.category[0]!=='LGT'),'shortest',ultraSlot,coord),'missing LGT cannot inherit schema -1 default');
 assert(Forecast.rawItems(ultra.map(r=>r.category[0]==='LGT'?{...r,fcstValue:['-1']}:r),'shortest',ultraSlot,coord),'actual signed lightning -1 is preserved');
 const old={date:'20260622',time:'0030'},oldRows=f.rows('shortest',old,coord).map(r=>{delete r.pop;return r});
 assert(Forecast.complete('shortest',old,oldRows));
 let controls=[],callbacks=[],finished=0,calls=0;
 const c=new Forecast({product:'shortest',model:empty,version:'2.0',readTimeoutMs:10,collectTimeoutMs:20,
    coords:cb=>cb(null,[coord]),emit:()=>{},collect:(list,s,k,cb,control)=>{calls++;callbacks.push(cb);controls.push(control)}});
 const slot={date:'20261003',time:'0030'};
 c.run(slot,'dummy',e=>{assert(e);finished++});c.run(slot,'dummy',e=>{assert(e);finished++});
 c.run({...slot,time:'0130'},'dummy',e=>{assert.match(e.message,/busy/);finished++});assert.strictEqual(calls,1);
 await wait(40);assert.strictEqual(finished,3);assert.strictEqual(c.active,null);assert(controls[0].cancelled);
 c.options.collectTimeoutMs=1000;c.run({...slot,time:'0130'},'dummy',e=>{assert(e);finished++});const newer=c.active;
 callbacks[0]();assert.strictEqual(c.active,newer);callbacks[1]();assert.strictEqual(c.active,null);assert.strictEqual(finished,4);
 let attempts=0;
 const bad=new Forecast({product:'short',version:'2.0',model:{find(){throw new Error('DB failed')}},coords:cb=>cb(null,[coord]),emit:()=>{},collect:()=>attempts++});
 bad.run({...slot,time:'0200'},'dummy',e=>assert(e));assert.strictEqual(attempts,0);assert.strictEqual(bad.active,null);
 bad.options.model={find(){return {setOptions(){return this},lean(){return this},exec(){}}}};
 bad.options.readTimeoutMs=5;
 await new Promise(resolve=>bad.run({...slot,time:'0200'},'dummy',e=>{assert(e);resolve()}));assert.strictEqual(bad.active,null);assert.strictEqual(attempts,0);
 console.log('PASS forecast coverage: both horizons, all required fields, signed/zero/conditional values, pinned exact queries, overlap/read/run deadlines and late fencing');
})().catch(e=>{console.error(e);process.exitCode=1});
