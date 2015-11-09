/**
 * Created by Peter on 2015. 8. 24..
 */
"use strict";

var router = require('express').Router();
var config = require('../config/config');
var dbForecast = require('../models/forecast');
var dbCurrent = require('../models/current');
var dbShort = require('../models/short');
var DateUtil = require('../models/dateUtil');

router.use(function timestamp(req, res, next){
    var printTime = new Date();
    log.info('+ townForecast > request | Time[', printTime.toISOString(), ']');

    next();
});

function getShortestTimeValue(gmt){
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };
    var nowTime = parseInt(currentDate.slice(10,12));

    if(nowTime >= 30){
        dateString.time = currentDate.slice(8, 10) + '30';
    }
    else{
        dateString.time = currentDate.slice(8, 10) + '00';
    }
    return dateString;
}

function getCurrentTimeValue(gmt){
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8, 10) + '00'
    };

    return dateString;
}

function getTimeValue(){
    var i=0;
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(9);
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
                var tempList = [];

                /********************
                 * TEST DATA
                 ********************/
                //requestTime.date = '20150830';
                //requestTime.time = '0300';
                /********************/

                log.info(requestTime);
                for (i = 0; i < listCurrent.length; i++) {
                    var item = {};
                    log.info('cur time : ', parseInt(listCurrent[i].date), parseInt(requestTime.date));
                    // 현재 요구한 시간을 3시간 단위 시간으로 변환 후 변환된 날짜보다 큰 값은 예보 데이터 사용하기 위해 버림.
                    if (parseInt(listCurrent[i].date) > parseInt(requestTime.date)) {
                        continue;
                    }
                    // 현재 요구한 시간을 3시간 단위 시간으로 변환 후 변환된 날짜가 같고 현재 시간 보다 큰 값은 예보 데이터 사용하기 위해 버림.
                    if ((listCurrent[i].date === requestTime.date) && (parseInt(listCurrent[i].time) > parseInt(requestTime.time))) {
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

                        log.info('from current', item);
                        tempList.push(JSON.parse(JSON.stringify(item)));
                    }
                }

                var popCount = 0;
                for (i = 0; i < listShort.length; i++) {
                    var item = {};
                    if(listShort[i].date === requestTime.date && listShort[i].time === requestTime.time){
                        // 현재시간 보다 이전의 데이터는 16개만 보내주기 위해서...
                        popCount = i - 16;
                    }

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
                    for(var j = 0 ; j < tempList.length ; j++) {
                        if ((tempList[j].date === listShort[i].date) && (tempList[j].time === listShort[i].time)) {
                            item.date = tempList[j].date;
                            item.time = tempList[j].time;
                            item.pty = tempList[j].pty;
                            item.r06 = tempList[j].r06;
                            item.reh = tempList[j].reh;
                            item.sky = tempList[j].sky;
                            item.t3h = tempList[j].t3h;
                            break;
                        }
                    }
                    resultList.push(item);
                }

                if(popCount > 0){
                    log.info('pop count : ', popCount);
                    resultList = resultList.slice(popCount, resultList.length);
                }

                /********************************************************************
                 * START : To merge the RSS data to result.
                 ********************************************************************/
                var rssData = townRss.getTownRssDb(result.mData.mCoord.mx, result.mData.mCoord.my).shortData;
                if(rssData.length > 1){
                    var lastDate = 0;
                    log.info(rssData);
                    resultList.forEach(function(item){
                        // resultList의 short데이터 중 제일 마지막 리스트 즉 제일 미래의 시간을 기억해둔다
                        if(parseInt(lastDate) < parseInt('' + item.date + item.time)){
                            lastDate = '' + item.date + item.time;
                            log.info('change last date:', lastDate);
                        }

                        // 현재 이후의 데이터는 RSS DATA 에서 같은 날짜의 데이터가 있으면 RSS의 데이터로 overwrite하자
                        if(parseInt('' + item.date + item.time) > parseInt('' + requestTime.date + requestTime.time)){
                            for(i=0 ; i < rssData.length ; i++){
                                if(parseInt('' + item.date + item.time) === parseInt(rssData[i].date)){
                                    //item.date = rssData[i].date.slice(0, 8);
                                    //item.time = rssData[i].date.slice(8, 12);
                                    item.pop = rssData[i].pop;
                                    item.pty = rssData[i].pty;
                                    item.r06 = rssData[i].r06;
                                    item.reh = rssData[i].reh;
                                    item.s06 = rssData[i].s06;
                                    item.sky = rssData[i].sky;
                                    item.t3h = rssData[i].temp;
                                    if(item.time === '0600' && rssData[i].tmn != -999) {
                                        item.tmn = rssData[i].tmn;
                                    }
                                    if(item.time === '1500' && rssData[i].tmn != -999){
                                        item.tmx = rssData[i].tmx;
                                    }
                                    log.info('updated', item);
                                    break;
                                }
                            }
                        }
                    });

                    // 이제 RSS 데이터에 resultList의 가장 미래의 데이터보다 큰 값이 있으면 resultList뒤에다 붙여 주자
                    rssData.forEach(function(rssItem){
                        if(lastDate < rssItem.date){
                            var item = {};
                            item.date = rssItem.date.slice(0, 8);
                            item.time = rssItem.date.slice(8, 12);
                            item.pop = rssItem.pop;
                            item.pty = rssItem.pty;
                            item.r06 = rssItem.r06;
                            item.reh = rssItem.reh;
                            item.s06 = rssItem.s06;
                            item.sky = rssItem.sky;
                            item.t3h = rssItem.temp;
                            if(item.time === '0600' && rssItem.tmn != -999){
                                item.tmn = rssItem.tmn;
                            } else{
                                item.tmn = 0;
                            }
                            if(item.time === '1500' && rssItem.tmx != -999){
                                item.tmx = rssItem.tmx;
                            }else{
                                item.tmx = 0;
                            }

                            log.info('push data>', item);
                            resultList.push(item);
                        }
                    });
                }
                /********************************************************************
                 * END :
                 ********************************************************************/
                log.info(resultList);
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

        var nowDate = getCurrentTimeValue(+9);
        var dateUtil = new DateUtil();
        var nowBefore = dateUtil.getNextDate(nowDate.date, nowDate.time, -2);
        var nowAfter = dateUtil.getNextDate(nowDate.date, nowDate.time, 2);

        dbShort.getShortDataWithSpecificDate({ first : regionName, second : cityName, third : townName },
            nowDate.date, nowAfter.date, function (err, result) {
            if (err) {
                log.error('> getShort : failed to get Short data from DB');
                log.error(meta);
                next();
            }

            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/
            if(result === null || result === []) next();

            try {
                var listShort = result;
                var requestTime = getTimeValue();
                var tempList = [];
                log.info('short list length : ' + listShort.length);

                /********************
                 * TEST DATA
                 ********************/
                //requestTime.date = '20150830';
                //requestTime.time = '0300';
                /********************/

                dbCurrent.getCurrentDataWithSpecificDate({'first':regionName, 'second':cityName, 'third':townName},
                    // start date , end(now) date
                    nowBefore.date, nowDate.date, function(err, res) {
                        if(err){
                            log.error('> getShort : failed to get Current data from DB');
                            log.error(meta);
                            next();
                        }
                        if(res === null || res === []) next();

                        var listCurrent = res;
                        log.info('current length : ' + listCurrent.length);
                        for (var i = 0; i < listCurrent.length; i++) {
                            if(listCurrent[i].currentData.date === nowDate.date){// now date use just short data not current
                                continue;
                            }

                            var item = {};
                            item.date = listCurrent[i].currentData.date;
                            item.time = listCurrent[i].currentData.time;
                            item.mx = listCurrent[i].currentData.mx;
                            item.my = listCurrent[i].currentData.my;
                            item.t1h = listCurrent[i].currentData.t1h;
                            item.rn1 = listCurrent[i].currentData.rn1;
                            item.sky = listCurrent[i].currentData.sky;
                            item.uuu = listCurrent[i].currentData.uuu;
                            item.vvv = listCurrent[i].currentData.vvv;
                            item.reh = listCurrent[i].currentData.reh;
                            item.pty = listCurrent[i].currentData.pty;
                            item.lgt = listCurrent[i].currentData.lgt;
                            item.vec = listCurrent[i].currentData.vec;
                            item.wsd = listCurrent[i].currentData.wsd;
                            tempList.push(item);
                        }

                        //tempList.push({'current end..' : 1});

                        var lastTime = tempList[tempList.length - 1].time;
                        if (lastTime === '0000' || lastTime === '0300' ||
                            lastTime === '0600' || lastTime === '0900' ||
                            lastTime === '1200' || lastTime === '1500' ||
                            lastTime === '1800' || lastTime === '2100') {
                            // remove duplicate short data ...
                            tempList.pop();
                        }
                        for(var i = 0 ; i < listShort.length ; i ++){
                            var item = {};

                            item.date = listShort[i].shortData.date;
                            item.time = listShort[i].shortData.time;
                            item.mx = listShort[i].shortData.mx;
                            item.my = listShort[i].shortData.my;
                            item.t1h = listShort[i].shortData.t3h;
                            item.rn1 = listShort[i].shortData.r06;
                            item.sky = listShort[i].shortData.sky;
                            item.uuu = listShort[i].shortData.uuu;
                            item.vvv = listShort[i].shortData.vvv;
                            item.reh = listShort[i].shortData.reh;
                            item.pty = listShort[i].shortData.pty;
                            item.lgt = 0;
                            item.vec = listShort[i].shortData.vec;
                            item.wsd = listShort[i].shortData.wsd;

                            if(i == (listShort.length - 1)) {
                                tempList.push(item);
                                break;
                            }

                            var delta = Math.round((listShort[i + 1].shortData.t3h - listShort[i].shortData.t3h) / 3);
                            var afterObj = JSON.parse(JSON.stringify(item));
                            var time = afterObj.time;
                            var nextTime = dateUtil.getNextTime(item.date, item.time, 1);
                            afterObj.date = nextTime.date;
                            afterObj.time = nextTime.time;
                            afterObj.t1h = item.t1h + delta;
                            var afterAfterObj = JSON.parse(JSON.stringify(item));
                            nextTime = dateUtil.getNextTime(item.date, item.time, 2);
                            afterAfterObj.date = nextTime.date;
                            afterAfterObj.time = nextTime.time;
                            afterAfterObj.t1h = item.t1h  + delta + delta;
                            tempList.push(item);
                            tempList.push(afterObj);
                            tempList.push(afterAfterObj);
                        }
                        //log.info('tempList length : ' + tempList.length);
                        req.short = tempList;
                        next();
                    });
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
            log.info('get shortest data');
            try{
                var listShortest = result.mData.data.shortest;
                var nowDate = getShortestTimeValue(+9);
                var resultItem = {};

                resultItem = listShortest[listShortest.length - 1];
                resultItem.date = nowDate.date;
                resultItem.time = nowDate.time;

                //log.info(listShortest);
                req.shortest = resultItem;
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
                    next();
                }
            }
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/
            try{
                var listCurrent = result.mData.data.current;
                var listShort = result.mData.data.short;
                var nowDate = getCurrentTimeValue(+9);
                var acceptedDate = getCurrentTimeValue(+6);
                var shortDate = getTimeValue();
                var currentItem = listCurrent[listCurrent.length - 1];
                var resultItem = {};

                if((nowDate.date !== currentItem.date) ||
                    (nowDate.date === currentItem.date && acceptedDate.time >= currentItem.time)){
                    // 데이터가 없다면 3시간 예보 데이터 사용.
                    for(var i=0 ; i<listShort.length ; i++){
                        if(shortDate.date === listShort[i].date && shortDate.time === listShort[i].time){
                            resultItem.date = listShort[i].date;
                            resultItem.time = listShort[i].time;
                            resultItem.mx = listShort[i].mx;
                            resultItem.my = listShort[i].my;
                            resultItem.t1h = listShort[i].t3h;
                            resultItem.rn1 = listShort[i].r06;
                            resultItem.sky = listShort[i].sky;
                            resultItem.uuu = listShort[i].uuu;
                            resultItem.vvv = listShort[i].vvv;
                            resultItem.reh = listShort[i].reh;
                            resultItem.pty = listShort[i].pty;
                            resultItem.lgt = 0;
                            resultItem.vec = listShort[i].vec;
                            resultItem.wsd = listShort[i].wsd;
                            break;
                        }
                    }

                }else{
                    // 현재 시간으로 넣어준
                    resultItem = currentItem;
                }
                resultItem.time = nowDate.time;

                //log.info(listCurrent);
                req.current = resultItem;
                next();
            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    else{
        dbCurrent.getOneCurrentData(regionName, cityName, townName, function(err, result){
            if(err){
                log.error('> getCurrent : failed to get data from DB');
                log.error(meta);
                next();
            }
            /********************
             * TEST DATA
             ********************/
            //result = config;
            /********************/
            try{
                var currentItem = result[0].currentData;
                var nowDate = getCurrentTimeValue(+9);
                var acceptedDate = getCurrentTimeValue(+6);
                var resultItem = {};

                log.info('nowDate : ' + nowDate.date + " , nowTime : " + nowDate.time);
                log.info('acceptDate : ' + acceptedDate.date + " , acceptTime : " + acceptedDate.time);
                if((nowDate.date !== currentItem.date) ||
                    (nowDate.date === currentItem.date && acceptedDate.time >= currentItem.time)){
                    // 데이터가 없다면 3시간 예보 데이터 사용.
                    dbShort.getOneShortDataWithDateAndTime(regionName, cityName, townName, nowDate.date, nowDate.time, function(err, shortRes){
                         if(err){
                            log.error('> getCurrentest : failed to get data from DB');
                            log.error(meta);
                            next();
                        }

                        resultItem.date = shortRes[0].shortData.date;
                        resultItem.time = shortRes[0].shortData.time;
                        resultItem.mx = shortRes[0].shortData.mx;
                        resultItem.my = shortRes[0].shortData.my;
                        resultItem.t1h = shortRes[0].shortData.t3h;
                        resultItem.rn1 = shortRes[0].shortData.r06;
                        resultItem.sky = shortRes[0].shortData.sky;
                        resultItem.uuu = shortRes[0].shortData.uuu;
                        resultItem.vvv = shortRes[0].shortData.vvv;
                        resultItem.reh = shortRes[0].shortData.reh;
                        resultItem.pty = shortRes[0].shortData.pty;
                        resultItem.lgt = 0;
                        resultItem.vec = shortRes[0].shortData.vec;

                        resultItem.time = nowDate.time;
                        req.current = resultItem;
                        next();
                    });
                }else{
                    // 현재 시간으로 넣어준
                    resultItem = currentItem;
                    resultItem.time = nowDate.time;

                    //log.info(listCurrent);
                    req.current = resultItem;
                    next();
                }
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

var getMid = function(req, res, next){
    var meta = {};

    var regionName = req.params.region;
    var cityName = req.params.city;
    var townName = '';
    if(req.params.town != undefined){
        townName = req.params.town;
    }
    meta.method = 'getMid';
    meta.region = regionName;
    meta.city = cityName;

    log.info('>', meta);

    if(config.db.mode === 'ram'){
        manager.getMidDb(regionName, cityName, function(err, result){
            if(err){
                log.error('> getMid : failed to get data from DB');
                log.error(meta);
                next();
            }
            try{
                log.info('> Mid DATA : ', result);

                if(townName != ''){
                    /**********************************************************
                     *  START : Get current data and merge it
                     **********************************************************/
                    manager.getWeatherDb(regionName, cityName, townName, function(err, townDb){
                        if(err){
                            log.error('> getShortest : failed to get data from DB');
                            log.error(meta);
                            next();
                        }

                        try{
                            var listCurrent = townDb.mData.data.current;
                            log.info('current>', townDb);

                            result.dailyData.forEach(function(item){
                                var max = 0;
                                var min = 100;
                                var count = 0;
                                listCurrent.forEach(function(curItem){
                                    if(item.date == curItem.date){
                                        count += 1;
                                        if(curItem.t1h > max){
                                            max = curItem.t1h;
                                        }
                                        if(curItem.t1h < min){
                                            min = curItem.t1h;
                                        }
                                    }
                                });

                                if(count > 23){
                                    log.info('replace:', item.date, item.taMax, item.taMin);
                                    item.taMax = max;
                                    item.taMin = min;
                                    count = 0;
                                }
                            });

                        }catch(e){
                            log.error('Second Phase ERROE>>', meta);
                            next();
                        }
                    });
                    /**********************************************************
                     *  END
                     **********************************************************/
                }

                req.midData = result;
                next();

            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    else{
        next();
    }
};

var getRegionSummary = function(req, res, next){
    var meta = {};
    var regionName = req.params.region;

    meta.method = 'getRegionSummary';
    meta.region = regionName;

    log.info('>', meta);

    if(config.db.mode === 'ram'){
        manager.getRegionSummary(regionName, function(err, result){
            if(err){
                if(err){
                    log.error('> getRegionSummary : failed to get data from DB');
                    log.error(meta);
                    next();
                }
            }
            try{
                log.info('> getRegionSummary DATA : ', result);
                req.midData = result;
                next();

            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    else{
        next();
    }
};

var getSummary = function(req, res, next){
    var meta = {};

    meta.method = 'getSummary';

    log.info('>', meta);

    if(config.db.mode === 'ram'){
        manager.getSummary(function(err, result){
            if(err){
                if(err){
                    log.error('> getSummary : failed to get data from DB');
                    log.error(meta);
                    next();
                }
            }
            try{
                log.info('> getSummary DATA : ', result);
                req.summary = result;
                next();

            }
            catch(e){
                log.error('ERROE>>', meta);
                next('route');
            }
        });
    }
    else{
        next();
    }
};

var getLifeIndexKma = function(req, res, next) {
     //add life index of kma info
    if (!req.short && !req.midData) {
        var err = new Error("Fail to find short, mid weather");
        log.error(err);
        next();
    }

    try {
        var LifeIndexKmaController = require('../controllers/lifeIndexKmaController');
        LifeIndexKmaController.appendData({third: req.params.town, second: req.params.city, first: req.params.region},
            req.short, req.midData.dailyData, function (err) {
                if (err) {
                    log.error(err);
                }
                next();
            });
    }
    catch(e) {
        if (e) {
            log.error(e);
        }
        next();
    }
};

var getKeco = function (req, res, next) {
    if (!req.current)  {
        var err = new Error("Fail to find current weather");
        log.warn(err);
        next();
    }

    try {
        var KecoController = require('../controllers/kecoController');
        KecoController.appendData({
                third: req.params.town,
                second: req.params.city,
                first: req.params.region
            }, req.current,
            function (err) {
                if (err) {
                    log.error(err);
                }
                next();
            });
    }
    catch(e) {
        if (e) {
            log.warn(e);
        }
        next();
    }
};

router.get('/', [getSummary], function(req, res) {
    var meta = {};

    var result = {};

    meta.method = '/';

    log.info('##', meta);

    if(req.summary){
        result.summary = req.summary;
    }

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

router.get('/:region', [getRegionSummary], function(req, res) {
    var meta = {};

    var result = {};
    var regionName = req.params.region;

    meta.method = '/:region';
    meta.region = regionName;

    log.info('##', meta);

    result.regionName = regionName;

    if(req.midData){
        result.midData = req.midData;
    }

    res.json(result);
});

router.get('/:region/:city', [getMid, getLifeIndexKma], function(req, res) {
    var meta = {};

    var result = {};
    var regionName = req.params.region;
    var cityName = req.params.city;

    meta.method = '/:region/:city';
    meta.region = regionName;
    meta.city = cityName;

    log.info('##', meta);

    result.regionName = regionName;
    result.cityName = cityName;

    if(req.midData){
        result.midData = req.midData;
    }

    res.json(result);
});

router.get('/:region/:city/:town', [getShort, getShortest, getCurrent, getMid, getLifeIndexKma, getKeco],
            function(req, res) {
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
    if(req.midData){
        result.midData = req.midData;
    }

    res.json(result);
});

router.get('/:region/:city/:town/short', [getShort, getLifeIndexKma], function(req, res) {
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

router.get('/:region/:city/:town/current', [getCurrent, getKeco], function(req, res) {
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


module.exports = router;