/**
 * Created by aleckim on 2016. 4. 27..
 */

var router = require('express').Router();

var ControllerTown24h = require('../../controllers/controllerTown24h');

var cTown = new ControllerTown24h();

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ dailySummary > request | Time[', printTime.toISOString(), ']');

    next();
});

function divideParams(req, res, next) {
    var params = req.params[0].split('/');
    req.params.region = params[0];
    req.params.city = params[1];
    req.params.town = params[2];
    return next();
}


router.get('/town/*', [divideParams, cTown.getAllDataFromDb, cTown.getShort, cTown.getShortRss, cTown.getShortest,
                                    cTown.getCurrent, cTown.updateCurrentListForValidation, cTown.mergeCurrentByStnHourly, cTown.getKmaStnMinuteWeather,
                                    cTown.convert0Hto24H, cTown.mergeCurrentByShortest, cTown.mergeShortWithCurrentList,
                                    cTown.mergeByShortest, cTown.adjustShort,
                                    cTown.getMid, cTown.getMidRss, cTown.convertMidKorStrToSkyInfo, cTown.getPastMid, cTown.mergeMidWithShort,
                                    cTown.getLifeIndexKma, cTown.getKeco, cTown.getKecoDustForecast,
                                    cTown.insertIndex, cTown.insertStrForData, cTown.getSummary,
                                    cTown.dataToFixed, cTown.makeDailySummary, cTown.sendDailySummaryResult]);

router.get('/geo/:lat/:lon', [], function(req, res) {

});

module.exports = router;
