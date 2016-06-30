/**
 *
 * Created by aleckim on 2016. 2. 21..
 */

var router = require('express').Router();

var ControllerTown24h = require('../../controllers/controllerTown24h');

var cTown = new ControllerTown24h();

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ townForecast24h > request | Time[', printTime.toISOString(), ']');

    next();
});

router.get('/', [cTown.getSummary], function(req, res) {
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

router.get('/:region', [cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                    cTown.getCurrent, cTown.getKmaStnHourlyWeather, cTown.convert0Hto24H,
                                    cTown.mergeCurrentByShortest, cTown.mergeShortWithCurrentList,
                                    cTown.mergeByShortest, cTown.adjustShort,
                                    cTown.getMid, cTown.getMidRss, cTown.getPastMid, cTown.mergeMidWithShort,
                                    cTown.getLifeIndexKma, cTown.getKeco, cTown.getKecoDustForecast,
                                    cTown.insertIndex, cTown.insertStrForData,
                                    cTown.getSummary, cTown.sendResult]);

router.get('/:region/:city', [cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                    cTown.getCurrent, cTown.getKmaStnHourlyWeather, cTown.convert0Hto24H,
                                    cTown.mergeCurrentByShortest, cTown.mergeShortWithCurrentList,
                                    cTown.mergeByShortest, cTown.adjustShort,
                                    cTown.getMid, cTown.getMidRss, cTown.getPastMid, cTown.mergeMidWithShort,
                                    cTown.getLifeIndexKma, cTown.getKeco, cTown.getKecoDustForecast,
                                    cTown.insertIndex, cTown.insertStrForData,
                                    cTown.getSummary, cTown.sendResult]);

/**
 * getCurrent가는 getShortest, getShort보다 앞에 올 수 없음.
 * getSummary는 getShortest, getCurrent보다 앞에 올수 없음.
 */
router.get('/:region/:city/:town', [cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                    cTown.getCurrent, cTown.getKmaStnHourlyWeather, cTown.convert0Hto24H,
                                    cTown.mergeCurrentByShortest,  cTown.mergeShortWithCurrentList,
                                    cTown.mergeByShortest, cTown.adjustShort,
                                    cTown.getMid, cTown.getMidRss, cTown.getPastMid, cTown.mergeMidWithShort,
                                    cTown.getLifeIndexKma, cTown.getKeco, cTown.getKecoDustForecast,
                                    cTown.insertIndex, cTown.insertStrForData,
                                    cTown.getSummary, cTown.sendResult]);

/**
 * mid, short, shortest 다 정상적으로 동작하기 위해서는 current, shorest, short의 데이타가 필요하다.
 */
router.get('/:region/:city/:town/mid', [cTown.getMid, cTown.getMidRss, cTown.getPastMid,
                                    cTown.mergeMidWithShort, cTown.getLifeIndexKma, cTown.getKeco,
                                    cTown.getKecoDustForecast, cTown.insertIndex,
                                    cTown.insertStrForData, cTown.sendResult]);

router.get('/:region/:city/:town/short', [cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                            cTown.convert0Hto24H, cTown.mergeShortWithCurrentList, cTown.adjustShort,
                                            cTown.getLifeIndexKma, cTown.getKeco, cTown.insertIndex,
                                            cTown.insertStrForData, cTown.sendResult]);

router.get('/:region/:city/:town/shortest', [cTown.getShortest, cTown.convert0Hto24H, cTown.insertIndex,
                                            cTown.insertStrForData, cTown.sendResult]);

router.get('/:region/:city/:town/current', [cTown.getCurrent, cTown.getKmaStnHourlyWeather, cTown.convert0Hto24H,
                                            cTown.getLifeIndexKma, cTown.getKeco, cTown.insertIndex,
                                            cTown.insertStrForData, cTown.getSummary, cTown.sendResult]);

module.exports = router;
