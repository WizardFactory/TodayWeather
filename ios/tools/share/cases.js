// The share message of the Cordova app (IN-16, #2965; O16, V20), run in the macOS JavaScriptCore shell (the engine of the
// Cordova iOS app) by generate.py:
//   jsc cases.js -- <service.weatherutil.js> <controller.tabctrl.js> <locales dir>
// It prints one JSON document:
// - `texts`: per catalog the translations `doTabShare` asks for (LOC_CURRENT, LOC_HIGHEST, LOC_LOWEST, LOC_WEATHER and
//   `$rootScope.title`, LOC_TODAYWEATHER), as angular-translate returns them from client/www/locales.
// - `cases`: TabCtrl's `$scope.doTabShare` for one selected city record (`WeatherInfo.getCityOfIndex`, the place with
//   its weather), the WebView's `navigator.language` (`Util.language`) and a catalog: the message handed to
//   `window.plugins.socialsharing.share(message, null, null, null)`, or `startPopup` when the city has no location.
// `doTabShare`, `_makeMessageForTodayWeather` and `_makeMessageForTodayAir` are taken from the source by brace matching
// and run unchanged, with WeatherUtil from service.weatherutil.js (`getShortenAddress`, `getWeatherEmoji`); `$translate`
// is a stand-in that resolves with the catalog's strings and, as AngularJS's `$q`, runs `.finally` after a success
// callback that threw (the message then holds what was added before the throw). `clientConfig.package` is
// `todayWeather`. A city of `undefined` is left out of its record.
(function (args) {
    'use strict';
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var sources = {util: readFile(args[0]), tab: readFile(args[1])};
    var localesDir = args[2];

    function extract(src, signature) {
        var start = src.indexOf(signature);
        if (start < 0) { throw new Error(signature + ' not found'); }
        var i = src.indexOf('{', start), depth = 0;
        for (; i < src.length; i++) {
            if (src[i] === '{') { depth++; } else if (src[i] === '}' && --depth === 0) { break; }
        }
        return src.slice(src.indexOf('function', start), i + 1);
    }

    function weatherUtil() {
        var factory;
        var angular = {module: function () { return {factory: function (_, fn) { factory = fn; }}; }};
        Function('angular', 'console', 'clientConfig', 'window', 'alert', sources.util)(
            angular, quiet, {debug: false}, {}, function () {});
        return factory({}, function () { throw new Error('no network'); }, {ga: {trackEvent: function () {}, trackException: function () {}}},
            {getUnit: function () { return undefined; }}, {track: function () {}});
    }
    var WeatherUtil = weatherUtil();

    var keys = ['LOC_CURRENT', 'LOC_HIGHEST', 'LOC_LOWEST', 'LOC_WEATHER', 'LOC_TODAYWEATHER'];
    var catalogs = {ko: 'ko', en: 'en', ja: 'ja', de: 'de', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW'};
    var texts = {};
    Object.keys(catalogs).forEach(function (code) {
        var all = JSON.parse(readFile(localesDir + '/' + catalogs[code] + '.json'));
        texts[code] = {};
        keys.forEach(function (k) { texts[code][k] = all[k]; });
    });

    // TabCtrl's share for `city` with `language` and the catalog `catalog`.
    function share(city, language, catalog) {
        var out = {};
        var $scope = {startPopup: function () { out.startPopup = true; }};
        var window = {plugins: {socialsharing: {share: function (message, subject, file, url) {
            out.message = message;
            out.arguments = [subject, file, url];
        }}}};
        var WeatherInfo = {getCityIndex: function () { return 0; }, getCityOfIndex: function () { return city; }};
        var $translate = function (ids) {
            var translations = {};
            ids.forEach(function (id) { translations[id] = texts[catalog][id]; });
            return {then: function (success) {
                try { success(translations); } catch (e) { out.threw = String(e && e.name); }
                return {finally: function (fn) { fn(); }};
            }};
        };
        Function('$scope', 'window', 'WeatherInfo', 'WeatherUtil', 'clientConfig', 'Util', '$translate', '$rootScope', 'console', [
            extract(sources.tab, 'function _makeMessageForTodayWeather('),
            extract(sources.tab, 'function _makeMessageForTodayAir('),
            '$scope.doTabShare = ' + extract(sources.tab, '$scope.doTabShare = function') + ';',
            '$scope.doTabShare();',
        ].join('\n'))($scope, window, WeatherInfo, WeatherUtil, {package: 'todayWeather'},
            {language: language, ga: {trackEvent: function () {}, trackException: function () {}}}, $translate,
            {title: 'LOC_TODAYWEATHER'}, quiet);
        return out;
    }

    var loc = {lat: 37.56, long: 126.98};
    var seoulWeather = {t1h: 7.2, skyIcon: 'moon_smallcloud', today: {tmx: 12, tmn: -1},
        summaryWeather: '어제보다 -1˚, 맑음', summaryAir: '대기상태가 좋아요'};
    function city(fields) {
        var c = {name: '회현동', address: '대한민국 서울특별시 중구 회현동', location: loc, currentWeather: seoulWeather};
        Object.keys(fields).forEach(function (k) {
            if (fields[k] === undefined) { delete c[k]; } else { c[k] = fields[k]; }
        });
        return c;
    }
    function weather(fields) {
        var w = {t1h: 7.2, skyIcon: 'sun', today: {tmx: 12, tmn: 3}};
        Object.keys(fields).forEach(function (k) {
            if (fields[k] === undefined) { delete w[k]; } else { w[k] = fields[k]; }
        });
        return w;
    }

    var cases = [
        // The languages: `Util.language.indexOf("ko")` picks the Korean link.
        ['seoul ko-KR', city({}), 'ko-KR', 'ko'],
        ['seoul ko', city({}), 'ko', 'ko'],
        ['seoul en-US', city({}), 'en-US', 'en'],
        ['seoul ja', city({}), 'ja', 'ja'],
        ['seoul de-DE', city({}), 'de-DE', 'de'],
        ['seoul zh-CN', city({}), 'zh-CN', 'zh-CN'],
        ['seoul zh-TW', city({}), 'zh-TW', 'zh-TW'],
        ['a language tag containing ko (kok-IN)', city({}), 'kok-IN', 'en'],
        // The city line: the name, else the shortened address.
        ['empty name, address of 5 parts', city({name: '', address: '대한민국 경기도 수원시 장안구 정자동'}), 'ko-KR', 'ko'],
        ['no name, address of 4 parts with a province', city({name: undefined, address: '대한민국 경기도 수원시 장안구'}), 'ko-KR', 'ko'],
        ['no name, address of 4 parts', city({name: undefined, address: '대한민국 서울특별시 중구 회현동'}), 'ko-KR', 'ko'],
        ['no name, address of 3 parts', city({name: undefined, address: '대한민국 제주특별자치도 제주시'}), 'ko-KR', 'ko'],
        ['no name, address of 2 parts', city({name: undefined, address: '대한민국 부산광역시'}), 'ko-KR', 'ko'],
        ['no name, foreign address', city({name: undefined, address: 'London'}), 'en-US', 'en'],
        ['no name, no address', city({name: undefined, address: undefined}), 'ko-KR', 'ko'],
        ['number name', city({name: 5}), 'ko-KR', 'ko'],
        // The summary: summaryWeather with summaryAir, summaryWeather alone, else summary; falsy summaries are left out.
        ['summary only', city({currentWeather: weather({summary: '맑음'})}), 'ko-KR', 'ko'],
        ['summaryWeather only', city({currentWeather: weather({summaryWeather: '맑음', summary: '흐림'})}), 'ko-KR', 'ko'],
        ['summaryWeather null with summaryAir', city({currentWeather: weather({summaryWeather: null, summaryAir: '좋음'})}), 'ko-KR', 'ko'],
        ['summaryWeather with summaryAir null', city({currentWeather: weather({summaryWeather: '비', summaryAir: null})}), 'ko-KR', 'ko'],
        ['summaryWeather empty', city({currentWeather: weather({summaryWeather: '', summary: '흐림'})}), 'ko-KR', 'ko'],
        ['summaryWeather 0', city({currentWeather: weather({summaryWeather: 0})}), 'ko-KR', 'ko'],
        ['no summary', city({currentWeather: weather({})}), 'ko-KR', 'ko'],
        // Values as JavaScript joins them.
        ['missing values', city({currentWeather: {skyIcon: 'cloud'}}), 'ko-KR', 'ko'],
        ['null values', city({currentWeather: weather({t1h: null, today: {tmx: '8', tmn: null}})}), 'ko-KR', 'ko'],
        ['today null', city({currentWeather: weather({today: null})}), 'ko-KR', 'ko'],
        ['today a string', city({currentWeather: weather({today: 'x'})}), 'ko-KR', 'ko'],
        ['number texts', city({currentWeather: weather({t1h: -0.5, today: {tmx: 1e21, tmn: 0.1}})}), 'ko-KR', 'ko'],
        ['boolean and array values', city({currentWeather: weather({t1h: true, today: {tmx: [1, null, 'a'], tmn: {}}})}), 'ko-KR', 'ko'],
        // The emoji: the first match of getWeatherEmoji.
        ['emoji lightning', city({currentWeather: weather({skyIcon: 'sun_smallcloud_lightning'})}), 'ko-KR', 'ko'],
        ['emoji rainsnow', city({currentWeather: weather({skyIcon: 'cloud_rainsnow'})}), 'ko-KR', 'ko'],
        ['emoji rain', city({currentWeather: weather({skyIcon: 'sun_bigcloud_rain'})}), 'ko-KR', 'ko'],
        ['emoji snow', city({currentWeather: weather({skyIcon: 'snow'})}), 'ko-KR', 'ko'],
        ['emoji moon cloud', city({currentWeather: weather({skyIcon: 'moon_bigcloud'})}), 'ko-KR', 'ko'],
        ['emoji cloud', city({currentWeather: weather({skyIcon: 'cloud'})}), 'ko-KR', 'ko'],
        ['emoji moon', city({currentWeather: weather({skyIcon: 'moon'})}), 'ko-KR', 'ko'],
        ['emoji none', city({currentWeather: weather({skyIcon: 'fog'})}), 'ko-KR', 'ko'],
        ['emoji case-sensitive', city({currentWeather: weather({skyIcon: 'Sun'})}), 'ko-KR', 'ko'],
        // A throw in the weather lines leaves the city line, which `.finally` shares.
        ['no currentWeather', city({currentWeather: undefined}), 'ko-KR', 'ko'],
        ['currentWeather null', city({currentWeather: null}), 'ko-KR', 'ko'],
        ['no skyIcon', city({currentWeather: {t1h: 3}}), 'ko-KR', 'ko'],
        ['skyIcon a number', city({currentWeather: weather({skyIcon: 5})}), 'ko-KR', 'ko'],
        ['currentWeather a string', city({currentWeather: 'x'}), 'ko-KR', 'ko'],
        // No location: nothing is shared and the start choice opens (O02).
        ['no city', undefined, 'ko-KR', 'ko'],
        ['no location', city({location: undefined}), 'ko-KR', 'ko'],
        ['location null', city({location: null}), 'ko-KR', 'ko'],
        ['current position without a location', {name: '현재 위치', currentPosition: true}, 'ko-KR', 'ko'],
    ];

    var out = {texts: texts, cases: cases.map(function (c) {
        var r = share(c[1], c[2], c[3]);
        var record = {name: c[0], language: c[2], catalog: c[3]};
        if (c[1] !== undefined) { record.city = c[1]; }
        if (r.message !== undefined) {
            record.message = r.message;
            record.shareArguments = r.arguments;
        }
        if (r.startPopup) { record.startPopup = true; }
        if (r.threw) { record.threw = r.threw; }
        return record;
    })};
    print(JSON.stringify(out));
})(arguments);
