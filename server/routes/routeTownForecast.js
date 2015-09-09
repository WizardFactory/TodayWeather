/**
 * Created by Peter on 2015. 8. 24..
 */
"use strict";

var router = require('express').Router();
var config = require('../config/config');
var dbForecast = require('../models/forecast');

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ townForecast > request | Time[', printTime.toISOString(), ']');

    next();
});

function getTimeValue(){
    var i=0;
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(-39);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };
    var time = currentDate.slice(8, 12);

    if(parseInt(time) < 300){
        dateString.time = '0000';
    }
    else if(parseInt(time) < 600) {
        dateString.time = '0300';
    }
    else if(parseInt(time) < 900){
        dateString.time = '0600';
    }
    else if(parseInt(time) < 1200){
        dateString.time = '0900';
    }
    else if(parseInt(time) < 1500){
        dateString.time = '1200';
    }
    else if(parseInt(time) < 1800){
        dateString.time = '1500';
    }
    else if(parseInt(time) < 2100){
        dateString.time = '1800';
    }
    else if(parseInt(time) < 2400){
        dateString.time = '2100';
    }
    else{
        log.error('unknown TimeString');
        return;
    }

    return dateString;
}

/****************************************************************************
*   THIS IS FOR TEST.
*****************************************************************************/

function getTimeTable(){
    var i=0;
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(-39);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };
    var time = currentDate.slice(8, 12);
    var day = 0;
    var listResult = [];

    if(parseInt(time) < 300){
        dateString.time = '0000';
    }
    else if(parseInt(time) < 600) {
        dateString.time = '0300';
    }
    else if(parseInt(time) < 900){
        dateString.time = '0600';
    }
    else if(parseInt(time) < 1200){
        dateString.time = '0900';
    }
    else if(parseInt(time) < 1500){
        dateString.time = '1200';
    }
    else if(parseInt(time) < 1800){
        dateString.time = '1500';
    }
    else if(parseInt(time) < 2100){
        dateString.time = '1800';
    }
    else if(parseInt(time) < 2400){
        dateString.time = '2100';
    }
    else{
        log.error('unknown TimeString');
        return;
    }

    log.info('make time table');
    listResult.push(JSON.parse(JSON.stringify(dateString)));
    for(i=0 ; i<45 ; i++){
        if(dateString.time === '2100'){
            if(day === 0){
                currentDate = timeFunction.getWorldTime(-15);
            }
            else if(day === 1){
                currentDate = timeFunction.getWorldTime(+9);
            }
            else if(day === 2){
                currentDate = timeFunction.getWorldTime(+33);
            }else if(day === 3){
                currentDate = timeFunction.getWorldTime(+57);
            }else if(day === 4){
                currentDate = timeFunction.getWorldTime(+81);
            }

            dateString.time = '0000';
            dateString.date = currentDate.slice(0, 8);
            day++;
        }
        else{
            var timeValue = new Number(parseInt(dateString.time) + 300);
            dateString.time = timeValue.toString();
        }

        listResult.push(JSON.parse(JSON.stringify(dateString)));
    }

    log.info(listResult);
    return listResult;
}
function getShortFromDB(regionName, cityName, townName, callback){
    var err = 0;
    var listTownData = config.testTownData;
    var result = [];
    var resultTown = {};



    log.info('list length : ', listTownData.length);
    for(var i in listTownData){
        var townData = listTownData[i];
        if(townData.regionName === regionName && townData.cityName === cityName && townData.townName === townName){
            resultTown = townData;
            break;
        }
    }

    if(resultTown.regionName === undefined){
        resultTown = listTownData[2];
    }

    var listDate = getTimeTable();
    resultTown.data.short.forEach(function(entry, i){
        var item = {};
        item.date = listDate[i].date;//entry.date;
        item.time = listDate[i].time;//entry.time;
        item.pop = entry.pop;
        item.pty = entry.pty;
        item.r06 = entry.r06;
        item.reh = entry.reh;
        item.s06 = entry.s06;
        item.sky = entry.sky;
        item.t3h = entry.t3h;
        item.tmn = entry.tmn;
        item.tmx = entry.tmx;

        result.push(item);
    });

    if(callback){
        callback(err, result);
    }
}

function getShortestFromDB(regionName, cityName, townName, callback){
    var err = 0;
    var listTownData = config.testTownData;
    var result = {};
    var resultTown = {};

    for(var i in listTownData){
        var townData = listTownData[i];
        if(townData.regionName === regionName && townData.cityName === cityName && townData.townName === townName){
            resultTown = townData;
            break;
        }
    }

    if(resultTown.regionName === undefined){
        resultTown = listTownData[2];
    }
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(+9);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8, 10) + '00'
    };
    result.date = dateString.date;
    result.time = dateString.time;
    result.pty = Date.now() % 90;
    result.rn1 = 5;
    result.sky = Date.now() % 4;
    result.lgt = Date.now() % 3;

    if(callback){
        callback(err, result);
    }
}

function getCurrentFromDB(regionName, cityName, townName, callback){
    var err = 0;
    var listTownData = config.testTownData;
    var result = {};
    var resultTown = {};
    var index = 0;

    for(var i in listTownData){
        var townData = listTownData[i];
        if(townData.regionName === regionName && townData.cityName === cityName && townData.townName === townName){
            resultTown = townData;
            break;
        }
    }

    if(resultTown.regionName === undefined){
        resultTown = listTownData[2];
    }

    index = (Date.now() %12);
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(+9);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8, 10) + '00'
    };
    result.date = dateString.date;//resultTown.data.current[index].date;
    result.time = dateString.time;//resultTown.data.current[index].time;
    result.t1h = resultTown.data.current[index].t1h;
    result.rn1 = resultTown.data.current[index].rn1;
    result.sky = resultTown.data.current[index].sky;
    result.reh = resultTown.data.current[index].reh;
    result.pty = resultTown.data.current[index].pty;
    result.lgt = resultTown.data.current[index].lgt;

    if(callback){
        callback(err, result);
    }
}
/****************************************************************************/


var getShort = function(req, res, next){
    var meta = {};
    var resultList = [];

    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = req.params.town;

    meta.method = 'getShort';
    meta.region = regionName;
    meta.city = cityName;
    meta.town = townName;

    log.info('>', meta);

    var getMethod;

    if(config.db.mode === 'ram'){
        manager.getWeatherDb(regionName, cityName, townName, function (err, result) {
            if (err) {
                log.error('> getShort : failed to get data from DB');
                log.error(meta);
                return;
            }

            //log.info(result.toString());
            //log.info(result.mData.data.short);
            //log.info(result.mData.data.current);
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/

            try {
                var listShort = result.mData.data.short;
                var listCurrent = result.mData.data.current;
                var i = 0;
                var j = 0;
                var requestTime = getTimeValue();

                /********************
                 * TEST DATA
                 ********************/
                //requestTime.date = '20150830';
                //requestTime.time = '0300';
                /********************/

                for (i = 0; i < listCurrent.length; i++) {
                    var item = {};
                    // 현재 요구한 시간을 3시간 단위 시간으로 변환 후 변환된 날짜보다 큰 값은 예보 데이터 사용하기 위해 버림.
                    if (parseInt(listCurrent[i].date) >= parseInt(requestTime.date)) {
                        continue;
                    }
                    // 현재 요구한 시간을 3시간 단위 시간으로 변환 후 변환된 날짜가 같고 현재 시간 보다 큰 값은 예보 데이터 사용하기 위해 버림.
                    if ((listCurrent[i].date === requestTime.date) && (parseInt(listCurrent[i].time) >= parseInt(requestTime.time))) {
                        continue;
                    }

                    if (listCurrent[i].time === '0000' || listCurrent[i].time === '0300' ||
                        listCurrent[i].time === '0600' || listCurrent[i].time === '0900' ||
                        listCurrent[i].time === '1200' || listCurrent[i].time === '1500' ||
                        listCurrent[i].time === '1800' || listCurrent[i].time === '2100') {
                        item.date = listCurrent[i].date;
                        item.time = listCurrent[i].time;
                        item.pop = -100;
                        item.pty = listCurrent[i].pty;
                        item.r06 = listCurrent[i].rn1;
                        item.reh = listCurrent[i].reh;
                        item.s06 = -1;
                        item.sky = listCurrent[i].sky;
                        item.t3h = listCurrent[i].t1h;
                        item.tmn = -100;
                        item.tmx = -100;

                        resultList.push(JSON.parse(JSON.stringify(item)));
                    }
                }

                for (i = 0; i < listShort.length; i++) {
                    var item = {};
                    // 현재 시간 보다 작은 시간대의 short 데이터는 일부만 사용한다.
                    if ((parseInt(listShort[i].date) < parseInt(requestTime.date)) ||
                        (listShort[i].date === requestTime.date && parseInt(listShort[i].time) < parseInt(requestTime.time))) {
                        resultList.forEach(function (entry, index) {
                            // current 데이터를 이용해서 과거 정보를 넣었는데 이중 빠진 내용(강수확률 등의 정보는 여기에서 채워 넣는다)
                            if (entry.date === listShort[i].date && entry.time === listShort[i].time) {
                                entry.pop = listShort[i].pop;
                                entry.s06 = listShort[i].s06;
                                entry.tmn = listShort[i].tmn;
                                entry.tmx = listShort[i].tmx;
                            }
                        })
                    } else {
                        item.date = listShort[i].date;
                        item.time = listShort[i].time;
                        item.pop = listShort[i].pop;
                        item.pty = listShort[i].pty;
                        item.r06 = listShort[i].r06;
                        item.reh = listShort[i].reh;
                        item.s06 = listShort[i].s06;
                        item.sky = listShort[i].sky;
                        item.t3h = listShort[i].t3h;
                        item.tmn = listShort[i].tmn;
                        item.tmx = listShort[i].tmx;

                        resultList.push(item);
                    }
                }

                //log.info(resultList);
                req.short = resultList;
                next();
            }
            catch (e) {
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    else {
        dbForecast.getData(regionName, cityName, townName, function (err, result) {
            if (err) {
                log.error('> getShort : failed to get data from DB');
                log.error(meta);
                return;
            }

            //log.info(result.toString());
            //log.info(result.mData.data.short);
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/

            try {
                var listShort = result.mData.data.short;
                var listCurrent = result.mData.data.current;
                var i = 0;
                var j = 0;
                var requestTime = getTimeValue();

                /********************
                 * TEST DATA
                 ********************/
                //requestTime.date = '20150830';
                //requestTime.time = '0300';
                /********************/

                for (i = 0; i < listCurrent.length; i++) {
                    var item = {};
                    // 현재 요구한 시간을 3시간 단위 시간으로 변환 후 변환된 날짜보다 큰 값은 예보 데이터 사용하기 위해 버림.
                    if (parseInt(listCurrent[i].date) >= parseInt(requestTime.date)) {
                        continue;
                    }
                    // 현재 요구한 시간을 3시간 단위 시간으로 변환 후 변환된 날짜가 같고 현재 시간 보다 큰 값은 예보 데이터 사용하기 위해 버림.
                    if ((listCurrent[i].date === requestTime.date) && (parseInt(listCurrent[i].time) >= parseInt(requestTime.time))) {
                        continue;
                    }

                    if (listCurrent[i].time === '0000' || listCurrent[i].time === '0300' ||
                        listCurrent[i].time === '0600' || listCurrent[i].time === '0900' ||
                        listCurrent[i].time === '1200' || listCurrent[i].time === '1500' ||
                        listCurrent[i].time === '1800' || listCurrent[i].time === '2100') {
                        item.date = listCurrent[i].date;
                        item.time = listCurrent[i].time;
                        item.pop = -100;
                        item.pty = listCurrent[i].pty;
                        item.r06 = listCurrent[i].rn1;
                        item.reh = listCurrent[i].reh;
                        item.s06 = -1;
                        item.sky = listCurrent[i].sky;
                        item.t3h = listCurrent[i].t1h;
                        item.tmn = -100;
                        item.tmx = -100;

                        resultList.push(item);
                    }
                }

                for (i = 0; i < listShort.length; i++) {
                    var item = {};
                    // 현재 시간 보다 작은 시간대의 short 데이터는 일부만 사용한다.
                    if ((parseInt(listShort[i].date) < parseInt(requestTime.date)) ||
                        (listShort[i].date === requestTime.date && parseInt(listShort[i].time) < parseInt(requestTime.time))) {
                        resultList.forEach(function (entry, i) {
                            // current 데이터를 이용해서 과거 정보를 넣었는데 이중 빠진 내용(강수확률 등의 정보는 여기에서 채워 넣는다)
                            if (entry.date === listShort[i].date && entry.time === listShort[i].time) {
                                entry.pop = listShort[i].pop;
                                entry.s06 = listShort[i].s06;
                                entry.tmn = listShort[i].tmn;
                                entry.tmx = listShort[i].tmx;
                            }
                        })
                    } else {
                        item.date = listShort[i].date;
                        item.time = listShort[i].time;
                        item.pop = listShort[i].pop;
                        item.pty = listShort[i].pty;
                        item.r06 = listShort[i].r06;
                        item.reh = listShort[i].reh;
                        item.s06 = listShort[i].s06;
                        item.sky = listShort[i].sky;
                        item.t3h = listShort[i].t3h;
                        item.tmn = listShort[i].tmn;
                        item.tmx = listShort[i].tmx;

                        resultList.push(item);
                    }
                }

                //log.info(resultList);
                req.short = resultList;
                next();
            }
            catch (e) {
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    /****************************************************************************
     *   THIS IS FOR TEST.
     *****************************************************************************
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
     */
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

    if(config.db.mode === 'ram'){
        next();
    }
    else{
        dbForecast.getData(regionName, cityName, townName, function(err, result){
            if(err){
                if(err){
                    log.error('> getShortest : failed to get data from DB');
                    log.error(meta);
                    next('route');
                    return;
                }
            }
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/
            try{
                var listShortest = result.mData.data.shortest;

                //log.info(listShortest);
                req.shortest = listShortest[listShortest.length - 1];
                next();
            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }

    /****************************************************************************
     *   THIS IS FOR TEST.
     *****************************************************************************
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

    if(config.db.mode === 'ram'){
        manager.getWeatherDb(regionName, cityName, townName, function(err, result){
            if(err){
                if(err){
                    log.error('> getShortest : failed to get data from DB');
                    log.error(meta);
                    return;
                }
            }
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/
            try{
                var listCurrent = result.mData.data.current;

                //log.info(listCurrent);
                req.current = listCurrent[listCurrent.length - 1];
                next();
            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    else{
        dbForecast.getData(regionName, cityName, townName, function(err, result){
            if(err){
                if(err){
                    log.error('> getShortest : failed to get data from DB');
                    log.error(meta);
                    return;
                }
            }
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/
            try{
                var listCurrent = result.mData.data.current;

                //log.info(listCurrent);
                req.current = listCurrent[listCurrent.length - 1];
                next();
            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }

    /****************************************************************************
     *   THIS IS FOR TEST.
     *****************************************************************************
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

    result.regionName = regionName;
    result.cityName = cityName;
    result.townName = townName;

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

    result.regionName = regionName;
    result.cityName = cityName;
    result.townName = townName;

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

    result.regionName = regionName;
    result.cityName = cityName;
    result.townName = townName;

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

    result.regionName = regionName;
    result.cityName = cityName;
    result.townName = townName;

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