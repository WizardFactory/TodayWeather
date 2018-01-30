/**
 * Created by aleckim on 2017. 12. 27..
 */

"use strict";

var assert  = require('assert');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var ControllerPush = require('../../controllers/controllerPush');

var i18n = require('i18n');
i18n.configure({
    // setup some locales - other locales default to en silently
    locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'],
    // sets a custom cookie name to parse locale settings from
    cookie: 'twcookie',

    // where to store json files - defaults to './locales'
    directory: __dirname + './../locales',

    register: global
});
global.i18n = i18n;

describe('e2e local test - controller push', function() {

    var pushInfo1 = { "cityIndex" : 1,
        "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
        "pushTime" : 82800,
        "type" : "ios", "source" : "KMA", "lang" : "ko",
        "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
            "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
        "geo" : [ 127.37, 36.3 ],
        "name" : "정림동" };

    var pushInfo2 = { "cityIndex" : 1,
        "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
        "town" : { "first" : "대전광역시", "second" : "서구", "third" : "정림동" },
        "pushTime" : 82800,
        "type" : "ios", "source" : "KMA", "lang" : "ko",
        "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
            "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
        "name" : "정림동" };

    it('test request daily summary without town', function(done) {
        this.timeout(20*1000);
        var co = new ControllerPush();
        co.requestDailySummary(pushInfo1, function (err, result) {
            assert.equal(err, null, err);
            console.log(result);
            done();
        });
    });

    it('test request daily summary without geo', function(done) {
        this.timeout(20*1000);
        var co = new ControllerPush();
        co.requestDailySummary(pushInfo2, function (err, result) {
            assert.equal(err, null, err);
            console.log(result);
            done();
        });
    });
});

