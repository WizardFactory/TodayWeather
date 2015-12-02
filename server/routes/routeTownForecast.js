/**
 * Created by Peter on 2015. 8. 24..
 */
"use strict";

var router = require('express').Router();
var config = require('../config/config');
var dbForecast = require('../models/forecast');
var dbCurrent = require('../models/current');
var dbShort = require('../models/short');
var dbShortest = require('../models/shortest');
var dbMidTemp = require('../models/midTemp');
var dbMidLand = require('../models/midLand');
var DateUtil = require('../models/dateUtil');
var ModelUtil = require('../models/modelUtil');

var modelShort = require('../models/modelShort');
var modelCurrent = require('../models/modelCurrent');
var modelShortest = require('../models/modelShortest');
var modelMidForecast = require('../models/modelMidForecast');
var modelMidTemp = require('../models/modelMidTemp');
var modelMidLand = require('../models/modelMidLand');
var modelMidSea = require('../models/modelMidSea');
var modelShortRss = require('../models/modelShortRss');
var dbTown = require('../models/town');

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


/*
 *   get coordinate (mx, my) from town list.
 *   @param region
 *   @param city
 *   @param town
 *   @param cb
 *
 *   @return {}
 */
var getCoord = function(region, city, town, cb){
    var meta = {};
    meta.method = 'getCoord';
    meta.region = region;
    meta.city = city;
    meta.town = town;

    try{
        dbTown.find({'town.first':region, 'town.second':city, 'town.third':town}, function(err, result){
            if(err){
                log.error('~> getCoord : fail to find db item');
                if(cb){
                    cb(err);
                }
                return;
            }

            if(result.length === 0){
                log.error('~> there is no data', result.length);
                return;
            }
            if(result.length > 1){
                log.error('~> what happened??', result.length);
            }

            var coord = {
                mx: result[0].mCoord.mx,
                my: result[0].mCoord.my
            };

            //log.info('~> found coord:', coord.mx, coord.my);

            if(cb){
                cb(0, coord);
            }
            return coord;
        });
    }catch(e){
        log.error(meta);
    }

    return {}
};

/*
 *   get town data list from db
 *   @param coord
 *   @param cb
 *
 *   @return {}
 */
var getTownDataFromDB = function(db, indicator, cb, date, time){
    var meta = {};
    meta.method = 'getShortFromDB';
    meta.indicator = indicator;

    try{
        db.find({'mCoord.mx': indicator.mx, 'mCoord.my': indicator.my}, function(err, result){
            if(err){
                log.error('~> getDataFromDB : fail to find db item');
                if(cb){
                    cb(err);
                }
                return;
            }

            if(result.length === 0){
                log.error('~> getDataFromDB : there is no data');
                return;
            }
            if(result.length > 1){
                log.error('~> getDataFromDB : what happened??', result.length);
            }

            if(cb){
                var ret = [];
                if(result[0].shortData){
                    if(result[0].shortData[0].ftm){
                        result[0].shortData.forEach(function(item){
                            var newItem = {};
                            rssString.forEach(function(string){
                                newItem[string] = item[string];
                            });
                            ret.push(newItem);
                        });
                    }else{
                        //ret = result[0].shortData;
                        result[0].shortData.forEach(function(item){
                            var newItem = {};
                            shortString.forEach(function(string){
                                newItem[string] = item[string];
                            });
                            commonString.forEach(function(string){
                                newItem[string] = item[string];
                            });
                            ret.push(newItem);
                        });
                    }
                }else if(result[0].currentData){
                    //ret = result[0].currentData;
                    result[0].currentData.forEach(function(item){
                        var newItem = {};
                        curString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        commonString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        ret.push(newItem);
                    });
                }else if(result[0].shortest){
                    //ret = result[0].shortestData;
                    result[0].shortestData.forEach(function(item){
                        var newItem = {};
                        shortestString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        commonString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        ret.push(newItem);
                    });
                }
                else{
                    log.info('~> what???');
                    log.error(meta);
                    return {};
                }
                cb(0, ret);
            }
            return result[0];
        });
    }catch(e){
        log.error(meta);
    }

    return {};
};

/*
 *   get mid data list from db
 *   @param coord
 *   @param cb
 *
 *   @return {}
 */
var getMidDataFromDB = function(db, indicator, cb, date, time){
    var meta = {};
    meta.method = 'getMidDataFromDB';
    meta.indicator = indicator;

    try{
        db.find({regId : indicator}, function(err, result){
            if(err){
                log.error('~> getMidDataFromDB : fail to find db item');
                if(cb){
                    cb(err);
                }
                return;
            }

            if(result.length > 1){
                log.error('~> getMidDataFromDB : what happened??', result.length);
            }

            if(cb){
                cb(0, result[0]);
            }
            return result[0];
        });
    }catch(e){
        log.error(meta);
    }

    return {};
};

/*
 *   merge short data with current data
 *   @param short list
 *   @param current list
 *
 *   @return []
 */
var mergeShortWithCurrent = function(shortList, currentList, cb){
    var meta = {};
    meta.method = 'mergeShortWithCurrent';
    meta.short = shortList[0];
    meta.current = currentList[0];

    try{
        var requestTime = getTimeValue();
        var tmpList = [];

        // 과거의 current 데이터를 short 리스트에 넣을 수 있게 리스트를 구성한다
        currentList.forEach(function(curItem, index){
            var newItem = {};
            //log.info(parseInt(curItem.date), parseInt(requestTime.date));
            //log.info(parseInt(curItem.time), parseInt(requestTime.time));
            // 현재 시간 보다 작은 current의 데이터를 사용해서 지난 정보는 실제 current 값을 사용한다
            if ((parseInt(curItem.date) < parseInt(requestTime.date)) ||
                ((parseInt(curItem.date) === parseInt(requestTime.date)) &&
                parseInt(curItem.time) <= parseInt(requestTime.time))){
                // 시간이 0시 이거나 3의 배수인 시간일때 데이터를 구성한다
                if(curItem.time === '0000' || (parseInt(curItem.time) % 3) === 0){
                    newItem.time = curItem.time;
                    newItem.date = curItem.date;
                    if((index === 0) || (index === currentList.length - 1)){
                        var tmp = {};
                        if(index === 0){
                            tmp = currentList[index + 1];
                        }else{
                            tmp = currentList[index - 1];
                        }

                        //log.info(tmp);
                        curString.forEach(function(string){
                            if(string === 'sky' || string === 'pty' || string === 'lgt') {
                                newItem[string] = (tmp[string] > curItem[string])? tmp[string]:curItem[string];
                            }
                            else{
                                newItem[string] = (tmp[string] + curItem[string]) / 2;
                            }
                        });
                    }else {
                        var prv = currentList[index-1];
                        var next = currentList[index+1];
                        curString.forEach(function(string){
                            if(string === 'sky' || string === 'pty' || string === 'lgt') {
                                newItem[string] = (prv[string] > curItem[string])? prv[string]:curItem[string];
                                newItem[string] = (newItem[string] > next[string])? newItem[string]:next[string];
                            }else{
                                newItem[string] = (prv[string] + curItem[string] + next[string]) / 3;
                            }
                        });
                    }

                    tmpList.push(newItem);
                }
            }
        });
        //log.info('~> tmpList :',tmpList);

        shortList.forEach(function(shortItem, index){
            tmpList.forEach(function(tmpItem){
                if(shortItem.date === tmpItem.date && shortItem.time === tmpItem.time){
                    shortList[index].pty = tmpItem.pty;
                    shortList[index].r06 = tmpItem.rn1;
                    shortList[index].reh = tmpItem.reh;
                    shortList[index].sky = tmpItem.sky;
                    shortList[index].t3h = tmpItem.t1h;
                }
            });
        });

        //log.info('~> After :', shortList);

        if(cb){
            cb(0, shortList);
        }
    }
    catch(e){
        log.error(meta);
        return [];
    }

    return shortList;
};


/*
 *   merge short data with RSS data
 *   @param short list
 *   @param rss list
 *
 *   @return []
 */
var mergeShortWithRSS = function(shortList, rssList, cb){
    var meta = {};
    meta.method = 'mergeShortWithRSS';
    meta.short = shortList[0];
    meta.rssList = rssList[0];

    //log.info(rssList.length);
    //log.info(shortList.length);
    try{
        var requestTime = getTimeValue();

        rssList.forEach(function(rssItem){
            //log.info(parseInt('' + rssItem.date), parseInt('' + requestTime.date + requestTime.time));
            // 현재 시간보다 큰(미래의 데이터)만 사용한다. 과거 데이터는 current로 부터 얻은 데이터를 그대로 사용.
            if(parseInt('' + rssItem.date) > parseInt('' + requestTime.date + requestTime.time)){
                var found = 0;
                for(var i=0 ; i < shortList.length ; i++){
                    //log.info(parseInt(''+shortList[i].date + shortList[i].time),parseInt(rssItem.date));
                    if(parseInt('' + shortList[i].date + shortList[i].time) === parseInt(rssItem.date)){
                        found = 1;
                        shortList[i].pop = rssItem.pop;
                        shortList[i].pty = rssItem.pty;
                        shortList[i].r06 = rssItem.r06;
                        shortList[i].reh = rssItem.reh;
                        shortList[i].s06 = rssItem.s06;
                        shortList[i].sky = rssItem.sky;
                        shortList[i].t3h = rssItem.temp;
                        if(shortList[i].time === '0600' && rssItem.tmn != -999) {
                            shortList[i].tmn = rssItem.tmn;
                        }
                        if(shortList[i].time === '1500' && rssItem.tmn != -999){
                            shortList[i].tmx = rssItem.tmx;
                        }
                    }
                }
                if(found === 0){
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

                    //log.info('~> push data>', item);
                    shortList.push(item);
                }
            }
        });

        //log.info('~> final : ', shortList);
        if(cb) {
            cb(0, shortList);
        }
    }
    catch(e) {
        log.error(meta);
        return [];
    }

    return shortList;
};

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
                next();
            }
        });
    }
    else {
        try{
            getCoord(regionName, cityName, townName, function(err, coord){
                getTownDataFromDB(modelShort, coord, function(err, shortList){
                    var requestTime = getTimeValue();
                    var popCount = 0;
                    var i = 0;

                    //log.info(shortList);
                    //shortList.forEach(function(item, index){
                    //    log.info('routeS>', item);
                    //});
                    for(i=0 ; shortList.length ; i++){
                        if(shortList[i].date === requestTime.date && shortList[i].time >= requestTime.time){
                            //log.info('found same date');
                            break;
                        }
                    }

                    if(i > 16){
                        //log.info('prv count :', i);
                        shortList.slice(0, (i - 16));
                    }

                    getTownDataFromDB(modelCurrent, coord, function(err, currentList){
                        //log.info(currentList);
                        //currentList.forEach(function(item, index){
                        //    log.info('routeC>', item);
                        //});
                        mergeShortWithCurrent(shortList, currentList, function(err, firstMerged){
                            //log.info(firstMerged);
                            getTownDataFromDB(modelShortRss, coord, function(err, rssList){
                                //log.info(rssList);
                                mergeShortWithRSS(firstMerged, rssList, function(err, resultList){
                                    log.info(resultList);
                                    req.short = resultList;
                                    next();
                                });
                            });
                        });
                    });
                });
            });
        } catch(e){
            log.error('ERROE>>', meta);
            next();
        }
    }
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
        dbShortest.getOneShortestData(regionName, cityName, townName, function(err, result){
            if(err){
                log.error('> getShortest : failed to get data from DB');
                log.error(meta);
                next('route');
                return;
            }

            var shortestData = result[0].shortestData;
            var nowDate = getCurrentTimeValue(+9);
            var resultItem = {};

            resultItem.date= nowDate.date;
            resultItem.time= nowDate.time;
            resultItem.mx= shortestData.mx;
            resultItem.my= shortestData.my;
            resultItem.pty= shortestData.pty;
            resultItem.rn1= shortestData.rn1;
            resultItem.sky= shortestData.sky;
            resultItem.lgt= shortestData.lgt;

            req.shortest = resultItem;
            next();
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
                var shortDate = getTimeValue();
                var resultItem = {};

                log.info('>> current:', currentItem);
                log.info('nowDate : ' + nowDate.date + " , nowTime : " + nowDate.time);
                log.info('acceptDate : ' + acceptedDate.date + " , acceptTime : " + acceptedDate.time);
                if((nowDate.date !== currentItem.date) ||
                    (nowDate.date === currentItem.date && acceptedDate.time >= currentItem.time)){
                    // 데이터가 없다면 3시간 예보 데이터 사용.
                    dbShort.getOneShortDataWithDateAndTime(regionName, cityName, townName, shortDate.date, shortDate.time, function(err, shortRes){
                         if(err){
                            log.error('> getCurrentest : failed to get data from DB');
                            log.error(meta);
                            next();
                        }

                        log.info('>> current(get short) : ', shortRes);

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
        var dateUtil = new DateUtil();
        var modelUtil = new ModelUtil();

        var regionName = req.params.region;
        var cityName = req.params.city;
        var nowDate = getCurrentTimeValue(+9);
        var beforeWeekDate = dateUtil.getNextDate(nowDate.date, nowDate.time, -7);
        var oneDayAfterDate = dateUtil.getNextDate(nowDate.date, nowDate.time, 1);
        var twoDayAfterDate = dateUtil.getNextDate(nowDate.date, nowDate.time, 2);
        var result = {
            dailyData : []
        };
        var resultList = [];

        log.silly('before week ' + beforeWeekDate.date);
        log.silly('one day ' + oneDayAfterDate.date + ' time ' + oneDayAfterDate.time);
        log.silly('two day ' + twoDayAfterDate.date + ' time ' + twoDayAfterDate.time);
        dbMidTemp.getOneTempData(regionName, cityName, nowDate.date, function(err, tempRes){
            if(err){
                log.error('> getMid : failed to get data from *Temp DB');
                log.error(meta);
                next();
            }

            if(tempRes === null || tempRes === []) next();

            dbMidLand.getOneLandData(regionName, cityName, nowDate.date, function(err, landRes){
                if(err){
                    log.error('> getMid : failed to get data from *Land DB');
                    log.error(meta);
                    next();
                }

                if(landRes === null || landRes === []) next();

                var regId = modelUtil.getCode(regionName, cityName);
                var town = modelUtil.getCodeWithRegId(regId);
                log.silly('regId : ' + regId);
                dbCurrent.getCurrentDataWithSpecificDate(town, beforeWeekDate.date, nowDate.date, function(err, currentRes){
                    if(err){
                        log.error('> getMid : failed to get data from *Current DB');
                        log.error(meta);
                        next();
                    }

                    log.silly(town);
                    if(currentRes === null || currentRes === []) next();

                    function averageValueToSky (average, rain){
                        var resultSky = '';
                        if(average <= 1) resultSky = '맑음';
                        else if(average <= 2) resultSky = '구름조금';
                        else if(average <= 3) resultSky = '구름많음';
                        else resultSky = '흐림';

                        if(rain){
                            if(average <= 2) resultSky = '구름많음';
                            resultSky += ' 비';
                        }
                        return resultSky;
                    }

                    var avCnt = 1;
                    var tempDate = currentRes[0].currentData.date;
                    var avRn1 = 0; // 강수량
                    var amSky = 0, amRain = false, amCnt = 1;
                    var pmSky = 0, pmRain = false, pmCnt = 1;
                    var avReh = 0; // 습도
                    var avPty = 0; // 강수형태
                    var avWsd = 0; // 풍속
                    var taMax = Number.MIN_VALUE;
                    var taMin = Number.MAX_VALUE;

                    for(var i = 0 ; i < currentRes.length ; i ++){
                        var item = {};
                        var currentTemp = currentRes[i];
                        if((i + 1) !== currentRes.length){
                            if(currentRes[(i + 1)].currentData.date !== tempDate){
                                item.date = tempDate;
                                item.taRn1 = Math.round(avRn1 / avCnt);
                                item.taReh = Math.round(avReh / avCnt);
                                item.taPty = Math.round(avPty / avCnt);
                                item.wfAm = averageValueToSky(Math.round(amSky / amCnt), amRain); // stirng..
                                item.wfPm = averageValueToSky(Math.round(pmSky / pmCnt), pmRain); // stirng..
                                item.taWsd = Math.round(avWsd / avCnt);
                                item.taMax = taMax;
                                item.taMin = taMin;
                                resultList.push(item);
                                taMax = Number.MIN_VALUE, taMin = Number.MAX_VALUE; //value initialize
                                avRn1 = 0, amSky = 0, amRain = false, amCnt = 1, pmSky = 0, pmRain = false, pmCnt = 1, avReh = 0, avPty = 0, avWsd = 0, avCnt = 1;
                                tempDate = currentRes[(i + 1)].currentData.date;
                                continue;
                            }
                        } else {
                            item.date = currentRes[i].currentData.date;
                            item.taRn1 = Math.round(avRn1 / avCnt);
                            item.taReh = Math.round(avReh / avCnt);
                            item.taPty = Math.round(avPty / avCnt);
                            item.wfAm = averageValueToSky(Math.round(amSky / amCnt), amRain); // stirng..
                            item.wfPm = averageValueToSky(Math.round(pmSky / pmCnt), pmRain); // stirng..
                            item.taWsd = Math.round(avWsd / avCnt);
                            item.taMax = taMax;
                            item.taMin = taMin;
                            resultList.push(item);
                        }
                        avRn1 = avRn1 + (currentTemp.currentData.rn1 == -1 ? 0 : currentTemp.currentData.rn1);
                        avReh = avReh + (currentTemp.currentData.reh == -1 ? 0 : currentTemp.currentData.reh);
                        avPty = avPty + (currentTemp.currentData.pty == -1 ? 0 : currentTemp.currentData.pty);
                        avWsd = avWsd + (currentTemp.currentData.wsd == -1 ? 0 : currentTemp.currentData.wsd);
                        if(taMax < currentTemp.currentData.t1h) taMax = currentTemp.currentData.t1h;
                        if(taMin > currentTemp.currentData.t1h) taMin = currentTemp.currentData.t1h;

                        if(currentTemp.currentData.time <= '1200') {
                            amSky = amSky + (currentTemp.currentData.sky == -1? 0 : currentTemp.currentData.sky);
                            amRain = amRain || !!parseInt(currentTemp.currentData.pty) || !!parseInt(currentTemp.currentData.lgt);
                            amCnt ++;
                        } else {
                            pmSky = pmSky + (currentTemp.currentData.sky == -1? 0 : currentTemp.currentData.sky);
                            pmRain = pmRain || !!parseInt(currentTemp.currentData.pty) || !!parseInt(currentTemp.currentData.lgt);
                            pmCnt ++;
                        }
                        avCnt ++;
                    }

                    resultList.push({'end current' : ' test'});
                    dbShort.getShortDataWithSpecificDate(town, oneDayAfterDate.date, twoDayAfterDate.date, function(err, shortRes){
                        if(err){
                            log.error('> getMid : failed to get data from *Current DB');
                            log.error(meta);
                            next();
                        }

                        if(shortRes === null || shortRes === []) next();
                        log.info('short length ' + shortRes.length);
                        var avCnt = 1;
                        var tempDate = shortRes[0].shortData.date;
                        var avRn1 = 0; // 강수량
                        var amSky = 0, amRain = false, amCnt = 1;
                        var pmSky = 0, pmRain = false, pmCnt = 1;
                        var avReh = 0; // 습도
                        var avPty = 0; // 강수형태
                        var avWsd = 0; // 풍속
                        var taMax = Number.MIN_VALUE;
                        var taMin = Number.MAX_VALUE;

                        for(var i = 0 ; i < shortRes.length ; i ++){
                            var item = {};
                            var shortItem = shortRes[i];
                            if((i + 1) !== shortRes.length){
                                if(shortRes[(i + 1)].shortData.date !== tempDate){
                                    item.date = tempDate;
                                    item.taRn1 = Math.round(avRn1 / avCnt);
                                    item.taReh = Math.round(avReh / avCnt);
                                    item.taPty = Math.round(avPty / avCnt);
                                    item.wfAm = averageValueToSky(Math.round(amSky / amCnt), amRain); // stirng..
                                    item.wfPm = averageValueToSky(Math.round(pmSky / pmCnt), pmRain); // stirng..
                                    item.taWsd = Math.round(avWsd / avCnt);
                                    item.taMax = taMax;
                                    item.taMin = taMin;
                                    resultList.push(item);
                                    taMax = Number.MIN_VALUE, taMin = Number.MAX_VALUE; //value initialize
                                    avRn1 = 0, amSky = 0, amRain = false, amCnt = 1, pmSky = 0, pmRain = false, pmCnt = 1, avReh = 0, avPty = 0, avWsd = 0, avCnt = 1;
                                    tempDate = shortRes[(i + 1)].shortData.date;
                                    log.info('push list in short');
                                    console.log(item);
                                    continue;
                                }
                            } else {
                                item.date = shortRes[i].shortData.date;
                                item.taRn1 = Math.round(avRn1 / avCnt);
                                item.taReh = Math.round(avReh / avCnt);
                                item.taPty = Math.round(avPty / avCnt);
                                item.wfAm = averageValueToSky(Math.round(amSky / amCnt), amRain); // stirng..
                                item.wfPm = averageValueToSky(Math.round(pmSky / pmCnt), pmRain); // stirng..
                                item.taWsd = Math.round(avWsd / avCnt);
                                item.taMax = taMax;
                                item.taMin = taMin;
                                resultList.push(item);
                                log.info('end ;; push list in short');
                                console.log(item);
                            }
                            avRn1 = avRn1 + (shortItem.shortData.r06 == -1 ? 0 : shortItem.shortData.r06);
                            avReh = avReh + (shortItem.shortData.reh == -1 ? 0 : shortItem.shortData.reh);
                            avPty = avPty + (shortItem.shortData.pty == -1 ? 0 : shortItem.shortData.pty);
                            avWsd = avWsd + (shortItem.shortData.wsd == -1 ? 0 : shortItem.shortData.wsd);
                            if(taMax < shortItem.shortData.t3h) taMax = (shortItem.shortData.t3h == 0 ? taMax : shortItem.shortData.t3h);
                            if(taMin > shortItem.shortData.t3h) taMin = (shortItem.shortData.t3h == 0 ? taMin : shortItem.shortData.t3h);

                            if(shortItem.shortData.time <= '1200') {
                                amSky = amSky + (shortItem.shortData.sky == -1? 0 : shortItem.shortData.sky);
                                amRain = amRain || !!parseInt(shortItem.shortData.pty);
                                amCnt ++;
                            } else {
                                pmSky = pmSky + (shortItem.shortData.sky == -1? 0 : shortItem.shortData.sky);
                                pmRain = pmRain || !!parseInt(shortItem.shortData.pty);
                                pmCnt ++;
                            }
                            avCnt ++;
                        }

                        log.info('land length ' + landRes.length);
                        log.info('temp length ' + tempRes.length);

                        var landTemp = landRes[0].midLandData;
                        var tempTemp = tempRes[0].midTempData;

                        for(var i = 0 ; i < 7 ; i++){
                            var item = {};
                            var day = i+3;
                            item.date = dateUtil.getNextDate(nowDate.date, nowDate.time, day).date;
                            if(day > 7){
                                item.wfAm = landTemp['wf'+day];
                                item.wfPm = landTemp['wf'+day];
                            }else{
                                item.wfAm = landTemp['wf'+day+'Am'];
                                item.wfPm = landTemp['wf'+day+'Pm'];
                            }
                            item.taMin = tempTemp['taMin'+day];
                            item.taMax = tempTemp['taMax'+day];
                            resultList.push(item);
                        }

                        result.dailyData = resultList;
                        req.midData = result;
                        next();
                    });
                });
            });
        });
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