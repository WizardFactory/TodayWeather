/**
 *
 * Created by aleckim on 2017. 11. 7..
 */

"use strict";

var router = require('express').Router();
var async = require('async');

var ControllerTown24h = require('../../controllers/controllerTown24h');
var GeoController = require('../../controllers/geo.controller');
var WorldWeather = require('../../controllers/worldWeather/controllerWorldWeather');

var cTown = new ControllerTown24h();
var worldWeather = new WorldWeather();


router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ geo > request | Time[', printTime.toISOString(), ']');

    next();
});

var kmaRouterList = [cTown.checkParamValidation, cTown.getAllDataFromDb, cTown.checkDBValidation, cTown.getShort,
    cTown.getShortRss, cTown.getShortest, cTown.getCurrent, cTown.updateCurrentListForValidation,
    cTown.mergeCurrentByStnHourly, cTown.getKmaStnMinuteWeather, cTown.convert0Hto24H, cTown.mergeShortWithCurrentList,
    cTown.mergeByShortest, cTown.adjustShort, cTown.getMid, cTown.getMidRss, cTown.convertMidKorStrToSkyInfo,
    cTown.getPastMid, cTown.mergeMidWithShort, cTown.getLifeIndexKma, cTown.getHealthDay, cTown.getKeco,
    cTown.getKecoDustForecast, cTown.getRiseSetInfo, cTown.insertIndex, cTown.insertStrForData, cTown.insertSkyIcon,
    cTown.getSummary, cTown.makeResult];

var wwRouterList = [worldWeather.checkApiVersion, worldWeather.queryTwoDaysWeather, worldWeather.convertDsfLocalTime,
    worldWeather.mergeDsfDailyData, worldWeather.mergeDsfCurrentData, worldWeather.mergeDsfHourlyData,
    worldWeather.mergeAqi, worldWeather.dataSort];

/**
 * lat 위도
 * lon 경도
 * 구글지도의 입력 값과 같은 순서임
 * 위도,경도 소수점 두자리까지 하면 1km,세자리까지 하면 100m
 *
 * pre daum api에 물어서 국내/해외 구분
 * case 1 한국어로 국내 위치 요청 - daumapi물어서 주소 받아서 결과 생성
 * case 2 한국어로 해외 위치 요청 - 구글api물어서 한국어 이름(and 주소) 전달
 * case 3 외국어로 국내 위치 요청 - daumapi물어서 주소 받아 날씨 결과 생성, 요청한 언어 맞는 이름(and 주소) 전달
 * case 4 외국어로 외국 위치 요청 - 구글api물어서 외국어 이름(and 주소) 전달
 * 해외의 경우 국내와 같이 5km블록의 대표좌표로 변환해서 날씨정보 전달
 *
 * client에서 내장함수 사용하여 주소 전달하는 경우
 * case 1 한국어로 국내 위치 요청 - 이름만 선정하고 날씨정보 붙여서 전달
 * case 2 한국어로 해외 위치 요청 - 이름만 선정하고 날씨정보 붙여서 전달
 * case 3 외국어로 국내 위치 요청 - 이름 선정하고 daumapi물어서 주소 받아 날씨 결과 생성
 * case 4 외국어로 외국 위치 요청 - 이름만 선정
 * client에서 해외의 경우 국내와 같이 5km블록의 대표좌표로 변환해서 요청
 *
 * normalize하면서 좌표가 바다로 되는 문제가 있음
 * seoul 37.566,126.977
 * busan 35.1795543,129.0756416
 * daegu 35.8714354,128.601445
 * tokyo 35.689,139.691
 * yokohama 35.4437078,139.6380256
 * osaka 34.6937378,135.5021651
 * shanghai 31.230,121.473
 * beijing 39.904,116.407
 * chengdu 30.572815,104.066801
 * new york 40.7127753,-74.0059728
 * los angeles 34.0522342,-118.2436849
 * chicago 41.8781136,-87.6297982
 * london 51.507, -0.128
 * berlin 52.520,13.404
 * delhi 28.704,77.102
 * karachi 24.861,67.010
 * mosco 55.756,37.617
 */
router.get('/:lat/:lon',
    function (req, res, next) {
        var cGeo = new GeoController();
        cGeo.setInfoFromReq(req);
        cGeo.location2address(req, res, next);
    },
    function (req, res, next) {
        var operations = [];
        var funcList = req.country === 'KR'?kmaRouterList:wwRouterList;

        funcList.forEach(function (func) {
            operations.push(func.bind(null, req, res));
        });

        async.series(operations, function (err) {
            if (err)  {
                log.error(err);
                return next(err);
            }
            next();
        });
    },
    function (req, res) {
        var result = req.result;

        if(req.error) {
            result = req.error;
        }
        else if (req.result == undefined) {
            result = {result: 'Unknown result'};
        }
        else {
            if (result.source === 'DSF') {
                if (req.result.thisTime.length != 2) {
                    log.error("thisTime's length is not 2 loc="+JSON.stringify(req.result.location));
                }
            }
        }

        log.info('## - ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' + req.sessionID);
        res.json(result);
    });

module.exports = router;
