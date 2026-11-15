// The air standards' grade and scale mapping of the Cordova app (IN-09, #2958; V32), run in the macOS JavaScriptCore
// shell (the engine of the Cordova iOS app) by generate.py:
//   jsc cases.js -- <service.weatherutil.js> <controller.tabctrl.js> <controller.air.js>
// It prints one JSON document:
// - `standards`: for each `airUnit` (the four standards, a missing, a null, an unknown one and the retired `aircn`),
//   TabCtrl's `setAirUnit` (`aqiStandard`, `aqiMaxValue`) and, for each pollutant, the gauge's bands as tab-air.html
//   shows them: the color (`border-color`), the translation key and `~ {{obj.value[aqiCode]}}`.
// - `grades`: `grade2Color(grade)`, `grade2Color(grade, 'white')` and `getSentimentIcon(grade)` for each standard and
//   for grades inside, at and beyond the table, 0, missing, null, strings, fractions and booleans.
// - `labels`: AirCtrl's `getLabelPosition(grade, value)` for each standard and pollutant at the gauge widths of the
//   iOS screens, for each grade at the band's bounds and middle and at the V32 values (airnow so2 0.05 and 0.1).
// The functions are taken from the sources by brace matching and run unchanged; Util, Units, $sce and the document are
// stand-ins. Missing (undefined) values are left out of the records; NaN is written as the string "NaN".
(function (args) {
    'use strict';
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var sources = {util: readFile(args[0]), tab: readFile(args[1]), air: readFile(args[2])};

    // One named function from a source, by brace matching (as android/tools/corpus/generate.mjs extracts them).
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
    var aqiStandard = weatherUtil().aqiStandard;

    // TabCtrl's air helpers for one standard.
    function tab(airUnit) {
        var $scope = {};
        Function('$scope', 'console', 'Util', 'Units', '$sce', 'aqiStandard', [
            'var airUnit;',
            extract(sources.tab, 'function setAirUnit('),
            '$scope.getSentimentIcon = ' + extract(sources.tab, '$scope.getSentimentIcon = function'),
            '$scope.grade2Color = ' + extract(sources.tab, '$scope.grade2Color = function'),
            'setAirUnit();',
        ].join('\n'))($scope, quiet, {ga: {trackEvent: function () {}, trackException: function () {}}},
            {getUnit: function () { return airUnit; }}, {trustAsHtml: function (s) { return s; }}, aqiStandard);
        return $scope;
    }

    // AirCtrl's getLabelPosition over a gauge `width` wide with a label `labelWidth` wide (offsetWidth; 0 reads as 52).
    function label($scope, aqiCode, width, labelWidth) {
        var document = {getElementById: function (id) { return id === 'aqistd' ? width : labelWidth; }};
        var angular = {element: function (el) { return {prop: function () { return el; }}; }};
        return Function('$scope', 'console', 'Util', 'aqiCode', 'angular', 'document',
            'return ' + extract(sources.air, '$scope.getLabelPosition = function') + ';')(
            $scope, quiet, {ga: {trackException: function () {}}}, aqiCode, angular, document);
    }

    function num(v) { return typeof v === 'number' && isNaN(v) ? 'NaN' : v; }
    // `{{value}}`: AngularJS's stringify (undefined and null show nothing).
    function interpolate(v) { return v === undefined || v === null ? '' : String(v); }

    var airUnits = ['airkorea', 'airkorea_who', 'airnow', 'aqicn', undefined, null, 'unknown', 'aircn'];
    var codes = ['aqi', 'pm25', 'pm10', 'o3', 'no2', 'co', 'so2', undefined];
    var grades = [undefined, null, 0, 1, 2, 3, 4, 5, 6, 7, 8, '1', '2', '4', 1.5, -1, true, false, ''];
    var out = {standards: [], grades: [], labels: []};

    airUnits.forEach(function (airUnit) {
        var $scope = tab(airUnit);
        var std = {bands: {}, maxValue: {}};
        if (airUnit !== undefined) { std.airUnit = airUnit; }
        std.hasStandard = $scope.hasOwnProperty('aqiStandard');
        codes.forEach(function (code) {
            var key = code === undefined ? 'undefined' : code;
            // <div class="air-std" ng-repeat="obj in aqiStandard" ng-style="{'border-color': obj.color}">
            //   <span>{{obj.str|translate}}</span><br><span ng-if="obj.value">~ {{obj.value[aqiCode]}}</span>
            std.bands[key] = ($scope.aqiStandard || []).map(function (obj) {
                return {color: obj.color, str: obj.str, text: obj.value ? '~ ' + interpolate(obj.value[code]) : ''};
            });
            if ($scope.aqiMaxValue) { std.maxValue[key] = $scope.aqiMaxValue[code]; }
        });
        out.standards.push(std);
        grades.forEach(function (g) {
            var r = {color: $scope.grade2Color(g), white: $scope.grade2Color(g, 'white'), icon: $scope.getSentimentIcon(g)};
            if (airUnit !== undefined) { r.airUnit = airUnit; }
            if (g !== undefined) { r.grade = g; }
            out.grades.push(r);
        });
    });

    // The gauge widths of the iOS screens (`.air-std-table` has 4 px margins: 375, 393, 440 pt and a 1024 pt iPad) and
    // two label widths (0: the default 52).
    var widths = [367, 385, 432, 1016];
    var labelWidths = [0, 44];
    ['airkorea', 'airkorea_who', 'airnow', 'aqicn'].forEach(function (airUnit) {
        var $scope = tab(airUnit);
        ['aqi', 'pm25', 'pm10', 'o3', 'no2', 'co', 'so2'].forEach(function (code) {
            var bp = aqiStandard[airUnit].value[code];
            widths.forEach(function (width) {
                labelWidths.forEach(function (labelWidth) {
                    var position = label($scope, code, width, labelWidth);
                    for (var g = 0; g <= bp.length; g++) {
                        var values = g >= 1 && g < bp.length ? [bp[g - 1], (bp[g - 1] + bp[g]) / 2, bp[g]] : [bp[1]];
                        if (airUnit === 'airnow' && code === 'so2') { values = values.concat([0.05, 0.1]); }
                        values.forEach(function (v) {
                            out.labels.push([airUnit, code, width, labelWidth, g, v, num(position(g, v))]);
                        });
                    }
                    // A value the page shows as '-' (no value): NaN, which the browser ignores as `left`.
                    out.labels.push([airUnit, code, width, labelWidth, 1, '-', num(position(1, '-'))]);
                });
            });
        });
    });
    print(JSON.stringify(out));
})(arguments);
