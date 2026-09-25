/**
 *
 * Created by aleckim on 2018. 1. 24..
 */

'use strict';

var router = require('express').Router();

var ControllerTown24h = require('../../controllers/controllerTown24h');

var cTown = new ControllerTown24h();

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ kma/addr > request | Time[', printTime.toISOString(), ']');

    next();
});

router.get('/', function(req, res) {
    var meta = {};

    var result = {};

    meta.method = '/';

    log.info('##', meta);

    if(req.summary){
        result.summary = req.summary;
    }

    result.usage = [
        '/{도,특별시,광역시} : response summarized weather information on matched region',
        '/{도,특별시,광역시}/{시,군,구} : response summarized weather information on matched city',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍} : response weather data for all three types such as short, shortest, current',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/short : response only short information',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/shortest : response only shortest information',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/current : response only current information'
    ];
    res.json(result);
});

/**
 * getCurrent가는 getShortest, getShort보다 앞에 올 수 없음.
 * getSummary는 getShortest, getCurrent보다 앞에 올수 없음.
 * 기존의 getSummary를 단위변환때문에 setYesterDay와 getSummaryAfterUnitConverter로 분리함.
 * skyIcon은 convertUnits 전에 불러야 함.
 * insrtStr은 convertUnits 후에 불러야함.
 * v000901에서는 makeResult에서 location 정보를 추가함.
 */
var routerList = [cTown.checkQueryValidation, cTown.checkParamValidation, cTown.getAllDataFromDb, cTown.getShort,
    cTown.getShortRss, cTown.getShortest, cTown.getCurrent, cTown.updateCurrentListForValidation, cTown.mergeCurrentSkyByShortest,
    cTown.mergeCurrentByStnHourly, cTown.getKmaStnMinuteWeather, cTown.convert0Hto24H, cTown.mergeShortWithCurrentList,
    cTown.mergeByShortest, cTown.adjustShort, cTown.getMid, cTown.getMidRss, cTown.convertMidKorStrToSkyInfo,
    cTown.getPastMid, cTown.mergeMidWithShort, cTown.updateMidTempMaxMin, cTown.getLifeIndexKma, cTown.getHealthDay, cTown.getKeco,
    cTown.getKecoDustForecast, cTown.getRiseSetInfo, cTown.insertIndex, cTown.makeAirInfo, cTown.AirForecast, cTown.insertSkyIconLowCase,
    cTown.setYesterday, cTown.convertUnits, cTown.insertStrForData, cTown.getSummaryAfterUnitConverter,
    cTown.makeResult, cTown.sendResult];

router.get('/addr/:region', routerList);

router.get('/addr/:region/:city', routerList);

router.get('/addr/:region/:city/:town', routerList);

routerList.unshift(cTown.coord2addr);

router.get('/coord/:loc', routerList);

module.exports = router;
