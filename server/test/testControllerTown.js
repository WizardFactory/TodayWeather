/**
 * Created by aleckim on 2016. 3. 16..
 */

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var ControllerTown = require('../controllers/controllerTown');
var cTown = new ControllerTown();

var ControllerTown24h = require('../controllers/controllerTown24h');
var cTown24h = new ControllerTown24h();

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

var i18n = require('i18n');

i18n.configure({
    // setup some locales - other locales default to en silently
    locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'],

    // sets a custom cookie name to parse locale settings from
    cookie: 'twcookie',

    // where to store json files - defaults to './locales'
    directory: __dirname + '/locales',

    register: global
});

var kmaTimeLib = require('../lib/kmaTimeLib');

describe('unit test - controller town', function() {

    it('test _getShortestTimeValue ', function() {
        var date = new Date();
        var ret = cTown._getShortestTimeValue(date.getTimezoneOffset()/60*-1);
        var today = kmaTimeLib.convertDateToYYYYMMDD(date);
        assert.equal(ret.date, today, 'Fail get time value');
    });

    it('test _getCurrentTimeValue', function () {
        var date = new Date();
        var ret = cTown._getCurrentTimeValue(date.getTimezoneOffset()/60*-1);
        var today = kmaTimeLib.convertDateToYYYYMMDD(date);
        assert.equal(ret.date, today, 'Fail get time value');
    });

    it('test _min', function () {
        var min = cTown._min([3,4,6,7], 3);
        assert.equal(min, 4, 'Fail to get min') ;
    });

    it('test _max', function () {
        var min = cTown._max([3,4,6,7], 7);
        assert.equal(min, 6, 'Fail to get max') ;
    });

    it('test _sum', function () {
        var sum = cTown._sum([3,7,10], 10);
        assert.equal(sum, 10, 'Fail to sum');
    });

    it('test _average', function () {
        var avg = cTown._average([10,10, 5], 5);
        assert.equal(avg, 10, 'Fail to average');
    });

    it('test _mergeList', function () {
        var list = [{date:'20160322', a:1, b:2}, {date:'20160808', c:3, d:4}];
        cTown._mergeList(list, [{date:'20160808', e:5}, {date:'20160909', f:7}]);
        assert(list, [ { date: '20160322', a: 1, b: 2 },
                        { date: '20160808', c: 3, d: 4, e: 5 },
                        { date: '20160909', f: 7 } ], 'Fail to merge list');
    });

    it('test convertMidKorStrToSkyInfo', function (done) {
        var req = {};
        req.params = {};
        req.params.region = "seoul";
        req.params.city = "kangnam";
        req.midData = {};
        req.midData.dailyData = [];
        req.midData.dailyData.push({wfAm: "구름많음", wfPm: "흐리고 비"});
        req.midData.dailyData.push({wfAm: "흐리고 비", wfPm: "맑음"});
        req.midData.dailyData.push({wfAm: "구름조금", wfPm: "맑음"});
        req.midData.dailyData.push({wfAm: "흐리고 비", wfPm: "구름적고 눈"});
        req.midData.dailyData.push({wfPm: "흐리고 비", wfAm: "구름적고 눈"});
        req.midData.dailyData.push({wfAm: "흐리고 비/눈", wfPm: "구름적고 눈"});
        req.midData.dailyData.push({wfAm: "흐리고 비/눈", wfPm: "구름적고 눈/비"});
        req.midData.dailyData.push({wfAm: "흐리고 비", wfPm: "구름적고 눈/비"});
        req.midData.dailyData.push({wfAm: "흐리고 눈", wfPm: "맑음"});
        req.midData.dailyData.push({wfAm: "흐리고 눈/비", wfPm: "맑음"});
        req.midData.dailyData.push({wfPm: "흐리고 눈/비", wfAm: "맑음"});

        var next = function () {
            console.log(req.midData.dailyData);
            done();
        };
        cTown.convertMidKorStrToSkyInfo(req, {}, next);
    });

    var current = {
        date : '20171119',
        time : '0500',
        liveTime : '0500',
        t1h: 22.5,
        rn1: 1,
        sky: 1,
        uuu: 1,
        vvv: 1,
        reh: 30,
        pty: 2,
        lgt: 1,
        vec: 0,
        wsd: 0
    };

    it('test update current from stn weather', function() {
        var current1 = {
            date : '20171119',
            time : '0500',
            t1h: 10,
            rn1: 1,
            sky: 1,
            uuu: 1,
            vvv: 1,
            reh: 30,
            pty: 2,
            lgt: 1,
            vec: 0,
            wsd: 0
        };

        var currentList = [];
        currentList.push(current1);
        cTown._updateCurrentFromMinWeather(currentList, current);
        assert.equal(currentList[0].t1h, current.t1h);
        console.log(currentList);
    });

    it('test add current from stn weather', function() {
        var current1 = {
            date : '20171119',
            time : '0400',
            t1h: 10,
            rn1: 1,
            sky: 1,
            uuu: 1,
            vvv: 1,
            reh: 30,
            pty: 2,
            lgt: 1,
            vec: 0,
            wsd: 0
        };

        var currentList = [];
        currentList.push(current1);
        cTown._updateCurrentFromMinWeather(currentList, current);
        assert.equal(currentList[0].t1h, current1.t1h);
        assert.equal(currentList[1].t1h, current.t1h);
        console.log(currentList);
    });

    it('test make summary air', function() {
        var current = {"date":"20180328","time":13,"t1h":18.8,"rn1":0,"sky":4,"uuu":3.1,"vvv":2.7,"reh":47,"pty":0,
                        "lgt":0,"vec":242.6,"wsd":3.7,
                        "dongnae":{"date":"20180328","time":"1300","t1h":17.2,"rn1":0,
                            "sky":3,"uuu":3.1,"vvv":2.7,"reh":50,"pty":0,"lgt":0,"vec":229,"wsd":4.1},
                        "stnId":108,"stnName":"서울","addr":"서울특별시종로구송월동","altitude":86,
                        "geo":[126.96519465749947,37.57006278446992],"rnsCount":615,"rnsHit":487,"isMountain":false,
                        "isCityWeather":true,"sensoryTem":17.5,"dpt":8,"heavyCloud":9,"cloud":9,"visibility":10,
                        "weather":"흐림","hPa":1015.8,"wdd":"서남서","rs1d":0,"rs1h":0,"rs15m":0,"rns":false,
                        "cityHourAws":{"date":"2018-03-28T13:00:00.000Z","stnId":108,"sensoryTem":17.5,"dpt":8,
                            "heavyCloud":9,"cloud":9,"visibility":10,"weather":"흐림","hPa":1016.7,"reh":54,
                            "wsd":3.1,"wdd":"WSW","vec":241.2,"t1h":17.5,"rs1d":0,"rs1h":0,"rs15m":0,
                            "rns":false,"stnName":"서울"},
                        "cityMinAws":{"stnId":108,"stnName":"서울","addr":"서울특별시종로구송월동","altitude":86,
                            "geo":[126.96519465749947,37.57006278446992],"rnsCount":615,"rnsHit":487,
                            "isMountain":false,"isCityWeather":true,"date":"2018.03.28.13:53","hPa":1015.8,
                            "reh":47,"wsd":3.7,"wdd":"WSW","vec":242.6,"t1h":18.8,"rs1d":0,"rs1h":0,
                            "rs15m":0,"rns":false},
                        "stnDateTime":"2018.03.28.13:53","weatherType":3,"overwrite":true,"liveTime":"1353",
                        "ultrv":4,"ultrvGrade":1,"ultrvStr":"보통","fsn":57,"fsnGrade":1,"fsnStr":"주의",
                        "arpltn":{"date":"2018-03-28T13:00:00.000Z","stationName":"중구","pm25Grade":1,
                            "pm25Grade24":3,"pm10Grade":1,"pm10Grade24":1,"no2Grade":1,"o3Grade":1,
                            "coGrade":1,"so2Grade":1,"khaiGrade":1,"khaiValue":95,"pm25Value24":33,
                            "pm25Value":26,"pm10Value24":51,"pm10Value":42,"no2Value":0.022,"o3Value":0.05,
                            "coValue":0.5,"so2Value":0.004,"dataTime":"2018-03-28 13:00","mangName":"도시대기",
                            "aqiValue":95,"aqiIndex":95,"aqiGrade":1,"pm10Str":"보통","pm25Str":"보통","o3Str":"보통",
                            "no2Str":"좋음","coStr":"좋음","so2Str":"좋음","khaiStr":"보통","aqiStr":"보통"},
                        "sensorytem":19,"dspls":64,"dsplsGrade":0,"dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,
                        "decpsnStr":"낮음","heatIndex":18.8,"heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,
                        "freezeStr":"낮음","frostGrade":0,"frostStr":"낮음","night":false,"skyIcon":"Cloud",
                        "yesterday":{"date":"20180327","time":13,"t1h":18.6,"rn1":0,"sky":4,"uuu":2.7,"vvv":3.2,
                            "reh":43,"pty":0,"lgt":0,"vec":220,"wsd":4.2},
                        "dateObj":"2018.03.28 13:53","todayIndex":7,"wsdGrade":1,"wsdStr":"바람약함",
                        "summaryWeather":"자외선 보통, 바람약함","summaryAir":"초미세먼지 26 보통",
                        "summary":"초미세먼지 보통, 자외선 보통"};
        var str = cTown24h.makeSummaryAir(current);
        console.info(str);
    });
});

