/**
 * Created by aleckim on 2018. 2. 2..
 */

var async = require('async');
var express = require('express');
var router = express.Router();
var ControllerPush = require('../../controllers/controllerPush');
var AlertPushController = require('../../controllers/alert.push.controller');
var UnitConverter = require('../../lib/unitConverter');

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
                    log.warn(`pushInfo source is undefined fcmToken:${pushInfo.fcmToken}, regId:${pushInfo.registrationId}`);
                }
                if (pushInfo.category == undefined) {
                    log.warn(`pushInfo category is undefined fcmToken:${pushInfo.fcmToken}, regId:${pushInfo.registrationId}`);
                    pushInfo.category = 'alarm';
                }
                if (pushInfo.package == undefined) {
                    log.warn(`pushInfo package is undefined fcmToken:${pushInfo.fcmToken}, regId:${pushInfo.registrationId}`);
                    pushInfo.package = 'todayWeather';
                }

                pushInfo.units = UnitConverter.initUnits(pushInfo.units);

                log.info('pushInfo : '+ JSON.stringify(pushInfo));
            }
            catch (err) {
                return callback (err);
            }
            if (pushInfo.category === 'alarm') {
                var co = new ControllerPush();
                co.updatePushInfo(pushInfo, function (err, result) {
                    if (err) {
                        log.error(err);
                    }
                    callback(undefined, result);
                });
            }
            else if (pushInfo.category === 'alert') {
                var ca = new AlertPushController();
                ca.updateAlertPush(pushInfo, function (err, result) {
                    if (err) {
                        log.error(err);
                    }
                   callback(undefined, result) ;
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

    var language = req.headers['accept-language'] || req.headers['Accept-Language'];

    if (language == undefined) {
        log.warn("accept-language is undefined");
        language = 'en';
    }
    else {
        language = language.split(',')[0];
        if (language) {
            if ( language.indexOf('ko') >= 0 ||
                language.indexOf('en') >= 0 ||
                language.indexOf('ja') >= 0 ||
                language.indexOf('de') >= 0 )
            {
                language = language.substr(0, 2);
            }
        }
        else {
            log.error("Fail to parse language="+req.headers['accept-language']);
            language = 'en';
        }
    }

    var pushList = req.body;
    try {
        pushList.forEach(function (obj) {
           if (!obj.hasOwnProperty('type') || obj.type.length === 0)
           {
               throw new Error('invalid push info type');
           }

           if (!obj.hasOwnProperty('fcmToken') || obj.fcmToken.length === 0)
           {
               if (!obj.hasOwnProperty('registrationId') || obj.registrationId.length === 0) 
               {
                   throw new Error('invalid push info registrationId and fcmToken');
               }
           }

           if (!obj.hasOwnProperty('location') && !obj.hasOwnProperty('town')) {
               throw new Error('invalid push info location or town is empty');
           }
        });
    }
    catch (err) {
        log.error(err);
        return res.status(403).send(err.message);
    }

    updatePushInfoList(language, pushList, function (err, result) {
        if (err) {
            log.error(err);
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
