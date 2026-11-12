#!/usr/bin/env node
// Records the Cordova air quality screen S05 that the native screen is compared with (AN-09, #2888): run by capture.sh
// while the Cordova debug build runs offline at 384x832 dp, density 2, in ko-KR. The places are AN-02 corpus fixtures
// shown through the app's own services. Each state opens S05 afresh, as the tab and goAirInfoPage do (AirCtrl
// initializes on every entry), and taps cells as a user does:
//   kma-seoul             회현동 alone, the overall index (manual page 10 and, scrolled to the end, page 12)
//   kma-seoul-pm25        then the second detail cell, 초미세먼지 (manual page 11)
//   kma-seoul-station-1   afresh, then the second station, 한강대로
//   kma-seoul-o3          afresh at ?code=o3 (an hourly series without a forecast)
//   kma-seoul-dark        the overall index in the dark theme
//   vc-london             런던 added and selected: an overseas place, with the arrows of more than one place
//   kma-jeju-no-air       연동 (kma-jeju without air data) added and selected: only the grade scale
// For each state it cuts every block of the page (the header block, the gauge, then each card) from the screen with
// its rect and the text, image and style of every element inside it, and records the scope values the template
// read, the gauge's widths and the chart's SVG:
//   app/src/test/resources/air-reference/<state>/air-<n>.png and <state>/air.json
// Then it follows a pollutant chosen on S03 through the tab bar (navigation.json).
//   node capture.mjs <emulator-serial> <android-dir>
import fs from 'node:fs';
import path from 'node:path';
import {connect} from '../emulator/devtools.mjs';
import {BLOCKS, cutBlocks} from '../emulator/page-blocks.mjs';
import {Screen} from '../emulator/screen.mjs';
import {referenceRoot, recordView} from '../emulator/reference-view.mjs';

const [serial, root] = process.argv.slice(2);
const OUT = process.env.TW_REFERENCE_LANGUAGE ? path.join(referenceRoot(root, 'air'), process.env.TW_REFERENCE_LANGUAGE) : referenceRoot(root, 'air');
const corpus = path.join(root, 'core-domain/src/test/resources/corpus');
const input = (name) => JSON.parse(fs.readFileSync(path.join(corpus, 'inputs', `${name}.json`), 'utf8'));
const screenshots = new Screen(serial);

const dt = await connect(serial);
await dt.settled();
await recordView(dt, new Screen(serial), OUT);
await dt.evaluate(BLOCKS);
await dt.evaluate(`window.twAir = (function () {
    var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), WeatherUtil = inj.get('WeatherUtil');
    var $state = inj.get('$state'), $rootScope = inj.get('$rootScope'), $location = inj.get('$location');
    var wait = twBlocks.wait, closePopups = twBlocks.closePopups;
    // The SVG of a chart directive, element by element (as chart-reference records it).
    function scene(svg) {
        function walk(el) {
            var node = {tag: el.tagName.toLowerCase()};
            Array.prototype.forEach.call(el.attributes, function (a) { node[a.name] = a.value; });
            if (node.tag === 'text') {
                node.text = '';
                node.tspans = [];
                el.childNodes.forEach(function (c) {
                    if (c.nodeType === 3) node.text += c.textContent;
                    else if (c.tagName && c.tagName.toLowerCase() === 'tspan') {
                        var t = {text: c.textContent};
                        Array.prototype.forEach.call(c.attributes, function (a) { t[a.name] = a.value; });
                        node.tspans.push(t);
                    }
                });
            } else if (el.children.length) {
                node.children = Array.prototype.map.call(el.children, walk);
            }
            return node;
        }
        return walk(svg);
    }
    function airScope() {
        var el = twBlocks.shown('.air-std-table');
        return el ? angular.element(el).scope() : null;
    }
    function shown(sel) {
        return Array.prototype.filter.call(document.querySelectorAll(sel), function (e) {
            var r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
    }
    // What the page shows: the scope values the template reads, the gauge's widths (getLabelPosition reads them from
    // the page) and the chart's SVG.
    function describe() {
        var s = airScope() || {};
        var std = twBlocks.shown('#aqistd'), label = twBlocks.shown('#aqistd-label');
        var svg = twBlocks.shown('[ng-air-chart] svg');
        var chart = twBlocks.shown('[ng-air-chart]');
        return {
            count: twBlocks.blocks().length, body: document.body.className, url: $location.url(), state: $state.current.name,
            scope: JSON.parse(angular.toJson({address: s.address, aqiCode: s.aqiCode, airCodeName: s.airCodeName, mainName: s.mainName,
                stnIndex: s.stnIndex, airCodeGrade: s.airCodeGrade, airCodeValue: s.airCodeValue, airCodeStr: s.airCodeStr,
                mainInfo: s.mainInfo, airCodeActionGuide: s.airCodeActionGuide, cityCount: s.cityCount,
                forecastPubdate: s.forecastPubdate, forecastSource: s.forecastSource, hourlyChartTitle: s.hourlyChartTitle,
                chartAirHeight: s.chartAirHeight, bodyWidth: s.bodyWidth, bigFontSize: s.bigFontSize, headerHeight: s.headerHeight})),
            gauge: std && label ? {width: std.offsetWidth, labelWidth: label.offsetWidth, left: label.style.left,
                labelRect: label.getBoundingClientRect().toJSON(), stdRect: std.getBoundingClientRect().toJSON()} : null,
            chart: svg ? {rect: chart.getBoundingClientRect().toJSON(), scene: scene(svg)} : null,
        };
    }
    function settle() { return wait(1200).then(closePopups).then(function () { twBlocks.content().scrollTop = 0; return wait(400); }); }
    // A tap at the element's center: ionic.tap drops clicks it did not create, so the click carries isIonicTap as a
    // real tap's does (tapClickGateKeeper in ionic.bundle.js).
    function tapAt(el) {
        var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        var target = document.elementFromPoint(x, y);
        if (!target || !(target === el || el.contains(target))) throw new Error('covered: ' + (target && target.className));
        var ev = document.createEvent('MouseEvents');
        ev.initMouseEvent('click', true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);
        ev.isIonicTap = true;
        target.dispatchEvent(ev);
    }
    function tab(i) {
        tapAt(shown('.tabs a.tab-item')[i]);
        return wait(1500).then(closePopups);
    }
    function where() {
        var s = airScope();
        return {url: $location.url(), state: $state.current.name, aqiCode: s ? s.aqiCode : null};
    }
    return {
        place: function (data, info, mutations) {
            var converted = WeatherUtil.convertWeatherData([{data: data}]);
            var city = {name: info.name, address: info.address, country: info.country, location: info.location, currentPosition: false};
            Object.keys(converted).forEach(function (k) { city[k] = converted[k]; });
            (mutations || []).forEach(function (m) {
                var parent = m.path.slice(0, -1).reduce(function (o, k) { return o[k]; }, city);
                delete parent[m.path[m.path.length - 1]];
            });
            WeatherInfo.addCity(city);
            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            return closePopups();
        },
        select: function (i) { WeatherInfo.setCityIndex(i); },
        // The theme as the settings page sets it (controller.setting.radio.js): the body class and the image folders.
        theme: function (name) {
            $rootScope.settingsInfo.theme = name;
            $rootScope.iconsImgPath = window.theme[name].icons;
            $rootScope.weatherImgPath = window.theme[name].weather;
            $rootScope.$apply();
            return wait(500);
        },
        // Opens S05 afresh at /tab/air, with ?code= as goAirInfoPage builds it.
        open: function (code) {
            // A native chain, so its steps run after Angular's digests ($apply inside a digest throws).
            return wait(0).then(function () { return $state.go('tab.search'); }).then(function () { return wait(600); })
                .then(function () { $location.url('/tab/air' + (code ? '?code=' + code : '')); $rootScope.$apply(); })
                .then(settle).then(describe);
        },
        // Taps cell i of the detail card (setMainAqiCode) or the station card (setStation), as a user does.
        tap: function (kind, i) {
            var cells = shown('[ng-click^="' + kind + '"]');
            cells[i].scrollIntoView({block: 'center'});
            return wait(400).then(function () { tapAt(cells[i]); }).then(settle).then(describe);
        },
        // goAirInfoPage(code) as S03's air cells call it, then the tab bar: Hourly, Air, Locations, Air.
        navigation: function (code) {
            var steps = [];
            function note(what) { var w = where(); w.after = what; steps.push(w); }
            return wait(0).then(function () { return $state.go('tab.forecast'); }).then(function () { return wait(1500); })
                .then(function () {
                    var s = angular.element(twBlocks.content()).scope();
                    s.$apply(function () { s.goAirInfoPage(code); });
                    return wait(1500);
                })
                .then(function () { note('goAirInfoPage(' + code + ') on S03'); return tab(1); })
                .then(function () { note('Hourly tab'); return tab(3); })
                .then(function () { note('Air tab'); return tab(2); })
                .then(function () { note('Daily tab'); return tab(3); })
                .then(function () { note('Air tab'); return tab(0); })
                .then(function () { note('Locations tab'); return tab(3); })
                .then(function () { note('Air tab'); return steps; });
        },
    };
})()`);

const SEOUL = {fixture: 'kma-seoul', info: {name: '회현동', address: '대한민국 서울특별시 중구 회현동', country: 'KR', location: {lat: 37.56, long: 126.98}}};
const LONDON = {fixture: 'vc-london', info: {name: '런던', address: '영국 런던', country: 'GB', location: {lat: 51.51, long: -0.13}}};
const NO_AIR = {fixture: 'kma-jeju', info: {name: '연동', address: '대한민국 제주특별자치도 제주시 연동', country: 'KR', location: {lat: 33.5, long: 126.53}},
    mutations: [{path: ['airInfoList']}, {path: ['currentWeather', 'arpltn']}]};

const origin = screenshots.webViewOrigin();
const dpr = await dt.evaluate('devicePixelRatio');
async function capture(key, shown, places) {
    const dir = path.join(OUT, key);
    const blocks = await cutBlocks(dt, screenshots, origin, dpr, dir, 'air', shown.count, key);
    const {count, ...page} = shown;
    fs.writeFileSync(path.join(dir, 'air.json'), JSON.stringify({key, places, ...page, blocks}) + '\n');
    console.log(`${key}: ${blocks.length} blocks (${blocks.map((b) => b.cls.split(' ')[0] || '-').join(', ')}), ${page.url}`);
}
const add = (p) => dt.evaluate(`twAir.place(${JSON.stringify(input(p.fixture))}, ${JSON.stringify(p.info)}, ${JSON.stringify(p.mutations || [])})`);
const placesOf = (...list) => list.map((p) => ({fixture: p.fixture, ...p.info, mutations: p.mutations}));

await add(SEOUL);
await capture('kma-seoul', await dt.evaluate('twAir.open()'), placesOf(SEOUL));
if (!process.env.TW_REFERENCE_SIZE) {
await capture('kma-seoul-pm25', await dt.evaluate(`twAir.tap('setMainAqiCode', 1)`), placesOf(SEOUL));
await dt.evaluate('twAir.open()');
await capture('kma-seoul-station-1', await dt.evaluate(`twAir.tap('setStation', 1)`), placesOf(SEOUL));
await capture('kma-seoul-o3', await dt.evaluate(`twAir.open('o3')`), placesOf(SEOUL));
}
await dt.evaluate(`twAir.theme('dark')`);
await capture('kma-seoul-dark', await dt.evaluate('twAir.open()'), placesOf(SEOUL));
if (process.env.TW_REFERENCE_SIZE) {
    for (const theme of ['old', 'photo']) {
        await dt.evaluate(`twAir.theme('${theme}')`);
        await capture(`kma-seoul-${theme}`, await dt.evaluate('twAir.open()'), placesOf(SEOUL));
    }
}
await dt.evaluate(`twAir.theme('light')`);
await add(LONDON);
await capture('vc-london', await dt.evaluate('twAir.open()'), placesOf(SEOUL, LONDON));
await add(NO_AIR);
await capture('kma-jeju-no-air', await dt.evaluate('twAir.open()'), placesOf(SEOUL, LONDON, NO_AIR));

await dt.evaluate('twAir.select(0)');
const steps = await dt.evaluate(`twAir.navigation('pm25')`);
fs.writeFileSync(path.join(OUT, 'navigation.json'), JSON.stringify({place: 'kma-seoul', steps}, null, 1) + '\n');
for (const s of steps) console.log(`navigation: ${s.after} -> ${s.url} (${s.state}, aqiCode ${s.aqiCode})`);
dt.close();
