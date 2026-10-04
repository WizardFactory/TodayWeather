'use strict';
var zones = require('../kmaWarningZones');
function call(target, method, args) {
    return new Promise(function (resolve, reject) {
        target[method].apply(
            target,
            args.concat(function (err, value) {
                if (err) reject(err);
                else resolve(value);
            })
        );
    });
}
function create(options) {
    var Controller = require('../../controllers/controllerPush');
    var Alert = require('../../controllers/alert.push.controller');
    var push = new Controller();
    var providers = require('../pushProviders');
    var auth = new Map();
    // Distinct towns fan out to the service's own API at the same minute; bound those requests.
    var weatherSource = require('./weatherSource').create({
        concurrency: Number(process.env.PUSH_WEATHER_CONCURRENCY) || 16,
        now: options && options.now,
        normalize: function (body) {
            if (!body.units) body.units = require('../unitConverter').initUnits({});
            return body;
        }
    });
    var transport = require('./transport').create({
        concurrency: Number(process.env.PUSH_SEND_CONCURRENCY) || 128
    });
    function normalized(record) {
        var r = JSON.parse(JSON.stringify(record));
        r.lang = r.lang || 'ko';
        r.units = require('../unitConverter').initUnits(r.units);
        r.source = r.country === 'KR' ? 'KMA' : r.country ? 'VC' : r.source || 'KMA';
        // Domestic requests share a resolved town; overseas requests keep exact coordinates.
        if (r.source === 'KMA' && r.town && r.town.first) delete r.geo;
        return r;
    }
    function weather(record, deadline) {
        var r = normalized(record),
            url = new Alert()._makeRequestUrl(r);
        return weatherSource.get(url, r.lang, deadline);
    }
    return {
        resolve: async function (loc, r) {
            var town = loc.town || r.town,
                country = town ? 'KR' : undefined;
            if (loc.lat !== undefined) {
                // Use the existing geocoding service adapter off the send path (runtime URL contract below).
                var config = require('../../config/config'),
                    request = require('request');
                var data = await new Promise(function (resolve, reject) {
                    request(
                        {
                            url: config.apiServer.url + '/geocode/v000903/coord/' + loc.lat + ',' + loc.long,
                            json: true,
                            timeout: 5000
                        },
                        function (e, res, b) {
                            if (e || !res || res.statusCode >= 400)
                                return reject(new Error('Push region lookup failed'));
                            resolve(b);
                        }
                    );
                });
                country = data.country;
                var address = data.kmaAddress || {};
                town = address.name1
                    ? { first: address.name1, second: address.name2, third: address.name3 }
                    : undefined;
            }
            return {
                country: country,
                town: town,
                zones: town && town.first ? zones.zonesForTown(town) : [],
                weatherKey: JSON.stringify([r.source || 'KMA', loc.lat, loc.long, town])
            };
        },
        alarm: async function (r, context) {
            var settings = normalized(r),
                body = JSON.parse(JSON.stringify(await weather(settings, context && context.deadline)));
            return settings.source === 'KMA'
                ? push._makeKmaPushMessage(settings, body)
                : push._makeDsfPushMessage(settings, body);
        },
        conditional: async function (r, state, date, context) {
            var worker = new Alert();
            worker.time = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60;
            var body = JSON.parse(JSON.stringify(await weather(r, context && context.deadline)));
            var settings = Object.assign(normalized(r), state || {}),
                info = worker._parseWeatherAirData(settings, body);
            var send = worker._compareWithLastInfo(settings, info);
            worker._updateAlertPush(settings, info, send);
            return {
                state: { airAlerts: settings.airAlerts, precipAlerts: settings.precipAlerts },
                notification: send === 'none' ? null : worker._convertToNotification(settings, info)
            };
        },
        warning: function (event, r) {
            var weather = zones.weatherOf(event.warnVar),
                level = zones.levelOf(event.warnStress);
            var area =
                (event.zones || [event.areaCode]).find(function (z) {
                    return r.zoneIds.indexOf(z) >= 0;
                }) || event.areaCode;
            var name = zones.zoneName(area) || event.areaName || '';
            var english = {
                1: 'Strong wind',
                2: 'Heavy rain',
                3: 'Cold wave',
                4: 'Dry weather',
                5: 'Storm surge',
                6: 'High waves',
                7: 'Typhoon',
                8: 'Heavy snow',
                9: 'Asian dust',
                12: 'Extreme heat',
                13: 'Tropical night'
            };
            var title =
                r.lang === 'ko'
                    ? weather.weatherStr + ' ' + level.levelStr
                    : (english[event.warnVar] || 'Severe weather') +
                      ' ' +
                      (event.warnStress === 0 ? 'advisory' : 'warning');
            return { title: title, text: name };
        },
        authorize: function (product) {
            var old = auth.get(product);
            if (old && old.until > Date.now()) return old.promise;
            var app = providers.firebase(product),
                entry = { until: Date.now() + 30000 },
                timer;
            entry.promise = Promise.race([
                app.options.credential.getAccessToken(),
                new Promise(function (resolve, reject) {
                    timer = setTimeout(function () {
                        reject(new Error('Push authorization timeout'));
                    }, 10000);
                })
            ]).then(
                function (token) {
                    clearTimeout(timer);
                    entry.until = Date.now() + Math.max(0, token.expires_in * 1000 - 60000);
                    if (!app.options.projectId) throw new Error('Firebase project ID is required');
                    return { projectId: app.options.projectId, token: token.access_token };
                },
                function () {
                    clearTimeout(timer);
                    entry.until = Infinity;
                    throw new Error('Push authorization failed');
                }
            );
            auth.set(product, entry);
            return entry.promise;
        },
        send: transport.send,
        close: transport.close
    };
}
module.exports = { create: create, call: call };
