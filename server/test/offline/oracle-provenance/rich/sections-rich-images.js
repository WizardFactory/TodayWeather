'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
async function images(L, context, now, getPixels) {
    // Reuse valid synthetic GIF raw bytes only. Current legacy decodes, extracts
    // station values and saves hourly rows again; old expected rows are never read.
    const original = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(L.root,'server2/tests/domestic/fixtures/air_forecast.json.gz')))).forecast;
    const announcement = '2026-10-15 17시 발표';
    const urls = original.announcements[0].slice(1);
    const raw = urls.map((url,i) => ({url, body_base64:original.images[i],content_type:'image/gif'}));
    const byUrl = Object.fromEntries(raw.map(r => [r.url,Buffer.from(r.body_base64,'base64')]));
    global.ORACLE_GET_PIXELS = (url,type,cb) => byUrl[url] ? getPixels(byUrl[url],type,cb) : cb(new Error('Unknown offline image URL'));
    const Model = L.load('models/arpltn.hourly.forecast.js');
    const collection = L.fake.attach(Model);
    const Ctrl = L.load('controllers/airkorea.hourly.forecast.controller.js');
    const callback = fn => new Promise((resolve,reject) => fn(err=>err?reject(err):resolve()));
    const Real = Date;
    function FixedDate(...args) { return new Real(...(args.length ? args : [now])); }
    FixedDate.prototype = Real.prototype;
    FixedDate.now = () => now; FixedDate.UTC = Real.UTC; FixedDate.parse = Real.parse;
    global.Date = FixedDate;
    try { await callback(cb=>(new Ctrl()).do(announcement,cb)); }
    finally { global.Date = Real; }
    // Legacy starts TTL cleanup asynchronously. Preserve completion before capture.
    await new Promise(resolve=>setTimeout(resolve,100));
    return {announcement, raw, docs:context.ej(collection.docs)};
}
module.exports = {images};
