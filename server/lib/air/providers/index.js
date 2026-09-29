/**
 * Air quality provider adapters (#2628). Each exports the same interface:
 * {id, label, stationBased, isConfigured(keyString), fetchCurrent(gCoord, deps, callback)}.
 */

"use strict";

var google = require('./google');
var openweather = require('./openweather');
var visualcrossing = require('./visualcrossing');
var aqicn = require('./waqi');

var list = [google, openweather, visualcrossing, aqicn];
var byId = {};
list.forEach(function (provider) {
    byId[provider.id] = provider;
});

module.exports = {
    google: google,
    openweather: openweather,
    visualcrossing: visualcrossing,
    aqicn: aqicn,
    list: list,
    byId: byId
};
