/**
 *
 * Created by aleckim on 2017. 12. 08..
 */

'use strict';

var router = require('express').Router();

var worldWeather = new (require('../../controllers/worldWeather/controllerWorldWeather'))();
var ControllerWWUnits = require('../../controllers/worldWeather/controller.ww.units');
var ctrlUnits = new ControllerWWUnits();

router.use(function timestamp(req, res, next){
    log.info('## + ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' + req.sessionID);
    next();
});

function convertParamAndQuery(req, res, next) {
    req.params=req.params||{};
    req.params.category = 'current';
    req.params.days = '2';

    req.query = req.query||{};
    req.query.gcode = req.params.loc;
    req.query.aqi = req.query.airUnit;

    req.validVersion = true;

    next();
}

router.get('/:loc', ctrlUnits.checkQueryValidation, convertParamAndQuery, worldWeather.queryTwoDaysWeather, worldWeather.convertDsfLocalTime,
    worldWeather.mergeDsfDailyData, worldWeather.mergeDsfCurrentData, worldWeather.mergeDsfHourlyData,
    worldWeather.mergeAqi, worldWeather.dataSort, ctrlUnits.convertUnits, ctrlUnits.makeSummary, worldWeather.sendResult);

module.exports = router;
