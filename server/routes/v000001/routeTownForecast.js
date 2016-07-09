/**
 * Created by Peter on 2015. 8. 24..
 */

var router = require('express').Router();
var ControllerTown = require('../../controllers/controllerTown');
var cTown = new ControllerTown();

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ townForecast > request | Time[', printTime.toISOString(), ']');

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
                        cTown.getCurrent, cTown.adjustShort, cTown.getKeco, cTown.getMid,
                        cTown.getMidRss, cTown.getPastMid, cTown.mergeMidWithShort,
                        cTown.mergeByShortest, cTown.dataToFixed, cTown.sendResult]);

router.get('/:region/:city', [cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                cTown.getCurrent, cTown.adjustShort, cTown.getKeco, cTown.getMid,
                                cTown.getMidRss, cTown.getPastMid, cTown.mergeMidWithShort,
                                cTown.mergeByShortest, cTown.dataToFixed, cTown.sendResult]);

router.get('/:region/:city/:town', [cTown.getAllDataFromDb, cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                    cTown.getCurrent, cTown.getKmaStnHourlyWeather,
                                    cTown.mergeShortWithCurrentList, cTown.mergeByShortest, cTown.adjustShort,
                                    cTown.getMid,cTown.getMidRss, cTown.getPastMid, cTown.mergeMidWithShort,
                                    cTown.getLifeIndexKma, cTown.getKeco,
                                    cTown.dataToFixed, cTown.sendResult]);

router.get('/:region/:city/:town/mid', [cTown.getMid, cTown.getMidRss, cTown.getPastMid,
                                    cTown.mergeMidWithShort, cTown.dataToFixed, cTown.sendResult]);

router.get('/:region/:city/:town/short', [cTown.getShort, cTown.getShortRss, cTown.adjustShort, cTown.dataToFixed, cTown.sendResult]);

router.get('/:region/:city/:town/shortest', [cTown.getShortest, cTown.dataToFixed, cTown.sendResult]);

router.get('/:region/:city/:town/current', [cTown.getCurrent, cTown.getKeco, cTown.dataToFixed, cTown.sendResult]);

module.exports = router;