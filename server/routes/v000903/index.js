/**
 * Created by aleckim on 2018. 4. 02..
 */

"use strict";

var express = require('express');
var router = express.Router();

router.use(function timestamp(req, res, next){
    var deviceId = '';
    if (req.headers['device-id']) {
        deviceId = req.headers['device-id'];
    }

    log.info('@@ + ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' +
        req.sessionID+ ' UUID='+deviceId);
    log.info('user-agent='+req.headers['user-agent']+ '  sID=' + req.sessionID+ ' UUID='+deviceId);

    next();
});


router.use('/gather', require('../v000001/routeGather'));
//router.use('/town', require('./route.kma.addr'));
router.use('/daily', require('../v000705/dailySummary'));
router.use('/check-purchase', require('../v000705/receiptValidation'));
router.use('/push', require('../v000705/routePushNotification'));
router.use('/push-list', require('../v000902/route.push.update.list'));
router.use('/nation', require('../v000803/route.nation'));

router.use('/kma', require('./route.kma.v000903'));
//router.use('/dsf/addr', require('./route.dsf.addr'));
router.use('/dsf/coord', require('../v000902/route.dsf.coord.v000902'));

/**
 * make html error page
 */
router.post('/', function(req,res) {
    res.render('index', {title:'TodayWeather : post'});
});

router.use('/test', require('../v000803/route.test'));

router.use('/geo', require('./route.geo.v000903'));

module.exports = router;
