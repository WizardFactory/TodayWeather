/**
 * Created by aleckim on 2017. 6. 16..
 */

var router = require('express').Router();

var test = require('../../controllers/route.test.controller');

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ testRoute > request | Time[', printTime.toISOString(), ']');

    next();
});

function divideParams(req, res, next) {
    var params = req.params[0].split('/');
    req.params.region = params[0];
    req.params.city = params[1];
    req.params.town = params[2];
    return next();
}

router.get('/stnWeatherHourly/*', [divideParams, test.stnWeatherHourly]);
router.get('/stnWeatherMinute/*', [divideParams, test.stnWeatherMinute]);

module.exports = router;
