/**
 * Created by aleckim on 2017. 12. 8..
 */

'use strict';

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var ControllerTown24h = require('../controllers/controllerTown24h');
var cTown24h = new ControllerTown24h();

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

var kmaTimeLib = require('../lib/kmaTimeLib');

describe('unit test - controller town 24h', function() {
    it('test _getShortestTimeValue ', function () {
        var date = new Date();
        var ret = cTown24h._getShortestTimeValue(date.getTimezoneOffset() / 60 * -1);
        var today = kmaTimeLib.convertDateToYYYYMMDD(date);
        assert.equal(ret.date, today, 'Fail get time value');
    });

    it('test _getShortestTimeValue ', function (done) {
        cTown24h.checkQueryValidation({query:{}}, null, function () {
            done();
        });
    });

    it('test insertSkyLife', function (done) {
        var req={};

        req.current = {"date":"20171223","time":"1200","t1h":7.1,"rn1":0,"sky":3,"uuu":-0.3,"vvv":2.3,
            "reh":72,"pty":0,"lgt":0,"vec":201.4,"wsd":2,"stnId":108,"stnName":"서울","addr":"서울특별시종로구송월동",
            "altitude":86,"geo":[126.96519465749947,37.57006278446992],"rnsCount":615,"rnsHit":487,"isMountain":false,
            "isCityWeather":true,"sensoryTem":5.8,"dpt":2.2,"visibility":2,"hPa":1023.6,"wdd":"남남서","rs1d":0,"rs1h":0,
            "rns":false,"heavyCloud":8,"cloud":8,"weather":"박무","stnDateTime":"2017.12.23.12:06","weatherType":4,
            "liveTime":"1206","overwrite":true,"fsn":71,"fsnGrade":2,"fsnStr":"경고",
            "arpltn":{"stationName":"중구","pm10Grade":2,"no2Grade":2,"o3Grade":1,"coGrade":1,"so2Grade":1,"khaiGrade":2,
                "khaiValue":88,"pm10Value":96,"no2Value":0.048,"o3Value":0.004,"coValue":0.8,"so2Value":0.007,
                "dataTime":"2017-12-23 11:00","pm25Grade":2,"pm25Value":68,"pm10Str":"보통","pm25Str":"보통",
                "o3Str":"좋음","no2Str":"보통","coStr":"좋음","so2Str":"좋음","khaiStr":"보통","aqiGrade":2,"aqiStr":"보통"},
            "sensorytem":6,"dspls":47,"dsplsGrade":0,"dsplsStr":"낮음","decpsn":1,"decpsnGrade":0,"decpsnStr":"낮음",
            "heatIndex":7.1,"heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,
            "frostStr":"낮음","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"SunBigCloud",
            "yesterday":{"date":"20171222","time":"1200","t1h":5.3,"rn1":0,"sky":3,"uuu":-1.5,"vvv":1.6,"reh":62,
                "pty":0,"lgt":0,"vec":135,"wsd":2.3},
            "summary":"박무, 식중독 경고"};
        req.shortest=[
            {"date":"20171223","time":"1200","pty":0,"rn1":0,"sky":4,"lgt":0,"t1h":7,"uuu":-1,
                "vvv":2.9,"reh":60, "vec":159,"wsd":3.1,"wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"1300","pty":0,"rn1":0,"sky":4,"lgt":0,"t1h":7.7,"uuu":-0.4,
                "vvv":2.7,"reh":55,"vec":169,"wsd":2.8,"wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"1400","pty":0,"rn1":0,"sky":4,"lgt":0,"t1h":8.3,"uuu":0,
                "vvv":2.5,"reh":50,"vec":181,"wsd":2.5,"wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"1500","pty":0,"rn1":0,"sky":4,"lgt":0,"t1h":9,"uuu":0.6,
                "vvv":2.3,"reh":45,"vec":195,"wsd":2.4,"wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"}
        ];
        req.short = [
            {"date":"20171223","time":"0300","pop":30,"pty":0,"r06":0,"reh":75,"s06":0,"sky":4,"t3h":4.4,
                "tmn":2,"tmx":-50,"uuu":0.3,"vvv":1.1,"wav":-1,"vec":195,"wsd":1.1,"rn1":0,"lgt":0,
                "sensorytem":4,"dspls":42,"dsplsGrade":0,"dsplsStr":"낮음","decpsn":1,"decpsnGrade":0,
                "decpsnStr":"낮음","heatIndex":4.4,"heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,
                "freezeStr":"낮음","frostGrade":0,"frostStr":"낮음","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"0600","pop":20,"pty":0,"r06":0,"reh":81,"s06":0,"sky":4,"t3h":6.3,"tmn":-50,
                "tmx":-50,"uuu":-0.2,"vvv":1.7,"wav":-1,"vec":170,"wsd":1.7,"rn1":0,"lgt":0,"sensorytem":5,
                "dspls":45,"dsplsGrade":0,"dsplsStr":"낮음","decpsn":2,"decpsnGrade":0,"decpsnStr":"낮음",
                "heatIndex":6.3,"heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음",
                "frostGrade":0,"frostStr":"낮음","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"0900","pop":10,"pty":0,"r06":0,"reh":80,"s06":0,"sky":4,"t3h":6.4,"tmn":-50,
                "tmx":-50,"uuu":-0.1,"vvv":1.5,"wav":-1,"vec":172,"wsd":1.5,"rn1":0,"lgt":0,"sensorytem":6,"dspls":45,
                "dsplsGrade":0,"dsplsStr":"낮음","decpsn":2,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":6.4,
                "heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,
                "frostStr":"낮음","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"1200","pop":10,"pty":0,"r06":0,"reh":67,"s06":0,"sky":4,"t3h":7.5,"tmn":-50,
                "tmx":-50,"uuu":-1,"vvv":-1,"wav":-1,"vec":170,"wsd":2.3,"rn1":0,"lgt":0,"sensorytem":6,"dspls":48,
                "dsplsGrade":0,"dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":7.5,
                "heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,
                "frostStr":"낮음","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"1500","pop":20,"pty":0,"r06":0,"reh":45,"s06":0,"sky":4,"t3h":9,"tmn":-50,
                "tmx":9,"uuu":0.6,"vvv":2.3,"vec":195,"wsd":2.4,"shortestRn1":0,"lgt":0,"sensorytem":8,"dspls":51,
                "dsplsGrade":0,"dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":9,
                "heatIndexGrade":0,"heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,
                "frostStr":"낮음","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"1800","pop":30,"pty":0,"r06":0,"reh":40,"s06":0,"sky":4,"t3h":7,"tmn":-50,
                "tmx":-50,"uuu":1.9,"vvv":2.1,"vec":223,"wsd":2.8,"sensorytem":5,"dspls":49,"dsplsGrade":0,
                "dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":7,"heatIndexGrade":0,
                "heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,"frostStr":"낮음","wsdGrade":1,
                "wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"2100","pop":30,"pty":0,"r06":0,"reh":55,"s06":0,"sky":4,"t3h":7,"tmn":-50,
                "tmx":-50,"uuu":-1.4,"vvv":1.5,"vec":135,"wsd":2.1,"sensorytem":6,"dspls":48,"dsplsGrade":0,
                "dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":7,"heatIndexGrade":0,
                "heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,"frostStr":"낮음","wsdGrade":1,
                "wsdStr":"바람약함","skyIcon":"Cloud"},
            {"date":"20171223","time":"2400","pop":30,"pty":0,"r06":0,"reh":65,"s06":0,"sky":4,"t3h":6,"tmn":-50,
                "tmx":-50,"uuu":-2,"vvv":0.3,"vec":99,"wsd":2.1,"sensorytem":4,"dspls":46,"dsplsGrade":0,
                "dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":6,"heatIndexGrade":0,
                "heatIndexStr":"낮음","freezeGrade":0,"freezeStr":"낮음","frostGrade":0,"frostStr":"낮음","wsdGrade":1,
                "wsdStr":"바람약함","skyIcon":"Cloud"}
        ];
        req.midData = {};
        req.midData.dailyData = [
            {"date":"20171222","lgt":0,"pty":0,"reh":69,"rn1":0,"sky":4,"lgtAm":0,"ptyAm":0,"skyAm":4,"wfAm":"흐림",
                "lgtPm":0,"ptyPm":0,"skyPm":4,"wfPm":"흐림","t1d":3.7,"wsd":1.5,"taMax":6.2,"taMin":-0.4,"pop":30,
                "r06":0,"s06":0,"fsn":64,"fsnGrade":1,"asthma-lunt":3,"asthma-luntStr":"매우 높음","skin":0,
                "skinStr":"낮음","brain":2,"brainStr":"높음","flowerWoody":2,"flowerWoodyStr":"높음",
                "locationName":"서울","locationGeo":[37.55,37.55],"sunrise":"2017.12.22 07:43",
                "suntransit":"2017.12.22 12:30","sunset":"2017.12.22 17:17","moonrise":"2017.12.22 10:18",
                "moontransit":"2017.12.22 15:33","moonset":"2017.12.22 20:51","civilm":"2017.12.22 07:14",
                "civile":"2017.12.22 17:46","nautm":"2017.12.22 06:41","naute":"2017.12.22 18:19",
                "astm":"2017.12.22 06:09","aste":"2017.12.22 18:51","fsnStr":"주의","wsdGrade":1,
                "wsdStr":"바람약함","skyIcon":"Cloud","skyAmIcon":"Cloud","skyPmIcon":"Cloud"},
            {"date":"20171223","lgt":0,"pty":0,"reh":64,"rn1":0,"sky":4,"lgtAm":0,"ptyAm":0,"skyAm":4,"wfAm":"흐림",
                "lgtPm":0,"ptyPm":0,"t1d":6.7,"wsd":2,"taMax":9,"taMin":2,"pop":30,"r06":0,"s06":0,"skyPm":4,
                "wfPm":"흐림","fsn":71,"fsnGrade":2,"asthma-lunt":1,"asthma-luntStr":"보통","flowerWoody":1,
                "flowerWoodyStr":"보통","skin":0,"skinStr":"낮음","brain":1,"brainStr":"보통",
                "dustForecast":{"sido":"서울","PM10Grade":2,"PM10Str":"나쁨","PM25Grade":2,"PM25Str":"나쁨"},
                "locationName":"서울","locationGeo":[37.55,37.55],"sunrise":"2017.12.23 07:44",
                "suntransit":"2017.12.23 12:31","sunset":"2017.12.23 17:18","moonrise":"2017.12.23 10:55",
                "moontransit":"2017.12.23 16:19","moonset":"2017.12.23 21:48","civilm":"2017.12.23 07:14",
                "civile":"2017.12.23 17:47","nautm":"2017.12.23 06:41","naute":"2017.12.23 18:20",
                "astm":"2017.12.23 06:09","aste":"2017.12.23 18:52","fsnStr":"경고","wsdGrade":1,"wsdStr":"바람약함",
                "skyIcon":"Cloud","skyAmIcon":"Cloud","skyPmIcon":"Cloud"},
            {"date":"20171224","pop":80,"pty":1,"r06":15,"reh":80,"s06":0,"sky":4,"lgtAm":0,"ptyAm":1,"skyAm":4,
                "wfAm":"흐리고 비","lgtPm":0,"ptyPm":1,"skyPm":3,"wfPm":"구름많고 비","t1d":2.8,"taMax":4,"taMin":-1,
                "wsd":2.8,"fsn":63,"fsnGrade":1,"skin":0,"skinStr":"낮음","asthma-lunt":1,"asthma-luntStr":"보통",
                "flowerWoody":1,"flowerWoodyStr":"보통","brain":2,"brainStr":"높음",
                "dustForecast":{"sido":"서울","PM10Grade":1,"PM10Str":"보통","PM25Grade":2,"PM25Str":"나쁨"},
                "locationName":"서울","locationGeo":[37.55,37.55],"sunrise":"2017.12.24 07:44",
                "suntransit":"2017.12.24 12:31","sunset":"2017.12.24 17:18","moonrise":"2017.12.24 11:29",
                "moontransit":"2017.12.24 17:04","moonset":"2017.12.24 22:45","civilm":"2017.12.24 07:15",
                "civile":"2017.12.24 17:48","nautm":"2017.12.24 06:42","naute":"2017.12.24 18:20",
                "astm":"2017.12.24 06:10","aste":"2017.12.24 18:52","fsnStr":"주의","wsdGrade":1,"wsdStr":"바람약함",
                "ptyStr":"강수량","r06Str":"~15mm","skyIcon":"CloudRain","skyAmIcon":"CloudRain",
                "skyPmIcon":"SunBigCloudRain"}
        ];

        cTown24h.insertSkyIcon(req, null, function (err) {
            if (err) {
                console.error(err);
            }
            else {
                //console.info(req);
                assert.equal(req.current.night, false);
                assert.equal(req.short[1].night, true);
                assert.equal(req.short[2].night, false);
                assert.equal(req.short[5].night, true);
            }

            done();
        });
    });

    it('test convertUnits', function (done) {
        var req = {query:{temperatureUnit:"F", precipitationUnit:"in", distanceUnit:"mi", windSpeedUnit:"mph", pressureUnit:"mmHg", airUnit:"airkorea_who"}};
        req.current = {"date":"20171208","time":"1300","t1h":-1.4,"rn1":0,"sky":1,"uuu":2.8,"vvv":-1.6,
            "reh":27,"pty":0,"lgt":0,"vec":280.5,"wsd":3.4,"stnId":108,"stnName":"서울","addr":"서울특별시종로구송월동",
            "isCityWeather":true,"altitude":86,"geo":[126.96519465749947,37.57006278446992],"rnsCount":615,
            "rnsHit":487,"isMountain":false,"sensoryTem":-4.2,"dpt":-17.8,"visibility":19,"hPa":1024.1,"wdd":"W",
            "rs1d":0,"rs1h":0,"rns":false,"heavyCloud":0,"cloud":0,"weather":"맑음","stnDateTime":"2017.12.08.13:30",
            "weatherType":0,"liveTime":"1330","overwrite":true,"fsn":68,"fsnGrade":1,"fsnStr":"주의",
            "arpltn":{"stationName":"중구","pm10Grade":2,"no2Grade":1,"o3Grade":1,"coGrade":1,"so2Grade":1,
                "khaiGrade":2,"khaiValue":63,"pm10Value":30,"no2Value":0.017,"o3Value":0.025,"coValue":0.4,
                "so2Value":0.004,"dataTime":"2017-12-08 13:00","pm25Grade":2,"pm25Value":21,"pm10Str":"보통",
                "pm25Str":"보통","o3Str":"좋음","no2Str":"좋음","coStr":"좋음","so2Str":"좋음","khaiStr":"보통"},
            "sensorytem":-6,"dspls":41,"dsplsGrade":0,"dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음",
            "heatIndex":-1.4,"heatIndexGrade":0,"heatIndexStr":"낮음","frostGrade":0,"frostStr":"낮음",
            "sensorytemStr":"관심","wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Sun","summary":"체감온도 -6˚, 어제보다 -4˚",
            "yesterday":{"date":"20171207","time":"1300","t1h":2.9,"rn1":0,"sky":2,"uuu":2.5,"vvv":-2.9,"reh":36,
                "pty":0,"lgt":0,"vec":320,"wsd":3.9}};
        req.shortest = [
            {"date":"20171208","time":"1400","pty":0,"rn1":0,"sky":1,"lgt":0,"t1h":-1.4,"uuu":3,
                "vvv":-1.8,"reh":31,"vec":302,"wsd":3.6,"wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Sun"},
            {"date":"20171208","time":"1500","pty":0,"rn1":0,"sky":1,"lgt":0,"t1h":-0.9,"uuu":3.2,"vvv":-2,"reh":30,
                "vec":303,"wsd":3.8,"wsdGrade":1,"wsdStr":"바람약함","skyIcon":"Sun"}];

        req.short = [
            {"date":"20171210","time":"2100","pop":10,"pty":0,"r06":0,"reh":45,"s06":0,"sky":2,"t3h":-1,"tmn":-50,
                "tmx":-50,"uuu":4.3,"vvv":-1.3,"wav":-1,"vec":287,"wsd":4.5,"sensorytem":-6,"dspls":39,
                "dsplsGrade":0,"dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":-1,
                "heatIndexGrade":0,"heatIndexStr":"낮음","frostGrade":0,"frostStr":"낮음","sensorytemStr":"관심",
                "wsdGrade":2,"wsdStr":"바람약간강함","skyIcon":"MoonSmallCloud"},
            {"date":"20171210","time":"2400","pop":10,"pty":0,"r06":0,"reh":50,"s06":0,"sky":2,"t3h":-4,"tmn":-4,
                "tmx":-50,"uuu":4.7,"vvv":-2.6,"wav":-1,"vec":299,"wsd":5.4,"sensorytem":-10,"dspls":34,"dsplsGrade":0,
                "dsplsStr":"낮음","decpsn":0,"decpsnGrade":0,"decpsnStr":"낮음","heatIndex":-4,"heatIndexGrade":0,
                "heatIndexStr":"낮음","frostGrade":1,"frostStr":"보통","sensorytemStr":"주의","wsdGrade":2,
                "wsdStr":"바람약간강함","skyIcon":"MoonSmallCloud"}];
        req.midData = {};
        req.midData.dailyData = [
            {"date":"20171220","lgt":0,"pty":3,"reh":64,"rn1":0,"sky":3,"lgtAm":0,"ptyAm":0,"skyAm":2,"wfAm":"구름조금",
                "lgtPm":0,"ptyPm":3,"skyPm":4,"wfPm":"흐리고 눈","t1d":-2.3,"wsd":1,"taMax":3,"taMin":-7.8,"pop":70,
                "r06":2,"s06":0.1,"fsn":62,"fsnGrade":1,"brain":2,"brainStr":"높음","skin":0,"skinStr":"낮음",
                "asthma-lunt":3,"asthma-luntStr":"매우 높음","flowerWoody":2,"flowerWoodyStr":"높음",
                "dustForecast":{"sido":"서울","PM25Grade":1,"PM25Str":"보통","PM10Grade":1,"PM10Str":"보통"},
                "locationName":"서울","locationGeo":[37.55,37.55],"sunrise":"2017.12.20 07:42",
                "suntransit":"2017.12.20 12:29","sunset":"2017.12.20 17:16","moonrise":"2017.12.20 08:54",
                "moontransit":"2017.12.20 13:58","moonset":"2017.12.20 19:04","civilm":"2017.12.20 07:13",
                "civile":"2017.12.20 17:45","nautm":"2017.12.20 06:40","naute":"2017.12.20 18:18",
                "astm":"2017.12.20 06:08","aste":"2017.12.20 18:50","fsnStr":"주의","wsdGrade":1,"wsdStr":"바람약함",
                "ptyStr":"적설량","s06Str":"~0.1cm","rn1Str":"0cm","skyIcon":"SunBigCloudSnow",
                "skyAmIcon":"SunSmallCloud","skyPmIcon":"CloudSnow"},
            {"date":"20171221","pop":20,"pty":0,"r06":0,"reh":66,"s06":0,"sky":2,"lgtAm":0,"ptyAm":0,"skyAm":2,
                "wfAm":"구름조금","lgtPm":0,"ptyPm":0,"skyPm":1,"wfPm":"맑음","t1d":-0.5,"taMax":3,"taMin":-5,"wsd":0.9,
                "fsn":67,"fsnGrade":1,"skin":0,"skinStr":"낮음","flowerWoody":2,"flowerWoodyStr":"높음","brain":2,
                "brainStr":"높음","asthma-lunt":2,"asthma-luntStr":"높음",
                "dustForecast":{"sido":"서울","PM25Grade":1, "PM25Str":"보통","PM10Grade":1,"PM10Str":"보통"},
                "locationName":"서울","locationGeo":[37.55,37.55],"sunrise":"2017.12.21 07:43",
                "suntransit":"2017.12.21 12:30","sunset":"2017.12.21 17:17","moonrise":"2017.12.21 09:38",
                "moontransit":"2017.12.21 14:46","moonset":"2017.12.21 19:57","civilm":"2017.12.21 07:13",
                "civile":"2017.12.21 17:46","nautm":"2017.12.21 06:40","naute":"2017.12.21 18:19",
                "astm":"2017.12.21 06:08","aste":"2017.12.21 18:51","fsnStr":"주의","wsdGrade":1,"wsdStr":"바람약함",
                "skyIcon":"SunSmallCloud","skyAmIcon":"SunSmallCloud","skyPmIcon":"Sun"}];
        req.params = {region:"서울특별시", city:"", town:""};

        cTown24h.convertUnits(req, null, function () {
           //console.info(JSON.stringify({req:req}));
           var daily = req.midData.dailyData[0];
           assert(daily.tmx, 3);
           if (daily.dustForecast) {
               assert(daily.dustForecast.pm10Grade, 2);
           }
           done();
        });
    });

});

