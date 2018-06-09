/**
 * Created by Peter on 2016. 3. 17..
 */
var express = require('express');
var router = express.Router();
var worldWeather = new (require('../../controllers/worldWeather/controllerWorldWeather'))();

router.use(function timestamp(req, res, next){
    log.info('## + ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' + req.sessionID);
    next();
});

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'TodayWeather' });
});

router.get('/:version', [worldWeather.checkApiVersion, worldWeather.checkCommand, worldWeather.showUsage, worldWeather.sendResult]);
router.get('/:version/:category', [worldWeather.checkApiVersion, worldWeather.queryWeather,
    worldWeather.mergeWuForecastData, worldWeather.mergeWuCurrentDataToHourly, worldWeather.mergeWuCurrentData,
    worldWeather.mergeDsfData, worldWeather.sendResult]);

// temporary
router.get('/:version/:category/:days', worldWeather.checkApiVersion,
    worldWeather.queryTwoDaysWeatherNewForm, worldWeather.convertDsfLocalTime,
    worldWeather.mergeDsfDailyData, worldWeather.mergeDsfCurrentDataNewForm, worldWeather.mergeDsfHourlyData,
    worldWeather.mergeAqi, worldWeather.dataSort, worldWeather.sendResult);

module.exports = router;