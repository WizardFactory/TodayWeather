'use strict';
// Real geocoder HTTP, legacy weather formatting and credential-cache contract; OAuth itself is synthetic.
var assert = require('assert'),
    http = require('http'),
    fs = require('fs'),
    path = require('path'),
    net = require('net'),
    h = require('./push-harness');
var connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function () {
    var o = net._normalizeArgs(Array.prototype.slice.call(arguments))[0];
    if (['127.0.0.1', 'localhost', '::1'].indexOf(o.host || 'localhost') < 0)
        throw new Error('Nonlocal test connection');
    return connect.apply(this, arguments);
};
var fixture = fs.readFileSync(path.join(__dirname, 'fixtures/push-kma-weather.json')),
    requests = 0,
    tokens = 0;
var server = http.createServer(function (req, res) {
    requests++;
    res.setHeader('content-type', 'application/json');
    if (req.url.indexOf('/geocode/') === 0)
        return res.end(
            JSON.stringify({
                country: 'KR',
                kmaAddress: { name1: '서울특별시', name2: '강남구', name3: '삼성동' }
            })
        );
    res.end(fixture);
});
server.listen(0, '127.0.0.1', async function () {
    var runtime;
    try {
        process.env.SERVICE_SERVER = process.env.API_SERVER = 'http://127.0.0.1:' + server.address().port;
        global.log = h.logger();
        global.manager = {
            leadingZeros: function (n, d) {
                return String(n).padStart(d, '0');
            }
        };
        require('mongoose').connect = function () {
            throw new Error('Unexpected MongoDB connection');
        };
        h.stubModules({
            'lib/pushProviders.js': {
                firebase: function () {
                    return {
                        options: {
                            projectId: 'synthetic-project',
                            credential: {
                                getAccessToken: async function () {
                                    tokens++;
                                    return { access_token: 'synthetic-token', expires_in: 3600 };
                                }
                            }
                        }
                    };
                }
            }
        });
        runtime = require('../../lib/pushCoordinator/runtime').create();
        var r = {
            type: 'android',
            cityIndex: 0,
            id: 0,
            geo: [126.5312, 33.4996],
            location: { lat: 33.4996, long: 126.5312 },
            name: 'Jeju',
            source: 'KMA',
            lang: 'ko',
            package: 'todayWeather',
            timezoneOffset: 540,
            units: {
                temperatureUnit: 'C',
                windSpeedUnit: 'm/s',
                pressureUnit: 'hPa',
                distanceUnit: 'km',
                precipitationUnit: 'mm',
                airUnit: 'airkorea'
            },
            airAlertsBreakPoint: 3
        };
        var region = await runtime.resolve(r.location, r);
        assert(region.zones.length > 0);
        assert.equal(region.town.first, '서울특별시');
        r.weatherKey = region.weatherKey;
        r.zoneIds = region.zones;
        r.town = region.town;
        r.country = region.country;
        var alarms = await Promise.all([
            runtime.alarm(r),
            runtime.alarm(Object.assign({}, r, { name: 'Nearby', geo: [126.532, 33.5] }))
        ]);
        assert(alarms[0].title);
        assert.equal(
            requests,
            2,
            'one registration geocode and shared weather request; no send-time geocoding'
        );
        var alert = await runtime.conditional(r, {}, new Date());
        assert(alert.state.precipAlerts);
        assert.equal(requests, 2, 'alarm and conditional evaluator share the raw weather response');
        assert(alert.notification && alert.notification.title);
        assert(
            runtime.warning({ warnVar: 2, warnStress: 1, zones: r.zoneIds }, r).title.indexOf('호우') >= 0
        );
        assert(
            runtime
                .warning(
                    { warnVar: 2, warnStress: 1, zones: r.zoneIds },
                    Object.assign({}, r, { lang: 'de' })
                )
                .title.indexOf('Heavy rain') >= 0
        );
        var auth = await Promise.all([runtime.authorize('todayWeather'), runtime.authorize('todayWeather')]);
        assert.equal(tokens, 1);
        assert.equal(auth[0].projectId, 'synthetic-project');
        console.log(
            JSON.stringify({
                result: 'PASS',
                checks: [
                    'real runtime geocode mapping',
                    'shared legacy alarm formatter',
                    'conditional rain formatter',
                    'warning fallback',
                    'single OAuth refresh'
                ],
                weatherAndGeocodeRequests: requests
            })
        );
    } catch (e) {
        console.error(e.stack);
        process.exitCode = 1;
    } finally {
        if (runtime) runtime.close();
        server.close();
    }
});
