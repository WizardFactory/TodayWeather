/**
 * Created by aleckim on 2017. 12. 8..
 */

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
        var date = new Date();
        var ret = cTown24h.checkQueryValidation({query:{}}, null, function () {
            done();
        });
    });

    it('test convertUnits', function (done) {
        var req = {query:{tempUnit:"F", precipUnit:"in", distUnit:"mi", windUnit:"mph", pressUnit:"mmHg", airUnit:"airkorea_who"}};
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
            {"date":"20171217","wfPm":"구름많음","wfAm":"구름많음","taMin":-5,"taMax":2,"reliability":"보통","skyAm":3,
                "ptyAm":0,"lgtAm":0,"skyPm":3,"ptyPm":0,"lgtPm":0,"sky":3,"pty":0,"lgt":0,"locationName":"서울",
                "locationGeo":[37.55,37.55],"sunrise":"2017.12.17 07:40","suntransit":"2017.12.17 12:28",
                "sunset":"2017.12.17 17:15","moonrise":"2017.12.17 06:22","moontransit":"2017.12.17 11:35",
                "moonset":"2017.12.17 16:46","civilm":"2017.12.17 07:11","civile":"2017.12.17 17:44",
                "nautm":"2017.12.17 06:38","naute":"2017.12.17 18:17","astm":"2017.12.17 06:06",
                "aste":"2017.12.17 18:49","skyIcon":"SunBigCloud","skyAmIcon":"SunBigCloud","skyPmIcon":"SunBigCloud"},
            {"date":"20171218","wfPm":"구름조금","wfAm":"구름조금","taMin":-6,"taMax":2,"skyAm":2,"ptyAm":0,"lgtAm":0,
                "skyPm":2,"ptyPm":0,"lgtPm":0,"sky":2,"pty":0,"lgt":0,"skyIcon":"SunSmallCloud",
                "skyAmIcon":"SunSmallCloud","skyPmIcon":"SunSmallCloud"}];

        cTown24h.convertUnits(req, null, function () {
           console.info(JSON.stringify({req:req}));
           done();
        });
    });
});


