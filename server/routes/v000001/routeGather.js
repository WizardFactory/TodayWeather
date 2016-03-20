/**
 * Created by aleckim on 2016. 1. 20..
 */

var router = require('express').Router();
var server_key = require('../../config/config').keyString.cert_key;
var normal_key = require('../../config/config').keyString.normal;

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ gather > request | Time[', printTime.toISOString(), ']');

    next();
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
    var PastConditionGather = require('../../lib/PastConditionGather');
    var pastGather = new PastConditionGather();
    pastGather.start(1, server_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
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
    manager.keco.cbMainProcess(manager.keco, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
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

router.get('/shortest', function(req, res) {
    manager.getTownShortestData(9, server_key, function (err) {
        if (err) {
            log.error(err);
        }
        res.send();
    });
});

router.get('/lifeindex', function (req, res) {
    manager.taskKmaIndexService.cbMainProcess(manager.taskKmaIndexService, function (err) {
        if (err) {
            log.error(err);
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

module.exports = router;
