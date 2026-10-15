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
    ['missing frame',{pixels:pixels({shape:[47,820,820,4]})}],
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
for (const path of [imagePath('pm10','2026/02/30'),imagePath().replace('/23/','/05/'),imagePath().replace('/23/','/11/'),imagePath('pm25'),'https://www.airkorea.or.kr/dustImage/']) {
    test('invalid image date/path or pollutant mismatch does not write: '+path, async () => {
        const h = harness(); await assert.rejects(pipeline(h,{pubDate:'2026-10-15 11:00',pm10:path})); assert.equal(h.rows.length,0);
    });
}
test('observed four-level GIF palette rounding preserves the legend value; five levels reject', async () => {
    const h = harness({pixels:pixels({band:21,paletteDelta:4})});
    const rows = await pipeline(h);
    assert.equal(rows[0].val,75);
    const bad = harness({pixels:pixels({paletteDelta:5})});
    await assert.rejects(pipeline(bad)); assert.equal(bad.rows.length,0);
});
