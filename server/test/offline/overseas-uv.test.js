/* #2634: recorded Tokyo weather with explicitly synthetic UV, never a live UV observation.
 * NODE_PATH=/tmp/tw-2585/node_modules TZ=UTC node server/test/offline/overseas-uv.test.js
 * Full route harness isolates providers and storage; schema tests use real mongoose without connecting.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const {createHarness, setNow} = require('./vc-weather-smoke');
const {withDayBefore} = require('./vc-synthetic');
const root = path.resolve(__dirname, '../..');
const at = Date.parse('2026-09-26T07:04:30Z');
const place = {name: 'Tokyo', lat: 35.69, lon: 139.692, zone: 'Asia/Tokyo', offset: 540};
const fields = ['uvIndex', 'ultrv', 'ultrvGrade', 'ultrvStr'];
function body(current, daily) {
    if (arguments.length === 0) { current = 1; daily = 7; }
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/vc-tokyo-combined.json')));
    raw.currentConditions.uvindex = current;
    raw.days.forEach(d => { d.uvindex = daily; d.hours.forEach(h => { h.uvindex = current; }); });
    return withDayBefore(raw);
}
function check(row, value, grade) {
    assert.equal(row.uvIndex, value);
    assert.equal(row.ultrv, value);
    assert.equal(row.ultrvGrade, grade);
    assert.equal(typeof row.ultrvStr, 'string');
    assert(row.ultrvStr.length > 0);
}
function absent(row) { fields.forEach(k => assert.equal(Object.hasOwn(row, k), false, k + ' must be absent')); }

test('UV passes through complete overseas routes, cache hit and existing mobile parsers', async () => {
    setNow(at);
    const h = createHarness(() => body());
    for (const kind of ['v000903', 'v000902', 'v000901', 'ww']) {
        const result = await h.request(kind, place, {temperatureUnit: 'F'});
        check(result.thisTime[1], 1, 0);
        check(result.thisTime[0], 1, 0);
        assert(result.daily.length >= 9);
        result.daily.forEach(d => check(d, 7, 2));
        if (kind === 'v000903') {
            for (const file of ['client/www/js/service.weatherutil.js', 'ta.ios/www/js/service.weatherutil.js']) {
                const data = parseApp(file, result);
                check(data.currentWeather, 1, 0);
                check(data.currentWeather.today, 7, 2);
            }
        }
        if (kind === 'ww') check(parseApp('tw.ios/www/js/service.weatherutil.js', result).currentWeather.today, 7, 2);
    }
    assert.equal(h.providerCalls.length, 1, 'cache hit adds no provider call');
});

test('valid UV zero and existing grade boundaries survive current/daily responses', async () => {
    setNow(at);
    for (const [value, grade] of [[0,0],[2,0],[3,1],[5,1],[6,2],[7,2],[8,3],[10,3],[11,4],[1.5,0]]) {
        const result = await createHarness(() => body(value,value)).request('v000903', place, {});
        check(result.thisTime[1], value, grade);
        result.daily.forEach(d => check(d, value, grade));
    }
});

test('missing, invalid and legacy UV never becomes zero or a grade', async () => {
    setNow(at);
    for (const invalid of [undefined, null, '', '5', false, -1, NaN, Infinity]) {
        const result = await createHarness(() => body(invalid,invalid)).request('v000903', place, {});
        result.thisTime.forEach(absent);
        result.daily.forEach(absent);
    }
});

test('optional UV survives real mongoose schema round trip without adding old-cache defaults', () => {
    const Model = require(path.join(root, 'models/worldWeather/dsf.model'));
    const h = createHarness();
    const C = h.load(path.join(root, 'controllers/worldWeather/dsf.controller.js'));
    const converter = require(path.join(root, 'lib/VC/vcConverter'));
    for (const value of [0, 7, undefined]) {
        const docs = converter.toDarkSkyDocs(body(value,value), new Date(at));
        const data = new C()._parseData(docs.current);
        const record = new Model({data}).toObject();
        const rows = [record.data.current, ...record.data.daily.data, ...record.data.hourly.data];
        assert(rows.length > 1);
        rows.forEach(r => value === undefined ? assert.equal(Object.hasOwn(r,'uvIndex'),false) : assert.equal(r.uvIndex,value));
    }
});

test('daily and current UV labels use the request translator', () => {
    const h = createHarness();
    const World = h.load(path.join(root, 'controllers/worldWeather/controllerWorldWeather.js'));
    const c = new World();
    const ts = {__: key => 'translated:' + key};
    assert.equal(c._makeDailyDataFromDSF({uvIndex: 7}, ts).ultrvStr, 'translated:LOC_HIGH');
    assert.equal(c._makeCurrentDataFromDSFCurrent({uvIndex: 0}, ts).ultrvStr, 'translated:LOC_LOW');
});

function parseApp(file, result) {
    let util;
    const units = {temperatureUnit:'C',windSpeedUnit:'m/s',pressureUnit:'hPa',distanceUnit:'km',precipitationUnit:'mm',airUnit:'airkorea'};
    const context = {angular:{module:()=>({factory:(n,f)=>{util=f({},()=>{throw Error('network disabled');},
        {ga:{trackEvent(){},trackException(e){throw e;}}}, {getUnit:k=>units[k],convertUnits:(a,b,v)=>v,getDefaultUnits:()=>Object.assign({},units)});}})},
        console:{log(){},info(){},warn(){},error(){}},clientConfig:{debug:false},alert:m=>{throw Error(m);}};
    vm.runInNewContext(fs.readFileSync(path.join(root,'..',file),'utf8'),context);
    return util.convertWeatherData([{data:JSON.parse(JSON.stringify(result))}]);
}

test('daily weather fallback never supplies current UV when current/hourly observations are missing', () => {
    const converter = require(path.join(root, 'lib/VC/vcConverter'));
    const raw = body(1, 9);
    delete raw.currentConditions;
    raw.days.forEach(d => { d.hours = []; });
    const docs = converter.toDarkSkyDocs(raw, new Date(at));
    for (const kind of ['current','today','yesterday','twoDaysAgo']) {
        assert.equal(Object.hasOwn(docs[kind].currently, 'uvIndex'), false, kind);
        assert.equal(docs[kind].daily.data[0].uvIndex, 9);
    }
});

test('missing currentConditions can use current-hour UV without using daily maximum', () => {
    const converter = require(path.join(root, 'lib/VC/vcConverter'));
    const raw = body(0, 9);
    delete raw.currentConditions;
    assert.equal(converter.toDarkSkyDocs(raw, new Date(at)).current.currently.uvIndex, 0);
});

test('recorded Visual Crossing Tokyo UV reaches current and every daily response row', async () => {
    // Real provider capture: 2026-09-29T05:25:40.390Z, coordinates 35.69,139.692,
    // range last1days/next7days; queryCost was 49 both before and after adding UV.
    const captured = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/vc-tokyo-uv.json')));
    setNow(Date.parse('2026-09-29T05:25:40.390Z'));
    const result = await createHarness(() => captured).request('v000903',place,{});
    assert.equal(result.thisTime[1].uvIndex,captured.currentConditions.uvindex);
    assert.equal(result.daily.length,captured.days.length);
    result.daily.forEach((row,i)=>assert.equal(row.uvIndex,captured.days[i].uvindex));
});
