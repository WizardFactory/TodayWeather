/* Run with Node >=18: node server/test/offline/rss-wind.test.js.
 * Loads whole production modules; replaces storage/network dependencies only.
 * No app startup, providers, credentials, Mongo connection or scheduler.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const time = require('../../lib/kmaTimeLib');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const rssString = vm.runInNewContext(appSource.match(/global\.rssString = (\[[^;]+);/)[1]);
const noop = function () {};
const log = Object.fromEntries(['info','warn','error','debug','verbose','silly'].map(k => [k,noop]));
// Publication fixtures and freshness policy must share a deterministic clock.
// Noon KST also keeps the 11:00 primary-publication fixture in the past.
class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-24T03:00:00.000Z'])); }
    static now() { return Date.parse('2026-09-24T03:00:00.000Z'); }
}
function load(relative, dependencies) {
    const module = {exports: {}};
    vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), {
        module, exports: module.exports, Date:FixedDate, console, log, rssString,
        require: name => {
            if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
            throw new Error('Unexpected dependency: '+ name);
        }
    }, {filename: relative});
    return module.exports;
}
function environment(version, rows, pubDate = '202609240800') {
    const config = {db:{version}};
    const queries = [];
    function model(kind) {
        return {find(query) {
            queries.push({kind, query});
            return {sort(){return this;},batchSize(){return this;},limit(){return this;},lean(){return this;},exec(cb){
                const result = kind === 'v1' ? [{pubDate, shortData:rows}] : rows.map(row => ({
                    pubDate:time.getKoreaDateObj(pubDate), fcsDate:time.getKoreaDateObj(row.date),shortData:row
                }));
                cb(null,result);
            }};
        }};
    }
    const v1 = model('v1'), v2 = model('v2');
    const Rss = load('controllers/kma/kma.town.short.rss.controller.js', {
        events:require('node:events'), async:{}, request:{}, '../../config/config':config,
        xml2js:{}, '../../models/modelShortRss':v1, '../../models/town':{},
        '../../models/kma/kma.town.short.rss.model.js':v2, '../../lib/kmaTimeLib':time,
        dnscache:noop
    });
    const source = fs.readFileSync(path.join(root,'controllers/controllerTown.js'),'utf8');
    const deps = {};
    // Non-RSS imports are not exercised by this unit suite. Unexpected execution fails.
    for (const match of source.matchAll(/require\('([^']+)'\)/g)) deps[match[1]] = function unused(){throw new Error('Unexpected collaborator '+match[1]);};
    Object.assign(deps, {'../config/config':config,'../models/modelShortRss':v1,
        '../lib/midForecastPolicy': load('lib/midForecastPolicy.js',{}), '../lib/kmaTimeLib':time,'./kma/kma.town.short.rss.controller.js':Rss});
    for (const name of ['./kma/kma.town.current.controller.js','./kma/kma.town.short.controller.js',
        './kma/kma.town.shortest.controller.js','./kma/kma.town.mid.controller.js']) deps[name] = noop;
    const Town = load('controllers/controllerTown.js',deps);
    const town = new Town();
    town._getCoord = (r,c,t,cb) => cb(null,{mx:60,my:127});
    town._getTimeValue = () => ({date:'20260924',time:'0900'});
    return {town,rss:new Rss(),queries};
}
function upstream(direction = 'W') {
    const values = {hour:12,day:0,temp:25,tmx:-999,tmn:-999,sky:1,pty:0,wfKor:'맑음',wfEn:'Clear',
        pop:0,r12:0,s12:0,ws:1.3,wd:6,wdKor:'서',wdEn:direction,reh:65,r06:0,s06:0};
    return {wid:{header:[{tm:['202609240800'],x:['60'],y:['127']}],body:[{
        data:[Object.fromEntries(Object.entries(values).map(([k,v])=>[k,[String(v)]]))]
    }]}};
}
function base(date='20260924',time='1200') {return {date,time,pop:10,pty:0,r06:0,s06:0,reh:60,sky:3,
    t3h:23,tmn:10,tmx:30,wsd:2,vec:180,wav:0.5,uuu:-2,vvv:1};}
function row(extra={}) {return Object.assign({ftm:'202609240800',date:'202609241200',temp:25,tmn:-999,
    tmx:-999,pop:20,pty:0,r06:0,s06:0,reh:65,sky:1,ws:1.3,wd:6},extra);}
function merge(version, options={}) {
    const rows = options.rows || [row({date:'202609240900'}), row(options.rss)];
    const env = environment(version,rows,options.pubDate);
    if(options.now) env.town._getTimeValue = () => options.now;
    const req = {params:{},shortPubDate:options.basePubDate || '202609240500',short: options.short || [Object.assign(base(),options.base)]};
    let called=0;
    env.town.getShortRss(req,{}, err=>{assert.ifError(err);called++;});
    assert.equal(called,1,'middleware must finish exactly once');
    return {req,env};
}
for (const [label,code] of Object.entries({E:1,N:2,NE:3,NW:4,S:5,SE:6,SW:7,W:8,UNKNOWN:-1})) {
    test('collector direction '+label,()=>{
        environment('2.0',[]).rss.parseShortRss(0,upstream(label),(error,result)=>{
            assert.equal(error,0);assert.equal(result.shortData[0].wdEn,code);
            assert.equal(result.shortData[0].wfEn,1,'weather code remains Clear');
            assert.equal(result.pubDate,'202609240800');
            assert.equal(result.mCoord.mx,60);assert.equal(result.mCoord.my,127);
        });
    });
}
test('collector absent direction remains sentinel',()=>{
    const input=upstream(); delete input.wid.body[0].data[0].wdEn;
    environment('2.0',[]).rss.parseShortRss(0,input,(error,result)=>{
        assert.equal(error,0);assert.equal(result.shortData[0].wdEn,-1);
    });
});
for (const version of ['1.0','2.0']) {
    for (const pubDate of ['202609230800','202609241300']) {
        test(version+' expired/future RSS publication is rejected: '+pubDate,()=>{
            // Keep primary older too: rejection must exercise expiry, not precedence.
            const {req}=merge(version,{pubDate,basePubDate:'202609230500'});
            assert.deepEqual(req.short[0],base());
            assert.equal(req.shortRssPubDate,undefined);
        });
    }
    test(version+' newer RSS uses real DB projection and normalizes wind',()=>{
        const {req,env}=merge(version);
        assert.equal(req.short[0].wsd,1.3);assert.equal(req.short[0].vec,270);
        assert.equal(req.short[0].t3h,25);assert.equal(req.short[0].reh,65);
        assert.equal(req.shortRssPubDate,'202609240800');
        assert.equal(env.queries[0].kind,version==='1.0'?'v1':'v2');
        assert.equal(req.short[0].wav,0.5);assert.equal(req.short[0].uuu,-2);assert.equal(req.short[0].vvv,1);
    });
    for (let wd=0;wd<8;wd++) test(version+' direction '+wd+' to degrees',()=>{
        assert.equal(merge(version,{rss:{wd}}).req.short[0].vec,wd*45);
    });
    test(version+' equal preserves valid values and fills missing/sentinel fields',()=>{
        assert.deepEqual(merge(version,{basePubDate:'202609240800'}).req.short[0],base());
        for (const missing of [undefined,null,-1,NaN]) {
            const result=merge(version,{basePubDate:'202609240800',base:{wsd:missing,vec:missing,reh:missing,t3h:-50}}).req.short[0];
            assert.equal(result.wsd,1.3);assert.equal(result.vec,270);assert.equal(result.reh,65);assert.equal(result.t3h,25);
        }
    });
    test(version+' older is ignored',()=>{
        const {req}=merge(version,{basePubDate:'202609241100'});
        assert.deepEqual(req.short[0],base());assert.equal(req.shortRssPubDate,undefined);
    });
    test(version+' invalid RSS wind never erases base',()=>{
        for (const value of [undefined,null,-1,-999,NaN,Infinity,'','6','bad']) {
            const result=merge(version,{rss:{ws:value,wd:value}}).req.short[0];
            assert.equal(result.wsd,2,'ws '+value);assert.equal(result.vec,180,'wd '+value);
        }
        for(const wd of [8,360,1.5]) assert.equal(merge(version,{rss:{wd}}).req.short[0].vec,180);
        assert.equal(merge(version,{rss:{ws:0,wd:0}}).req.short[0].wsd,0);
    });
    test(version+' absent/missing sources preserve every base field',()=>{
        for(const value of [undefined,null,NaN,Infinity,-999]) {
            const absent=row();
            for (const key of Object.keys(absent)) if(!['ftm','date'].includes(key)) absent[key]=value;
            assert.deepEqual(merge(version,{rows:[row({date:'202609240900'}),absent]}).req.short[0],base());
        }
        const sentinel=row({temp:-50,pop:-1,pty:-1,reh:-1,sky:-1,r06:-1,s06:-1,ws:-1,wd:-1});
        assert.deepEqual(merge(version,{rows:[row({date:'202609240900'}),sentinel]}).req.short[0],base());
        assert.equal(merge(version,{rss:{temp:-1}}).req.short[0].t3h,-1,'negative temperature is valid');
    });
    test(version+' first future and single future slot are included',()=>{
        for (const rows of [[row()],[row(),row({date:'202609241500'})]]) {
            assert.equal(merge(version,{rows}).req.short[0].wsd,1.3);
        }
    });
    test(version+' exact now and past stay unchanged; midnight matches',()=>{
        const a=base('20260924','0600'),b=base('20260924','0900'),c=base('20260925','0000');
        const result=merge(version,{short:[a,b,c],rows:[row({date:'202609240600'}),row({date:'202609240900'}),row({date:'202609250000'})]}).req;
        assert.equal(result.short[0].wsd,2);assert.equal(result.short[1].wsd,2);assert.equal(result.short[2].wsd,1.3);
    });
    test(version+' tmx source gate and 06:00 tmn',()=>{
        const result=merge(version,{short:[base('20260924','1500'),base('20260925','0600')],rows:[
            row({date:'202609240900'}),row({date:'202609241500',tmn:-999,tmx:31}),row({date:'202609250600',tmn:12,tmx:-999})
        ]}).req.short;
        assert.equal(result[0].tmx,31);assert.equal(result[1].tmn,12);
    });
}

test('v2 UTC/KST publication boundary remains on the intended local date',()=>{
    assert.equal(time.getKoreaDateObj('202609250000').toISOString(),'2026-09-24T15:00:00.000Z');
    assert.equal(time.getKoreaTimeString(new Date('2026-09-23T23:00:00.000Z')),'202609240800');
});
