// The nationwide pages and the warnings of the Cordova app (IN-13, #2962), run in the macOS JavaScriptCore shell (the
// engine of the Cordova iOS app) by generate.py:
//   TZ=Asia/Seoul jsc cases.js -- <client/www> <corpus inputs>
// It prints one JSON document. The controllers NationCtrl (controller.nation.js), NationAirCtrl
// (controller.nation.air.js) and KmaSpecialCtrl (controller.kma.special.js) run unchanged, with WeatherUtil.aqiStandard
// from service.weatherutil.js; WeatherUtil.getNationWeather, $http, Units, Util, $ionicLoading and $ionicHistory are
// stand-ins that answer as the request ended. What the templates show is then read as nation.html, nation-air.html and
// kma-special.html read the scopes:
// - `nation`: for each answer (a resolved value or a rejection) and units, NationCtrl's labels in each mode (the name,
//   `getIcon` when not undefined, `{{getText1}}` with `{{getText1Unit}}` and `{{getText2}}` with `{{getText2Unit}}` when
//   not undefined) and NationAirCtrl's labels for each pollutant (the name, `{{getText1}}` when not undefined, the
//   background `grade2Color`), and whether `$ionicLoading` was hidden again.
// - `special`: for each answer of `$http` (`responseType: 'json'`: a body that is no JSON is null) and language,
//   `specialList` as parseSpecialData left it, `error` when the request failed, and for a list the cards as
//   kma-special.html interpolates them (the comment's HTML is what `ng-bind-html` receives).
(function (args) {
    'use strict';
    var www = args[0];
    var inputs = args[1];
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var read = function (rel) { return readFile(www + '/' + rel); };
    var input = function (name) { return JSON.parse(readFile(inputs + '/' + name + '.json')); };
    var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
    var ga = {trackEvent: function () {}, trackException: function () {}};

    function weatherUtil() {
        var factory;
        var angular = {module: function () { return {factory: function (_, fn) { factory = fn; }}; }};
        Function('angular', 'console', 'clientConfig', 'window', 'alert', read('js/service.weatherutil.js'))(
            angular, quiet, {debug: false}, {}, function () {});
        return factory({}, function () { throw new Error('no network'); }, {ga: ga},
            {getUnit: function () { return undefined; }}, {track: function () {}});
    }
    var aqiStandard = weatherUtil().aqiStandard;

    // A controller file's controller function (angular.module(...).controller(name, fn)).
    // `DateImpl` is the Date the source sees (the WebView's default locale for the warnings' times).
    function controller(file, DateImpl) {
        var fn;
        var angular = {module: function () { return {controller: function (_, f) { fn = f; }}; }};
        Function('angular', 'console', 'clientConfig', 'Date', read('js/' + file))(angular, quiet, {serverUrl: 'https://server'},
            DateImpl || Date);
        return fn;
    }
    var NationCtrl = controller('controller.nation.js');
    var NationAirCtrl = controller('controller.nation.air.js');

    // A promise that settles synchronously, in the order $q's callbacks run (then, then finally).
    function settled(ok, value) {
        return {
            then: function (onOk, onErr) {
                var next;
                try {
                    next = ok ? settled(true, onOk ? onOk(value) : value)
                        : (onErr ? settled(true, onErr(value)) : settled(false, value));
                } catch (e) {
                    next = settled(false, e);
                }
                return next;
            },
            finally: function (fn) { fn(); return this; },
        };
    }

    // `{{value}}`: AngularJS's stringify (undefined and null show nothing, objects as JSON).
    function interpolate(v) {
        if (v === undefined || v === null) { return ''; }
        if (typeof v === 'object') { return JSON.stringify(v); }
        return '' + v;
    }
    // The text a block shows: HTML white space collapsed, none at the ends.
    function collapse(s) { return s.replace(/[ \t\n\f\r]+/g, ' ').replace(/^ | $/g, ''); }

    function run(Ctrl, answer, units) {
        var $scope = {}, loading = [];
        var Util = {region: 'KR', ga: ga};
        var WeatherUtil = {aqiStandard: aqiStandard, getNationWeather: function (region) {
            if (region !== 'KR') { throw new Error('region ' + region); }
            return settled(!answer.reject, answer.reject ? new Error('Request failed') : clone(answer.value));
        }};
        var Units = {getUnit: function (name) { return units[name]; }};
        Ctrl($scope, Util, WeatherUtil, {goBack: function () {}},
            {show: function () { loading.push('show'); }, hide: function () { loading.push('hide'); }}, Units);
        return {$scope: $scope, loading: loading};
    }

    var MODES = [0, 1, 2];
    function nationCase(name, answer, units) {
        var w = run(NationCtrl, answer, units);
        var a = run(NationAirCtrl, answer, units);
        var s = w.$scope;
        var modes = MODES.map(function (mode) {
            s.changeWeatherType(mode);
            return s.cityList.map(function (city) {
                var label = {name: city.name, top: city.top, left: city.left, lines: []};
                var icon = s.getIcon(city.name);
                if (icon !== undefined) { label.icon = interpolate(icon); }
                var t1 = s.getText1(city.name), t2 = s.getText2(city.name);
                if (t1 !== undefined) { label.lines.push({text: interpolate(t1), unit: interpolate(s.getText1Unit())}); }
                if (t2 !== undefined) { label.lines.push({text: interpolate(t2), unit: interpolate(s.getText2Unit())}); }
                return label;
            });
        });
        var air = {};
        a.$scope.airTypeList.forEach(function (type) {
            a.$scope.changeAirType(type);
            air[type] = a.$scope.cityList.map(function (city) {
                var label = {name: city.name, top: city.top, left: city.left, lines: [], background: a.$scope.grade2Color(city.name)};
                var t1 = a.$scope.getText1(city.name);
                if (t1 !== undefined) { label.lines.push({text: interpolate(t1), unit: ''}); }
                return label;
            });
        });
        var recorded = answer.reject ? {reject: true} : answer.input ? {input: answer.input}
            : {value: answer.value === undefined ? null : answer.value};
        return {name: name, answer: recorded,
            units: units, title: s.getNationName(), airTitle: a.$scope.getNationName(),
            loading: [w.loading, a.loading], modes: modes, air: air, airTypes: a.$scope.airTypeList};
    }

    function specialCase(name, answer, locale) {
        class LocaleDate extends Date {
            toLocaleDateString() { return super.toLocaleDateString(locale); }
            toLocaleTimeString() { return super.toLocaleTimeString(locale); }
        }
        var $scope = {}, requests = [];
        var $http = function (config) {
            requests.push(config);
            var r = {
                success: function (fn) { if (!answer.status) { fn(clone(answer.value), 200); } return r; },
                error: function (fn) { if (answer.status) { fn(answer.body, answer.status); } return r; },
            };
            return r;
        };
        controller('controller.kma.special.js', LocaleDate)($scope, {ga: ga}, $http, {goBack: function () {}});
        var out = {name: name, locale: locale, requests: requests.map(function (c) {
            return {method: c.method, url: c.url, timeout: c.timeout, responseType: c.responseType};
        })};
        if (answer.input) { out.answer = {input: answer.input}; } else if ('value' in answer) {
            out.answer = {value: answer.value === undefined ? null : answer.value};
        } else { out.status = answer.status; }
        if ($scope.error) { out.error = true; }
        if ($scope.specialList !== undefined) { out.specialList = clone($scope.specialList); }
        if (Array.isArray($scope.specialList)) {
            // <div ng-if="specialList" class="item item-body" ng-repeat="special in specialList">
            out.cards = $scope.specialList.map(function (special) {
                var sp = special || {};
                var card = {heading: collapse(interpolate(sp.name) + ' ' + interpolate(sp.announcement)), situations: [],
                    note: sp.type === 1 || sp.type === 2};
                if (sp.imageUrl) { card.imageUrl = interpolate(sp.imageUrl); }
                if (sp.situationList && Array.isArray(sp.situationList)) {
                    card.situations = sp.situationList.map(function (situation) {
                        var si = situation || {};
                        return {title: collapse(interpolate(si.weatherStr) + interpolate(si.levelStr)),
                            lines: si.info && Array.isArray(si.info) ? si.info.map(function (info) {
                                var i = info || {};
                                return collapse(interpolate(i.timeStr) + ' ' + interpolate(i.location));
                            }) : []};
                    });
                }
                if (sp.comment !== undefined && sp.comment !== null) { card.commentHtml = interpolate(sp.comment); }
                return card;
            });
        }
        return out;
    }

    var KR = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm',
        airUnit: 'airkorea'};
    function units(change) { var u = clone(KR); Object.keys(change).forEach(function (k) { u[k] = change[k]; }); return u; }
    var nation = input('nation');
    var special = input('special');
    var out = {nation: [], special: []};
    out.nation.push(nationCase('production', {value: nation, input: 'nation.json'}, KR));
    out.nation.push(nationCase('production-kph-in-airnow', {value: nation, input: 'nation.json'},
        units({windSpeedUnit: 'km/h', precipitationUnit: 'inch', airUnit: 'airnow'})));
    out.nation.push(nationCase('production-who', {value: nation, input: 'nation.json'}, units({airUnit: 'airkorea_who'})));
    out.nation.push(nationCase('production-aqicn', {value: nation, input: 'nation.json'}, units({airUnit: 'aqicn'})));
    out.nation.push(nationCase('empty', {value: {nation: 'KR', weather: [], air: []}}, KR));
    out.nation.push(nationCase('no-lists', {value: {nation: 'KR'}}, KR));
    out.nation.push(nationCase('not-lists', {value: {weather: {'서울': 1}, air: 'x'}}, KR));
    out.nation.push(nationCase('text-body', {value: 'Internal Server Error'}, KR));
    out.nation.push(nationCase('null-body', {value: null}, KR));
    out.nation.push(nationCase('failed', {reject: true}, KR));
    ['ko-KR', 'en-US'].forEach(function (locale) {
        out.special.push(specialCase('production', {value: special, input: 'special.json'}, locale));
    });
    out.special.push(specialCase('empty', {value: []}, 'ko-KR'));
    out.special.push(specialCase('null-body', {value: null}, 'ko-KR'));
    out.special.push(specialCase('object-body', {value: {}}, 'ko-KR'));
    out.special.push(specialCase('failed', {status: 500, body: 'Internal Server Error'}, 'ko-KR'));
    out.special.push(specialCase('timeout', {status: -1, body: null}, 'ko-KR'));
    out.special.push(specialCase('fields', {value: [
        {name: '기상특보', announcement: '2026-11-07T15:00:00.000Z', type: 2, comment: 'a\n<b>b</b>\n\nc',
            situationList: [{weatherStr: '강풍', levelStr: '주의보', info: [{timeStr: '11월 08일 밤', location: '울릉도'}, {}]}, {}]},
        {type: '1', comment: 'x'},
        {type: 3, situationList: [], comment: ''},
        {announcement: 'not a date', type: 1, comment: 'y', imageUrl: 'http://example.invalid/a.png'},
    ]}, 'ko-KR'));
    print(JSON.stringify(out));
})(arguments);
