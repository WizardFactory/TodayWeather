/**
 * Created by Peter on 2016. 3. 17..
 */
var express = require('express');
var router = express.Router();
var worldWeather = new (require('../../controllers/worldWeather/controllerWorldWeather'))();

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ weather > request | Time[', printTime.toISOString(), ']');

    next();
});

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'TodayWeather' });
});

router.get('/:version', [worldWeather.checkApiVersion, worldWeather.checkCommand, worldWeather.showUsage,
    worldWeather.sendResult]);

router.get('/:version/:category', [worldWeather.checkApiVersion, worldWeather.queryWeather,
    worldWeather.mergeWuForecastData, worldWeather.mergeWuCurrentDataToTimely, worldWeather.mergeWuCurrentData,
    worldWeather.mergeDsfData, worldWeather.sendResult]);

// temporary
router.get('/:version/:category/:days', worldWeather.checkApiVersion, worldWeather.queryTwoDaysWeather,
    worldWeather.mergeWuForecastData, worldWeather.mergeWuCurrentDataToTimely, worldWeather.mergeWuCurrentData,
    worldWeather.mergeDsfDailyData, worldWeather.mergeDsfHourlyData, worldWeather.dataSort, worldWeather.addLocalTime,
    worldWeather.sendResult);

module.exports = router;