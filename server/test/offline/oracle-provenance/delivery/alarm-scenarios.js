/* S18b-1 oracle scenarios for the legacy alarm worker (task evidence). Weather bodies start from
 * the S02 golden v000902 KMA and DSF responses; every token, name and coordinate is synthetic. */
'use strict';
const fs = require('fs');
const path = require('path');
const golden = JSON.parse(fs.readFileSync(path.join(process.env.TW_REPO, 'server2/tests/golden/records.json'), 'utf8'));
const body = id => JSON.parse(Buffer.from(golden.cases.find(c => c.id === id).body_base64, 'base64').toString());
const K0 = body('domestic-v000902');
const W0 = body('world-v000902');
const clone = v => JSON.parse(JSON.stringify(v));
const units = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km',
    precipitationUnit: 'mm', airUnit: 'airkorea', airForecastSource: 'kaq'};
const day = (k, n) => k.midData.dailyData.find(d => d.fromToday === n);

function kma(mut) { const k = clone(K0); if (mut) mut(k); return k; }
function dsf(mut) { const w = clone(W0); if (mut) mut(w); return w; }
const evening = k => { k.current.dateObj = '2026.09.24 19:30'; };
const pollutants = {
    pm25: {daily: [{fromToday: 0, val: 20, grade: 2, str: '보통'}, {fromToday: 1, val: 45, grade: 3, str: '나쁨'}]},
    pm10: {daily: [{fromToday: 0, val: 40, grade: 2, str: '보통'}, {fromToday: 1, val: 25, grade: 1, str: '좋음'}]},
    o3: {daily: [{fromToday: 0, val: 0.03, grade: 1, str: '좋음'}, {fromToday: 1, val: 0.1, grade: 3, str: '나쁨'}]},
};
const ok = {status: 200, headers: {'content-type': 'application/json; charset=UTF-8'}, body: '{"name":"projects/oracle/messages/1"}'};
const fcmError = (status, code, fcm) => ({status, headers: {'content-type': 'application/json; charset=UTF-8'},
    body: JSON.stringify({error: {code: status, message: 'synthetic ' + code, status: code,
        details: fcm ? [{'@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: fcm}] : undefined}})});
const record = extra => Object.assign({type: 'ios', fcmToken: 'fcm-1', cityIndex: 1, id: 1, geo: [126.97, 37.56], source: 'KMA',
    name: '집', lang: 'ko', package: 'todayWeather', units: clone(units), pushTime: 79200, enable: true}, extra);

const cases = [
    ['kma-tw-morning', record(), {kma: kma()}],
    ['kma-tw-evening', record({lang: 'en'}), {kma: kma(evening)}],
    ['kma-tw-rain-dust', record(), {kma: kma(k => {
        evening(k);
        const d0 = day(k, 0), d1 = day(k, 1);
        Object.assign(d0, {skyAm: 'sun', skyPm: 'sun_bigcloud_rain', wfAm: '맑음', wfPm: '구름많고 비', tmn: 18, tmx: 24.6});
        Object.assign(d1, {skyAm: 'cloud_rain', skyPm: 'sun_smallcloud', wfAm: '흐리고 비', wfPm: '구름적고', tmn: 15.5, tmx: 21, pty: 1, pop: 70,
            dustForecast: {pm10Grade: 2, pm25Grade: 3, pm10Str: '보통', pm25Str: '나쁨', o3Str: '좋음'}});
    })}],
    ['kma-tw-current-rain', record(), {kma: kma(k => {
        Object.assign(k.current, {pty: 1, rn1: 2.5, skyIcon: 'Cloud_Rain', t1h: 0,
            arpltn: {pm10Grade: 3, pm10Str: '나쁨', pm25Grade: 3, pm25Str: '나쁨', khaiGrade: 2, khaiStr: '보통'}});
        Object.assign(day(k, 0), {pty: 1, pop: 60, dustForecast: {pm10Grade: 2, pm25Grade: 2, pm10Str: '보통', pm25Str: '보통'}});
    })}],
    ['kma-tw-aqi-order', record(), {kma: kma(k => {
        k.current.arpltn = {o3Grade: 3, o3Str: '나쁨', khaiGrade: 4, khaiStr: '매우나쁨'};
    })}],
    ['kma-tw-pollutants', record({lang: 'en'}), {kma: kma(k => {
        evening(k);
        k.airInfo.pollutants = {aqi: {daily: [{fromToday: 1, val: 50, grade: 2, str: 'Moderate'}]}, pm25: pollutants.pm25};
    })}],
    ['kma-tw-pollutants-pm10', record({lang: 'de'}), {kma: kma(k => {
        k.airInfo.pollutants = {pm25: {daily: [{fromToday: 1, val: 1}]}, pm10: pollutants.pm10, o3: pollutants.o3};
    })}],
    ['kma-ta-air', record({package: 'todayAir', lang: 'ja'}), {kma: kma(k => {
        k.current.summaryAir = '대기질은 보통입니다.';
        k.airInfo.pollutants = clone(pollutants);
    })}],
    ['kma-ta-air-evening', record({package: 'todayAir'}), {kma: kma(k => {
        evening(k);
        k.current.summaryAir = '대기질은 보통입니다.';
        k.airInfo.pollutants = clone(pollutants);
    })}],
    ['kma-ta-no-summary', record({package: 'todayAir'}), {kma: kma(k => { k.airInfo.pollutants = clone(pollutants); })}],
    ['kma-ta-max-index', record({package: 'todayAir', lang: 'zh-CN'}), {kma: kma(k => {
        k.current.summaryAir = 'x';
        k.airInfo.pollutants = {pm25: {daily: [{fromToday: 0, val: 10, grade: 1, str: '좋음'}]},
            o3: {daily: [{fromToday: 0, val: 0.2, grade: 3, str: '나쁨'}]}, aqi: {daily: [{fromToday: 0, val: 200, grade: 4}]}};
    })}],
    ['kma-ta-good', record({package: 'todayAir', lang: 'zh-TW'}), {kma: kma(k => {
        k.current.summaryAir = 'x';
        k.airInfo.pollutants = {pm25: {daily: [{fromToday: 0, val: 10, grade: 1, str: '좋음'}]}};
    })}],
    ['kma-ta-no-pollutants', record({package: 'todayAir'}), {kma: kma(k => { k.current.summaryAir = 'y'; })}],
    ['kma-missing-target', record(), {kma: kma(k => {
        evening(k);
        k.midData.dailyData = k.midData.dailyData.filter(d => d.fromToday !== 1);
    })}],
    ['kma-missing-wf', record(), {kma: kma(k => { delete day(k, 0).wfAm; day(k, 0).skyAm = 'sun'; day(k, 0).skyPm = 'sun'; })}],
    ['kma-town-only', record({geo: undefined, source: undefined, lang: 'zh-TW', units: {temperatureUnit: 'F', airUnit: 'aqicn'},
        town: {first: '서울특별시', second: '송파구', third: '잠실본동'}}), {kma: kma()}],
    ['kma-no-units-body', record({package: 'todayAir', units: undefined, lang: undefined}), {kma: kma(k => {
        delete k.units; k.current.summaryAir = 'z'; k.airInfo.pollutants = clone(pollutants);
    })}],
    ['kma-name-from-body', record({name: undefined}), {kma: kma()}],
    ['geo-kr', record({cityIndex: 0, id: 0, source: undefined, name: undefined}), {
        geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: '서울특별시', name2: '중구', name3: '명동'}, location: {lat: 37.5636, long: 126.9869}}},
        kma: kma()}],
    ['geo-kr-short-name', record({cityIndex: 0, id: 0, source: 'KMA'}), {
        geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: '서'}, location: {lat: 37.5, long: 127}}}, kma: kma()}],
    ['geo-foreign', record({cityIndex: 0, id: 0, name: 'Paris'}), {geo: {status: 200, body: {country: 'FR'}}, dsf: dsf()}],
    ['geo-500', record({cityIndex: 0, id: 0}), {geo: {status: 500, body: 'error'}}],
    ['geo-invalid', record({cityIndex: 0, id: 0}), {geo: {status: 200, body: {country: 'KR', kmaAddress: {name1: 'x'}}}}],
    ['source-vc', record({source: 'VC', name: 'Paris', lang: 'en', units: {temperatureUnit: 'F'}}), {dsf: dsf()}],
    ['dsf-evening-rain', record({source: 'DSF', name: 'Paris', lang: 'fr'}), {dsf: dsf(w => {
        Object.assign(w.thisTime[1], {dateObj: '2026.09.26 19:00', pty: 1, rn1: 1.2, skyIcon: 'cloud_rain',
            arpltn: {pm25Grade: 3, pm25Str: 'Unhealthy', pm10Grade: 2}});
    })}],
    ['dsf-morning-dry', record({source: 'VC', name: undefined, lang: 'ko'}), {dsf: dsf(w => {
        Object.assign(w.thisTime[1], {dateObj: '2026.09.26 08:00', t1h: 0});
    })}],
    ['dsf-ta-summary', record({source: 'VC', package: 'todayAir'}), {dsf: dsf(w => { w.thisTime[1].summaryAir = 'Air quality is moderate'; })}],
    ['dsf-ta-noair', record({source: 'VC', package: 'todayAir'}), {dsf: dsf(w => { delete w.airInfo; })}],
    ['unknown-source-geo', record({source: 'XX'}), {geo: {status: 200, body: {country: 'JP'}}, dsf: dsf()}],
    ['invalid', record({geo: undefined, source: undefined, town: undefined}), {}],
    ['weather-500', record(), {kma: {status: 500, body: 'oops'}}],
    ['weather-transport', record(), {kma: {error: 'ECONNREFUSED'}}],
    ['fcm-not-found', record({fcmToken: 'fcm-gone'}), {kma: kma(), fcm: [fcmError(404, 'NOT_FOUND', 'UNREGISTERED')]}],
    ['fcm-invalid-argument', record(), {kma: kma(), fcm: [fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT')]}],
    ['fcm-quota', record(), {kma: kma(), fcm: [fcmError(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED')]}],
    ['fcm-unavailable', record(), {kma: kma(), fcm: [fcmError(503, 'UNAVAILABLE', 'UNAVAILABLE')]}],
    ['fcm-html-500', record(), {kma: kma(), fcm: [{status: 500, headers: {'content-type': 'text/html'}, body: '<html>oops</html>'}]}],
    ['fcm-reset-then-ok', record(), {kma: kma(), fcm: [{error: 'ECONNRESET'}, ok]}],
    ['fcm-reset-twice', record(), {kma: kma(), fcm: [{error: 'ECONNRESET'}, {error: 'ECONNRESET'}]}],
    ['token-error', record(), {advance: 7200000, kma: kma(), token: {status: 400, headers: {'content-type': 'application/json'}, body: '{"error":"invalid_grant","error_description":"Invalid JWT"}'}}],
    ['after-token-error', record(), {advance: 7200000, kma: kma()}],
    ['ios-no-fcm', record({fcmToken: undefined, registrationId: 'reg-ios'}), {kma: kma()}],
    ['android-gcm', record({type: 'android', fcmToken: undefined, registrationId: 'reg-android'}), {kma: kma()}],
    ['android-no-reg', record({type: 'android', fcmToken: undefined}), {kma: kma()}],
    ['unknown-type', record({type: 'web', fcmToken: undefined}), {kma: kma()}],
    ['today-air-app', record({package: 'todayAir', fcmToken: 'fcm-ta'}), {kma: kma(k => { k.current.summaryAir = 'x'; })}],
    ['android-fcm', record({type: 'android', fcmToken: 'fcm-android', registrationId: 'reg-ignored', cityIndex: undefined}), {kma: kma()}],
];

// sendPush(time) at 2026-10-15T22:00:00Z (Thursday UTC; Friday 07:00 at UTC+9).
const days = (a) => a;
const at = iso => new Date(iso);
const scheduled = [
    record({fcmToken: 's-1', dayOfWeek: days([true, true, true, true, true, true, true]), timezoneOffset: 540, updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-2', dayOfWeek: days([true, true, true, true, true, false, true]), timezoneOffset: 540, updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-3', dayOfWeek: days([false, false, false, false, true, false, false]), timezoneOffset: -300, updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-4', dayOfWeek: days([true, true]), updatedAt: at('2026-10-10T00:00:00Z')}),
    record({fcmToken: 's-5', dayOfWeek: [], updatedAt: at('2026-08-01T00:00:00Z')}),
    record({fcmToken: 's-6'}),
    record({fcmToken: 's-7', cityIndex: 0, id: 0, updatedAt: at('2026-08-15T21:59:59Z')}),
];
module.exports = {cases, scheduled, schedule: {now: '2026-10-15T22:00:00.000Z', time: 79200}};
