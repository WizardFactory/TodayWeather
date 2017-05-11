/**
 * Created by Peter on 2016. 3. 17..
 */
var express = require('express');
var router = express.Router();
var controllerRequester = require('../../controllers/worldWeather/controllerRequester');
var requester = new controllerRequester();

router.use(function timestamp(req, res, next){
    log.info('@@ + ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' + req.sessionID);

    next();
});

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'TodayWeather' });
});

router.get('/:category/:command', [requester.checkKey, requester.runCommand, requester.sendResult]);

module.exports = router;