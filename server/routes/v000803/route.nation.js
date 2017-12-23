/**
 * Created by aleckim on 2017. 6. 21..
 */

var router = require('express').Router();
var async = require('async');
var req = require('request');
var config = require('../../config/config');

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ nation > request | Time[', printTime.toISOString(), ']');

    next();
});

/**
 *
 * @param cityName
 * @param callback
 */
function requestApi(cityName, callback) {
    var version = "v000803";
    var url = config.push.serviceServer+"/"+version+"/town"+"/"+encodeURIComponent(cityName);

    log.info('Start '+cityName+' '+new Date());
    req(url, {json:true}, function(err, response, body) {
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

router.get('/SouthKorea', function(req, res) {

    //서울(서울경기), 춘천(강원도), 부산(경남), 대구(경북), 제주(제주), 광주(전남), 대전(충남), 청주(충북), 전주(전북), 강릉,
    //수원, 인천, 안동, 울릉도/독도, 목표, 여수, 울산, 백령도, 창원
    var cityArray = ["서울특별시", "강원도/춘천시", "부산광역시", "대구광역시", "제주특별자치도/제주시", "광주광역시", "대전광역시",
        "충청북도/청주시", "전라북도/전주시", "강원도/강릉시"];

    async.map(cityArray,
        function (city, callback) {
            requestApi(city, function (err, weatherInfo) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, weatherInfo);
            });
        },
        function (err, weatherList) {
            if (err) {
                log.error(err);
                return res.status(500).send(err);
            }
            return res.send({nation:"SouthKorea", weather:weatherList});
        });

});

module.exports = router;
