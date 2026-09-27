/* KMA warning functional smoke with a real MongoDB (#2609).
 *
 * Real: HTTP between the requester and a local provider stub serving the recorded WthrWrnInfoService
 * responses (fixtures/kma-warning), KmaWarningRequester, KmaWarningCollector, mongoose models on MongoDB,
 * the express router routes/v000903/route.kma.v000903.js (GET /v000903/kma/special) with i18n.
 * The town response is the full v000903 coordinate middleware from the rss-response-smoke harness (synthetic
 * weather stores) with the real kma.specialweather.controller reading the zone state written to MongoDB.
 *
 *   docker run -d --rm --name tw2609-mongo -p 27099:27017 mongo:3.4.15
 *   TZ=UTC TW_MONGO_URL=mongodb://127.0.0.1:27099/tw2609 NODE_PATH=<deps> node server/test/offline/kma-warning-smoke.js
 *
 * <deps>: async express@4.13 i18n@0.8 mongoose@5.1.2 request sprintf xml2js, plus what the route's controllers
 * load (axios get-pixels aws-sdk dnscache). TW_E2E_PORT keeps the server running for the client/www E2E
 * (kma-warning-client-e2e.js) and also serves client/www, with TW_CLIENT_LIB (bower lib) and TW_CLIENT_CSS.
 * The database named in TW_MONGO_URL is dropped first; never point it at a shared database.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const mongoUrl = process.env.TW_MONGO_URL;
if (!mongoUrl || !/127\.0\.0\.1|localhost/.test(mongoUrl)) {
    console.error('TW_MONGO_URL must name a disposable local MongoDB database (not run)');
    process.exit(2);
}
const logs = [];
global.log = {};
['info', 'warn', 'error', 'debug', 'verbose', 'silly'].forEach(level => {
    global.log[level] = (...args) => { logs.push({level, text: args.map(a => a && a.stack || String(a)).join(' ')}); if (level === 'warn' || level === 'error') { console.log('[' + level + ']', ...args); } };
});

const mongoose = require('mongoose');
const express = require('express');
const i18n = require('i18n');
const server = path.resolve(__dirname, '../..');
const KmaWarningRequester = require('../../lib/kmaWarningRequester');
const KmaWarningCollector = require('../../lib/kmaWarningCollector');
const Situation = require('../../models/modelKmaSpecialWeatherSituation');
const Zone = require('../../models/modelKmaSpecialWeatherZone');
const {makeFixture, createHarness, locations} = require('./rss-response-smoke');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/kma-warning', name + '.json'), 'utf8'));
const itemsOf = body => body.response.body.items.item;
const page = items => ({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'},
    body: {dataType: 'JSON', items: {item: items}, pageNo: 1, numOfRows: 1000, totalCount: 104}}});
// 2026-09-26 11:30 KST (tmSeq 128): 강풍주의보, 호우경보 and 호우주의보 around Jeju.
const wrnMsgDay = itemsOf(fixture('wrn-msg-0926'));
const at1130 = wrnMsgDay.find(i => i.tmSeq === 128);
const pwnCdRows = itemsOf(fixture('pwn-cd-0921-0927')).filter(r => r.tmFc < 202609261140);
const providerBodies = {
    getPwnStatus: page([{other: at1130.other, t6: at1130.t6, t7: at1130.t7, tmEf: String(at1130.t5), tmFc: at1130.tmFc, tmSeq: at1130.tmSeq}]),
    getWthrWrnMsg: page(wrnMsgDay),
    getPwnCd: page(pwnCdRows),
    getWthrPwn: fixture('wthr-pwn'),
    getWthrInfo: fixture('wthr-info'),
    getWthrBrkNews: fixture('brk-news')
};
const providerCalls = [];

function listen(handler) {
    return new Promise(resolve => {
        const srv = http.createServer(handler);
        srv.listen(Number(process.env.TW_E2E_PORT && handler.e2e ? process.env.TW_E2E_PORT : 0), '127.0.0.1', () => resolve(srv));
    });
}
function getJson(target, headers) {
    return new Promise((resolve, reject) => {
        http.get(target, {headers: headers || {}}, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => { try { resolve({status: res.statusCode, headers: res.headers, body: JSON.parse(body)}); } catch (err) { reject(new Error(res.statusCode + ' ' + body.slice(0, 200))); } });
        }).on('error', reject);
    });
}
const gather = collector => new Promise(resolve => collector.gather(err => resolve(err)));

async function main() {
    const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'kma-warning-smoke-output');
    fs.mkdirSync(outputDir, {recursive: true});
    await mongoose.connect(mongoUrl);
    await mongoose.connection.db.dropDatabase();
    // Indexes built at connect were dropped with the database; rebuild them as a fresh deployment would.
    await Promise.all([Situation.ensureIndexes(), Zone.ensureIndexes()]);

    const provider = await listen((req, res) => {
        const parsed = url.parse(req.url, true);
        const operation = parsed.pathname.split('/').pop();
        providerCalls.push({operation, query: parsed.query});
        assert.equal(parsed.query.dataType, 'JSON');
        assert.equal(req.url.match(/serviceKey=([^&]*)/)[1], 'SMOKE%2BKEY%3D%3Dxxxxxxxxxxxxxxxxxxxx', 'stored key sent once-encoded');
        const body = providerBodies[operation];
        res.writeHead(body ? 200 : 404, {'Content-Type': 'application/json;charset=UTF-8'});
        res.end(JSON.stringify(body || {}));
    });
    const baseUrl = 'http://127.0.0.1:' + provider.address().port + '/1360000/WthrWrnInfoService/';
    const collector = new KmaWarningCollector({requester: new KmaWarningRequester({keys: ['SMOKE%2BKEY%3D%3Dxxxxxxxxxxxxxxxxxxxx'], baseUrl})});

    // S1: first cycle stores types 1-4 and the zone state.
    assert.equal(await gather(collector), undefined, 'first cycle stores documents');
    const docs = await Situation.find({}).lean().exec();
    assert.deepEqual(docs.map(d => d.type).sort(), [1, 2, 3, 4]);
    const t1 = docs.find(d => d.type === 1);
    assert.equal(t1.announcement.toISOString(), '2026-09-26T11:30:00.000Z');
    assert.deepEqual(t1.situationList.map(s => s.weatherStr + s.levelStr), ['강풍주의보', '호우경보', '호우주의보']);
    assert.equal(t1.bulletin.title, at1130.t1);
    const zoneDocs = await Zone.find({}).lean().exec();
    const active = zoneDocs.filter(z => z.active && z.warnVar > 0);
    assert.ok(active.length > 0, 'active zones stored');
    assert.ok(zoneDocs.some(z => z.areaCode === '_sync' && z.lastFromTmFc), 'sync marker stored');
    const indexes = await Zone.collection.indexes();
    assert.ok(indexes.some(i => i.unique && i.key.areaCode === 1 && i.key.warnVar === 1), 'unique zone index');

    // S2: an unchanged announcement stores nothing and calls neither getWthrWrnMsg nor getPwnCd.
    const before = providerCalls.length;
    assert.equal(await gather(collector), 'skip');
    assert.deepEqual(providerCalls.slice(before).map(c => c.operation), ['getPwnStatus', 'getWthrPwn', 'getWthrInfo', 'getWthrBrkNews']);
    assert.equal(await Situation.count({}).exec(), 4);

    // S3: the real /v000903/kma router and i18n serve the stored bulletins.
    i18n.configure({locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'], cookie: 'twcookie', directory: path.join(server, 'locales'), register: global});
    const app = express();
    app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
    app.use(i18n.init);
    app.use('/v000903/kma', require('../../routes/v000903/route.kma.v000903'));

    // S4: the full v000903 coordinate middleware for a 서귀포시 town, with the real special weather controller
    // reading the zone state from MongoDB.
    const seogwipo = {name: 'Jeju', town: {first: '제주특별자치도', second: '서귀포시', third: '성산읍'}, mCoord: {mx: 60, my: 37}, gCoord: {lat: 33.4588, lon: 126.9425}};
    locations.push(seogwipo);
    const zoneRows = JSON.parse(JSON.stringify(await Zone.find({areaCode: {$ne: '_sync'}}).lean().exec()));
    const townResponse = async (place, rows) => {
        const weather = makeFixture(place, 'equal');
        weather.zoneRows = rows;
        // Korean server texts, as for a ko client (res.__ from i18n).
        const translate = (phrase, ...args) => i18n.__.apply(i18n, [{phrase, locale: 'ko'}].concat(args));
        return (await createHarness('2.0', weather, {translate}).request({windSpeedUnit: 'm/s', temperatureUnit: 'C'})).body;
    };
    const town = await townResponse(seogwipo, zoneRows);
    assert.deepEqual(town.current.specialInfo.map(s => s.weatherStr + s.levelStr + '@' + s.locationName),
        ['호우경보@제주도산지', '호우주의보@서귀포시남부', '호우주의보@서귀포시동부', '호우주의보@서귀포시중산간', '강풍주의보@서귀포시동부', '강풍주의보@서귀포시중산간', '강풍주의보@제주도산지']);
    // The 제주도산지 호우경보 reaches 서귀포시 towns (AK decision 2026-09-27) and leads the summary.
    assert.ok(town.current.summaryWeather.indexOf('호우경보') !== -1, 'summaryWeather: ' + town.current.summaryWeather);
    assert.ok(town.current.summary.indexOf('호우경보') !== -1, 'summary: ' + town.current.summary);
    const seoul = await townResponse(locations[0], zoneRows);
    assert.equal(seoul.current.specialInfo, undefined, 'no Seoul warning');
    fs.writeFileSync(path.join(outputDir, 'town-seogwipo.json'), JSON.stringify(town, null, 1));

    app.get('/weather/v000903/coord/:loc', (req, res) => res.json(town));
    const e2e = Object.assign((req, res) => app(req, res), {e2e: true});
    if (process.env.TW_E2E_PORT) {
        serveClient(app);
    }
    const web = await listen(e2e);
    const origin = 'http://127.0.0.1:' + web.address().port;
    const special = await getJson(origin + '/v000903/kma/special', {'Accept-Language': 'ko'});
    assert.equal(special.status, 200);
    assert.equal(special.headers['cache-control'], 'max-age=300');
    const byType = {};
    special.body.forEach(item => { byType[item.type] = item; });
    const flashVisible = Date.now() < Date.parse('2026-09-27T19:10:00Z');
    assert.deepEqual(special.body.map(s => s.type), flashVisible ? [4, 1, 2, 3] : [1, 2, 3]);
    assert.equal(byType[1].name, '기상특보');
    assert.equal(byType[1].announcement, '2026-09-26T02:30:00.000Z');
    assert.equal(byType[1].bulletin.title, at1130.t1);
    assert.equal(byType[2].situationList[0].weatherStr, '없음');
    assert.ok(byType[3].comment.length > 0 && byType[1].comment.length > 0);
    fs.writeFileSync(path.join(outputDir, 'kma-special.json'), JSON.stringify(special.body, null, 1));

    const summary = {
        stored: docs.length, activeZones: active.length, townSpecialInfo: town.current.specialInfo.length,
        summaryWeather: town.current.summaryWeather, specialTypes: special.body.map(s => s.type),
        providerCalls: providerCalls.map(c => c.operation), warnings: logs.filter(l => l.level === 'warn').length
    };
    console.log(JSON.stringify(summary));
    if (process.env.TW_E2E_PORT) {
        console.log('E2E server ready ' + origin);
        return;
    }
    web.close();
    provider.close();
    // Models loaded by the route build their indexes asynchronously; let them finish before disconnecting.
    await Promise.all(mongoose.modelNames().map(name => mongoose.model(name).init().catch(() => {})));
    await mongoose.disconnect();
    console.log('kma warning smoke passed');
}

// client/www with bower libraries and compiled CSS from outside the checkout; serverUrl points here.
function serveClient(app) {
    const www = path.resolve(server, '../client/www');
    const lib = process.env.TW_CLIENT_LIB;
    const css = process.env.TW_CLIENT_CSS;
    assert.ok(lib && css, 'TW_CLIENT_LIB and TW_CLIENT_CSS are required with TW_E2E_PORT');
    app.get('/client.config.js', (req, res) => {
        const source = fs.readFileSync(path.join(www, 'client.config.js'), 'utf8')
            .replace("serverUrl : 'https://localhost'", "serverUrl : 'http://127.0.0.1:" + process.env.TW_E2E_PORT + "'");
        res.type('application/javascript').send(source);
    });
    // index.html bootstraps angular on Cordova's deviceready; a browser has no Cordova, so emit it once loaded.
    app.get('/cordova.js', (req, res) => res.type('application/javascript').send(
        "document.addEventListener('DOMContentLoaded', function () { setTimeout(function () {" +
        " var e = document.createEvent('Events'); e.initEvent('deviceready', true, false); document.dispatchEvent(e); }, 0); });"));
    app.get('/css/ionic.app.css', (req, res) => res.sendFile(css));
    app.use('/lib', express.static(lib));
    app.use(express.static(www));
    app.use((req, res) => { console.log('[e2e 404]', req.method, req.url); res.status(404).send('not found'); });
}

main().catch(err => { console.error(err.stack); process.exitCode = 1; setTimeout(() => process.exit(1), 100); });
