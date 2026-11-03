/* S15b-2 station oracle sections (task evidence). Runs legacy KmaScraper parsers with cheerio
 * 0.20.0 (the S15 oracle dependency) over page inputs. `iconv` (a native legacy dependency) is
 * replaced by iconv-lite's EUC-KR decoder; inputs use KS X 1001 text only, where both agree. */
'use strict';
const Module = require('module');
const fs = require('fs');
const path = require('path');

function installIconv() {
    const lite = Module._load('iconv-lite', module);
    const rawLoad = Module._load;
    Module._load = function (request) {
        if (request === 'iconv') {
            return {Iconv: function () { this.convert = buf => Buffer.from(lite.decode(buf, 'euc-kr'), 'utf8'); }};
        }
        return rawLoad.apply(this, arguments);
    };
}
function scraper(L) {
    installIconv();
    const Scraper = L.load('lib/kmaScraper.js');
    return new Scraper();
}
const cheerio = () => Module._load('cheerio', module);

function ej(v) {
    if (v instanceof Date) return {$date: v.getTime()};
    if (Array.isArray(v)) return v.map(ej);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ej(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$number: String(v)};
    return v;
}
/** Legacy AWS page parse: getAWSWeather decoding then _parseStnMinInfo. */
function parseAws(s, bytes, requested) {
    const lite = Module._load('iconv-lite', module);
    const text = Buffer.from(lite.decode(bytes, 'euc-kr'), 'utf8').toString();
    const $ = cheerio().load(text);
    let out;
    s._parseStnMinInfo(requested, $, (err, res) => { out = err ? {error: err.state || err.message} : {pubDate: res.pubDate, rows: ej(res.stnList)}; });
    return out;
}
function parseCity(s, bytes, contentType, requested) {
    const text = s._decodeKmaHtml(bytes, {headers: {'content-type': contentType}});
    const res = s._parseCityWeatherHtml(text, requested);
    if (res instanceof Error) return {error: res.message.split('=')[0]};
    return {pubDate: res.pubDate, rows: ej(res.cityList)};
}

async function pages(L) {
    const s = scraper(L);
    const fx = require('./station-fixtures');
    const out = [];
    for (const c of fx.pages()) {
        const bytes = Buffer.from(c.base64, 'base64');
        const result = c.kind === 'aws' ? parseAws(s, bytes, c.requested) : parseCity(s, bytes, c.content_type || '', c.requested);
        out.push(Object.assign({}, c, {result}));
    }
    // Merge of the first hourly AWS page with the first city page.
    return out;
}
async function merge(L) {
    const s = scraper(L);
    const fx = require('./station-fixtures');
    const out = [];
    for (const c of fx.merges()) {
        const aws = parseAws(s, Buffer.from(c.aws, 'base64'), c.requested);
        const city = parseCity(s, Buffer.from(c.city, 'base64'), c.city_type || '', c.requested);
        // Re-parse to get live objects (Dates) for the merge itself.
        const lite = Module._load('iconv-lite', module);
        let awsList;
        s._parseStnMinInfo(c.requested, cheerio().load(Buffer.from(lite.decode(Buffer.from(c.aws, 'base64'), 'euc-kr'), 'utf8').toString()), (e, r) => { awsList = r.stnList; });
        const cityList = s._parseCityWeatherHtml(s._decodeKmaHtml(Buffer.from(c.city, 'base64'), {headers: {'content-type': c.city_type || ''}}), c.requested).cityList;
        out.push({id: c.id, aws_id: c.aws_id, city_id: c.city_id, aws: aws.pubDate, city: city.pubDate, merged: ej(s._mergeAWSandCity(awsList, cityList))});
    }
    return out;
}
module.exports = {pages, merge, parseAws, parseCity, scraper, ej};
