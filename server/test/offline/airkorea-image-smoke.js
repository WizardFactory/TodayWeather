'use strict';
// Local files only: actual get-pixels decoder + production controllers + memory model.
// Manifest entries: code, file, url, sha256, expectedStart (KST YYYY-MM-DD).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const getPixels = require('get-pixels');
const {harness,invoke} = require('./airkorea-image-harness');
async function main() {
    const manifestPath = path.resolve(process.argv[2] || '');
    const manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    const paths = {pubDate:manifest[0].publication.slice(0,13)+':00'};
    const files = {};
    for (const code of ['PM10','PM25']) {
        const entry = manifest.find(row => row.code === code);
        assert(entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.expectedStart),'expectedStart must be verified against the visible first-frame label');
        const bytes = fs.readFileSync(path.resolve(path.dirname(manifestPath),entry.file));
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);
        files[entry.url] = bytes;
        paths[code.toLowerCase()] = entry.url;
    }
    const h = harness({getPixels(url,type,cb) {
        assert(files[url],'network access forbidden');
        getPixels(files[url],type,cb);
    }});
    await invoke(h.dust,'getDustImage',paths);
    h.hourly.airkoreaDustImageMgr = h.dust;
    const stations = [
        {stationName:'seoul-reference',geo:[126.978,37.5665]},
        {stationName:'daejeon-reference',geo:[127.3845,36.3504]},
        {stationName:'busan-reference',geo:[129.0756,35.1796]},
        {stationName:'jeju-reference',geo:[126.5312,33.4996]}
    ];
    await invoke(h.hourly,'_updateHourlyForecast',['pm10','pm25'],stations);
    for (const station of stations) {
        const rows = await invoke(h.hourly,'getForecast',station.stationName);
        for (const code of ['PM10','PM25']) {
            const expectedStart = manifest.find(row => row.code === code).expectedStart;
            const series = rows.filter(row => row.code === code.toLowerCase());
            assert.equal(series.length,48,'all sampled station frames must have a legend match');
            assert.equal(series[0].dataTime,expectedStart+' 00:00');
            assert.equal(series[0].date.toISOString(),new Date(expectedStart+'T00:00:00+09:00').toISOString());
            assert(series.every(row => Number.isFinite(row.val) && row.val >= 0));
            console.log(JSON.stringify({station:station.stationName,code,rows:series.length,first:series[0].dataTime,
                last:series[47].dataTime,firstInstant:series[0].date.toISOString(),min:Math.min(...series.map(row=>row.val)),
                max:Math.max(...series.map(row=>row.val))}));
        }
    }
    console.log(JSON.stringify({result:'PASS',storedRows:h.rows.length,timezone:process.env.TZ || 'host default',storage:'isolated memory'}));
}
main().catch(error => {console.error(error);process.exitCode=1;});
