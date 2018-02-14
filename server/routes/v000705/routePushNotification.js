/**
 * Created by aleckim on 2016. 5. 2..
 */

var express = require('express');
var router = express.Router();
var config = require('../../config/config');
var ControllerPush = require('../../controllers/controllerPush');

/**
 * pushTime은 UTC 기준으로 전달됨.
 * accept-language:ko-kr
 * post : {"registrationId":"7974b5d61f30f4045894b5f22780878b402b8ea48bce07953704076488fdcf53",
 *          "type":"ios","pushTime":82800,"cityIndex":0,"town":{"first":"서울특별시","second":"송파구","third":"잠실본동"},
 *          "name":"잠실본동","location":{"lat":37.5042121534679,"long":127.0859521091583},"source":"KMA",
 *          "units":{"temperatureUnit":"C","windSpeedUnit":"m/s","pressureUnit":"hPa",
 *          "distanceUnit":"m","precipitationUnit":"mm"}}
 * create or update pushInfo
 */
router.post('/', function(req, res) {
    log.info('post : '+ JSON.stringify(req.body));
    log.info('accept-language:'+req.headers['accept-language']);

    //update modelPush
    //return _id

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

    var pushInfo;

    try {
        pushInfo = req.body;

        if (!pushInfo.hasOwnProperty('registrationId') ||
            !pushInfo.hasOwnProperty('type') )
        {
            throw new Error('invalid push info registrationId/type');
        }
        if (pushInfo.registrationId.length === 0 ||
            pushInfo.type.length === 0)
        {
            throw new Error('invalid push info registrationId/type');
        }
        if (!pushInfo.hasOwnProperty('location') && !pushInfo.hasOwnProperty('town')) {
            throw new Error('invalid push info location or town is empty');
        }

        pushInfo.lang = language;
        if (pushInfo.location && pushInfo.location.hasOwnProperty('long') && pushInfo.location.hasOwnProperty('lat')) {
            pushInfo.geo = [pushInfo.location.long, pushInfo.location.lat];
        }

        if (pushInfo.source == undefined) {
            pushInfo.source = "KMA"
        }

        log.info('pushInfo : '+ JSON.stringify(pushInfo));
    }
    catch (err) {
        return res.status(403).send(err.message);
    }

    var co = new ControllerPush();
    co.updatePushInfo(pushInfo, function (err, result) {
        if (err) {
            log.error(err);
            //return  res error
            return res.status(500).send(err.message);
        }
        return res.send(result);
    });
});

/**
 * update registration id
 */
router.put('/', function(req, res) {
    log.info('put : '+ JSON.stringify(req.body));
    var co = new ControllerPush();
    co.updateRegistrationId(req.body.newRegId, req.body.oldRegId, function (err, result) {
        if (err) {
            log.error(err);
            //return  res error
            return res.status(500).send(err.message);
        }
        return res.send(result);
    });
});

/**
 * remove
 */
router.delete('/', function(req, res) {
    log.info('delete : '+ JSON.stringify(req.body));

    var co = new ControllerPush();
    co.removePushInfo(req.body, function (err, result) {
        if (err) {
            log.error(err);
            //return  res error
            return res.status(500).send(err.message);
        }
        return res.send(result.toString());
    });
});

module.exports = router;
