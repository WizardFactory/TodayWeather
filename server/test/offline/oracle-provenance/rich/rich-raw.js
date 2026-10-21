'use strict';
function kmaPage(items) {
    return JSON.stringify({response:{header:{resultCode:'00',resultMsg:'NORMAL_SERVICE'},body:{dataType:'JSON',items:{item:items},pageNo:1,numOfRows:1000,totalCount:Array.isArray(items)?items.length:1}}});
}
function richRaw(value, now) {
    const raw=[];
    value.station.runs.forEach((run,index)=>{
        const stamp=run.requested || Buffer.from(run.aws,'base64').toString('latin1').match(/2026\.10\.15\.\d\d:\d\d/)[0];
        const at=Date.parse(stamp.replace(/\./g,'-').replace(/-(\d\d):(\d\d)$/,'T$1:$2:00+09:00'));
        if(!Number.isFinite(at))throw new Error('station raw publication');
        raw.push({family:run.kind==='minute'?'aws-minute':'aws-hourly',fetched_at:run.fetched_at,pages:[{base64:run.aws,content_type:'text/html;charset=euc-kr'}],requested:stamp});
        if(run.city)raw.push({family:'city-observation',fetched_at:run.fetched_at,pages:[{base64:run.city,content_type:run.city_type}],requested:stamp});
    });
    for(const a of value.air.stations.acquisitions)raw.push({family:'air-stations',fetched_at:a.fetched,pages:a.pages});
    value.air.observations.acquisitions.forEach((a,i)=>{if(value.air.observations.runs[i].rows>0&&!value.air.observations.runs[i].error)raw.push({family:'air-observations',fetched_at:a.fetched,pages:a.pages});});
    value.air.dust.acquisitions.forEach((a,i)=>{const result=value.air.dust.runs[i];if(result.parsed>0&&!result.error)raw.push({family:'air-dust',fetched_at:a.fetched,announcement:result.expected,pages:a.pages});});
    value.life.runs.forEach((run,i)=>{const outcome=value.life.outcomes[i];if(outcome.rows>0&&!outcome.error)raw.push({family:'life-'+run.kind,fetched_at:run.fetched,issued:run.issued,pages:[kmaPage(run.items)]});});
    value.kasi.runs.filter(r=>!r.skipped&&!r.error).forEach((run,i)=>raw.push({family:'kasi',area:run.area,day:run.day,fetched_at:now-600000+i,pages:[kmaPage(run.raw)]}));
    value.mfds.runs.filter(r=>!r.error).forEach(run=>raw.push({family:'mfds',fetched_at:run.now,pages:[JSON.stringify(run.body)]}));
    for(const request of value.asos.requests)raw.push({family:'asos-'+request.kind,fetched_at:now-60000,station:'108',query:request.query,pages:[request.body]});
    raw.push({family:'air-images',fetched_at:now-30000,announcement:value.images.announcement,urls:value.images.raw.map(r=>r.url),pages:value.images.raw.map(r=>({base64:r.body_base64,content_type:r.content_type}))});
    return raw;
}
module.exports={richRaw};
