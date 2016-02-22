var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res) {
  res.render('index', { title: 'TodayWeather' });
});

router.use('/town', require('./routeTownForecast'));
router.use('/gather', require('./routeGather'));

module.exports = router;
