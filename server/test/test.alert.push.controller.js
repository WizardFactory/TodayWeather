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
        dayOfWeeks: [1,5],
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
        dayOfWeeks: [1,2,3,4,5],
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
});
