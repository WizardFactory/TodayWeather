#!/usr/bin/env node
// Records the Cordova weather screens S03 (Hourly) and S04 (Daily) that the native screens are compared with (AN-08,
// #2887): run by capture.sh while the Cordova debug build runs offline at 384x832 dp, density 2, in ko-KR. The places
// are AN-02 corpus fixtures shown through the app's own services: 회현동 (kma-seoul) alone, then London (vc-london)
// added and selected, so its pages show the arrows of more than one place. For each place and page it cuts every block
// of the page (the header block, then each card and the attribution) from the screen, with its rect and the text,
// image and style of every element inside it:
//   app/src/test/resources/forecast-reference/<place>/<page>-<n>.png and <place>/<page>.json
//   node capture.mjs <emulator-serial> <android-dir>
import fs from 'node:fs';
import path from 'node:path';
import {connect} from '../emulator/devtools.mjs';
import {BLOCKS, cutBlocks} from '../emulator/page-blocks.mjs';
import {Screen} from '../emulator/screen.mjs';
import {referenceRoot, recordView} from '../emulator/reference-view.mjs';

const [serial, root] = process.argv.slice(2);
const OUT = process.env.TW_REFERENCE_LANGUAGE ? path.join(referenceRoot(root, 'forecast'), process.env.TW_REFERENCE_LANGUAGE) : referenceRoot(root, 'forecast');
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const input = (name) => JSON.parse(fs.readFileSync(path.join(corpus, 'inputs', `${name}.json`), 'utf8'));
const screenshots = new Screen(serial);

const dt = await connect(serial);
await dt.settled();
await recordView(dt, new Screen(serial), OUT);
await dt.evaluate(BLOCKS);
await dt.evaluate(`window.twForecast = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope');
    var wait = twBlocks.wait, closePopups = twBlocks.closePopups;
    return {
        place: function (data, info) {
            var converted = WeatherUtil.convertWeatherData([{data: data}]);
            var city = {name: info.name, address: info.address, country: info.country, location: info.location, currentPosition: false};
            Object.keys(converted).forEach(function (k) { city[k] = converted[k]; });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            return closePopups();
        },
        // Opens a page afresh (ForecastCtrl initializes on every entry: cityCount, sizes, scroll).
        page: function (state) {
            // A native chain, so its steps run after Angular's digests ($apply inside a digest throws).
            return wait(0).then(function () { return $state.go('tab.search'); }).then(function () { return wait(600); })
                .then(function () { return $state.go(state); }).then(function () { return wait(1200); }).then(closePopups)
                .then(function () { $rootScope.$broadcast('applyEvent', 'capture'); $rootScope.$apply(); return wait(1500); })
                .then(closePopups).then(function () {
                    twBlocks.content().scrollTop = 0;
                    return wait(400);
                }).then(function () { return {count: twBlocks.blocks().length, body: document.body.className}; });
        },
    };
})()`);

const PLACES = [
    {key: 'kma-seoul', fixture: 'kma-seoul', info: {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}}},
    {key: 'vc-london', fixture: 'vc-london', info: {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13}}},
];
const origin = screenshots.webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
for (const place of PLACES) {
    await dt.evaluate(`twForecast.place(${JSON.stringify(input(place.fixture))}, ${JSON.stringify(place.info)})`);
    for (const [page, state] of [['hourly', 'tab.forecast'], ['daily', 'tab.dailyforecast']]) {
        const shown = await dt.evaluate(`twForecast.page(${JSON.stringify(state)})`);
        const blocks = await cutBlocks(dt, screenshots, origin, dpr, path.join(OUT, place.key), page, shown.count, `${place.key} ${page}`);
        const record = {place: place.key, page, body: shown.body, blocks};
        fs.writeFileSync(path.join(OUT, place.key, `${page}.json`), JSON.stringify(record) + '\n');
        console.log(`${place.key} ${page}: ${record.blocks.length} blocks (${record.blocks.map((b) => b.cls.split(' ')[0] || '-').join(', ')})`);
    }
}
dt.close();
