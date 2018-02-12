/**
 * Created by aleckim on 2018. 2. 2..
 */

var async = require('async');
var express = require('express');
var router = express.Router();
var ControllerPush = require('../../controllers/controllerPush');
var AlertPushController = require('../../controllers/alert.push.controller');

function updatePushInfoList(language, pushList, callback) {
    if (!Array.isArray(pushList)) {
        var err = new Error('Invalid push info list');
        err.statusCode = 403;
        return callback(err);
    }

    async.map(pushList,
        function (pushInfo, callback) {
            try {
                pushInfo.lang = language;
                if (pushInfo.location) {
                    pushInfo.geo = [pushInfo.location.long, pushInfo.location.lat];
                }
                if (pushInfo.source == undefined) {
                    log.error('pushInfo source is undefined');
                    pushInfo.source = "KMA"
                }

                log.info('pushInfo : '+ JSON.stringify(pushInfo));
            }
            catch (err) {
                return callback (err);
            }
            if (pushInfo.category === 'alarm') {
                var co = new ControllerPush();
                co.updatePushInfo(pushInfo, function (err, result) {
                    callback(err, result);
                });
            }
            else if (pushInfo.category === 'alert') {
                var ca = new AlertPushController();
                ca.updateAlertPush(pushInfo, function (err, result) {
                   callback(err, result) ;
                })
            }
        },
        function (err, results) {
            if (err) {
                err.statusCode = 500;
                return callback(err);
            }
            callback(null, results);
        });
}

router.post('/', function(req, res) {
    log.info('post : '+ JSON.stringify(req.body));
    log.info('accept-language:'+req.headers['accept-language']);

    var language = req.headers['accept-language'];
    if (language == undefined) {
        log.warn("accept-language is undefined");
        language = 'en';
    }
    else {
        language = language.split(',')[0];
        if (language) {
            language = language.substr(0, language.length-3);
        }
        else {
            log.error("Fail to parse language="+req.headers['accept-language']);
            language = 'en';
        }
    }

    var pushList = req.body;

    updatePushInfoList(language, pushList, function (err, result) {
        if (err) {
            if (err.statusCode) {
                return res.status(err.statusCode).send(err.message);
            }
            else {
                return res.status(501).send(err.message);
            }
        }
        return res.send(result);
    });
});

module.exports = router;
