'use strict';
const assert=require('assert');
// Independent synthetic oracle for the September 2026 KMA forecast contract.
const hour=3600000,day=24*hour;
function parts(t){const s=new Date(t).toISOString();return {date:s.slice(0,10).replace(/-/g,''),time:s.slice(11,13)+'00'}}
function publication(slot){return Date.UTC(+slot.date.slice(0,4),+slot.date.slice(4,6)-1,+slot.date.slice(6,8),+slot.time.slice(0,2),+slot.time.slice(2))}
// data.go.kr answers an ultra-short HH30 request with baseTime HH00 (production, 2026-10-04 #2676 rollback).
function echo(product,slot){return product==='shortest'?slot.time.slice(0,2)+'00':slot.time}
function rows(product,slot,coord,baseTime){
    const pub=slot.date+(baseTime||echo(product,slot));
    const base=publication(slot),start=base-base%hour,midnight=start-start%day;
    const late=+slot.time.slice(0,2)>=17,extension=midnight+(late?4:3)*day;
    const times=[];
    if(product==='shortest'){for(let i=1;i<=6;i++)times.push(start+i*hour)}
    else{
        for(let t=start+hour;t<extension;t+=hour)times.push(t);
        for(let t=extension;t<extension+day;t+=3*hour)times.push(t);
    }
    return times.map(t=>{
        const p=parts(t),r={...p,...coord,pubDate:pub,sky:1,reh:0,pty:0,uuu:-2,vvv:0,vec:0,wsd:0};
        if(product==='shortest')Object.assign(r,{t1h:-12.5,rn1:0,lgt:-3,pop:0});
        else{
            Object.assign(r,{t3h:-12.5,r06:0,s06:0,pop:0});
            if(p.time==='0600'&&(p.date!==slot.date||slot.time==='0200'))r.tmn=-20;
            if(p.time==='1500'&&(p.date!==slot.date||slot.time<='1100'))r.tmx=0;
        }
        return r;
    });
}
function documents(product,version,slot,coord,data){
    const field=product+'Data',pub=data[0].pubDate;
    if(version==='1.0')return [{mCoord:coord,pubDate:pub,[field]:data}];
    return data.map(row=>({mCoord:coord,pubDate:new Date(publication({date:pub.slice(0,8),time:pub.slice(8)})-9*hour),fcsDate:new Date(publication(row)-9*hour),[field]:row}));
}
function items(product,slot,coord,baseTime){
 baseTime=baseTime||echo(product,slot);
 const names={t3h:'TMP',r06:'PCP',s06:'SNO',t1h:'T1H',rn1:'RN1',sky:'SKY',reh:'REH',pty:'PTY',pop:'POP',uuu:'UUU',vvv:'VVV',vec:'VEC',wsd:'WSD',tmn:'TMN',tmx:'TMX',lgt:'LGT'};
 const out=[];for(const row of rows(product,slot,coord,baseTime))for(const f of Object.keys(names))if(row[f]!==undefined)out.push({baseDate:[slot.date],baseTime:[baseTime],fcstDate:[row.date],fcstTime:[row.time],nx:[String(coord.mx)],ny:[String(coord.my)],category:[names[f]],fcstValue:[String(row[f])]});return out;
}
// In-memory model: DB1 find by query and a DB2 aggregate that evaluates the generated stages
// with Mongo query/expression semantics (BSON type order), so offline tests exercise the real conditions.
function value(doc,path){return path.split('.').reduce((v,k)=>v==null?undefined:v[k],doc)}
function same(a,b){return a instanceof Date||b instanceof Date?a!=null&&b!=null&&+a===+b:a===b}
function rank(v){return v==null?1:typeof v==='number'?2:typeof v==='string'?3:typeof v==='boolean'?8:v instanceof Date?9:Array.isArray(v)?5:4}
function cmp(a,b){
 const r=rank(a)-rank(b);if(r)return r;
 if(typeof a==='number'){if(Number.isNaN(a)||Number.isNaN(b))return Number.isNaN(a)?(Number.isNaN(b)?0:-1):1;return a<b?-1:a>b?1:0}
 if(a instanceof Date)return +a-+b;if(typeof a==='string'||typeof a==='boolean')return a<b?-1:a>b?1:0;return 0}
function test(v,cond){
 if(cond===null||typeof cond!=='object'||cond instanceof Date)return same(v,cond);
 return Object.keys(cond).every(op=>{const c=cond[op];if(op==='$in')return c.some(x=>same(v,x));throw new Error('unsupported operator '+op)})}
function matches(doc,query){return Object.keys(query).every(k=>test(value(doc,k),query[k]))}
function truthy(v){return !(v===false||v==null||v===0)}
function evaluate(doc,e){
 if(typeof e==='string'&&e[0]==='$')return value(doc,e.slice(1));
 if(e===null||typeof e!=='object'||e instanceof Date)return e;
 const [op]=Object.keys(e),a=e[op],x=i=>evaluate(doc,a[i]);
 switch(op){
  case '$eq':return cmp(x(0),x(1))===0;case '$ne':return cmp(x(0),x(1))!==0;
  case '$gt':return cmp(x(0),x(1))>0;case '$gte':return cmp(x(0),x(1))>=0;
  case '$lt':return cmp(x(0),x(1))<0;case '$lte':return cmp(x(0),x(1))<=0;
  case '$and':return a.every((_,i)=>truthy(x(i)));case '$or':return a.some((_,i)=>truthy(x(i)));
  case '$not':return !truthy(x(0));case '$in':return a[1].some(v=>cmp(x(0),v)===0);
  case '$cond':return truthy(x(0))?x(1):x(2);
  case '$add':{const d=x(0);return d instanceof Date?new Date(+d+x(1)):null}
  case '$size':return evaluate(doc,a).length;
  case '$setDifference':{const b=x(1);return x(0).filter(v=>!b.some(w=>cmp(v,w)===0))}
  case '$dateToString':{const d=evaluate(doc,a.date);if(!(d instanceof Date))return null;const t=d.toISOString();
   if(a.format==='%Y%m%d')return t.slice(0,4)+t.slice(5,7)+t.slice(8,10);assert.strictEqual(a.format,'%H%M');return t.slice(11,13)+t.slice(14,16)}
 }
 throw new Error('unsupported expression '+op)}
function memoryModel(docs){
 return {find(query){return {setOptions(){return this},lean(){return this},exec(cb){cb(null,docs().filter(d=>matches(d,query)))}}},
  aggregate(pipeline){return {option(){return this},exec(cb){
   assert.strictEqual(pipeline.length,4);const {_id,...accumulators}=pipeline[1].$group,groups=new Map();
   for(const d of docs().filter(d=>matches(d,pipeline[0].$match))){const id=d.mCoord.mx+':'+d.mCoord.my;
    if(!groups.has(id))groups.set(id,{_id:{mx:d.mCoord.mx,my:d.mCoord.my}});const g=groups.get(id);
    for(const [name,acc] of Object.entries(accumulators)){const v=evaluate(d,acc.$addToSet);g[name]=g[name]||[];if(!g[name].some(w=>cmp(v,w)===0))g[name].push(v)}}
   cb(null,[...groups.values()].map(g=>({_id:g._id,n:evaluate(g,pipeline[2].$project.n)})).filter(g=>g.n===pipeline[3].$match.n))}}}};
}
module.exports={rows,documents,publication,parts,hour,day,items,echo,memoryModel,matches};
