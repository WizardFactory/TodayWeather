'use strict';
// Independent synthetic oracle for the September 2026 KMA forecast contract.
const hour=3600000,day=24*hour;
function parts(t){const s=new Date(t).toISOString();return {date:s.slice(0,10).replace(/-/g,''),time:s.slice(11,13)+'00'}}
function publication(slot){return Date.UTC(+slot.date.slice(0,4),+slot.date.slice(4,6)-1,+slot.date.slice(6,8),+slot.time.slice(0,2),+slot.time.slice(2))}
function rows(product,slot,coord){
    const base=publication(slot),start=base-base%hour,midnight=start-start%day;
    const late=+slot.time.slice(0,2)>=17,extension=midnight+(late?4:3)*day;
    const times=[];
    if(product==='shortest'){for(let i=1;i<=6;i++)times.push(start+i*hour)}
    else{
        for(let t=start+hour;t<extension;t+=hour)times.push(t);
        for(let t=extension;t<extension+day;t+=3*hour)times.push(t);
    }
    return times.map(t=>{
        const p=parts(t),r={...p,...coord,pubDate:slot.date+slot.time,sky:1,reh:0,pty:0,uuu:-2,vvv:0,vec:0,wsd:0};
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
    const field=product+'Data';
    if(version==='1.0')return [{mCoord:coord,pubDate:slot.date+slot.time,[field]:data}];
    return data.map(row=>({mCoord:coord,pubDate:new Date(publication(slot)-9*hour),fcsDate:new Date(publication(row)-9*hour),[field]:row}));
}
function items(product,slot,coord){
 const names={t3h:'TMP',r06:'PCP',s06:'SNO',t1h:'T1H',rn1:'RN1',sky:'SKY',reh:'REH',pty:'PTY',pop:'POP',uuu:'UUU',vvv:'VVV',vec:'VEC',wsd:'WSD',tmn:'TMN',tmx:'TMX',lgt:'LGT'};
 const out=[];for(const row of rows(product,slot,coord))for(const f of Object.keys(names))if(row[f]!==undefined)out.push({baseDate:[slot.date],baseTime:[slot.time],fcstDate:[row.date],fcstTime:[row.time],nx:[String(coord.mx)],ny:[String(coord.my)],category:[names[f]],fcstValue:[String(row[f])]});return out;
}
module.exports={rows,documents,publication,parts,hour,day,items};
