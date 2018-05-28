/**
 *
 * Created by aleckim on 2018. 1. 24..
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


function _2lowcase(str) {
   return str.replace("Sun", "sun")
       .replace("Moon", "moon")
       .replace("SmallCloud", "_smallcloud")
       .replace("BigCloud", "_bigcloud")
       .replace("Cloud", "cloud")
       .replace("RainSnow", "_rainsnow")
       .replace("Rain", "_rain")
       .replace("Snow", "_snow")
       .replace("Lightning", "_lightning");
}

function skyIconLowCase(req, res, next) {
    var result = req.result;
    if (result == undefined) {
        return next();
    }

    try {
        if (result.daily) {
            result.daily.forEach(function (obj) {
                if (obj.skyIcon) {
                    obj.skyIcon = _2lowcase(obj.skyIcon);
                }
            });
        }
        if (result.thisTime) {
            result.thisTime.forEach(function (obj) {
                if (obj.skyIcon) {
                    obj.skyIcon = _2lowcase(obj.skyIcon);
                }
            });
        }
        if (result.hourly) {
            result.hourly.forEach(function (obj) {
                if (obj.skyIcon) {
                    obj.skyIcon = _2lowcase(obj.skyIcon);
                }
            });
        }
    }
    catch (err) {
        log.error(err);
    }
    next();
}

router.get('/:loc', ctrlUnits.checkQueryValidation, convertParamAndQuery,
    worldWeather.queryTwoDaysWeatherNewForm, worldWeather.convertDsfLocalTime,
    worldWeather.mergeDsfDailyData, worldWeather.mergeDsfCurrentDataNewForm,
    worldWeather.mergeDsfHourlyData, worldWeather.mergeAqi, worldWeather.dataSort,
    skyIconLowCase, ctrlUnits.convertUnits, worldWeather.makeAirInfo, ctrlUnits.makeSummary, worldWeather.sendResult);

module.exports = router;
