/**
 * Created by aleckim on 2017. 6. 21..
 */

"use strict";

var router = require('express').Router();
var async = require('async');
var req = require('request');
var config = require('../../config/config');

var ControllerTown24h = require('../../controllers/controllerTown24h');
var KecoCtrl = require('../../controllers/kecoController');

var cTown = new ControllerTown24h();

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ nation > request | Time[', printTime.toISOString(), ']');

    next();
});

/**
 *
 * @param cityName
 * @param version
 * @param query
 * @param lang
 * @param callback
 */
function requestApi(cityName, version, query, lang, callback) {
    var apiEndpoint;

    version = version || 'v000901';
    apiEndpoint = version >= 'v000901'? '/kma/addr':'/town';

    var arrayCityName;
    arrayCityName = cityName.split("/");
    var url = config.apiServer.url+'/'+version+apiEndpoint;
    arrayCityName.forEach(function (name) {
        url += "/"+encodeURIComponent(name);
    });

    if (query) {
        var count = 0;
        for (var key in query) {
            url += count === 0? "?":"&";
            url += key+'='+query[key];
            count++;
        }
    }

    /**
     * 못 받으면 다음 요청에 받도록 timeout을 길게 함
     */
    var options = {json: true, timeout: 9000, headers: {'Accept-Language' : lang}};

    log.info({city: cityName, date: new Date(), url: url});

    req(url, options, function(err, response, body) {
        log.info('Finished '+cityName+' '+new Date());
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            err = new Error("response.statusCode="+response.statusCode);
            log.error(err);
            return callback(err);
        }
        callback(undefined, body);
    });
}

function getSidoArpltn(req, res, next) {
    var meta = {};
    meta.sID = req.sessionID;
    meta.method = 'getSidoArpltn';
    meta.region = req.params.region;
    meta.city = req.params.city;
    meta.town = req.params.town;
    log.info(meta);

    var airUnit = req.query.airUnit;

    KecoCtrl.getSidoArpltn(function (err, arpltnList) {
        if (err) {
            err.message += ' ' + JSON.stringify(meta);
            log.error(err);
            return next(err);
        }

        try {
            arpltnList.forEach(function (arpltn) {
                KecoCtrl.recalculateValue(arpltn, airUnit);
            });
            req.air = arpltnList;
        }
        catch (err) {
           return next(err);
        }
        next();
    });
}

function getWeather(req, res, next) {
    var meta = {};
    meta.sID = req.sessionID;
    meta.method = 'getWeather';
    log.info(meta);

    //서울(서울경기), 춘천(강원도), 부산(경남), 대구(경북), 제주(제주), 광주(전남), 대전(충남), 청주(충북), 전주(전북), 강릉,
    //수원, 인천, 안동, 울릉도/독도, 목표, 여수, 울산, 백령도, 창원
    var cityArray = ["서울특별시", "강원도/춘천시", "부산광역시", "대구광역시", "제주특별자치도/제주시", "광주광역시", "대전광역시",
        "충청북도/청주시", "전라북도/전주시", "강원도/강릉시", "인천광역시", "전라남도/목포시", "전라남도/여수시", "경상북도/안동시", "울산광역시"];

    var acceptLanguage;
    if (req.headers) {
        if (req.headers.hasOwnProperty('accept-language')) {
           acceptLanguage = req.headers['accept-language'];
        }
        if (req.headers.hasOwnProperty('Accept-Language')) {
            acceptLanguage = req.headers['Accept-Language'];
        }
    }

    async.map(cityArray,
        function (city, callback) {
            requestApi(city, req.version, req.query, acceptLanguage, function (err, weatherInfo) {
                if (err) {
                    return callback(err);
                }
                delete weatherInfo.airInfo;
                delete weatherInfo.airInfoList;
                callback(undefined, weatherInfo);
            });
        },
        function (err, weatherList) {
            if (err) {
                err.message += ' ' + JSON.stringify(meta);
                log.error(err);
                return next(err);
            }
            req.weather = weatherList;

            next();
        });
}

router.get('/:nation', [cTown.checkQueryValidation, getSidoArpltn, getWeather], function(req, res) {

    var result = {nation:"KR"};

    if (req.weather) {
        result.weather = req.weather;
    }
    if (req.air) {
        result.air = req.air;
    }

    if (result.weather || result.air) {
        res.send(result);
    }
    else {
        res.status(501).send("Fail to get nation weather");
    }
});

module.exports = router;
