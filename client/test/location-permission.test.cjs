// Location permission flows must settle for every cordova.plugins.diagnostic 7.4.0 status (#2871).
// Denying the prompt used to leave the start screen spinner (and the tab loading state) running forever.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

// Constants copied from cordova.plugins.diagnostic 7.4.0 www/{android,ios}/diagnostic.js.
const STATUS = {
    android: {GRANTED: 'GRANTED', GRANTED_WHEN_IN_USE: 'authorized_when_in_use', DENIED_ONCE: 'DENIED_ONCE',
        DENIED_ALWAYS: 'DENIED_ALWAYS', NOT_REQUESTED: 'NOT_REQUESTED', UNKNOWN: 'unknown', LIMITED: 'LIMITED'},
    ios: {NOT_REQUESTED: 'not_determined', UNKNOWN: 'unknown', DENIED_ALWAYS: 'denied_always', RESTRICTED: 'restricted',
        GRANTED: 'authorized', GRANTED_WHEN_IN_USE: 'authorized_when_in_use', EPHEMERAL: 'ephemeral', PROVISIONAL: 'provisional'}
};
const LOCATION_MODE = {HIGH_ACCURACY: 'high_accuracy', DEVICE_ONLY: 'device_only', BATTERY_SAVING: 'battery_saving', LOCATION_OFF: 'location_off'};
const CONTROLLERS = {
    start: {file: 'www/js/controller.start.js', end: '    function saveCity(', denied: 'LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED'},
    search: {file: 'www/js/controller.searchctrl.js', end: '        function loadWeatherData(', denied: 'LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED'},
    tab: {file: 'www/js/controller.tabctrl.js', end: '        function updateWeatherData(', denied: 'LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY'}
};
const PENDING = Symbol('pending');

// A device whose permission status changes only through the prompt answers.
function device(platform, {status, answers = [], locationOn = true}) {
    const state = {status, prompts: 0};
    const diagnostic = {
        permissionStatus: STATUS[platform], locationMode: LOCATION_MODE, locationAuthorizationMode: {WHEN_IN_USE: 'when_in_use'},
        getLocationAuthorizationStatus(done) { setImmediate(() => done(state.status)); },
        requestLocationAuthorization(done) {
            state.prompts++;
            if (answers.length) { state.status = answers.shift(); }
            setImmediate(() => done(state.status));
        }
    };
    const cordova = {plugins: {diagnostic}};
    const ionic = {Platform: {isIOS: () => platform === 'ios', isAndroid: () => platform === 'android'}};
    let utilFactory;
    vm.runInNewContext(read('www/js/service.util.js'), {
        angular: {noop() {}, module() { return {factory(n, fn) { utilFactory = fn; }}; }},
        clientConfig: {}, window: {cordova}, cordova, console: {log() {}}, ionic
    });
    const util = utilFactory({}, {track() {}});
    // iOS keeps the permission in locationStatus (registerLocationStateChangeHandler); Android keeps the location mode.
    Object.defineProperty(util, 'locationStatus', {
        get: () => platform === 'ios' ? state.status : (locationOn ? LOCATION_MODE.HIGH_ACCURACY : LOCATION_MODE.LOCATION_OFF)
    });
    return {state, cordova, ionic, util};
}

function load(name, env) {
    const {file, end} = CONTROLLERS[name];
    const source = read(file);
    const start = source.indexOf(name === 'search' ? '        function updateCurrentPosition(' : name === 'tab' ? '        function updateCurrentPosition(' : '    function updateCurrentPosition(');
    assert.ok(start > 0 && source.indexOf(end) > start, `${file} location functions not found`);
    const q = {defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {resolve, reject, promise}; }};
    const context = {
        $q: q, $scope: {setLocationAuthorizationStatus(status) { env.recorded = status; }}, $translate: {instant: key => key}, $ionicLoading: {hide() {}},
        Util: env.util, cordova: env.cordova, window: {cordova: env.cordova}, ionic: env.ionic,
        console: {log() {}, error() {}, info() {}},
        WeatherUtil: {
            getCurrentPosition: () => Promise.resolve({coords: {latitude: 37.5, longitude: 127}, provider: 'fixture'}),
            geolocationNormalize: location => location,
            getGeoInfoByLocation: location => Promise.resolve({location, address: 'fixture'})
        },
        strFailToGetCurrentPosition: 'FAIL_POSITION', strPleaseTurnOnLocationWiFi: 'TURN_ON_WIFI', strFailToGetAddressInfo: 'FAIL_ADDRESS'
    };
    vm.runInNewContext(source.slice(start, source.indexOf(end)) + '\nthis.update = updateCurrentPosition;', context);
    return () => context.update({address: null, location: null});
}

// The callers retry silently on a null rejection (resume/locationOn reload); anything else is shown to the user.
async function settle(update) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await Promise.race([
            update().then(value => ({value}), reason => ({reason})),
            new Promise(done => setTimeout(() => done(PENDING), 1000))
        ]);
        if (result === PENDING) { return PENDING; }
        if (!('reason' in result) || result.reason !== null) { return {...result, attempts: attempt}; }
    }
    return 'endless silent retries';
}

for (const name of Object.keys(CONTROLLERS)) {
    test(`${name}: Android denial on the prompt ends with the denied message`, async () => {
        const env = device('android', {status: STATUS.android.NOT_REQUESTED, answers: [STATUS.android.DENIED_ONCE]});
        const result = await settle(load(name, env));
        assert.notEqual(result, PENDING, 'location request never settled');
        // The prompt answer itself ends the request; no silent reload attempt.
        assert.equal(result.reason, CONTROLLERS[name].denied);
        assert.equal(result.attempts, 1);
        assert.equal(env.state.prompts, 1);
    });

    test(`${name}: Android DENIED_ONCE asks again and a second denial settles`, async () => {
        const env = device('android', {status: STATUS.android.DENIED_ONCE, answers: [STATUS.android.DENIED_ALWAYS]});
        const result = await settle(load(name, env));
        assert.notEqual(result, PENDING, 'location request never settled');
        // The prompt answer itself ends the request; no silent reload attempt.
        assert.equal(result.reason, CONTROLLERS[name].denied);
        assert.equal(result.attempts, 1);
        assert.equal(env.state.prompts, 1);
    });

    test(`${name}: unknown and restricted statuses settle without a prompt`, async () => {
        for (const [platform, status] of [['android', STATUS.android.UNKNOWN], ['ios', STATUS.ios.RESTRICTED], ['ios', STATUS.ios.DENIED_ALWAYS]]) {
            const env = device(platform, {status});
            const result = await settle(load(name, env));
            assert.notEqual(result, PENDING, `${platform} ${status} never settled`);
            assert.ok(typeof result.reason === 'string' && result.reason, `${platform} ${status} settled silently`);
            assert.equal(env.state.prompts, 0);
        }
    });

    test(`${name}: iOS denial on the prompt ends with the denied message`, async () => {
        const env = device('ios', {status: STATUS.ios.NOT_REQUESTED, answers: [STATUS.ios.DENIED_ALWAYS]});
        const result = await settle(load(name, env));
        assert.notEqual(result, PENDING, 'location request never settled');
        assert.equal(result.reason, CONTROLLERS[name].denied);
        assert.equal(result.attempts, 1);
    });

    test(`${name}: a granted prompt reloads and resolves the position`, async () => {
        for (const platform of ['android', 'ios']) {
            const env = device(platform, {status: STATUS[platform].NOT_REQUESTED, answers: [STATUS[platform].GRANTED_WHEN_IN_USE]});
            const result = await settle(load(name, env));
            assert.ok(result.value && result.value.location, `${platform}: ${JSON.stringify(result)}`);
            assert.equal(env.state.prompts, 1);
        }
    });
}

for (const name of ['start', 'search']) {
    test(`${name}: granted permission with location services off asks to turn them on`, async () => {
        const env = device('android', {status: STATUS.android.GRANTED_WHEN_IN_USE, locationOn: false});
        const result = await settle(load(name, env));
        assert.equal(result.reason, 'LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION');
        // The retry popup picks its buttons from this status; a stale DENIED_ALWAYS would offer app settings.
        assert.equal(env.recorded, STATUS.android.GRANTED_WHEN_IN_USE);
        assert.equal(env.state.prompts, 0);
    });
}
