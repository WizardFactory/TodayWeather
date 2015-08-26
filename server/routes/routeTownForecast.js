/**
 * Created by Peter on 2015. 8. 24..
 */
"use strict";

var router = require('express').Router();
var config = require('../config/config');

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ townForecast > request | Time[', printTime.toISOString(), ']');

    next();
});

/****************************************************************************
*   THIS IS FOR TEST.
*****************************************************************************/
function getShortFromDB(regionName, cityName, townName, callback){
    var err = 0;
    var result = config.testData.short;
    result.대분류 = regionName;
    result.중분류 = cityName;
    result.소분류 = townName;

    if(callback){
        callback(err, result);
    }
}

function getShortestFromDB(regionName, cityName, townName, callback){
    var err = 0;
    var result = config.testData.shortest;
    result.대분류 = regionName;
    result.중분류 = cityName;
    result.소분류 = townName;

    if(callback){
        callback(err, result);
    }
}

function getCurrentFromDB(regionName, cityName, townName, callback){
    var err = 0;
    var result = config.testData.current;
    result.대분류 = regionName;
    result.중분류 = cityName;
    result.소분류 = townName;

    if(callback){
        callback(err, result);
    }
}
/****************************************************************************/


var getShort = function(req, res, next){
    var meta = {};

    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = 'getShort';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('>', meta);

    /****************************************************************************
     *   THIS IS FOR TEST.
     *****************************************************************************/
    getShortFromDB(regionName, cityName, townName, function(err, result){
        if(err){
            log.error('> getShortFromDB : Failed to get data');
            next('route');
            return;
        }
        log.info('> getShortFromDB : successed to get data');

        req.short = result;
        next();
    });
    /****************************************************************************/
};

var getShortest = function(req, res, next){
    var meta = {};

    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = 'getShortest';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('>', meta);

    /****************************************************************************
     *   THIS IS FOR TEST.
     *****************************************************************************/
    getShortestFromDB(regionName, cityName, townName, function(err, result){
        if(err){
            log.error('> getShortestFromDB : Failed to get data');
            next('route');
            return;
        }
        log.info('> getShortestFromDB : successed to get data');

        req.shortest = result;
        next();
    });
    /****************************************************************************/
};

var getCurrent = function(req, res, next){
    var meta = {};

    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = 'getCurrent';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('>', meta);

    /****************************************************************************
     *   THIS IS FOR TEST.
     *****************************************************************************/
    getCurrentFromDB(regionName, cityName, townName, function(err, result){
        if(err){
            log.error('> getCurrentFromDB : Failed to get data');
            next('route');
            return;
        }
        log.info('> getCurrentFromDB : successed to get data');

        req.current = result;
        next();
    });
    /****************************************************************************/
};

router.get('/:region/:city/:town', [getShort, getShortest, getCurrent], function(req, res) {
    var meta = {};

    var result = {};
    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = '/:region/:city/:town';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('##', meta);

    if(req.short){
        result.short = req.short;
    }
    if(req.shortest){
        result.shortest = req.shortest;
    }
    if(req.current){
        result.current = req.current;
    }

    res.json(result);
});

router.get('/:region/:city/:town/short', getShort, function(req, res) {
    var meta = {};

    var result = {};
    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = '/:region/:city/:town/short';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('##', meta);

    if(req.short){
        result.short = req.short;
    }

    res.json(result);
});

router.get('/:region/:city/:town/shortest', getShortest, function(req, res) {
    var meta = {};

    var result = {};
    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = '/:region/:city/:town/shortest';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('##', meta);

    if(req.shortest){
        result.shortest = req.shortest;
    }

    res.json(result);
});

router.get('/:region/:city/:town/current', getCurrent, function(req, res) {
    var meta = {};

    var result = {};
    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = '/:region/:city/:town/current';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('##', meta);

    if(req.current){
        result.current = req.current;
    }
    res.json(result);
});

router.get('/', function(req, res){
    var result = {};

    result.usage = [
        '/{도,특별시,광역시} : response summarized weather information on matched region',
        '/{도,특별시,광역시}/{시,군,구} : response summarized weather information on matched city',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍} : response weather data for all three types such as short, shortest, current',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/short : response only short information',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/shortest : response only shortest information',
        '/{도,특별시,광역시}/{시,군,구}/{동,면,읍}/current : response only current information'
    ];
    res.json(result);
});

module.exports = router;