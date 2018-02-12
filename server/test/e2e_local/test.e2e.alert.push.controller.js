/**
 * Created by aleckim on 18. 2. 8..
 */

"use strict";

const Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

const assert  = require('assert');
const mongoose = require('mongoose');
const async = require('async');

var controllerManager = require('../../controllers/controllerManager');
global.manager = new controllerManager();

const AlertPushController = require('../../controllers/alert.push.controller');

describe('unit test - alert push controller', function() {

    before(function (done) {
        this.timeout(10*1000);
        mongoose.Promise = global.Promise;
        mongoose.connect('mongodb://localhost/todayweather', function(err) {
            if (err) {
                console.error('Could not connect to MongoDB!');
            }
            done();
        });
        mongoose.connection.on('error', function(err) {
            if (err) {
                console.error('MongoDB connection error: ' + err);
                done();
            }
        });
    });

    var pushInfo1 = {
        registrationId: 'push1',
        startTime: 79200,    //7H to utc 22h
        endTime: 32400,      //18H to utc 9h
        cityIndex: 0,
        type: 'ios',
        town: {first: '서울특별시', second: '송파구', third: '잠실본동'},
        geo: [127.0864194, 37.5033556],
        lang: 'ko',
        name: 'jamsil',
        source: 'KMA',
        units: {
            temperatureUnit: "C",
            windSpeedUnit: "m/s",
            pressureUnit: "hPa",
            distanceUnit: "km",
            precipitationUnit: "mm",
            airUnit: "airkorea"
        },
        dayOfWeeks: [1,5],
        timezoneOffset: 540,
        airAlertsBreakPoint: 2
    };

    var pushInfo2 = {
        registrationId: 'push2',
        startTime: 3600,     //10H to utc 1H
        endTime: 46800,      //22H to utc 13H
        cityIndex: 1,
        type: 'ios',
        town: {first: '', second: '', third: ''},
        geo: [139.6917064, 35.6894875],
        lang: 'en',
        name: 'Tokyo',
        source: 'DSF',
        units: {
            temperatureUnit: "F",
            windSpeedUnit: "mph",
            pressureUnit: "mbar",
            distanceUnit: "miles",
            precipitationUnit: "inch"
        },
        dayOfWeeks: [1,2,3,4,5],
        timezoneOffset: 540,
        airAlertsBreakPoint: 2
    };

    let ctrlAlertPush = new AlertPushController();

    it('test remove push1', function (done) {
        ctrlAlertPush.removeAlertPush(pushInfo1, ()=> {
            done();
        });
    });

    it('test remove push2', function (done) {
        ctrlAlertPush.removeAlertPush(pushInfo2, ()=> {
            done();
        });
    });

    it('test update1', function (done) {
        ctrlAlertPush.updateAlertPush(pushInfo1, (err, result)=> {
            if (err) {
                console.error(err);
            }
            console.log(result);
            done();
        });
    });

    it('test update2', function (done) {
        ctrlAlertPush.updateAlertPush(pushInfo2, (err, result)=> {
            if (err) {
                console.error(err);
            }
            console.log(result);
            done();
        });
    });

    it('test get alert push by time', function (done) {
        this.timeout(10*1000);
        let timeList = [];
        (() => {
           for (let i=0; i<=24; i++)  {
               timeList.push(i);
           }
        })();

        console.log('getAlertPushByTime');
        async.mapSeries(timeList,
            function (time, callback) {
                time *= 3600;
                ctrlAlertPush._getAlertPushByTime(time, (err, results) => {
                    if (err) {
                        console.error(err);
                    }
                    results.forEach((result)=> {
                        console.log({current:time/3600, startTime:result.startTime/3600, endTime: result.endTime/3600, reverseTime: result.reverseTime});
                    });
                   callback(null, results) ;
                });
            },
            function () {
                done();
            });
    });

    it('test init alert push list', function (done) {
        this.timeout(10*1000);
        ctrlAlertPush.sendAlertPushList(4*3600+45*60, function () {
           done();
        });
    });

    it('test send alert push list', function (done) {
        ctrlAlertPush._sendNotification = function (pushInfo, notification, callback) {
            console.info(notification);
            callback();
        };

        this.timeout(10*1000);
        ctrlAlertPush.sendAlertPushList(23*3600, function () {
            done();
        });
    });

    it('test send alert push list', function (done) {
        ctrlAlertPush._sendNotification = function (pushInfo, notification, callback) {
            console.info(notification);
            callback();
        };

        this.timeout(10*1000);
        ctrlAlertPush.sendAlertPushList(11*3600, function () {
            done();
        });
    });

    it('test send alert push list', function (done) {
        ctrlAlertPush._sendNotification = function (pushInfo, notification, callback) {
            console.info(notification);
            callback();
        };

        this.timeout(10*1000);
        ctrlAlertPush.sendAlertPushList(23*3600+46*60, function () {
           done();
        });
    });

    it('test send alert push list', function (done) {
        ctrlAlertPush._sendNotification = function (pushInfo, notification, callback) {
            console.info(notification);
            callback();
        };

        this.timeout(10*1000);
        ctrlAlertPush.sendAlertPushList(11*3600+46*60, function () {
            done();
        });
    });
});

