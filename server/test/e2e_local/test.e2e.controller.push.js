/**
 * Created by aleckim on 2017. 12. 27..
 */

"use strict";

var assert  = require('assert');

var mongoose = require('mongoose');

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
    directory: __dirname + '/../../locales',

    register: global
});

global.i18n = i18n;

describe('e2e local test - controller push', function() {

    // var pushInfo1 = { "id":1, "cityIndex" : 1,
    //     "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
    //     "pushTime" : 82800,
    //     "enable" : true,
    //     "category" : "alarm",
    //     "type" : "ios", "source" : "KMA", "lang" : "ko",
    //     "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
    //         "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
    //     "geo" : [ 127.37, 36.3 ],
    //     "name" : "정림동1", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":540 };

    // var pushInfo2 = { "id":2, "cityIndex" : 2,
    //     "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
    //     "town" : { "first" : "대구광역시", "second" : "달서구", "third" : "송현1동" },
    //     "pushTime" : 82800,
    //     "enable" : true,
    //     "category" : "alarm",
    //     "type" : "ios", "source" : "KMA", "lang" : "ko",
    //     "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
    //         "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm", "airForecastSource" : "kaq"},
    //     "name" : "송현1동", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":-540};

    // var pushInfo3 = { "id":3, "cityIndex" : 2,
    //     "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
    //     "town" : { "first" : "대전광역시", "second" : "서구", "third" : "정림동" },
    //     "pushTime" : 82900,
    //     "enable" : false,
    //     "category" : "alarm",
    //     "type" : "ios", "source" : "KMA", "lang" : "ko",
    //     "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
    //         "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
    //     "name" : "정림동3", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":540};

    // var pushInfo4 = { "id":3, "cityIndex" : 3,
    //     "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
    //     "pushTime" : 82900,
    //     "enable" : false,
    //     "category" : "alarm",
    //     "type" : "ios", "source" : "DSF", "lang" : "ko",
    //     "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
    //         "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
    //     "geo" : [ -79.936, 40.461 ],
    //     "name" : "New York", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":540};

    // var pushInfo5 = { "id":4, "cityIndex" : 4,
    //     "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
    //     "pushTime" : 82900,
    //     "enable" : false,
    //     "category" : "alarm",
    //     "type" : "ios", "source" : "DSF", "lang" : "ko",
    //     "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
    //         "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
    //     "geo" : [ 85.324, 27.717 ],
    //     "name" : "Kathmandu", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":540};

    // it('test request daily summary without town', function(done) {
    //     this.timeout(20*1000);
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo1, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary for air without town', function(done) {
    //     this.timeout(20*1000);
    //     pushInfo1.package = 'todayAir';
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo1, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary without geo', function(done) {
    //     this.timeout(20*1000);
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo2, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary for air', function(done) {
    //     this.timeout(20*1000);
    //     pushInfo2.package = 'todayAir';
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo2, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary without geo', function(done) {
    //     this.timeout(20*1000);
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo4, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary for air', function(done) {
    //     this.timeout(20*1000);
    //     pushInfo4.package = 'todayAir';
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo4, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary without geo', function(done) {
    //     this.timeout(20*1000);
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo5, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    // it('test request daily summary for air', function(done) {
    //     this.timeout(20*1000);
    //     pushInfo5.package = 'todayAir';
    //     var co = new ControllerPush();
    //     co.requestDailySummary(pushInfo5, function (err, result) {
    //         assert.equal(err, null, err);
    //         console.log(result);
    //         done();
    //     });
    // });

    it('test request daily summary without source', function(done) {
        this.timeout(20*1000);
        var pushInfo4 = { "id":3, "cityIndex" : 3,
            "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
            "pushTime" : 82900,
            "enable" : false,
            "category" : "alarm",
            "type" : "ios", "source" : "DSF", "lang" : "ko",
            "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
                "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm" },
            "geo" : [ -79.936, 40.461 ],
            "name" : "New York", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":540};
        pushInfo4.package = 'todayWeather';

        var co = new ControllerPush();
        co.requestDailySummary(pushInfo4, function (err, result) {
            assert.equal(err, null, err);
            console.log(result);
            done();
        });
    });

    it('test request daily summary without source', function(done) {
        this.timeout(20*1000);
        var pushInfo2 = { "id":2, "cityIndex" : 2,
            "registrationId" : "3c9b9e4f199b94bbf6a5253860c09a33f2dcabcdb097ec6d3f9a7ab44dba013f",
            "pushTime" : 82800,
            "enable" : true,
            "category" : "alarm",
            "type" : "ios", "lang" : "ko",
            "units" : { "temperatureUnit" : "C", "windSpeedUnit" : "m/s",
                "pressureUnit" : "hPa", "distanceUnit" : "km", "precipitationUnit" : "mm", "airForecastSource" : "kaq"},
            "geo" : [ 127.086, 37.503 ],
            "name" : "잠실본동", "dayOfWeek":[false, true, false, true, false, true, false], "timezoneOffset":-540};
        pushInfo2.package = 'todayWeather';

        var co = new ControllerPush();
        co.requestDailySummary(pushInfo2, function (err, result) {
            assert.equal(err, null, err);
            console.log(result);
            done();
        });
    });

    // before(function (done) {
    //     this.timeout(10*1000);
    //     mongoose.Promise = global.Promise;
    //     // let path = 'mongodb://alec:wzd0417@cluster0-shard-00-00-krcxi.mongodb.net:27017,cluster0-shard-00-01-krcxi.mongodb.net:27017,cluster0-shard-00-02-krcxi.mongodb.net:27017/todayweather?ssl=true&replicaSet=Cluster0-shard-0&authSource=admin';
    //     let path = 'mongodb://localhost/todayweather';
    //     mongoose.connect(path, function(err) {
    //         if (err) {
    //             console.error('Could not connect to MongoDB!');
    //         }
    //         done();
    //     });
    //     mongoose.connection.on('error', function(err) {
    //         if (err) {
    //             console.error('MongoDB connection error: ' + err);
    //             done();
    //         }
    //     });
    // });

    // it ('test remove RegistrationId Changed To Fcm', function (done) {
    //     this.timeout(60*1000);
    //     var ctrl = new ControllerPush();
    //     ctrl._removeDuplicates(function (err, results) {
    //         done();
    //     });
    // });

    // it ('test remove old list', function (done) {
    //     var ctrl = new ControllerPush();

    //     var pushList = [];
    //     pushList.push(pushInfo1);
    //     pushList.push(pushInfo2);
    //     pushList.push(pushInfo3);

    //     ctrl._getCurrentTime = function () {
    //         var current = new Date();
    //         current.setDate(current.getDate()-100);
    //         return current;
    //     };

    //     ctrl.sendNotification = function (pushInfo, callback) {
    //         callback(undefined, pushInfo);
    //     };

    //     ctrl.updatePushInfoList('ko', pushList, function (err, result) {
    //         if (err) {
    //             log.error(err);
    //         }
    //         assert.equal(err, undefined);

    //         ctrl.sendPush(pushInfo1.pushTime, function (err, result) {
    //             if (err)  {
    //                 log.error(err);
    //             }
    //             else {
    //                 log.info(result);
    //             }
    //             assert.equal(err, undefined);
    //             done();
    //         });
    //     });
    // });

    // it('test filter day of week', function() {
    //     var pushList = [];
    //     pushList.push(pushInfo1);
    //     pushList.push(pushInfo2);
    //     var date = new Date();
    //     console.log("day="+date.getDay());

    //     var co = new ControllerPush();
    //     var filteredList = co._filterByDayOfWeek(pushList, date);
    //     console.log(filteredList);
    // });

    // it('test get push info by time', function(done) {
    //     var co = new ControllerPush();
    //     co.getPushByTime(pushInfo3.pushTime, function (err, result) {
    //         if (err) {
    //             console.error(err);
    //         }
    //         assert.equal(result, undefined);
    //         done();
    //     });
    // });

    // it('test tw alarm fcm notification', function(done) {
    //     var co = new ControllerPush();
    //     var pushInfo = {
    //         fcmToken: "cvQm_aycwIE:APA91bE-ioed2OUOHbmHPBb-3L_CTvscdzs5JtJzPhKVxvnUF7Ydg0QZ0V0HfsxoiubJhAsvqIjL9QOodRzo9mrWua9eQUZXPVgy28msrBT7coa80kGIn0p-2mCgGDYHspXS9RcnwP27",
    //         cityIndex: 0,
    //         package: "todayWeather"
    //     };
    //     var notification = {
    //         title: 'tw alarm fcm test',
    //         text: 'tw alarm fcm send test'
    //     };
    //     co.sendAndroidNotification(pushInfo, notification, function(err, result){
    //         if (err) {
    //             console.error(err);
    //         }
    //         else {
    //             console.info(result);
    //         }
    //         done();
    //     });
    // });

    // it('test ta alarm fcm notification', function(done) {
    //     var co = new ControllerPush();
    //     var pushInfo = {
    //         fcmToken: "eiz96kEmVLk:APA91bGoM1W2g6UMrG5eE3rBrMrmNLx20Co6u6IAYyP39u0FX9sZAuWwZsShQ7ZB8M4s4XBLqKDvfTBoeLN9D2yVcQkefEfDClhHAtHKiLDmBZ8Z3IQ28O5XrfnKwZJXzsbT1Zgj2Kml",
    //         cityIndex: 0,
    //         package: "todayAir"
    //     };
    //     var notification = {
    //         title: 'ta alarm fcm test',
    //         text: 'ta alarm fcm send test'
    //     };
    //     co.sendAndroidNotification(pushInfo, notification, function(err, result){
    //         if (err) {
    //             console.error(err);
    //         }
    //         else {
    //             console.info(result);
    //         }
    //         done();
    //     });
    // });
});

