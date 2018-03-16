/**
 * Created by aleckim on 18. 2. 8..
 */

"use strict";

var assert  = require('assert');

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

const AlertPushController = require('../controllers/alert.push.controller');

describe('unit test - alert push controller', function() {
    let pushInfo1 = {
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
        dayOfWeek: [false, true, false, false, false, true, false],
        timezoneOffset: 540,
        airAlertsBreakPoint: 2
    };

    let pushInfo2 = {
        registrationId: 'push2',
        startTime: 3600,     //10H to utc 1H
        endTime: 46800,      //22H to utc 13H
        cityIndex: 1,
        type: 'ios',
        town: {first: '', second: '', third: ''},
        geo: [139.6917064, 35.6894875],
        lang: 'ko',
        name: 'Tokyo',
        source: 'DSF',
        units: {
            temperatureUnit: "F",
            windSpeedUnit: "mph",
            pressureUnit: "mbar",
            distanceUnit: "miles",
            precipitationUnit: "inch"
        },
        dayOfWeek: [false, true, true, true, true, true, false],
        timezoneOffset: 540,
        airAlertsBreakPoint: 2
    };

    let dataList = [];

    let pushInfoList = [];
    pushInfoList.push(pushInfo1);

    dataList = [];

    dataList.push({});

    dataList.push({source:"KMA"});

    dataList.push({
        source:"KMA",
        current:{},
    });

    dataList.push({
        source:"KMA",
        current:{
            dateObj: "2018.02.09 14:19"
        }
    });

    pushInfoList.forEach(function (pushInfo) {
        dataList.forEach(function (data) {
            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};

                let ctrlAlertPush = new AlertPushController();
                let infoObj;
                let send;
                let notification;
                try {
                    infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                    send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                    ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                    notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);
                }
                catch (err) {
                    console.log(err);
                }
                console.log({infoObj: JSON.stringify(infoObj)});
                console.log({send: send});
                console.log({updatedPushInfo: JSON.stringify(pushInfo)});
                console.log({notification: notification});
            });
        });
    });

    dataList = [];

    dataList.push({
        source: "KMA",
        current: {
            pty: 1,
            dateObj: "2018.02.09 14:19"
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 2,
            dateObj: "2018.02.09 14:19"
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 3,
            dateObj: "2018.02.09 14:19"
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 1,
            weather: "비",
            dateObj: "2018.02.09 14:19"
        },
        airInfo: {
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 1,
            weather: "비",
            dateObj: "2018.02.09 14:19"
        },
        airInfo: {
            last: {}
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 1,
            weather: "비",
            dateObj: "2018.02.09 14:19"
        },
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 1,
            weather: "비",
            dateObj: "2018.02.09 14:19"
        },
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 4,
                pm25Grade: 3,
                pm10Str: "나쁨",
                pm25Str: "민감군주의",
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 0,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 4,
                pm25Grade: 3,
                pm10Str: "나쁨",
                pm25Str: "민감군주의",
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 4,
                pm25Grade: 3,
                pm10Str: "나쁨",
                pm25Str: "민감군주의",
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {}
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {}
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: []
                }
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{}]
                }
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{
                        date: "2018-02-09 15:00"
                    }]
                }
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{
                        date: "2018-02-09 15:00",
                        grade: 4
                    }]
                }
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 1,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{
                        date: "2018-02-09 15:00",
                        grade: 4,
                        str: "나쁨"
                    }]
                }
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [
            {
                pty: 1,
                dateObj: "2018.02.09 15:00"
            },
            {
                pty: 0,
                dateObj: "2018.02.09 16:00"
            }
        ],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{
                        date: "2018-02-09 15:00",
                        grade: 4,
                        str: "나쁨"
                    }]
                }
            }
        }
    });

    dataList.push({
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [
            {
                pty: 1,
                dateObj: "2018.02.09 15:00"
            },
            {
                pty: 1,
                dateObj: "2018.02.09 16:00"
            }
        ],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{
                        date: "2018-02-09 15:00",
                        grade: 4,
                        str: "나쁨"
                    }]
                }
            }
        }
    });

    pushInfoList.forEach(function (pushInfo) {
        dataList.forEach(function (data) {

            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};

                let ctrlAlertPush = new AlertPushController();
                ctrlAlertPush.time = 10 * 60 * 60 + 15 * 60;
                let infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                let send;
                let notification;
                send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);

                console.log(JSON.stringify({infoObj: infoObj}));
                console.log({send: send});
                console.log(JSON.stringify({pushInfo: pushInfo}));
                console.log({notification: notification});
            });

            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};

                let ctrlAlertPush = new AlertPushController();
                ctrlAlertPush.time = 10 * 60 * 60 + 45 * 60;
                let infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                let send;
                let notification;
                send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);

                console.log(JSON.stringify({infoObj: infoObj}));
                console.log({send: send});
                console.log(JSON.stringify({pushInfo: pushInfo}));
                console.log({notification: notification});
            });
        });
    });

    dataList = [];
    dataList.push({});

    dataList.push({source:"DSF"});

    dataList.push({
        source:"DSF",
        thisTime:[],
    });

    dataList.push({
        source:"KMA",
        thisTime:[
            {}, {}]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {dateObj: "2018.02.09 14:19"}]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:1, dateObj: "2018.02.09 14:19"}]
    });

    pushInfoList = [];
    pushInfoList.push(pushInfo2);

    pushInfoList.forEach(function (pushInfo) {
        dataList.forEach(function (data) {

            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};
                let ctrlAlertPush = new AlertPushController();
                let infoObj;
                let send;
                let notification;
                try {
                    infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                    send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                    ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                    notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);
                }
                catch (err) {
                    console.log(err);
                }
                console.log({infoObj: JSON.stringify(infoObj)});
                console.log({send: send});
                console.log({updatedPushInfo: JSON.stringify(pushInfo)});
                console.log({notification: notification});
            });
        });
    });

    dataList = [];

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: []
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: []
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{}]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00"
        }]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:0
        }]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }]
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{}
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{
            last:{}
        }
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{
            last:{
                dataTime: "2018-02-09 14:00",
            }
        }
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{
            last:{
                dataTime: "2018-02-09 14:00",
                pm25Grade: 1,
                pm10Grade: 3
            }
        }
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{
            last:{
                dataTime: "2018-02-09 14:00",
                pm25Grade: 3,
                pm10Grade: 3
            }
        }
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{
            last:{
                dataTime: "2018-02-09 14:00",
                pm25Grade: 4,
                pm10Grade: 1
            }
        }
    });

    dataList.push({
        source:"DSF",
        thisTime:[
            {},
            {pty:0, dateObj: "2018.02.09 14:19"}],
        hourly: [{
            dateObj: "2018.02.09 15:00",
            pyt:1
        }],
        airInfo:{
            last:{
                dataTime: "2018-02-09 14:00",
                pm25Grade: 4,
                pm10Grade: 1,
                pm25Str: "unhealth"
            }
        }
    });

    pushInfoList.forEach(function (pushInfo) {
        dataList.forEach(function (data) {

            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};
                console.log('\n');
                let ctrlAlertPush = new AlertPushController();
                ctrlAlertPush.time = 10 * 60 * 60 + 45 * 60;
                let infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                let send;
                let notification;
                send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);

                console.log(JSON.stringify({infoObj: infoObj}));
                console.log({send: send});
                console.log(JSON.stringify({pushInfo: pushInfo}));
                console.log({notification: notification});
            });
        });
    });

    dataList = [];

    let data = {
        source: "KMA",
        current: {
            pty: 0,
            weather: "맑음",
            dateObj: "2018.02.09 14:19"
        },
        shortestPubDate: "201802091530",
        shortest: [{
            pty: 0,
            dateObj: "2018.02.09 15:00"
        }],
        airInfo: {
            last: {
                dataTime: "2018-02-09 14:00",
                pm10Grade: 1,
                pm10Str: "좋음",
            },
            pollutants: {
                pm25: {
                    hourly: [{
                        date: "2018-02-09 15:00",
                        grade: 1,
                        str: "좋음"
                    }]
                }
            }
        }
    };


    let temp = JSON.parse(JSON.stringify(data));
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.current.pty = 1;
    temp.current.weather = '비';
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.shortest[0].pty = 1;
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.airInfo.last.pm10Grade = 4;
    temp.airInfo.last.pm10Str = '나쁨';
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.airInfo.pollutants.pm25.hourly[0].grade = 4;
    temp.airInfo.pollutants.pm25.hourly[0].str = '니쁨';
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.current.pty = 1;
    temp.current.weather = '비';
    temp.airInfo.last.pm10Grade = 4;
    temp.airInfo.last.pm10Str = '나쁨';
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.shortest[0].pty = 1;
    temp.airInfo.last.pm10Grade = 4;
    temp.airInfo.last.pm10Str = '나쁨';
    dataList.push(temp);

    temp = JSON.parse(JSON.stringify(data));
    temp.shortest[0].pty = 1;
    temp.airInfo.pollutants.pm25.hourly[0].grade = 4;
    temp.airInfo.pollutants.pm25.hourly[0].str = '니쁨';
    dataList.push(temp);

    pushInfoList = [];
    pushInfoList.push(pushInfo1);

    pushInfoList.forEach(function (pushInfo) {
        dataList.forEach(function (data) {

            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};

                let ctrlAlertPush = new AlertPushController();
                ctrlAlertPush.time = 10 * 60 * 60 + 45 * 60;
                let infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                let send;
                let notification;
                send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);

                console.log(JSON.stringify({infoObj: infoObj}));
                console.log({send: send});
                console.log(JSON.stringify({pushInfo: pushInfo}));
                console.log({notification: notification});
            });
        });
    });

    ['en', 'ja', 'zh-CN', 'de', 'zh-TW'].forEach(function (lang) {
        let temp = JSON.parse(JSON.stringify(pushInfo1));
        temp.lang = lang;
        pushInfoList.push(temp);
    });

    pushInfoList.forEach(function (pushInfo) {
        dataList.forEach(function (data) {

            it('test '+JSON.stringify({push:pushInfo, data:data}), function () {
                pushInfo.precipAlerts = {lastState: 0};

                let ctrlAlertPush = new AlertPushController();
                ctrlAlertPush.time = 10 * 60 * 60 + 45 * 60;
                let infoObj = ctrlAlertPush._parseWeatherAirData(pushInfo, data);
                let send;
                let notification;
                send = ctrlAlertPush._compareWithLastInfo(pushInfo, infoObj);
                ctrlAlertPush._updateAlertPush(pushInfo, infoObj, send);
                notification = ctrlAlertPush._convertToNotification(pushInfo, infoObj);

                console.log(JSON.stringify({infoObj: infoObj}));
                console.log({send: send});
                console.log(JSON.stringify({pushInfo: pushInfo}));
                console.log({notification: notification});
            });
        });
    });


    it ('test data current is undefined', function() {
        let data = {"timezone":{"min":180,"ms":10800000,"timezoneId":"Europe/Istanbul"},"location":{"lat":"41.008","lon":"28.978"},"pubDate":{"DSF":"2018-03-14T22:00:00.000Z"},"daily":[{"date":"20180314","desc":"Partly cloudy overnight.","sunrise":"2018.03.14 07:18","sunset":"2018.03.14 19:10","tempMax_c":16.3,"tempMax_f":61.4,"tempMin_c":11,"tempMin_f":51.8,"ftempMax_c":16.3,"ftempMax_f":61.4,"ftempMin_c":11,"ftempMin_f":51.8,"cloud":22,"precType":1,"precProb":53,"precip":2.07,"humid":74,"windSpd_mh":8.9,"windSpd_ms":3.98,"windDir":225,"press":1008.62,"vis":10.01,"skyIcon":"sun_smallcloud_rain","fromToday":-1,"dayOfWeek":3,"tmx":16.3,"tmn":11,"pty":1,"pop":53,"skyPm":"sun_smallcloud_rain","skyAm":"sun_smallcloud_rain","reh":74,"humidityIcon":"humidity_70","rn1":2.1,"wsd":3.98,"hPa":1008.62,"visibility":10.01,"wdd":"SW","dateObj":"2018.03.14 00:00"},{"date":"20180315","desc":"Partly cloudy throughout the day.","sunrise":"2018.03.15 07:17","sunset":"2018.03.15 19:11","tempMax_c":16,"tempMax_f":60.8,"tempMin_c":9,"tempMin_f":48.3,"ftempMax_c":16,"ftempMax_f":60.8,"ftempMin_c":6.9,"ftempMin_f":44.4,"cloud":48,"precType":0,"precProb":21,"precip":0.73,"humid":75,"windSpd_mh":6.7,"windSpd_ms":3,"windDir":224,"press":1011.05,"skyIcon":"sun_smallcloud","fromToday":0,"dayOfWeek":4,"tmx":16,"tmn":9,"pty":0,"pop":21,"skyPm":"sun_smallcloud","skyAm":"sun_smallcloud","reh":75,"humidityIcon":"humidity_70","rn1":0.7,"wsd":3,"hPa":1011.05,"dateObj":"2018.03.15 00:00"},{"date":"20180316","desc":"Mostly cloudy starting in the evening.","sunrise":"2018.03.16 07:15","sunset":"2018.03.16 19:12","tempMax_c":16.8,"tempMax_f":62.2,"tempMin_c":7.9,"tempMin_f":46.2,"ftempMax_c":16.8,"ftempMax_f":62.2,"ftempMin_c":5.7,"ftempMin_f":42.2,"cloud":20,"precType":0,"humid":73,"windSpd_mh":7.17,"windSpd_ms":3.21,"windDir":202,"press":1014.57,"skyIcon":"sun","fromToday":1,"dayOfWeek":5,"tmx":16.8,"tmn":7.9,"pty":0,"pop":0,"skyPm":"sun","skyAm":"sun","reh":73,"humidityIcon":"humidity_70","wsd":3.21,"hPa":1014.57,"dateObj":"2018.03.16 00:00"},{"date":"20180317","desc":"Mostly cloudy throughout the day and breezy starting in the afternoon.","sunrise":"2018.03.17 07:13","sunset":"2018.03.17 19:13","tempMax_c":21.3,"tempMax_f":70.3,"tempMin_c":8.1,"tempMin_f":46.6,"ftempMax_c":21.3,"ftempMax_f":70.3,"ftempMin_c":6,"ftempMin_f":42.8,"cloud":92,"precType":0,"humid":58,"windSpd_mh":12.72,"windSpd_ms":5.69,"windDir":202,"press":1009.21,"skyIcon":"cloud","fromToday":2,"dayOfWeek":6,"tmx":21.3,"tmn":8.1,"pty":0,"pop":0,"skyPm":"cloud","skyAm":"cloud","reh":58,"humidityIcon":"humidity_50","wsd":5.69,"hPa":1009.21,"dateObj":"2018.03.17 00:00"},{"date":"20180318","desc":"Breezy in the morning and rain in the morning and overnight.","sunrise":"2018.03.18 07:12","sunset":"2018.03.18 19:14","tempMax_c":16.8,"tempMax_f":62.2,"tempMin_c":11.4,"tempMin_f":52.5,"ftempMax_c":16.8,"ftempMax_f":62.2,"ftempMin_c":11.4,"ftempMin_f":52.5,"cloud":67,"precType":1,"precProb":77,"precip":11.52,"humid":68,"windSpd_mh":13.84,"windSpd_ms":6.19,"windDir":228,"press":1001.99,"skyIcon":"sun_bigcloud_rain","fromToday":3,"dayOfWeek":0,"tmx":16.8,"tmn":11.4,"pty":1,"pop":77,"skyPm":"sun_bigcloud_rain","skyAm":"sun_bigcloud_rain","reh":68,"humidityIcon":"humidity_60","r06":11.5,"wsd":6.19,"hPa":1001.99,"dateObj":"2018.03.18 00:00"},{"date":"20180319","desc":"Mostly cloudy throughout the day.","sunrise":"2018.03.19 07:10","sunset":"2018.03.19 19:15","tempMax_c":15.6,"tempMax_f":60.1,"tempMin_c":6.3,"tempMin_f":43.4,"ftempMax_c":15.6,"ftempMax_f":60.1,"ftempMin_c":3.3,"ftempMin_f":37.9,"cloud":69,"precType":1,"precProb":66,"precip":5.12,"humid":78,"windSpd_mh":1.69,"windSpd_ms":0.76,"windDir":252,"press":1010.76,"skyIcon":"sun_bigcloud_rain","fromToday":4,"dayOfWeek":1,"tmx":15.6,"tmn":6.3,"pty":1,"pop":66,"skyPm":"sun_bigcloud_rain","skyAm":"sun_bigcloud_rain","reh":78,"humidityIcon":"humidity_70","r06":5.1,"wsd":0.76,"hPa":1010.76,"dateObj":"2018.03.19 00:00"},{"date":"20180320","desc":"Mostly cloudy throughout the day and breezy in the afternoon.","sunrise":"2018.03.20 07:08","sunset":"2018.03.20 19:16","tempMax_c":17,"tempMax_f":62.6,"tempMin_c":9.7,"tempMin_f":49.5,"ftempMax_c":17,"ftempMax_f":62.6,"ftempMin_c":7,"ftempMin_f":44.6,"cloud":78,"precType":0,"precProb":37,"precip":3.23,"humid":77,"windSpd_mh":10.77,"windSpd_ms":4.81,"windDir":196,"press":1008.57,"skyIcon":"sun_bigcloud","fromToday":5,"dayOfWeek":2,"tmx":17,"tmn":9.7,"pty":0,"pop":37,"skyPm":"sun_bigcloud","skyAm":"sun_bigcloud","reh":77,"humidityIcon":"humidity_70","wsd":4.81,"hPa":1008.57,"dateObj":"2018.03.20 00:00"},{"date":"20180321","desc":"Mostly cloudy throughout the day and breezy in the afternoon.","sunrise":"2018.03.21 07:07","sunset":"2018.03.21 19:17","tempMax_c":13.5,"tempMax_f":56.3,"tempMin_c":6.8,"tempMin_f":44.2,"ftempMax_c":13.5,"ftempMax_f":56.3,"ftempMin_c":3,"ftempMin_f":37.5,"cloud":43,"precType":0,"precProb":31,"precip":2.68,"humid":79,"windSpd_mh":3.52,"windSpd_ms":1.57,"windDir":33,"press":1012.54,"skyIcon":"sun_smallcloud","fromToday":6,"dayOfWeek":3,"tmx":13.5,"tmn":6.8,"pty":0,"pop":31,"skyPm":"sun_smallcloud","skyAm":"sun_smallcloud","reh":79,"humidityIcon":"humidity_70","wsd":1.57,"hPa":1012.54,"dateObj":"2018.03.21 00:00"},{"date":"20180322","desc":"Mostly cloudy throughout the day and breezy until afternoon.","sunrise":"2018.03.22 07:05","sunset":"2018.03.22 19:18","tempMax_c":16.8,"tempMax_f":62.2,"tempMin_c":6.8,"tempMin_f":44.3,"ftempMax_c":16.8,"ftempMax_f":62.2,"ftempMin_c":3.2,"ftempMin_f":37.7,"cloud":80,"precType":1,"precProb":53,"precip":4.88,"humid":77,"windSpd_mh":9.43,"windSpd_ms":4.22,"windDir":176,"press":1002.66,"skyIcon":"sun_bigcloud_rain","fromToday":7,"dayOfWeek":4,"tmx":16.8,"tmn":6.8,"pty":1,"pop":53,"skyPm":"sun_bigcloud_rain","skyAm":"sun_bigcloud_rain","reh":77,"humidityIcon":"humidity_70","r06":4.9,"wsd":4.22,"hPa":1002.66,"dateObj":"2018.03.22 00:00"}],"thisTime":[{"date":"20180314","desc":"맑음","weatherType":0,"temp_c":11.3,"temp_f":52.3,"ftemp_c":11.3,"ftemp_f":52.3,"cloud":23,"windSpd_mh":5.07,"windSpd_ms":2.27,"windDir":202,"humid":84,"precType":0,"precProb":17,"precip":0.3,"vis":10,"press":1008.19,"oz":364.14,"time":0,"weather":"맑음","pty":0,"t1h":11.3,"sensorytem":11.3,"reh":84,"humidityIcon":"humidity_80","rn1":0.3,"wsd":2.27,"hPa":1008.19,"visibility":10,"stnDateTime":"2018.03.14 00:00","dateObj":"2018.03.14 00:00","arpltn":{}},{"date":"20180315","desc":"구름적음","weatherType":1,"temp_c":10.3,"temp_f":50.5,"ftemp_c":10.3,"ftemp_f":50.5,"cloud":32,"windSpd_mh":8.55,"windSpd_ms":3.82,"windDir":212,"humid":84,"precType":0,"vis":10,"press":1010.32,"oz":389.18,"skyIcon":"sun_smallcloud","time":1,"weather":"구름적음","pty":0,"t1h":10.3,"sensorytem":10.3,"reh":84,"humidityIcon":"humidity_80","wsd":3.82,"hPa":1010.32,"visibility":10,"stnDateTime":"2018.03.15 01:00","dateObj":"2018.03.15 01:00","arpltn":{},"todayIndex":1,"summaryWeather":"어제보다 -1˚, 구름적음","summaryAir":"","summary":"어제보다 -1˚, 구름적음"},{"date":"20180315","desc":"구름적음","weatherType":1,"temp_c":10.3,"temp_f":50.5,"ftemp_c":10.3,"ftemp_f":50.5,"cloud":32,"windSpd_mh":8.55,"windSpd_ms":3.82,"windDir":212,"humid":84,"precType":0,"vis":10,"press":1010.32,"oz":389.18,"skyIcon":"sun_smallcloud","time":1,"weather":"구름적음","pty":0,"t1h":10.3,"sensorytem":10.3,"reh":84,"humidityIcon":"humidity_80","wsd":3.82,"hPa":1010.32,"visibility":10,"stnDateTime":"2018.03.15 01:00","dateObj":"2018.03.15 01:00","arpltn":{}}],"hourly":[{"date":"20180314","temp_c":11.3,"temp_f":52.3,"ftemp_c":11.3,"ftemp_f":52.3,"cloud":23,"windSpd_mh":5.07,"windSpd_ms":2.27,"windDir":202,"humid":84,"precType":0,"precProb":17,"precip":0.28,"vis":10.01,"press":1008.19,"oz":364.14,"desc":"맑음","weatherType":0,"skyIcon":"moon_smallcloud","fromToday":-1,"t3h":11.3,"sensorytem":11.3,"pty":0,"pop":17,"wsd":2.27,"reh":84,"humidityIcon":"humidity_80","rn1":0.3,"hPa":1008.19,"visibility":10.01,"dateObj":"2018.03.14 00:00","time":0},{"date":"20180314","temp_c":11.5,"temp_f":52.7,"ftemp_c":11.5,"ftemp_f":52.7,"cloud":18,"windSpd_mh":6.64,"windSpd_ms":2.97,"windDir":211,"humid":77,"precType":0,"precProb":18,"precip":1.01,"vis":10.01,"press":1008.11,"oz":367.13,"desc":"맑음","weatherType":0,"skyIcon":"moon","fromToday":-1,"t3h":11.5,"sensorytem":11.5,"pty":0,"pop":18,"wsd":2.97,"reh":77,"humidityIcon":"humidity_70","rn1":1,"hPa":1008.11,"visibility":10.01,"dateObj":"2018.03.14 03:00","time":3},{"date":"20180314","temp_c":11,"temp_f":51.8,"ftemp_c":11,"ftemp_f":51.8,"cloud":34,"windSpd_mh":8.98,"windSpd_ms":4.01,"windDir":236,"humid":82,"precType":0,"precProb":14,"precip":0.57,"vis":10.01,"press":1008.01,"oz":369.56,"desc":"구름적음","weatherType":1,"skyIcon":"moon_smallcloud","fromToday":-1,"t3h":11,"sensorytem":11,"pty":0,"pop":14,"wsd":4.01,"reh":82,"humidityIcon":"humidity_80","rn1":0.6,"hPa":1008.01,"visibility":10.01,"dateObj":"2018.03.14 06:00","time":6},{"date":"20180314","temp_c":12.9,"temp_f":55.3,"ftemp_c":12.9,"ftemp_f":55.3,"cloud":27,"windSpd_mh":8.42,"windSpd_ms":3.76,"windDir":238,"humid":75,"precType":0,"precProb":6,"precip":0.17,"vis":10.01,"press":1008.88,"oz":374.06,"desc":"맑음","weatherType":0,"skyIcon":"sun_smallcloud","fromToday":-1,"t3h":12.9,"sensorytem":12.9,"pty":0,"pop":6,"wsd":3.76,"reh":75,"humidityIcon":"humidity_70","rn1":0.2,"hPa":1008.88,"visibility":10.01,"dateObj":"2018.03.14 09:00","time":9},{"date":"20180314","temp_c":14,"temp_f":57.2,"ftemp_c":14,"ftemp_f":57.2,"cloud":15,"windSpd_mh":11.72,"windSpd_ms":5.24,"windDir":233,"humid":70,"precType":0,"precProb":3,"precip":0.02,"vis":10.01,"press":1009.04,"oz":380.43,"desc":"맑음","weatherType":0,"skyIcon":"sun","fromToday":-1,"t3h":14,"sensorytem":14,"pty":0,"pop":3,"wsd":5.24,"reh":70,"humidityIcon":"humidity_70","rn1":0,"hPa":1009.04,"visibility":10.01,"dateObj":"2018.03.14 12:00","time":12},{"date":"20180314","temp_c":16.3,"temp_f":61.4,"ftemp_c":16.3,"ftemp_f":61.4,"cloud":23,"windSpd_mh":11.49,"windSpd_ms":5.14,"windDir":240,"humid":60,"precType":0,"precProb":2,"precip":0,"vis":10.01,"press":1008.18,"oz":385.15,"desc":"맑음","weatherType":0,"skyIcon":"sun_smallcloud","fromToday":-1,"t3h":16.3,"sensorytem":16.3,"pty":0,"pop":2,"wsd":5.14,"reh":60,"humidityIcon":"humidity_60","rn1":0,"hPa":1008.18,"visibility":10.01,"dateObj":"2018.03.14 15:00","time":15},{"date":"20180314","temp_c":15,"temp_f":59.1,"ftemp_c":15,"ftemp_f":59.1,"cloud":19,"windSpd_mh":11.69,"windSpd_ms":5.23,"windDir":194,"humid":64,"precType":0,"precProb":3,"precip":0.01,"vis":10.01,"press":1008.24,"oz":386.61,"desc":"맑음","weatherType":0,"skyIcon":"sun","fromToday":-1,"t3h":15,"sensorytem":15,"pty":0,"pop":3,"wsd":5.23,"reh":64,"humidityIcon":"humidity_60","rn1":0,"hPa":1008.24,"visibility":10.01,"dateObj":"2018.03.14 18:00","time":18},{"date":"20180314","temp_c":12,"temp_f":53.7,"ftemp_c":12,"ftemp_f":53.7,"cloud":15,"windSpd_mh":8.93,"windSpd_ms":3.99,"windDir":233,"humid":75,"precType":0,"precProb":3,"precip":0,"vis":10.01,"press":1009.52,"oz":385.88,"desc":"맑음","weatherType":0,"skyIcon":"moon","fromToday":-1,"t3h":12,"sensorytem":12,"pty":0,"pop":3,"wsd":3.99,"reh":75,"humidityIcon":"humidity_70","rn1":0,"hPa":1009.52,"visibility":10.01,"dateObj":"2018.03.14 21:00","time":21},{"date":"20180315","temp_c":10.8,"temp_f":51.5,"ftemp_c":10.8,"ftemp_f":51.5,"cloud":24,"windSpd_mh":8.68,"windSpd_ms":3.88,"windDir":202,"humid":81,"precType":0,"precProb":0,"precip":0,"vis":10.01,"press":1010.25,"oz":387.55,"desc":"구름적음","weatherType":1,"skyIcon":"moon_smallcloud","fromToday":0,"currentIndex":true,"t3h":10.8,"sensorytem":10.8,"pty":0,"pop":0,"wsd":3.88,"reh":81,"humidityIcon":"humidity_80","rn1":0,"hPa":1010.25,"visibility":10.01,"dateObj":"2018.03.15 00:00","time":0},{"date":"20180315","temp_c":9.3,"temp_f":48.8,"ftemp_c":7.1,"ftemp_f":44.8,"cloud":43,"windSpd_mh":9.19,"windSpd_ms":4.11,"windDir":222,"humid":91,"precType":0,"precProb":0,"precip":0,"vis":10.01,"press":1010.26,"oz":389.5,"desc":"구름적음","weatherType":1,"skyIcon":"moon_smallcloud","fromToday":0,"t3h":9.3,"sensorytem":7.1,"pty":0,"pop":0,"wsd":4.11,"reh":91,"humidityIcon":"humidity_90","hPa":1010.26,"visibility":10.01,"dateObj":"2018.03.15 03:00","time":3},{"date":"20180315","temp_c":9.2,"temp_f":48.5,"ftemp_c":7.1,"ftemp_f":44.8,"cloud":85,"windSpd_mh":8.5,"windSpd_ms":3.8,"windDir":217,"humid":90,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1010.02,"oz":389.95,"desc":"흐림","weatherType":3,"skyIcon":"cloud","fromToday":0,"t3h":9.2,"sensorytem":7.1,"pty":0,"pop":0,"wsd":3.8,"reh":90,"humidityIcon":"humidity_90","hPa":1010.02,"visibility":-1.61,"dateObj":"2018.03.15 06:00","time":6},{"date":"20180315","temp_c":11.1,"temp_f":52,"ftemp_c":11.1,"ftemp_f":52,"cloud":81,"windSpd_mh":9.39,"windSpd_ms":4.2,"windDir":210,"humid":80,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1010.77,"oz":393.4,"desc":"구름많음","weatherType":2,"skyIcon":"cloud","fromToday":0,"t3h":11.1,"sensorytem":11.1,"pty":0,"pop":0,"wsd":4.2,"reh":80,"humidityIcon":"humidity_80","hPa":1010.77,"visibility":-1.61,"dateObj":"2018.03.15 09:00","time":9},{"date":"20180315","temp_c":14.8,"temp_f":58.7,"ftemp_c":14.8,"ftemp_f":58.7,"cloud":21,"windSpd_mh":10.45,"windSpd_ms":4.67,"windDir":221,"humid":61,"precType":0,"precProb":1,"precip":0.01,"vis":-1.61,"press":1011.13,"oz":396.87,"desc":"맑음","weatherType":0,"skyIcon":"sun_smallcloud","fromToday":0,"t3h":14.8,"sensorytem":14.8,"pty":0,"pop":1,"wsd":4.67,"reh":61,"humidityIcon":"humidity_60","hPa":1011.13,"visibility":-1.61,"dateObj":"2018.03.15 12:00","time":12},{"date":"20180315","temp_c":15.8,"temp_f":60.4,"ftemp_c":15.8,"ftemp_f":60.4,"cloud":17,"windSpd_mh":9.66,"windSpd_ms":4.32,"windDir":240,"humid":54,"precType":0,"precProb":18,"precip":0.42,"vis":-1.61,"press":1010.63,"oz":397.35,"desc":"구름적음","weatherType":1,"skyIcon":"sun","fromToday":0,"t3h":15.8,"sensorytem":15.8,"pty":0,"pop":18,"wsd":4.32,"reh":54,"humidityIcon":"humidity_50","hPa":1010.63,"visibility":-1.61,"dateObj":"2018.03.15 15:00","time":15},{"date":"20180315","temp_c":13.5,"temp_f":56.4,"ftemp_c":13.5,"ftemp_f":56.4,"cloud":47,"windSpd_mh":6.05,"windSpd_ms":2.7,"windDir":275,"humid":65,"precType":0,"precProb":16,"precip":0.29,"vis":-1.61,"press":1011.09,"oz":397.83,"desc":"구름적음","weatherType":1,"skyIcon":"sun_smallcloud","fromToday":0,"t3h":13.5,"sensorytem":13.5,"pty":0,"pop":16,"wsd":2.7,"reh":65,"humidityIcon":"humidity_60","hPa":1011.09,"visibility":-1.61,"dateObj":"2018.03.15 18:00","time":18},{"date":"20180315","temp_c":11,"temp_f":51.9,"ftemp_c":11,"ftemp_f":51.9,"cloud":53,"windSpd_mh":2.23,"windSpd_ms":1,"windDir":320,"humid":77,"precType":0,"precProb":5,"precip":0.01,"vis":-1.61,"press":1013.03,"oz":397.5,"desc":"구름적음","weatherType":1,"skyIcon":"moon_bigcloud","fromToday":0,"t3h":11,"sensorytem":11,"pty":0,"pop":5,"wsd":1,"reh":77,"humidityIcon":"humidity_70","hPa":1013.03,"visibility":-1.61,"dateObj":"2018.03.15 21:00","time":21},{"date":"20180316","temp_c":9.2,"temp_f":48.6,"ftemp_c":8.8,"ftemp_f":47.9,"cloud":32,"windSpd_mh":3.2,"windSpd_ms":1.43,"windDir":241,"humid":83,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1014.01,"oz":396.81,"desc":"맑음","weatherType":0,"skyIcon":"moon_smallcloud","fromToday":1,"t3h":9.2,"sensorytem":8.8,"pty":0,"pop":0,"wsd":1.43,"reh":83,"humidityIcon":"humidity_80","hPa":1014.01,"visibility":-1.61,"dateObj":"2018.03.16 00:00","time":0},{"date":"20180316","temp_c":8,"temp_f":46.5,"ftemp_c":6,"ftemp_f":42.8,"cloud":14,"windSpd_mh":7.22,"windSpd_ms":3.23,"windDir":218,"humid":93,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1013.97,"oz":391.3,"desc":"맑음","weatherType":0,"skyIcon":"moon","fromToday":1,"t3h":8,"sensorytem":6,"pty":0,"pop":0,"wsd":3.23,"reh":93,"humidityIcon":"humidity_90","hPa":1013.97,"visibility":-1.61,"dateObj":"2018.03.16 03:00","time":3},{"date":"20180316","temp_c":8.2,"temp_f":46.8,"ftemp_c":6,"ftemp_f":42.8,"cloud":3,"windSpd_mh":8.24,"windSpd_ms":3.68,"windDir":214,"humid":96,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1014.13,"oz":382.49,"desc":"맑음","weatherType":0,"skyIcon":"moon","fromToday":1,"t3h":8.2,"sensorytem":6,"pty":0,"pop":0,"wsd":3.68,"reh":96,"humidityIcon":"humidity_90","hPa":1014.13,"visibility":-1.61,"dateObj":"2018.03.16 06:00","time":6},{"date":"20180316","temp_c":10.4,"temp_f":50.7,"ftemp_c":10.4,"ftemp_f":50.7,"cloud":0,"windSpd_mh":9.19,"windSpd_ms":4.11,"windDir":209,"humid":83,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1014.72,"oz":374.99,"desc":"맑음","weatherType":0,"skyIcon":"sun","fromToday":1,"t3h":10.4,"sensorytem":10.4,"pty":0,"pop":0,"wsd":4.11,"reh":83,"humidityIcon":"humidity_80","hPa":1014.72,"visibility":-1.61,"dateObj":"2018.03.16 09:00","time":9},{"date":"20180316","temp_c":14.6,"temp_f":58.2,"ftemp_c":14.6,"ftemp_f":58.2,"cloud":0,"windSpd_mh":10.86,"windSpd_ms":4.85,"windDir":210,"humid":59,"precType":0,"precProb":2,"precip":0.01,"vis":-1.61,"press":1014.63,"oz":369.38,"desc":"맑음","weatherType":0,"skyIcon":"sun","fromToday":1,"t3h":14.6,"sensorytem":14.6,"pty":0,"pop":2,"wsd":4.85,"reh":59,"humidityIcon":"humidity_50","hPa":1014.63,"visibility":-1.61,"dateObj":"2018.03.16 12:00","time":12},{"date":"20180316","temp_c":16.8,"temp_f":62.2,"ftemp_c":16.8,"ftemp_f":62.2,"cloud":8,"windSpd_mh":11.12,"windSpd_ms":4.97,"windDir":215,"humid":48,"precType":0,"precProb":2,"precip":0,"vis":-1.61,"press":1013.13,"oz":367.71,"desc":"맑음","weatherType":0,"skyIcon":"sun","fromToday":1,"t3h":16.8,"sensorytem":16.8,"pty":0,"pop":2,"wsd":4.97,"reh":48,"humidityIcon":"humidity_40","hPa":1013.13,"visibility":-1.61,"dateObj":"2018.03.16 15:00","time":15},{"date":"20180316","temp_c":14.8,"temp_f":58.7,"ftemp_c":14.8,"ftemp_f":58.7,"cloud":26,"windSpd_mh":5.19,"windSpd_ms":2.32,"windDir":176,"humid":57,"precType":0,"precProb":2,"precip":0.01,"vis":-1.61,"press":1015.31,"oz":365.49,"desc":"구름적음","weatherType":1,"skyIcon":"sun_smallcloud","fromToday":1,"t3h":14.8,"sensorytem":14.8,"pty":0,"pop":2,"wsd":2.32,"reh":57,"humidityIcon":"humidity_50","hPa":1015.31,"visibility":-1.61,"dateObj":"2018.03.16 18:00","time":18},{"date":"20180316","temp_c":12.3,"temp_f":54.1,"ftemp_c":12.3,"ftemp_f":54.1,"cloud":50,"windSpd_mh":7.24,"windSpd_ms":3.24,"windDir":143,"humid":67,"precType":0,"precProb":2,"precip":0.01,"vis":-1.61,"press":1016.01,"oz":357.64,"desc":"구름적음","weatherType":1,"skyIcon":"moon_smallcloud","fromToday":1,"t3h":12.3,"sensorytem":12.3,"pty":0,"pop":2,"wsd":3.24,"reh":67,"humidityIcon":"humidity_60","hPa":1016.01,"visibility":-1.61,"dateObj":"2018.03.16 21:00","time":21},{"date":"20180317","temp_c":10.2,"temp_f":50.4,"ftemp_c":10.2,"ftemp_f":50.4,"cloud":73,"windSpd_mh":7.58,"windSpd_ms":3.39,"windDir":158,"humid":74,"precType":0,"precProb":0,"precip":0,"vis":-1.61,"press":1015.8,"oz":349.52,"desc":"구름많음","weatherType":2,"skyIcon":"moon_bigcloud","fromToday":2,"t3h":10.2,"sensorytem":10.2,"pty":0,"pop":0,"wsd":3.39,"reh":74,"humidityIcon":"humidity_70","hPa":1015.8,"visibility":-1.61,"dateObj":"2018.03.17 00:00","time":0}],"source":"DSF","airInfo":{"source":"aqicn","last":{}},"units":{"temperatureUnit":"C","windSpeedUnit":"m/s","pressureUnit":"hPa","distanceUnit":"km","precipitationUnit":"mm","airUnit":"airkorea"}};
        let ctrlAlertPush = new AlertPushController();
        console.info(JSON.stringify(data, null, 2));
        let infoObj = ctrlAlertPush._parseWeatherAirData({airAlertsBreakPoint: 4}, data);
    });
});
