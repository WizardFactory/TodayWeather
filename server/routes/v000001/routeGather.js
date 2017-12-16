/**
 * Created by aleckim on 2016. 1. 20..
 */

var router = require('express').Router();
var server_key = require('../../config/config').keyString.cert_key;
var normal_key = require('../../config/config').keyString.normal;

var Scrape = require('../../lib/kmaScraper');
var PastConditionGather = require('../../lib/PastConditionGather');
var ctrlHealthDay = require('../../controllers/controllerHealthDay');
var KasiRiseSet = require('../../controllers/kasi.riseset.controller');

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ gather > request | Time[', printTime.toISOString(), ']');

    next();
});

router.get('/current/:mx/:my', function(req, res) {
    if (req.params.mx == undefined || req.params.my == undefined) {
        res.sendStatus(400);
        return;
    }
    var mCoord = {mx:req.params.mx, my:req.params.my};
    manager.getKmaData("current", mCoord, server_key, function (err, results) {
        if (err) {
            res.status(500).send(err.message);
        }
        else {
            res.send(results);
        }
    });
});

router.get('/current', function(req, res) {
    manager.getTownCurrentData(9, server_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/past', function(req, res) {
    var pastGather = new PastConditionGather();
    pastGather.start(1, server_key, function (err) {
        if (err) {
            log.error(err);
        }
    });
    res.send();
});

router.get('/shortrss', function(req, res) {
    townRss.mainTask(function() {
        log.info("RSS:res.send()");
        res.send();
    });
});

router.get('/midrss', function(req, res) {
    manager.midRssKmaRequester.mainProcess(manager.midRssKmaRequester, function (self, err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/midtemp', function(req, res) {
    manager.getMidTemp(9, normal_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/midland', function(req, res) {
    manager.getMidLand(9, normal_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/midforecast', function(req, res) {
    manager.getMidForecast(9, normal_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/midsea', function(req, res) {
    manager.getMidSea(9, normal_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/keco', function(req, res) {
    manager.keco.cbKecoProcess(manager.keco, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/kecoForecast', function(req, res) {
    manager.keco.getMinuDustFrcstDspth.call(manager.keco, function (err) {
        if (err !== 'skip') {
            log.error(err);
        }

        res.send();
    });
});

router.get('/short/:mx/:my', function(req, res) {
    if (req.params.mx == undefined || req.params.my == undefined) {
        res.sendStatus(400);
        return;
    }
    var mCoord = {mx:req.params.mx, my:req.params.my};
    manager.getKmaData("short", mCoord, server_key, function (err, results) {
        if (err) {
            res.status(500).send(err.message);
        }
        else {
            res.send(results);
        }
    });
});

router.get('/short', function(req, res) {
    manager.getTownShortData(9, server_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/shortest/:mx/:my', function(req, res) {
    if (req.params.mx == undefined || req.params.my == undefined) {
        res.sendStatus(400);
        return;
    }
    var mCoord = {mx:req.params.mx, my:req.params.my};
    manager.getKmaData("shortest", mCoord, server_key, function (err, results) {
        if (err) {
            res.status(500).send(err.message);
        }
        else {
            res.send(results);
        }
    });
});

router.get('/shortest', function(req, res) {
    manager.getTownShortestData(9, server_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/lifeindex', function (req, res) {
    manager.taskKmaIndexService.cbKmaIndexProcess(manager.taskKmaIndexService, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/healthday', function(req, res) {
    var requestUrl;
    var urlList = [];
    
    for(var i=1;i<=7;i++) {
        requestUrl = ctrlHealthDay.makeRequestString(i, 0);
        urlList.push(requestUrl);
    }

    ctrlHealthDay.getData(urlList, function(err) {
        if(err) {
            log.error(err);
        }
        res.send();
    });
});

/**
 * don't use
 */
router.get('/kmaStnHourly', function (req, res) {
    var scrape = new Scrape();
    scrape.getStnHourlyWeather(undefined, function (err, results) {
        if (err) {
            if (err === 'skip') {
                log.info('stn hourly weather info is already updated');
            }
            else {
                log.error(err);
            }
        }
        else {
            log.silly(results);
        }
        res.send();
    });
});

router.get('/kmaStnPastHourly', function (req, res) {
    var scrape = new Scrape();
    scrape.getStnPastHourlyWeather(8, function (err, results) {
        if (err) {
            if (err === 'skip') {
                log.info('stn hourly weather info is already updated');
            }
            else {
                log.error(err);
            }
        }
        else {
            log.silly(results);
        }
        res.send();
    });
});

router.get('/kmaStnMinute', function (req, res) {
    var scrape = new Scrape();
    scrape.getStnMinuteWeather(function (err, results) {
        if (err) {
            if (err === 'skip') {
                log.info('stn minute weather info is already updated');
            }
            else {
                log.error(err);
            }
        }
        else {
            log.silly(results);
        }
        res.send();
    });
});

router.get('/updateStnRnsHitRate', function (req, res) {
    var scrape = new Scrape();
    scrape.updateRnsHitRates(function (err, results) {
        if (err) {
            log.error(err);
        }
        else {
            log.silly(results);
        }
        res.send();
    });
});

router.get('/invalidateCloudFront/:items', function(req, res){
    var keydata  = require('../../config/config').keyString;
    var awsData = require('../../config/config').aws;
    var items = [];
    if(req.params.items === 'ALL'){
        items.push('/town/*')
    }

    manager.deleteCacheOnCloudFront(items,
        awsData.region,
        keydata.aws_access_key,
        keydata.aws_secret_key,
        awsData.cloudfront_api_version,
        awsData.distribution_id,
        function(err){
            if(err){
                log.error(err);
            }
            res.send();
        }
    );
});

router.get('/gatherKasiRiseSet', function(req, res) {
    KasiRiseSet.gatherAreaRiseSetFromApi(function (err, result) {
        if (err) {
            log.error(err);
            return res.status(500).send(err);
        }
        res.send(result);
    });
});

router.get('/updateInvalidt1h', function(req, res) {
    manager.updateInvalidT1hData(9, server_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

module.exports = router;
