// S09, O06 and notification goldens of the Cordova iOS app (IN-14, #2963), run in the macOS JavaScriptCore shell (the
// engine of the Cordova iOS app) by generate.py:
//   TZ=Asia/Seoul jsc alarms.js -- <service.push.js> <service.weatherutil.js> <controller.push.js> <ionic-timepicker.provider.js>
// It prints one JSON document. The cases follow android/tools/corpus/generate.mjs (alarmPage, pickerCases, tapCases,
// pushSavedCases of AN-14) with the platform reporting iOS and the iOS plugin's payloads (firebasex-messaging 2.0.3:
// `aps.alert` for a message while the app shows, `tap` "background"/"foreground" for a tap). Only the services and
// PushCtrl are real; $http, TwStorage, Firebase, the hour bar, the picker, $ionicPopup, $translate (each key is its own
// text), history, the timers and the clock are recorders or fixed values.
(function (args) {
    'use strict';
    var pushSource = readFile(args[0]);
    var utilSource = readFile(args[1]);
    var ctrlSource = readFile(args[2]);
    var pickerSource = readFile(args[3]);
    var quiet = {log: function () {}, warn: function () {}, error: function () {}, info: function () {}};
    var NOW = Date.UTC(2026, 10, 7, 3, 0, 0);
    class FixedDate extends Date {
        constructor(...a) { super(...(a.length ? a : [NOW])); }
        static now() { return NOW; }
    }
    var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };

    // The registered function of one module file: factory, controller or provider.
    function load(source, globals) {
        var registered;
        var module = {
            factory: function (_, fn) { registered = fn; return module; },
            controller: function (_, fn) { registered = fn; return module; },
            provider: function (_, fn) { registered = fn; return module; },
        };
        var angular = {module: function () { return module; }, extend: Object.assign};
        var names = ['angular'].concat(Object.keys(globals));
        var values = [angular].concat(names.slice(1).map(function (k) { return globals[k]; }));
        Function.apply(null, names.concat([source])).apply(null, values);
        return registered;
    }

    var DEVICE = {deviceId: '0F0B1C9E-5B4A-4C1D-9E2F-3A4B5C6D7E8F', language: 'ko-KR', appVersion: '1.1.1'};
    var CITIES = [
        {currentPosition: true, disable: false, name: '회현동', address: '대한민국 서울특별시 중구 회현동', source: 'KMA',
            location: {lat: 37.56, long: 126.98}},
        {currentPosition: false, disable: false, name: '명동', address: '대한민국 서울특별시 중구 명동', source: 'KMA',
            location: {lat: 37.56, long: 126.98}},
        {currentPosition: false, disable: false, name: 'London', address: 'United Kingdom London', country: 'GB', source: 'VC',
            location: {lat: 51.51, long: -0.13}},
    ];
    var TOWN = {first: '서울특별시', second: '중구', third: '명동'};
    var LIST = [
        {cityIndex: 0, id: 1, startTime: '2026-11-07T22:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', enable: true, category: 'alert', name: 'stale'},
        {cityIndex: 1, id: 1, startTime: '2026-11-07T22:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', enable: true, category: 'alert',
            name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN},
        {cityIndex: 1, id: 2, time: '2026-11-07T22:40:00.000Z', dayOfWeek: [false, true, true, true, true, true, false], enable: true,
            category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN},
        {cityIndex: 2, id: 1, startTime: '2026-11-08T03:00:00.000Z', endTime: '2026-11-08T03:00:00.000Z', enable: false, category: 'alert',
            name: 'London', source: 'VC', location: {long: -0.13}},
        {cityIndex: 2, id: 2, time: '2026-11-07T21:00:00.000Z', dayOfWeek: [true, true, true, true, true, true, true], enable: false,
            category: 'alarm', name: 'London', source: 'VC', location: {lat: 51.51, long: -0.13}},
    ];
    var UNITS = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm',
        airUnit: 'airkorea'};
    var ios = {Platform: {isIOS: function () { return true; }, isAndroid: function () { return false; }}};
    var config = {package: 'todayWeather', serverUrl: 'https://server'};
    var Util = {ga: {trackEvent: function () {}, trackException: function () {}}, uuid: DEVICE.deviceId,
        language: DEVICE.language, version: DEVICE.appVersion};

    function weatherUtil() {
        var factory = load(utilSource, {console: quiet, clientConfig: {debug: false}, window: {}, alert: function () {},
            setTimeout: function () {}, Date: FixedDate});
        return factory({}, function () { throw new Error('no network'); }, Util,
            {getUnit: function (n) { return UNITS[n]; }}, {track: function () {}});
    }

    // The Push service on an iOS device after Push.init over pushData2 {fcmToken, pushList}; `WeatherInfo` and `Firebase`
    // are the given doubles. `calls` records the requests, `store.saved` the last pushData2 list saved.
    function pushService(storedToken, list, WeatherInfo, Firebase, calls, store, timers) {
        var $http = function (cfg) {
            calls.push(clone({method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data}));
            return {success: function () { return this; }, error: function () { return this; }};
        };
        var factory = load(pushSource, {console: quiet, window: {}, clientConfig: config, ionic: ios,
            setTimeout: function (fn) { timers.push(fn); }, Date: FixedDate});
        var stored = {pushData2: {registrationId: null, type: 'ios', category: '', fcmToken: storedToken, pushList: list}};
        var TwStorage = {get: function (k) { return clone(stored[k] === undefined ? null : stored[k]); },
            set: function (k, v) { if (k === 'pushData2') { store.saved = clone(v.pushList); } }};
        var push = factory($http, TwStorage, Util, weatherUtil(), WeatherInfo, {getAllUnits: function () { return clone(UNITS); }},
            {$broadcast: function () {}}, Firebase);
        push.init();
        if (push.pushData.type !== 'ios') { throw new Error('platform is not iOS: ' + push.pushData.type); }
        timers.splice(0).forEach(function (fn) { fn(); });
        calls.length = 0;
        store.saved = null;
        return push;
    }

    // S09: PushCtrl over the real Push service for one place (AN-14's alarmPage). After each step it records the rows,
    // the add row, the weekdays, the switch, what opened (popup, picker), the requests sent, the list saved, whether the
    // page went back and the permission calls (grantPermission, hasPermission).
    function alarmPage(o) {
        var storedToken = o.storedToken === undefined ? 'token-a' : o.storedToken;
        var list = o.list || LIST;
        var cities = o.cities || CITIES;
        var permission = o.permission === undefined ? true : o.permission;
        var inited = o.inited === undefined ? true : o.inited;
        var timers = [];
        var calls = [];
        var store = {saved: null};
        var cityIndex = o.selected === undefined ? 1 : o.selected;
        var WeatherInfo = {
            getCityOfIndex: function (i) { return i >= 0 && i < cities.length ? clone(cities[i]) : null; },
            getCityIndex: function () { return cityIndex; },
            setCityIndex: function (i) { if (i >= 0 && i < cities.length) { cityIndex = i; } },
        };
        var permissionCalls = [];
        var Firebase = {init: function () {}, inited: inited,
            hasPermission: function (cb) { permissionCalls.push('has'); cb({isEnabled: permission}); },
            grantPermission: function (cb) { permissionCalls.push('grant'); cb(permission ? 'already granted' : null); }};
        var push = pushService(storedToken, list, WeatherInfo, Firebase, calls, store, timers);

        var slider = null, picker = null, opened = [], back = 0;
        var settingsOpened = [];
        var controller = load(ctrlSource, {console: quiet, window: {}, Date: FixedDate,
            setTimeout: function (fn) { timers.push(fn); },
            $: function () { return {ionRangeSlider: function (opts) { slider = opts; }}; },
            cordova: {plugins: {diagnostic: {switchToSettings: function (ok) { settingsOpened.push('app'); if (ok) { ok(); } }}}}});
        var popups = [];
        var thenable = function (value) {
            return {then: function (ok) { ok(value); return {finally: function (fn) { fn(); }}; }};
        };
        var $translate = function (keys) {
            var t = {};
            keys.forEach(function (k) { t[k] = k; });
            return thenable(t);
        };
        var popup = function (kind) {
            return function (opts) {
                var p = {kind: kind, title: opts.title === undefined ? null : opts.title,
                    template: opts.template === undefined ? null : opts.template,
                    buttons: (opts.buttons || []).map(function (b) { return {text: b.text, type: b.type === undefined ? null : b.type}; }),
                    answer: null, done: null};
                popups.push(p);
                opened.push({kind: kind, title: p.title, template: p.template, buttons: p.buttons});
                return {then: function (cb) { p.answer = cb; return {finally: function (fn) { p.done = fn; }}; }};
            };
        };
        var $ionicPopup = {show: popup('show'), alert: popup('alert')};
        var ionicTimePicker = {openTimePicker: function (opts) {
            picker = opts;
            opened.push({kind: 'picker', inputTime: opts.inputTime, setLabel: opts.setLabel, cancelLabel: opts.cancelLabel,
                closeLabel: opts.closeLabel});
        }};
        var $scope = {};
        controller.call(null, $scope, o.fav === undefined ? {} : {fav: String(o.fav)}, WeatherInfo, weatherUtil(), {}, Util,
            {goBack: function () { back++; }}, push, $translate, ionicTimePicker, $ionicPopup);

        var snapshot = function (step) {
            var rows = ($scope.alarmList || []).map(function (a, i) {
                return {index: i, id: a.id, enable: a.enable, text: $scope.secs2dateStr(a.time)};
            });
            var out = {step: step, title: $scope.address, rows: rows, canAdd: $scope.canMakeNewAlarm(),
                days: clone($scope.dayOfWeek), alertOn: $scope.alert.enable, opened: opened, requests: calls.splice(0), saved: store.saved,
                back: back, permission: permissionCalls, selected: cityIndex};
            opened = []; store.saved = null; back = 0; permissionCalls = [];
            return out;
        };
        var open = snapshot(null);
        open.slider = slider && {from: slider.from, to: slider.to, min: slider.min, max: slider.max, step: slider.step,
            type: slider.type, grid: slider.grid, hide_min_max: slider.hide_min_max};
        var after = (o.steps || []).map(function (step) {
            if (step.op === 'day') { $scope.toggleEnableDay(step.day); }
            else if (step.op === 'alert') { $scope.alert.enable = step.enable; $scope.onToggleEnableAlert(); }
            else if (step.op === 'hours') { slider.onChange({from: step.from, to: step.to}); }
            else if (step.op === 'picker') { $scope.onOpenTimePicker(step.index); }
            else if (step.op === 'set') { picker.callback(step.secs); }
            else if (step.op === 'delete') { picker.callback(0); }
            else if (step.op === 'close') { picker.callback(); }
            else if (step.op === 'cancel') { $scope.onClose(); }
            else if (step.op === 'save') { $scope.onOkay(); }
            else if (step.op === 'answer') {
                var p = popups[popups.length - 1];
                if (p.answer) { p.answer(step.value); }
                if (p.done) { p.done(); }
            }
            else if (step.op === 'permission') { permission = step.enabled; }
            else { throw new Error('unknown step ' + step.op); }
            timers.splice(0).forEach(function (fn) { fn(); });
            return snapshot(step);
        });
        return {open: open, after: after, settingsOpened: settingsOpened};
    }

    var EVENING_ALARMS = [[2, '2026-11-06T21:05:00.000Z', true], [3, '2026-11-07T03:30:00.000Z', true],
        [4, '2026-11-07T09:00:00.000Z', false], [5, '2026-11-06T22:00:00.000Z', true], [6, '2026-11-07T00:15:00.000Z', true],
        [7, '2026-11-07T11:45:00.000Z', true]];
    var EVENING = [{cityIndex: 1, id: 1, startTime: '2026-11-07T23:00:00.000Z', endTime: '2026-11-08T12:00:00.000Z', enable: false,
        category: 'alert', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN}].concat(EVENING_ALARMS.map(function (a) {
        return {cityIndex: 1, id: a[0], time: a[1], dayOfWeek: [true, false, false, false, false, false, true], enable: a[2],
            category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN};
    }));
    var withTimes = function (start, end) {
        var r = clone(LIST[1]);
        r.startTime = start;
        r.endTime = end;
        return [r];
    };
    // An alert whose window was saved on a month's last day as 07–24: the end is the next month's 1st, 00:00 (A23).
    var MONTH_END = withTimes('2026-10-30T22:00:00.000Z', '2026-10-31T15:00:00.000Z');
    var ALL_DAY = withTimes('2026-11-06T15:00:00.000Z', '2026-11-07T15:00:00.000Z');
    var EQUAL = withTimes('2026-11-07T00:00:00.000Z', '2026-11-07T00:00:00.000Z');
    var DISABLED_CURRENT = [Object.assign(clone(CITIES[0]), {disable: true})].concat(CITIES.slice(1));

    function alarmPageCases() {
        var save = [{op: 'save'}];
        return [
            // A place without records: the defaults (counted as edits), then Save registers them.
            ['first-save', {list: [], steps: save}],
            ['first-cancel-then-save', {list: [], steps: [{op: 'cancel'}, {op: 'answer', value: 'save'}]}],
            ['first-cancel-then-close', {list: [], steps: [{op: 'cancel'}, {op: 'answer', value: 'close'}]}],
            // Existing records: nothing changed, nothing sent.
            ['unchanged-save', {steps: save}],
            ['unchanged-cancel', {steps: [{op: 'cancel'}]}],
            // Picker on a row: Set, Delete, Close; on the add row: Set, Delete.
            ['set-row', {steps: [{op: 'picker', index: 0}, {op: 'set', secs: 21 * 3600 + 15 * 60}].concat(save)}],
            ['delete-row', {steps: [{op: 'picker', index: 0}, {op: 'delete'}].concat(save)}],
            ['close-row', {steps: [{op: 'picker', index: 0}, {op: 'close'}].concat(save)}],
            ['add-row', {steps: [{op: 'picker', index: 1}, {op: 'set', secs: 9 * 3600 + 35 * 60}].concat(save)}],
            ['add-row-delete', {steps: [{op: 'picker', index: 1}, {op: 'delete'}, {op: 'cancel'}]}],
            // The switch, the bar and the weekdays.
            ['alert-off', {steps: [{op: 'alert', enable: false}].concat(save)}],
            ['hours', {steps: [{op: 'hours', from: 0, to: 24}].concat(save)}],
            ['equal-hours', {steps: [{op: 'hours', from: 9, to: 9}].concat(save)}],
            ['equal-hours-alert-off', {steps: [{op: 'alert', enable: false}, {op: 'hours', from: 9, to: 9}].concat(save)}],
            ['equal-stored', {list: EQUAL, steps: save}],
            ['days', {steps: [{op: 'day', day: 0}, {op: 'day', day: 1}].concat(save)}],
            // Five enabled alarms hide the add row; a disabled one keeps its id; the slot-0 place; month-end and 0–24.
            ['five-enabled', {list: EVENING, steps: [{op: 'picker', index: 3}, {op: 'set', secs: 6 * 3600}].concat(save)}],
            ['current-position', {selected: 2, fav: 0, steps: save}],
            ['current-position-disabled', {selected: 2, fav: 0, cities: DISABLED_CURRENT, steps: save}],
            ['from-favorites', {selected: 2, fav: 1, steps: save}],
            ['month-end', {list: MONTH_END, steps: [{op: 'day', day: 3}].concat(save)}],
            ['all-day', {list: ALL_DAY, steps: [{op: 'day', day: 3}].concat(save)}],
            // Permission off: O11 on entry, Save refused with O11; Settings opens the app's page. No Firebase: no
            // prompt, Save stores.
            ['permission-off', {permission: false, list: [], steps: [{op: 'answer', value: 'settings'}].concat(save,
                [{op: 'answer', value: 'close'}, {op: 'permission', enabled: true}], save)}],
            ['no-firebase', {inited: false, list: [], steps: save}],
            ['no-token', {storedToken: null, list: [], steps: save}],
        ].map(function (c) {
            var o = c[1];
            var r = alarmPage(o);
            return {name: c[0], list: o.list || LIST, storedToken: o.storedToken === undefined ? 'token-a' : o.storedToken,
                cities: o.cities || CITIES, selected: o.selected === undefined ? 1 : o.selected,
                fav: o.fav === undefined ? null : o.fav, permission: o.permission === undefined ? true : o.permission,
                inited: o.inited === undefined ? true : o.inited, steps: o.steps || [], open: r.open, after: r.after,
                settingsOpened: r.settingsOpened};
        });
    }

    // ionic-timepicker with the app's configuration (app.js: 12-hour, a 5-minute step, three buttons): what the picker
    // shows for an input time, after its arrows, and what each button answers.
    function pickerCases() {
        var Provider = load(pickerSource, {Date: FixedDate});
        var provider = new Provider();
        provider.configTimePicker({format: 12, step: 5, buttons: 3});
        var shown;
        var $get = provider.$get[provider.$get.length - 1];
        var service = $get({$new: function () { return {}; }}, {show: function (o) { shown = o; return {}; }});
        var ops = {up: 'increaseHours', down: 'decreaseHours', minUp: 'increaseMinutes', minDown: 'decreaseMinutes',
            meridian: 'changeMeridian'};
        var out = [];
        [0, 5 * 60, 8 * 3600, 11 * 3600 + 55 * 60, 12 * 3600, 12 * 3600 + 30 * 60, 13 * 3600 + 5 * 60, 23 * 3600 + 55 * 60,
            7 * 3600 + 47 * 60, 7 * 3600 + 59 * 60 + 40].forEach(function (inputTime) {
            [[], ['up'], ['down'], ['minUp'], ['minDown'], ['meridian'], ['up', 'up', 'up', 'up', 'minUp', 'minUp', 'minUp'],
                ['down', 'down', 'minDown']].forEach(function (steps) {
                var result = 'none';
                service.openTimePicker({inputTime: inputTime, callback: function (v) { result = v; }, setLabel: 'Set',
                    cancelLabel: 'Delete', closeLabel: 'Close'});
                var scope = shown.scope;
                var opening = {hours: String(scope.time.hours), minutes: String(scope.time.minutes), meridian: scope.time.meridian};
                steps.forEach(function (s) { scope[ops[s]](); });
                var shownTime = {hours: String(scope.time.hours), minutes: String(scope.time.minutes), meridian: scope.time.meridian};
                shown.buttons[0].onTap();
                var set = result;
                shown.buttons[1].onTap();
                var deleted = result;
                result = 'none';
                shown.buttons[2].onTap();
                out.push({inputTime: inputTime, steps: steps, opening: opening, shown: shownTime, set: set, deleted: deleted,
                    closed: result === undefined ? null : result,
                    buttons: shown.buttons.map(function (b) { return {text: b.text, type: b.type}; })});
            });
        });
        return out;
    }

    // The notification callback of Push.init with the iOS plugin's payloads, `tap` normalized as service.firebase.js does
    // (`tap: !!tap`): what selects a place and what broadcasts. A tap carries "background" (cold or warm start) or
    // "foreground" (the app was open); a message while the app shows has no tap and its text in `aps.alert`.
    function tapCases() {
        var notify;
        var events = [];
        var WeatherInfo = {getCityOfIndex: function (i) { return clone(CITIES[i]); },
            setCityIndex: function (i) { events.push(['setCityIndex', i]); }};
        var Firebase = {init: function (_, n) { notify = n; }, inited: true};
        var factory = load(pushSource, {console: quiet, window: {}, clientConfig: config, ionic: ios,
            setTimeout: function () {}, Date: FixedDate});
        var push = factory(function () { return {success: function () { return this; }, error: function () { return this; }}; },
            {get: function () { return null; }, set: function () {}}, Util, weatherUtil(), WeatherInfo,
            {getAllUnits: function () { return {}; }}, {$broadcast: function (name, data) {
                events.push([name, data === undefined ? null : clone(data)]);
            }}, Firebase);
        push.init();
        var alert = {title: '명동 맑음 3˚', body: '내일 아침 -1˚, 낮 9˚'};
        var payloads = [
            {tap: 'background', cityIndex: '1', aps: {alert: alert}}, {tap: 'foreground', cityIndex: '2', aps: {alert: alert}},
            {tap: 'background', cityIndex: '0'}, {tap: 'background', cityIndex: '7'}, {tap: 'background', cityIndex: '-1'},
            {tap: 'background', cityIndex: ' 2'}, {tap: 'background', cityIndex: '2abc'}, {tap: 'background', cityIndex: 'abc'},
            {tap: 'background', cityIndex: ''}, {tap: 'background', cityIndex: '1.9'}, {tap: 'background', cityIndex: '0x1'},
            {tap: 'background', cityIndex: ' 1'}, {tap: 'background'},
            {cityIndex: '1', messageType: 'notification', aps: {alert: alert}},
            {cityIndex: '1', messageType: 'notification', aps: {alert: {body: 'only a body'}}},
            {cityIndex: '1', messageType: 'notification', aps: {alert: {title: 'only a title'}}},
            {cityIndex: '1', messageType: 'notification', aps: {alert: 'a string alert'}},
            {cityIndex: '1', messageType: 'notification', aps: {alert: {title: 'a <b>bold</b> &amp; title', body: 'x'}}},
            {body: 'a data body', title: 'a data title'}, {},
        ];
        return payloads.map(function (payload) {
            events.length = 0;
            var result = clone(payload);
            result.tap = !!result.tap;
            var threw = null;
            try {
                notify(undefined, result);
            } catch (e) {
                threw = String(e && e.name);
            }
            return {payload: payload, events: clone(events), threw: threw};
        });
    }

    // Push.updatePushListByCityIndex (the S09 save) and Push.enableAlertForOldAlarm (O06) over the stored list.
    function savedRequests(storedToken, list, newList, index) {
        var calls = [];
        var store = {saved: null};
        var WeatherInfo = {getCityOfIndex: function (i) { return clone(CITIES[i]); }};
        var push = pushService(storedToken, list, WeatherInfo, {init: function () {}, inited: true}, calls, store, []);
        if (newList === 'intro-ok') { push.enableAlertForOldAlarm(true); }
        else if (newList === 'intro-close') { push.enableAlertForOldAlarm(false); }
        else {
            // PushCtrl passes Dates (secs2date and the loaded records rehydrated by category).
            push.updatePushListByCityIndex(clone(newList).map(function (r) {
                if (r.category === 'alert') {
                    r.startTime = new FixedDate(r.startTime);
                    r.endTime = new FixedDate(r.endTime);
                } else {
                    r.time = new FixedDate(r.time);
                }
                return r;
            }), index);
        }
        return {requests: calls, saved: store.saved};
    }

    var SAVED_PLACE = [
        {cityIndex: 1, id: 1, startTime: '2026-11-06T22:00:00.000Z', endTime: '2026-11-07T13:00:00.000Z', enable: true, category: 'alert',
            name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN},
        {cityIndex: 1, id: 2, time: '2026-11-07T12:15:00.000Z', dayOfWeek: [false, true, true, true, true, true, false], enable: true,
            category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN},
        {cityIndex: 1, id: 3, time: '2026-11-06T11:20:00.000Z', dayOfWeek: [false, true, true, true, true, true, false], enable: false,
            category: 'alarm', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN},
    ];
    var LEGACY_CONVERTED = [
        {cityIndex: 1, id: 1, startTime: '2026-11-06T22:00:00.000Z', endTime: '2026-11-07T13:00:00.000Z', enable: false, category: 'alert',
            name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98}, town: TOWN},
        {cityIndex: 1, time: '2026-11-06T22:40:00.000Z', name: '명동', source: 'KMA', location: {lat: 37.56, long: 126.98},
            category: 'alarm', id: 2, enable: true, dayOfWeek: [true, true, true, true, true, true, true]},
        {cityIndex: 0, id: 1, startTime: '2026-11-06T22:00:00.000Z', endTime: '2026-11-07T13:00:00.000Z', enable: false, category: 'alert',
            name: 'stale'},
    ];
    var atCurrentPosition = SAVED_PLACE.map(function (r) { return Object.assign(clone(r), {cityIndex: 0}); });
    var allDay = [Object.assign(clone(SAVED_PLACE[0]), {startTime: '2026-11-06T15:00:00.000Z', endTime: '2026-11-07T15:00:00.000Z'})];
    var withoutPlace1 = LIST.filter(function (r) { return r.cityIndex !== 1; });

    var placeSaved = [
        ['replace-place', 'token-a', LIST, SAVED_PLACE, 1], ['new-place', 'token-a', withoutPlace1, SAVED_PLACE, 1],
        ['current-position', 'token-a', LIST, atCurrentPosition, 0], ['all-day-alert', 'token-a', [], allDay, 1],
        ['no-token', null, LIST, SAVED_PLACE, 1],
    ].map(function (c) {
        var r = savedRequests(c[1], c[2], c[3], c[4]);
        return {name: c[0], storedToken: c[1], pushList: c[2], list: c[3], index: c[4], requests: r.requests, saved: r.saved};
    });
    var alertIntro = [
        ['ok', 'token-a', LEGACY_CONVERTED, 'intro-ok'], ['close', 'token-a', LEGACY_CONVERTED, 'intro-close'],
        ['ok-no-token', null, LEGACY_CONVERTED, 'intro-ok'],
    ].map(function (c) {
        var r = savedRequests(c[1], c[2], c[3], null);
        return {name: c[0], storedToken: c[1], pushList: c[2], answer: c[3], requests: r.requests, saved: r.saved};
    });

    print(JSON.stringify({cities: CITIES, pushList: LIST, deviceId: DEVICE.deviceId, language: DEVICE.language,
        appVersion: DEVICE.appVersion, units: UNITS, now: NOW, zone: 'Asia/Seoul', pages: alarmPageCases(),
        picker: pickerCases(), taps: tapCases(), placeSaved: placeSaved, alertIntro: alertIntro}));
})(typeof scriptArgs !== 'undefined' ? scriptArgs : arguments);
