'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {harness,pixels,imagePath,invoke,pipeline} = require('./airkorea-image-harness');

test('current 820x820 calibration decodes and stores 48 KST hours for both pollutants', async () => {
    const h = harness();
    assert.equal(h.config.image.airkorea_korea_image.size.height, '820');
    const rows = await pipeline(h);
    assert.equal(rows.length,96);
    for (const code of ['pm10','pm25']) {
        const series = rows.filter(r => r.code === code);
        assert.equal(series[0].val,code === 'pm10' ? 24 : 12);
        assert.equal(series[0].dataTime,'2026-10-15 00:00');
        assert.equal(series[47].dataTime,'2026-10-16 23:00');
        assert.equal(series[0].date.toISOString(),'2026-10-14T15:00:00.000Z');
        assert.equal(series[0].pubDate,'2026-10-15 11:00');
        assert.ok(series.every(r => Number.isFinite(r.val) && r.val >= 0));
    }
});
test('an explicit 830-height override preserves rejection of an 820-height image without writes', async () => {
    const h = harness({env:{AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT:'830'}});
    await assert.rejects(pipeline(h)); assert.equal(h.rows.length,0);
});
test('original-record lookup through the actual hourly job writes and reads both pollutants', async () => {
    const h = harness();
    await invoke(h.hourly,'do','2026-10-15 11시 발표');
    const rows = await invoke(h.hourly,'getForecast','synthetic-seoul');
    assert.equal(rows.length,96);
    assert.equal(rows[0].date.toISOString(),'2026-10-14T15:00:00.000Z');
    await invoke(h.hourly,'do','2026-10-15 11시 발표');
    assert.equal(h.rows.length,96,'already collected publication skips duplicate writes');
});
test('explicit geographic/map calibration is honored', async () => {
    const h = harness({env:{AIRKOREA_KOREA_IMAGE_MAP_LEFT:'80',AIRKOREA_KOREA_IMAGE_COORDI_LEFT_LON:'124'}});
    assert.equal(h.parser.getImagePos().left,80);
    assert.equal(h.parser.getDefaultCoordi().top_left.lon,124);
    const map = await invoke(h.parser,'getPixelMap',imagePath(),'image/gif',h.dust.coordinate);
    assert.equal(map.map_width,583);
    assert.equal(map.map_pixel_distance_width,(130.6741-124)/583);
});
for (const [label,options] of [
    ['unknown canvas',{pixels:pixels({shape:[48,821,820,4]})}],
    ['empty animation',{pixels:pixels({shape:[0,820,820,4]})}],
    ['static image',{pixels:pixels({shape:[820,820,4]})}],
    ['last frame changed legend',{pixels:pixels({badLegend:true})}],
    ['out-of-bounds map',{env:{AIRKOREA_KOREA_IMAGE_MAP_BOTTOM:'900'}}],
    ['degenerate geography',{env:{AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT:'32'}}]
]) test(label+' fails before station writes', async () => {
    const h = harness(options); await assert.rejects(pipeline(h)); assert.equal(h.rows.length,0);
});
test('unknown pixel colours stay missing instead of becoming a sentinel or zero', async () => {
    const h = harness({pixels:pixels({unknown:true})});
    const rows = await pipeline(h); assert.equal(rows.length,0);
});
test('image cycle, not current clock or later publication, determines dates across month rollover', async () => {
    const h = harness();
    const rows = await pipeline(h,{pubDate:'2026-02-01 05:00',pm10:imagePath('pm10','2026/01/31'),pm25:imagePath('pm25','2026/01/31')});
    assert.equal(rows[0].dataTime,'2026-02-01 00:00');
    assert.equal(rows[47].dataTime,'2026-02-02 23:00');
});
for (const code of ['pm10','pm25']) {
    const other = code === 'pm10' ? 'pm25' : 'pm10';
    for (const path of [imagePath(code,'2026/02/30'),imagePath(code).replace('AQF.20261014','AQF.20261013'),imagePath(code).replace('/23/','/24/'),imagePath(code).replace('/23/','/12/'),imagePath(other),'https://www.airkorea.or.kr/dustImage/']) {
        test('invalid '+code+' date/path or pollutant mismatch with valid counterpart does not write: '+path, async () => {
            const h = harness();
            await assert.rejects(pipeline(h,{pubDate:'2026-10-15 11:00',[code]:path,[other]:imagePath(other)}));
            assert.equal(h.rows.length,0);
        });
    }
    test('missing '+code+' rejects the pair before station writes', async () => {
        const h = harness();
        await assert.rejects(pipeline(h,{pubDate:'2026-10-15 11:00',[other]:imagePath(other)}));
        assert.equal(h.rows.length,0);
    });
}
test('palette neighborhoods accept rounding without crossing into another band', async () => {
    for (const delta of [4,5,7]) {
        const h = harness({pixels:pixels({band:21,paletteDelta:delta})});
        const rows = await pipeline(h); assert.equal(rows[0].val,75);
    }
    const bad = harness({pixels:pixels({paletteDelta:10})});
    await assert.rejects(pipeline(bad)); assert.equal(bad.rows.length,0);
});
for (const [cycle,count,start,end] of [
    ['05',42,'2026-10-15 06:00','2026-10-16 23:00'],
    ['11',36,'2026-10-15 12:00','2026-10-16 23:00'],
    ['17',54,'2026-10-15 18:00','2026-10-17 23:00'],
    ['23',47,'2026-10-16 00:00','2026-10-17 22:00'],
    ['05',1,'2026-10-15 06:00','2026-10-15 06:00']
]) test('decoded count '+count+' controls extraction for cycle '+cycle, async () => {
    const h = harness({pixels:pixels({shape:[count,820,820,4]})});
    const rows = await pipeline(h,{pubDate:'2026-10-15 23:00',pm10:imagePath('pm10','2026/10/15',cycle),pm25:imagePath('pm25','2026/10/15',cycle)});
    for (const code of ['pm10','pm25']) {
        const series=rows.filter(r=>r.code===code); assert.equal(series.length,count);
        assert.equal(series[0].dataTime,start);assert.equal(series[count-1].dataTime,end);
        assert.equal(series[0].date.toISOString(),new Date(start.replace(' ','T')+':00+09:00').toISOString());
    }
});
test('pollutants keep independent decoded lengths and start dates', async () => {
    const h=harness({getPixels(url,type,cb){cb(null,pixels({shape:[url.includes('PM2P5')?54:36,820,820,4]}));}});
    const rows=await pipeline(h,{pubDate:'2026-10-15 17:00',pm10:imagePath('pm10','2026/10/15','11'),pm25:imagePath('pm25','2026/10/15','17')});
    const pm10=rows.filter(r=>r.code==='pm10'),pm25=rows.filter(r=>r.code==='pm25');
    assert.equal(pm10.length,36);assert.equal(pm25.length,54);assert.equal(pm10[0].dataTime,'2026-10-15 12:00');assert.equal(pm25[0].dataTime,'2026-10-15 18:00');
    assert.equal(pm25[53].dataTime,'2026-10-17 23:00');
});
test('six-hour-cycle arithmetic handles leap day and year rollover',()=>{
    const layout=require('../../lib/airkoreaImageLayout');
    for (const [day,cycle,wanted] of [['2028/02/29','17','2028-02-29T18:00:00.000Z'],['2026/12/31','23','2027-01-01T00:00:00.000Z']]) {
        assert.equal(new Date(layout.frameStart(imagePath('pm10',day,cycle),'PM10')).toISOString(),wanted);
    }
});
for (const count of [-1,1.5,NaN]) test('invalid frame count '+count+' fails before writes',async()=>{
    const h=harness({pixels:pixels({shape:[count,820,820,4]})});await assert.rejects(pipeline(h));assert.equal(h.rows.length,0);
});
test('every decoded frame legend is validated including new final frame',async()=>{
    const p=pixels({shape:[54,820,820,4]});const original=p.get;
    p.get=(f,x,y,c)=>f===53&&x===680&&c!==3?255:original(f,x,y,c);
    const h=harness({pixels:p});await assert.rejects(pipeline(h,{pubDate:'2026-10-15 17:00',pm10:imagePath('pm10','2026/10/15','17'),pm25:imagePath('pm25','2026/10/15','17')}));assert.equal(h.rows.length,0);
});
test('observed yellow-band delta7 is recognized and delta8 crosses the boundary',async()=>{
    for (const delta of [6,7,8]) {
        const p=pixels({band:11});const orig=p.get;
        p.get=(f,x,y,c)=>{
            const legend=x===680&&y===Math.floor(74+11.5*701/36);
            if(c<2&&(legend||x!==680))return 100+delta;
            return orig(f,x,y,c);
        };
        const h=harness({pixels:p});
        if(delta<8)assert.equal((await pipeline(h))[0].val,143);
        else{await assert.rejects(pipeline(h));assert.equal(h.rows.length,0);}
    }
});
