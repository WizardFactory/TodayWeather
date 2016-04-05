/**
 * Created by aleckim on 2016. 2. 17..
 */

"use strict";

var async = require('async');
var config = require('../config/config');

var dbTown = require('../models/town');
var modelShort = require('../models/modelShort');
var modelCurrent = require('../models/modelCurrent');
var modelShortest = require('../models/modelShortest');
var modelMidForecast = require('../models/modelMidForecast');
var modelMidTemp = require('../models/modelMidTemp');
var modelMidLand = require('../models/modelMidLand');
var modelShortRss = require('../models/modelShortRss');

var convertGeocode = require('../utils/convertGeocode');

var LifeIndexKmaController = require('../controllers/lifeIndexKmaController');
var KecoController = require('../controllers/kecoController');
var controllerKmaStnWeather = require('../controllers/controllerKmaStnWeather');

var kmaTimeLib = require('../lib/kmaTimeLib');

/**
 * router callback에서 getShort 호출시에, this는 undefined되기 때문에, 생성시에 getShort를 만들어주고, self는 생성자에서 만들어준다.
 * @constructor
 */
function ControllerTown() {
    this.dbTownList = [];

    var self = this;

    this.getShort = function(req, res, next){
        var meta = {};

        if(req.params.city === undefined){
            req.params.city = '';
        }

        if(req.params.town === undefined){
            req.params.town = '';
        }

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = 'getShort';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('>', meta);

        try{
            /*
             * 클라이언트에게 보내 줄 예보 날짜와 시간만넣은 데이터의 리스트를 만든다.
             * 이는 DB에 데이터가 빠진 부분이 있어도 최종 개수 및 데이터 시간 테이블을 맞추기 위함
             */
            var basicShortlist = self._makeBasicShortList();

            self._getCoord(regionName, cityName, townName, function(err, coord){
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                log.silly('S> coord : ',coord);

                self._getTownDataFromDB(modelShort, coord, function(err, shortList){
                    if (err) {
                        log.error(new Error('error to get short '+ err.message));
                        return next();
                    }

                    self._dataListPrint(shortList, 'route S', 'original short');

                    basicShortlist = self._mergeShortWithBasicList(shortList,basicShortlist);
                    self._dataListPrint(basicShortlist, 'route S', 'First, merged short');

                    self._getTownDataFromDB(modelCurrent, coord, function(err, currentList){
                        if (err) {
                            log.error(new Error('error to get current '+err.message));
                            return next();
                        }

                        self._dataListPrint(currentList, 'route S', 'Original Current');

                        self._mergeShortWithCurrent(basicShortlist, currentList, function(err, resultShortList) {
                            if (err) {
                                log.error(err);
                                return next();
                            }

                            self._dataListPrint(resultShortList, 'route S', 'Merged with Current');

                            var i;

                            for(i=0 ; i < resultShortList.length ; i++){
                                // discomfort index(불쾌지수)
                                resultShortList[i].dspls = LifeIndexKmaController.getDiscomfortIndex(resultShortList[i].t3h, resultShortList[i].reh);
                                resultShortList[i].dsplsStr = LifeIndexKmaController.convertStringFromDiscomfortIndex(resultShortList[i].dspls);

                                // decomposition index(부패지수)
                                resultShortList[i].decpsn = LifeIndexKmaController.getDecompositionIndex(resultShortList[i].t3h, resultShortList[i].reh);
                                resultShortList[i].decpsnStr = LifeIndexKmaController.convertStringFromDecompositionIndex(resultShortList[i].decpsn);
                            }

                            req.short = resultShortList;
                            next();
                        });
                    });
                });
            });
        } catch(e){
            log.error('ERROE>>', meta);
            log.error(e);
            next();
        }
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     */
    this.getShortRss = function(req, res, next){
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        var meta = {};
        meta.method = 'getShortRss';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>', meta);

        self._getCoord(regionName, cityName, townName, function(err, coord) {
            if(err) {
                log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                return next();
            }

            // req.short 데이터가 없을 경우 만들어준다.
            if(!req.hasOwnProperty('short')) {
                req.short = self._makeBasicShortList();
            }

            // modelShortRss에서 coord에 해당하는 날씨 데이터를 가져온다.
            self._getTownDataFromDB(modelShortRss, coord, function(err, rssList) {
                if(err) {
                    log.error(new Error('error to get short RSS '+ err.message));
                    return next();
                }

                var i;
                var requestTime = self._getTimeValue(9);

                for(i=rssList.length-1;i>0;i--) {
                    // 미래의 데이터만을 가져와서 사용한다. 과거 데이터는 current로 부터 얻은 데이터를 그대로 사용
                    // === 만을 하지 않고 <= 로 하는 이유는 동일한 값이 존재하지 않을 수도 있기 때문이다.
                    if(parseInt('' + rssList[i].date) <= parseInt('' + requestTime.date + requestTime.time)) {
                        // 여기서 바로 처리하지 않는 이유는 날짜 순서대로 배열에 놓고자함이다.
                        break;
                    }
                }
                // 미래의 데이터만 사용한다.
                if(parseInt('' + rssList[i].date) === parseInt('' + requestTime.date + requestTime.time)) {
                    i = i+1;
                }

                var j;
                var found;

                // rss 데이터를 모두 가져온다.
                for(i;i<rssList.length;i++) {
                    found = 0;

                    for(j=0;j<req.short.length;j++) {
                        if(parseInt(req.short[j].date + req.short[j].time) === parseInt(rssList[i].date)) {
                            found = 1;

                            req.short[j].pop = rssList[i].pop;
                            req.short[j].pty = rssList[i].pty;
                            req.short[j].r06 = Math.round(rssList[i].r06);
                            req.short[j].reh = rssList[i].reh;
                            req.short[j].s06 = Math.round(rssList[i].s06);
                            req.short[j].sky = rssList[i].sky;
                            req.short[j].t3h = Math.round(rssList[i].temp);
                            if(req.short[j].time === '0600' && rssList[i].tmn != -999) {
                                req.short[j].tmn = rssList[i].tmn;
                            } else if(req.short[j].time === '1500' && rssList[i].tmn != -999) {
                                req.short[j].tmx = rssList[i].tmx;
                            }
                            break;
                        }
                    }
                    if(found === 0) {
                        var item = {};
                        item.date = rssList[i].date.slice(0, 8);
                        item.time = rssList[i].date.slice(8, 12);
                        item.pop = rssList[i].pop;
                        item.pty = rssList[i].pty;
                        item.r06 = Math.round(rssList[i].r06);
                        item.reh = rssList[i].reh;
                        item.s06 = Math.round(rssList[i].s06);
                        item.sky = rssList[i].sky;
                        item.t3h = Math.round(rssList[i].temp);
                        if(item.time === '0600' && rssList[i].tmn != -999){
                            item.tmn = rssList[i].tmn;
                        } else{
                            item.tmn = -50;
                        }
                        if(item.time === '1500' && rssList[i].tmx != -999){
                            item.tmx = rssList[i].tmx;
                        }else{
                            item.tmx = -50;
                        }

                        req.short.push(item);
                    }
                }
                next();
            });
        });
    };

    /**
     *   merge short/current with shortest.
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.mergeByShortest = function(req, res, next){
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = 'mergeByShortest';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('>', meta);

        var currentTime = self._getCurrentTimeValue(9);

        self._getCoord(regionName, cityName, townName, function(err, coord){
            if (err) {
                log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                return next();
            }
            self._getTownDataFromDB(modelShortest, coord, function(err, shortestList) {
                if (err) {
                    log.error(new Error('error to get shortest for merge'+err.message));
                    return next();
                }

                log.verbose(shortestList);
                if(shortestList && shortestList.length > 0){

                    if(req.short && req.short.length > 0){
                        shortestList.forEach(function(shortestItem){
                            if(currentTime.date <= shortestItem.date && currentTime.time <= shortestItem.date) {
                                req.short.forEach(function(shortItem){
                                    if(shortestItem.date === shortItem.date && shortestItem.time === shortItem.time){
                                        log.silly('MRbyST> update short data');
                                        shortestString.forEach(function(string){
                                            if (shortestItem[string] < 0)  {
                                                log.error('MRbyST> '+string+' item is invalid '+JSON.stringify(meta)+
                                                    ' mCoord='+JSON.stringify(coord)+' item='+JSON.stringify(shortestItem));
                                            }
                                            else {
                                                shortItem[string] = shortestItem[string];
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }

                    if(req.current){
                        shortestList.forEach(function(shortestItem){
                            if(shortestItem.date === req.current.date && shortestItem.time === req.current.time){
                                log.silly('MRbyST> update current data');
                                shortestString.forEach(function(string){
                                    if (shortestItem[string] < 0)  {
                                        log.error('MRbyST> '+string+' item is invalid '+JSON.stringify(meta)+
                                            ' mCoord='+JSON.stringify(coord)+' item='+JSON.stringify(shortestItem));
                                    }
                                    else {
                                        req.current[string] = shortestItem[string];
                                    }
                                });
                            }
                        });

                    }
                }

                next();
            });
        });

        return this;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getShortest = function(req, res, next){
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = 'getShortest';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('>', meta);

        try{
            self._getCoord(regionName, cityName, townName, function(err, coord){
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelShortest, coord, function(err, shortestList){
                    if (err) {
                        log.error(new Error('error to get shortest '+ err.message));
                        return next();
                    }

                    log.debug(shortestList.length);
                    //log.info(listShortest);

                    var nowDate = self._getShortestTimeValue(+9);
                    req.shortest = shortestList.filter(function (shortest) {
                        return nowDate.date + nowDate.time <= shortest.date + shortest.time;
                    });

                    //재사용을 위해 req에 달아둠..
                    req.shortestList = shortestList;
                    next();
                });
            });
        } catch(e){
            log.error('ERROR >>', meta);
            log.error(e);
            next();
        }

        return this;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getCurrent = function(req, res, next) {
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = 'getCurrent';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('>', meta);

        try{
            self._getCoord(regionName, cityName, townName, function(err, coord) {
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelCurrent, coord, function(err, currentList) {
                    if (err) {
                        log.error(new Error('error to get current ' + err.message));
                        return next();
                    }
                    var nowDate = self._getCurrentTimeValue(+9);
                    var acceptedDate = self._getCurrentTimeValue(+6);
                    var currentItem = currentList[currentList.length - 1];
                    var resultItem = {};

                    if(nowDate.date === currentItem.date && nowDate.time === currentItem.time)  {
                        resultItem = currentItem;
                    }
                    else {
                        var kmaTimeLib = require('../lib/kmaTimeLib');
                        var currentTimeObj = kmaTimeLib.convertStringToDate(currentItem.date+currentItem.time);
                        var acceptedTimeObj = kmaTimeLib.convertStringToDate(acceptedDate.date+acceptedDate.time);
                        if (acceptedTimeObj.getTime() < currentTimeObj.getTime()) {
                            resultItem = currentItem;
                        }
                        else {
                            resultItem = self._makeCurrent(req.short, req.shortestList, nowDate.date, nowDate.time);
                            resultItem.time = nowDate.time;
                            resultItem.date = nowDate.date;
                        }
                    }

                    resultItem.sensorytem = Math.round(self._getNewWCT(resultItem.t1h, resultItem.wsd));
                    //log.info(listCurrent);
                    //지수 계산 이후에 반올림함.
                    resultItem.t1h = Math.round(resultItem.t1h);

                    // get discomfort index(불괘지수)
                    resultItem.dspls = LifeIndexKmaController.getDiscomfortIndex(resultItem.t1h, resultItem.reh);
                    resultItem.dsplsStr = LifeIndexKmaController.convertStringFromDiscomfortIndex(resultItem.dspls);

                    // get decomposition index(부패지수)
                    resultItem.decpsn = LifeIndexKmaController.getDecompositionIndex(resultItem.t1h, resultItem.reh);
                    resultItem.decpsnStr = LifeIndexKmaController.convertStringFromDecompositionIndex(resultItem.decpsn);

                    req.current = resultItem;

                    //재사용을 위해 req에 달아둠.
                    req.currentList = currentList;
                    next();
                });
            });
        } catch(e){
            log.error('ERROR>>', meta);
            log.error(e);
            next();
        }

        return this;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getMidRss = function (req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;

        var meta = {};
        meta.method = 'getMidRss';
        meta.region = regionName;
        meta.city = cityName;
        log.info('>', meta);

        if (!req.hasOwnProperty('midData')) {
            req.midData = {};
        }
        if (!req.midData.hasOwnProperty('dailyData') || !Array.isArray(req.midData.dailyData)) {
            req.midData.dailyData = [];
        }

        try {
            manager.getRegIdByTown(regionName, cityName, function(err, code) {
                if (err) {
                    log.error(new Error("Fail to get mid RSS "+ err.message));
                    return next();
                }

                var midRssKmaController = require('../controllers/midRssKmaController');
                midRssKmaController.overwriteData(req.midData, code.cityCode, function (err) {
                    if (err) {
                        log.error(err);
                    }
                    next();
                });
            });
        }
        catch(e) {
            log.error(e);
            next();
        }

        return this;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getMid = function(req, res, next){
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;

        meta.method = 'getMid';
        meta.region = regionName;
        meta.city = cityName;

        log.info('>', meta);

        try{
            manager.getRegIdByTown(regionName, cityName, function(err, code){
                if(err){
                    log.error(new Error('RM> there is no code '+ err.message));
                    return next();
                }

                self._getMidDataFromDB(modelMidForecast, code.pointNumber, function(err, forecastList){
                    if(err){
                        log.error('RM> no forecast data '+err.message);
                        return next();
                    }

                    //log.info(forecastList);
                    req.midData = {};
                    req.midData.forecast = forecastList[forecastList.length - 1];

                    var areaCode = code.cityCode.slice(0, 3);
                    if(areaCode === '11B'){
                        areaCode = '11B00000';
                    }
                    else if(areaCode === '21F'){
                        areaCode = '11F10000';
                    }
                    else{
                        areaCode = code.cityCode.slice(0, 4) + '0000';
                    }

                    self._getMidDataFromDB(modelMidLand, areaCode, function(err, landList){
                        if(err){
                            log.error('RM> no land data ' + err.message);
                            return next();
                        }
                        //log.info(landList);
                        self._getMidDataFromDB(modelMidTemp, code.cityCode, function(err, tempList){
                            if(err){
                                log.error('RM> no temp data ' + err.message);
                                log.error(meta);
                                return next();
                            }
                            //log.info(tempList);
                            self._mergeLandWithTemp(landList, tempList, function(err, dataList){
                                if(err){
                                    log.error('RM> failed to merge land and temp');
                                    log.error(meta);
                                    return next();
                                }
                                //log.info(dataList);
                                req.midData.dailyData = dataList;
                                next();
                            });
                        });
                    });
                })
            });
        }catch(e){
            log.error('ERROE>>', meta);
            log.error(e);
            next();
        }

        return this;
    };

    /**
     * time은 current에 들어있는 것을 써서 24전으로 맞춤.
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getSummary = function(req, res, next){
        var meta = {};

        meta.method = 'getSummary';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>', meta);

        if (!req.current || !req.currentList)  {
            var err = new Error("Fail to find current weather or current list "+JSON.stringify(meta));
            log.warn(err);
            next();
            return this;
        }

        var yesterdayDate = self._getCurrentTimeValue(+9-24);
        var yesterdayItem;
        for (var i=0; i<req.currentList.length;i++) {
            if (req.currentList[i].date == yesterdayDate.date &&
                parseInt(req.currentList[i].time) >= parseInt(req.current.time))
            {
                yesterdayItem =  req.currentList[i];
                break;
            }
        }
        if (yesterdayItem) {
            yesterdayItem.t1h = Math.round(yesterdayItem.t1h);
            req.current.summary = self._makeSummary(req.current, yesterdayItem);
            req.current.yesterday = yesterdayItem;
        }
        else {
            log.warn('Fail to gt yesterday weather info');
            req.current.summary = '';
        }
        next();
        return this;
    };

    /**
     *
     * @param current
     * @param short
     * @param dailyData
     * @private
     */
    this._appendLifeIndexToCurrent = function (current, short, dailyData) {
        var i;
        //for (i=0;i<short.length;i++) {
        //    if (short[i].date === current.date) {
        //        if (short[i].time >= current.time) {
        //            //
        //        }
        //    }
        //}
        for (i=0;i<dailyData.length;i++) {
            if (dailyData[i].date === current.date) {
                if (dailyData[i].ultrv) {
                    current.ultrv = dailyData[i].ultrv;
                    current.ultrvGrade = dailyData[i].ultrvGrade;
                    current.ultrvStr = dailyData[i].ultrvStr;
                }
                if (dailyData[i].fsn) {
                    current.fsn = dailyData[i].fsn;
                    current.fsnGrade = dailyData[i].fsnGrade;
                    current.fsnStr = dailyData[i].fsnStr;
                }
            }
        }
    };
    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getLifeIndexKma = function(req, res, next) {
        //add life index of kma info

        var meta = {};
        meta.method = 'getLifeIndexKma';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>', meta);

        if (!req.short && !req.midData) {
            var err = new Error("Fail to find short, mid weather");
            log.error(err);
            next();
            return this;
        }

        try {
            self._getTownInfo(req.params.region, req.params.city, req.params.town, function (err, townInfo) {
                if (err) {
                    log.error(err) ;
                    next();
                    return;
                }
                LifeIndexKmaController.appendData(townInfo, req.short, req.midData.dailyData, function (err) {
                    if (err) {
                        log.error(err);
                    }
                    //add lifeIndex to current
                    if (req.hasOwnProperty('current')) {
                        self._appendLifeIndexToCurrent(req.current, req.short, req.midData.dailyData);
                    }
                    next();
                });
            });
        }
        catch(e) {
            if (e) {
                log.error(e);
            }
            next();
        }
        return this;
    };

    /**
     *  5분전으로 dateTime을 생성하여 정각에 데이터가 아직 gather전에 에러나는 것 방지
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getKmaStnHourlyWeather = function (req, res, next) {
        var meta = {};
        meta.method = 'getKmaStnHourlyWeather';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>', meta);

        if (!req.current)  {
            var err = new Error("Fail to find current weather "+JSON.stringify(meta));
            log.warn(err);
            next();
            return this;
        }

        try {
            self._getTownInfo(req.params.region, req.params.city, req.params.town, function (err, townInfo) {
                if (err) {
                    log.error(err);
                    next();
                    return;
                }

                var now = new Date();
                now = now.setMinutes(now.getMinutes()-5);
                var date = kmaTimeLib.convertDateToYYYYMMDD(now);
                var time = kmaTimeLib.convertDateToHHMM(now);
                log.info(date+time);
                controllerKmaStnWeather.getStnHourly(townInfo, date+time, function (err, stnWeatherInfo) {
                    if (err) {
                        log.error(err);
                        next();
                        return;
                    }

                    var stnHourlyFirst = true;
                    if (req.current.time === time) {
                        log.verbose('use api first, just append new data of stn hourly weather info');
                        stnHourlyFirst = false;
                    }
                    else {
                        log.verbose('overwrite all data');
                    }

                    for (var key in stnWeatherInfo) {
                        if (stnHourlyFirst || req.current[key] == undefined) {
                            req.current[key] = stnWeatherInfo[key];
                        }
                    }

                    req.current.time = time;
                    // get discomfort index(불괘지수)
                    req.current.dspls = LifeIndexKmaController.getDiscomfortIndex(req.current.t1h, req.current.reh);
                    req.current.dsplsStr = LifeIndexKmaController.convertStringFromDiscomfortIndex(req.current.dspls);

                    // get decomposition index(부패지수)
                    req.current.decpsn = LifeIndexKmaController.getDecompositionIndex(req.current.t1h, req.current.reh);
                    req.current.decpsnStr = LifeIndexKmaController.convertStringFromDecompositionIndex(req.current.decpsn);

                    req.current.t1h = Math.round(req.current.t1h);

                    if (stnHourlyFirst) {
                        if (req.current.rns === true) {
                            if (req.current.pty === 0) {
                                log.info('change pty to rain or snow by get Kma Stn Hourly Weather town=' +
                                    req.params.region + req.params.city + req.params.town);

                                //대충 잡은 값임. 추후 최적화 필요함.
                                if (req.current.t1h > 2) {
                                    req.current.pty = 1;
                                }
                                else if (req.current.t1h > -1) {
                                    req.current.pty = 2;
                                }
                                else {
                                    req.current.pty = 3;
                                }
                                if (req.current.sky === 1) {
                                    req.current.sky = 2;
                                }
                            }
                            req.current.rn1 = req.current.rs1h;
                        }
                        else {
                            if (req.current.pty != 0) {
                                log.info('change pty to zero by get Kma Stn Hourly Weather town=' +
                                    req.params.region + req.params.city + req.params.town);
                                req.current.pty = 1;
                            }
                        }
                    }

                   //merge to req.current
                    next();
                });
            });
        }
        catch(e) {
            if (e) {
                log.warn(e);
            }
            next();
        }

    };
    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getKeco = function (req, res, next) {

        var meta = {};
        meta.method = 'getKeco';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>', meta);

        if (!req.current)  {
            var err = new Error("Fail to find current weather "+JSON.stringify(meta));
            log.warn(err);
            next();
            return this;
        }

        try {
            self._getTownInfo(req.params.region, req.params.city, req.params.town, function (err, townInfo) {
                if (err) {
                    log.error(err);
                    next();
                    return;
                }
                KecoController.getArpLtnInfo(townInfo, new Date(), function (err, arpltn) {
                    if (err) {
                        log.error(err);
                    }
                    req.current.arpltn = arpltn;
                    next();
                });
            });
        }
        catch(e) {
            if (e) {
                log.warn(e);
            }
            next();
        }

        return this;
    };

    this.getKecoDustForecast = function (req, res, next) {
        var meta = {};
        meta.method = 'getKecoDustForecast';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>', meta);

        if (!req.midData)  {
            var err = new Error("Fail to find midData weather "+JSON.stringify(meta));
            log.warn(err);
            next();
            return this;
        }

        try {
            var dateList = [];
            req.midData.dailyData.forEach(function (dailyData) {
               dateList.push(dailyData.date);
            });

            KecoController.getDustFrcst({region:req.params.region, city:req.params.city}, dateList, function (err, results) {
                if (err) {
                    log.error(err);
                    next();
                    return;
                }
                results.forEach(function (result) {
                    req.midData.dailyData.forEach(function (dailyData) {
                        if (dailyData.date === result.date) {
                            dailyData.dustForecast = result.dustForecast;
                        }
                    });
                });
                next();
            });
        }
        catch(e) {
            if (e) {
                log.warn(e);
            }
            next();
        }

        return this;
    };
    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getPastMid = function (req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        var meta = {};
        meta.method = 'getPastMid';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>', meta);

        if (!req.hasOwnProperty('midData')) {
            req.midData = {};
        }
        if (!req.midData.hasOwnProperty('dailyData') || !Array.isArray(req.midData.dailyData)) {
            req.midData.dailyData = [];
        }

        var daySummaryList;

        if (req.pastData) {
            try {
                daySummaryList = self._getDaySummaryList(req.pastData);
                self._mergeList(req.midData.dailyData, daySummaryList);
            }
            catch(e) {
                log.error(e);
            }
            next();
        }
        else {
            self._getCoord(regionName, cityName, townName, function(err, coord) {
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelCurrent, coord, function (err, currentList) {
                    if (err) {
                        log.error(new Error('error to get current for past' + err.message));
                        return next();
                    }

                    try {
                        var requestTime = self._getTimeValue(9-7*24); //지난주 동일 요일까지

                        //log.info(parseInt(curItem.date), parseInt(requestTime.date));
                        req.pastData = currentList.filter(function (current) {
                            return parseInt(current.date) >= parseInt(requestTime.date);
                        });

                        daySummaryList = self._getDaySummaryList(req.pastData);
                        self._mergeList(req.midData.dailyData, daySummaryList);
                    }
                    catch (e) {
                        log.error(e);
                    }
                    return next();
                });
            });
        }

        return this;
    };

    /**
     * 이미 pastdata가 merge되어 있다고 가정하고 있음.
     * @param req
     * @param res
     * @param next
     * @returns {*}
     */
    this.mergeMidWithShort  = function (req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        var meta = {};
        meta.method = 'mergeMidWithShort';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>', meta);

        if (!req.hasOwnProperty('midData')) {
            req.midData = {};
        }
        if (!req.midData.hasOwnProperty('dailyData') || !Array.isArray(req.midData.dailyData)) {
            req.midData.dailyData = [];
        }

        var daySummaryList;

        if (req.short) {
            try {
                daySummaryList = self._getDaySummaryListByShort(req.short);
                self._mergeList(req.midData.dailyData, daySummaryList);
            }
            catch(e) {
                log.error(e);
            }
            next();
        }
        else {
            log.error('You have to getShort before mergeMid');
            next();
        }
        return this;
    };

    this.adjustShort = function(req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        var meta = {};
        meta.method = 'adjustShort';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>', meta);

        if (!req.hasOwnProperty('short')) {
            log.error("Short forecast data hasn't attached on req");
            next();
            return this;
        }

        var daySummaryList = [];
        req.short.forEach(function (short, index) {
            var daySummary = self._createOrGetDaySummaryList(daySummaryList, short.date);
            daySummary.taMax = daySummary.taMax === undefined ? -50:daySummary.taMax;
            daySummary.taMin = daySummary.taMin === undefined ? -50:daySummary.taMin;

            if (daySummary.taMax < short.t3h) {
                daySummary.taMax = short.t3h;
            }
            if (daySummary.taMax < short.tmx) {
                daySummary.taMax = short.tmx;
                log.verbose(index+" tmx clear");
                //clear tmx
            }
            short.tmx = -50;

            if (daySummary.taMin === -50 && short.t3h !== -50) {
                daySummary.taMin = short.t3h;
            }
            else if (daySummary.taMin > short.t3h && short.t3h !== -50) {
                daySummary.taMin = short.t3h;
            }

            if (daySummary.taMin === -50 && short.tmn !== -50) {
                daySummary.taMin = short.tmn;
            }
            else if (daySummary.taMin > short.tmn && short.tmn !== -50) {
                daySummary.taMin = short.tmn;
                short.tmn = -50;
                log.verbose(index+" tmn clear");
            }
            short.tmn = -50;
        });

        req.short.forEach(function (short) {
            var daySum = self._createOrGetDaySummaryList(daySummaryList, short.date);
            daySum.taMax = daySum.taMax === undefined ? -50:daySum.taMax;
            daySum.taMin = daySum.taMin === undefined ? -50:daySum.taMin;
            if (daySum.taMax === -50 || daySum.taMin === -50) {
                log.warn("short date:"+short.date+" fail to get daySummary");
                return;
            }
            if (short.time === "0600") {
                short.tmn = daySum.taMin;
            }
            if (short.time === "1500") {
                short.tmx = daySum.taMax;
            }
        });

        var i = req.short.length - 1;
        for(;i>=0;i--) {
            if(req.short[i].reh !== -1) {
                break;
            }
        }

        req.short.splice(i+1, (req.short.length - (i+1)));

        next();

        return this;
    };

    this.insertStrForData = function (req, res, next) {
        if(req.short){
            req.short.forEach(function (data) {
               self._makeStrForKma(data);
            });
        }
        if(req.shortest){
            req.shortest.forEach(function (data) {
                self._makeStrForKma(data);
            });
        }
        if(req.current){
            self._makeStrForKma(req.current);
            if (req.current.arpltn) {
                self._makeArpltnStr(req.current.arpltn);
            }
        }
        if(req.midData){
            req.midData.dailyData.forEach(function (data) {
                self._makeStrForKma(data);
            });
        }

        next();
        return this;
    };

    this.sendResult = function (req, res) {
        var meta = {};

        var result = {};
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = '/:region/:city/:town';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('##', decodeURI(req.originalUrl));

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

        return this;
    }
}

/**
 * 어제오늘(맨앞에 들어가지만 우선순위는 꼴찌), 날씨(박무, 연무,..), 미세먼지(보통이하 일반 단 나쁨이면 높음), 초미세먼지(미세먼지랑 같이 나오지 않음),
 * 강수량/적설량, 체감온도, 불쾌지수, 자외선, 바람, 감기, 식중독, 부패,
 * @param {Object} current
 * @param {Object} yesterday
 * @returns {String}
 */
ControllerTown.prototype._makeSummary = function(current, yesterday) {
    var str = "";
    var stringList = [];

    if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
        var diffTemp = Math.round(current.t1h - yesterday.t1h);

        str = "어제";
        if (diffTemp == 0) {
            str += "와 동일";
        }
        else {
            str += "보다 " + Math.abs(diffTemp);
            if (diffTemp < 0) {
                str += "˚낮음";
            }
            else if (diffTemp > 0) {
                str += "˚높음";
            }
        }
        stringList.push(str);
    }

    if (current.weather) {
        if(current.weather == '구름많음' ||
            current.weather == '구름조금' ||
            current.weather == '맑음' ||
            current.weather == '흐림') {
            //skip
        }
        else {
            stringList.push(current.weather);
        }
    }

    //current.arpltn = {};
    //current.arpltn.pm10Value = 82;
    //current.arpltn.pm10Str = "나쁨";
    //current.arpltn.pm25Value = 82;
    //current.arpltn.pm25Str = "나쁨";
    var haveAQI = false;
    if (current.arpltn && current.arpltn.pm10Value && current.arpltn.pm10Str &&
        (current.arpltn.pm10Value > 80 || current.arpltn.pm10Grade > 2)) {
        stringList.push("미세먼지 " + current.arpltn.pm10Str);
        haveAQI = true;
    }
    else if (current.arpltn && current.arpltn.pm25Value &&
        (current.arpltn.pm25Value > 50 || current.arpltn.pm25Grade > 2)) {
        stringList.push("초미세먼지 " + current.arpltn.pm25Str);
        haveAQI = true;
    }

    //current.ptyStr = '강수량'
    //current.rn1Str = '1mm 미만'
    if (current.rn1Str) {
        stringList.push(current.ptyStr + " " + current.rn1Str);
    }

    //current.sensorytem = -10;
    //current.sensorytemStr = "관심";
    //current.wsd = 10;
    //current.wsdStr = convertKmaWsdToStr(current.wsd);
    if (current.sensorytem && current.sensorytem <= -10 && current.sensorytem !== current.t1h) {
        stringList.push("체감온도 " + current.sensorytem +"˚");
    }

    //불쾌지수

    //current.ultrv = 6;
    //current.ultrvStr = "높음";
    if (current.ultrv && current.ultrv >= 6) {
        stringList.push("자외선 " + current.ultrvStr);
    }

    if (current.wsd && current.wsd > 9) {
        stringList.push("바람이 " + current.wsdStr);
    }

    //감기

    if (current.fsnGrade && current.fsnGrade >=2 ) {
        if (current.fsnStr) {
            stringList.push("식중독 " + current.fsnStr);
        }
    }

    //부패

    //특정 이벤트가 없다면, 미세먼지가 기본으로 추가, 미세먼지가 어제 오늘 온도비교보다 우선순위 높음.
    if (haveAQI === false) {
        if (current.arpltn && current.arpltn.pm10Str && current.arpltn.pm10Value >= 0)  {
            stringList.push("미세먼지 " + current.arpltn.pm10Str);
        }
    }

    if (stringList.length >= 3) {
        return stringList[1]+", "+stringList[2];
    }
    else {
        return stringList.toString();
    }
};

ControllerTown.prototype._calcValue3hTo1h = function(time, prvValue, nextValue) {
    return  nextValue + (nextValue - prvValue)/3*time;
};

ControllerTown.prototype._makeCurrent = function(shortList, shortestList, date, time) {
        var self = this;
        var currentItem = {'t1h':-50, 'rn1':-1, 'sky':-1, 'uuu':-100, 'vvv':-100, 'reh':-1, 'pty':-1, 'lgt':-1,
            'vec':-1, 'wsd':-1};
        var shortest;
        var short;
        var prvShort;
        var i;
        var intTime = parseInt(time)/100;

        log.warn('_make Current '+date+time);

        if (!shortestList.length && !shortList.length) {
            log.error('_makeCurrent list has not items');
            return;
        }

        for (i=0;i<shortList.length;i++) {
            if (shortList[i].date === date && parseInt(shortList[i].time) >= parseInt(time)) {
                short = shortList[i];
                if (i>0) {
                    prvShort = shortList[i-1];
                }
                break;
            }
        }

        if (short) {
            currentItem.pty = short.pty;
            currentItem.sky = short.sky;
            if (short.time === time) {
                currentItem.t1h = short.t3h;
                currentItem.reh = short.reh;
                currentItem.wsd = short.wsd;
            }
            else {
                currentItem.t3h = Math.round(self._calcValue3hTo1h(intTime%3, short.t3h, prvShort.t3h));
                currentItem.reh = Math.round(self._calcValue3hTo1h(intTime%3, short.reh, prvShort.reh));
                currentItem.wsd = Math.round(self._calcValue3hTo1h(intTime%3, short.wsd, prvShort.wsd));
            }
        }

        for (i=shortestList.length-1;i>=0;i--) {
            if (shortestList[i].date === date && shortestList[i].time === time) {
                shortest = shortestList[i];
                break;
            }
        }

        if (shortest) {
            currentItem.pty = shortest.pty;
            currentItem.rn1 = shortest.rn1;
            currentItem.sky = shortest.sky;
            currentItem.lgt = shortest.lgt;
        }
        return currentItem;
    };

/**
 *
 * @param pty
 * @returns {*}
 */
ControllerTown.prototype._convertKmaPtyToStr = function(pty) {
    if (pty === 1) {
        return "강수량";
    }
    else if (pty === 2) {
        return "강수/적설량"
    }
    else if (pty === 3) {
        return "적설량";
    }

    return "";
};

/**
 * short는 r06, s06으로 나뉘고, current, shortest는 분리되지 않음.
 * @param pty
 * @param rXX
 * @returns {*}
 */
ControllerTown.prototype._convertKmaRxxToStr = function(pty, rXX) {
    if (pty === 1 || pty === 2) {
        switch(rXX) {
            case 0: return "0mm";
            case 1: return "1mm 미만";
            case 5: return "1~4mm";
            case 10: return "5~9mm";
            case 20: return "10~19mm";
            case 40: return "20~39mm";
            case 70: return "40~69mm";
            case 100: return "70mm 이상";
            default : console.log('convert Kma Rxx To Str : unknown data='+rXX);
        }
        /* spec에 없지만 2로 오는 경우가 있었음 related to #347 */
        if (0 < rXX && rXX < 100) {
            return rXX+"mm 미만";
        }
    }
    else if (pty === 3) {
        switch (rXX) {
            case 0: return "0cm";
            case 1: return "1cm 미만";
            case 5: return "1~4cm";
            case 10: return "5~9cm";
            case 20: return "10~19cm";
            case 100: return "20cm 이상";
            default : console.log('convert Km Rxx To Str : unknown data='+rXX);
        }
        /* spec에 없지만 2로 오는 경우가 있었음 */
        if (0 < rXX && rXX < 100) {
            return rXX+"cm 미만";
        }
    }

    return "";
};

/**
 *
 * @param data
 * @returns {ControllerTown}
 * @private
 */
ControllerTown.prototype._makeArpltnStr = function (data) {

    if (data.hasOwnProperty('pm10Value') && data.hasOwnProperty('pm10Grade')) {
        data.pm10Str = KecoController.parsePm10Info(data.pm10Value, data.pm10Grade);
    }

    if (data.hasOwnProperty('pm25Value') && data.hasOwnProperty('pm25Grade')) {
        data.pm25Str = KecoController.parsePm25Info(data.pm25Value, data.pm25Grade);
    }

    return this;
};

ControllerTown.prototype._makeStrForKma = function(data) {

    var self = this;

    if (data.hasOwnProperty('sensorytem') && data.sensorytem < 0) {
        data.sensorytemStr = self._parseSensoryTem(data.sensorytem);
    }

    if (data.hasOwnProperty('ultrvGrade')) {
        data.ultrvStr = LifeIndexKmaController.ultrvStr(data.ultrvGrade);
    }

    if (data.hasOwnProperty('fsnGrade')) {
        data.fsnStr = LifeIndexKmaController.fsnStr(data.fsnGrade);
    }

    if (data.hasOwnProperty('wsd')) {
        data.wsdStr = self._convertKmaWsdToStr(data.wsd);
    }
    if (data.hasOwnProperty('pty') && data.pty > 0) {
        data.ptyStr = self._convertKmaPtyToStr(data.pty);
        if (data.pty == 1) {
            if (data.hasOwnProperty('r06')) {
                data.r06Str = self._convertKmaRxxToStr(data.pty, data.r06);
            }
        }
        else if (data.pty == 2) {
            if (data.hasOwnProperty('r06')) {
                data.r06Str = self._convertKmaRxxToStr(1, data.r06);
            }
            if (data.hasOwnProperty('s06')) {
                data.s06Str = self._convertKmaRxxToStr(3, data.s06);
            }
        }
        else if (data.pty == 3) {
            if (data.hasOwnProperty('s06')) {
                data.s06Str = self._convertKmaRxxToStr(data.pty, data.s06);
            }
        }
        if (data.hasOwnProperty('rn1')) {
            data.rn1Str = self._convertKmaRxxToStr(data.pty, data.rn1);
        }
    }

    return this;
};

/**
 *
 * @param wsd
 * @returns {*}
 */
ControllerTown.prototype._convertKmaWsdToStr = function (wsd) {
    if (wsd < 0) {
       return '';
    }
    else if (wsd < 4) {
        return '약함';
    }
    else if(wsd < 9) {
        return '약간강함';
    }
    else if(wsd < 14) {
        return '강함';
    }
    else {
        return '매우강함';
    }
};

/**
 *
 * @param gmt
 * @returns {{date: *, time: string}}
 */
ControllerTown.prototype._getShortestTimeValue = function(gmt) {
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
};

/**
 *
 * @param gmt
 * @returns {{date: *, time: string}}
 */
ControllerTown.prototype._getCurrentTimeValue = function(gmt) {
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(gmt);
    return {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8, 10) + '00'
    };
};

/**
 * for short
 * @param gmt
 * @returns {{date: *, time: string}}
 */
ControllerTown.prototype._getTimeValue = function(gmt) {
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(gmt);
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
};

/**
 * for short
 * @returns {Array}
 */
ControllerTown.prototype._getTimeTable = function () {
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
        return listResult;
    }

    log.info('make time table');
    listResult.push(JSON.parse(JSON.stringify(dateString)));
    for(var i=0 ; i<45 ; i++){
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
};

/**
 *
 * @param regionName
 * @param cityName
 * @param townName
 * @param callback
 */
ControllerTown.prototype._getShortFromDB = function(regionName, cityName, townName, callback) {
    var err = 0;
    var listTownData = config.testTownData;
    var result = [];
    var resultTown = {};

    var self = this;

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

    var listDate = self._getTimeTable();
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
};

/**
 *
 * @param list
 * @param invalidValue
 * @returns {*}
 * @private
 */
ControllerTown.prototype._max = function(list, invalidValue) {
    var ret;
    var validList;

    if (!Array.isArray(list)) {
        return -1;
    }

    if (invalidValue != undefined) {
        validList = list.filter(function (val) {
            return val !== invalidValue;
        });
    }
    else {
        validList = list;
    }

    validList.forEach(function (data) {
        if (data > ret || ret === undefined) {
            ret = data;
        }
    });

    if (ret === undefined) {
        ret = invalidValue;
    }
    return ret;
};

ControllerTown.prototype._min = function(list, invalidValue) {
    var ret;
    var validList;

    if (!Array.isArray(list)) {
        return -1;
    }

    if (invalidValue != undefined) {
        validList = list.filter(function (val) {
            return val !== invalidValue;
        });
    }
    else {
        validList = list;
    }

    validList.forEach(function (data) {
        if (data < ret || ret === undefined) {
            ret = data;
        }
    });

    if (ret === undefined) {
        ret = invalidValue;
    }
    return ret;
};

/**
 *
 * @param list
 * @param invalidValue
 * @returns {number}
 * @private
 */
ControllerTown.prototype._sum = function(list, invalidValue) {
    var total = 0;
    if (!Array.isArray(list)) {
        return -1;
    }
    var validList;
    if (invalidValue != undefined) {
        validList = list.filter(function (val) {
            return val !== invalidValue;
        });
    }
    else {
        validList = list;
    }

    validList.forEach(function (num) {
        total += num;
    });

    if (total === 0) {
        return Math.round(total);
    }
    else {
        return total.toFixed(1);
    }
};

/**
 *
 * @param list
 * @param invalidValue
 * @returns {number}
 * @private
 */
ControllerTown.prototype._average = function(list, invalidValue) {
    var self = this;

    if (!Array.isArray(list)) {
        return -1;
    }

    var validList;
    if (invalidValue != undefined) {
        validList = list.filter(function (val) {
            return val !== invalidValue;
        });
    }
    else {
        validList = list;
    }

    return Math.round(self._sum(validList)/validList.length);
};

/**
 *
 * @param a
 * @param b
 * @returns {number}
 * @private
 */
ControllerTown.prototype._sortByDateTime = function(a, b) {
    if(a.date > b.date){
        return 1;
    }
    if(a.date < b.date){
        return -1;
    }
    if(a.date === b.date) {
        if (a.hasOwnProperty('time') && b.hasOwnProperty('time')) {
            if (a.time > b.time){
                return 1;
            }
            if(a.time < b.time){
                return -1;
            }
        }
    }
    return 0;
};

ControllerTown.prototype._mergeList = function(dstList, srcList) {

    var self = this;

    srcList.forEach(function (src) {
        for (var i=0; i<dstList.length; i++) {
            if (dstList[i].date === src.date) {
                for (var key in src) {
                    //copy all the fields
                    dstList[i][key] = src[key];
                }
                return;
            }
        }
        dstList.push(src);
    });

    dstList.sort(self._sortByDateTime);
    return this;
};

/**
 *
 * @param list
 * @param region
 * @param city
 * @param town
 * @param cb
 * @returns {*}
 * @private
 */
ControllerTown.prototype._findTown = function(list, region, city, town, cb) {
    if (list.length <= 0) {
        return cb(new Error("list length is zero"));
    }

    async.waterfall([
        function(callback){
            log.silly('Find code from list', region, city, town);
            for(var i=0; i<list.length; i++) {
                var dbTown = list[i];
                if (dbTown.town.first === region && dbTown.town.second === city && dbTown.town.third === town) {
                    log.silly('_findCode : ', dbTown.mCoord);
                    callback('goto exit', dbTown);
                    return;
                }
            }
            log.error("_findTown : Fail to find " + region + city + town);
            callback(null);
        },
        function(callback){
            log.silly('get getcode');
            convertGeocode(region, city, town, function (err, result) {
                if(err){
                    log.error('_findTown : Cannot get mx, my ' + region + city + town + " "+err.message);
                    return callback(null);
                }

                var newTown = {
                    gCoord: {
                        lat: result.lat,
                        lon: result.lon
                    },
                    mCoord: {
                        mx: result.mx,
                        my: result.my
                    },
                    town:{
                        first: region,
                        second: city,
                        third: town
                    }
                };

                list.push(newTown);
                log.silly('_findTown XY>',result);
                callback('goto exit', newTown);
            });
        }
    ],
    function(err, result){
        log.silly('FindTown>', result);
        if(result){
            cb(0, result);
            return;
        }

        cb(new Error("can not find Town"));
    });
};

ControllerTown.prototype._getTownInfo = function(region, city, town, cb) {
    var meta = {};
    meta.method = '_getTownInfo';
    meta.region = region;
    meta.city = city;
    meta.town = town;

    var self = this;

    try{
        if (self.dbTownList.length > 0) {
            self._findTown(self.dbTownList, region, city, town, function (err, towninfo) {
                cb(err, towninfo);
            });
            return this;
        }
        else {
            dbTown.find({}, {_id:0}).lean().exec(function (err, tList) {
                if(err){
                    log.error('~> _getCoord : fail to find db item');
                    if(cb){
                        cb(err);
                    }
                    return;
                }

                if(tList.length === 0){
                    log.error('~> there is no data', tList.length);
                    if(cb){
                        cb(new Error("there is no data"));
                    }
                    return;
                }
                self.dbTownList = tList;
                self._findTown(self.dbTownList, region, city, town, function (err, towninfo){
                    cb(err, towninfo);
                });
            });
            return this;
        }
    }catch(e){
        if (cb) {
            cb(e);
        }
        else {
            log.error(e);
        }
    }

    return this;
};

/**
 *   get coordinate (mx, my) from town list.
 * @param region
 * @param city
 * @param town
 * @param cb
 * @returns {*}
 */
ControllerTown.prototype._getCoord = function(region, city, town, cb){
    var meta = {};
    meta.method = '_getCoord';
    meta.region = region;
    meta.city = city;
    meta.town = town;

    var self = this;

    try{
        if (self.dbTownList.length > 0) {
            self._findTown(self.dbTownList, region, city, town, function(err, townInfo){
                if (err) {
                   cb(err);
                }
                else {
                    cb(err, townInfo.mCoord);
                }

            });
            return this;
        }
        else {
            dbTown.find({}, {_id:0}).lean().exec(function (err, tList) {
                if(err){
                    log.error('~> _getCoord : fail to find db item');
                    if(cb){
                        cb(err);
                    }
                    return;
                }

                if(tList.length === 0){
                    log.error('~> there is no data', tList.length);
                    if(cb){
                        cb(new Error("there is no data"));
                    }
                    return;
                }
                self.dbTownList = tList;
                self._findTown(self.dbTownList, region, city, town, function (err, townInfo) {
                   if (err)  {
                      return  cb(err);
                   }
                    return cb(err, townInfo.mCoord);
                });
            });
            return this;
        }
    }catch(e){
        if (cb) {
            cb(e);
        }
        else {
            log.error(e);
        }
    }

    return {}
};

/**
 * you have to return error object when it's error.
 * @param db
 * @param indicator
 * @param cb
 * @returns {Array}
 */
ControllerTown.prototype._getTownDataFromDB = function(db, indicator, cb){
    var meta = {};
    meta.method = '_getShortFromDB';
    meta.indicator = indicator;

    try{
        db.find({'mCoord.mx': indicator.mx, 'mCoord.my': indicator.my}, {_id: 0}).limit(1).lean().exec(function(err, result){
            if(err){
                log.error('~> getDataFromDB : fail to find db item');
                if(cb){
                    cb(err);
                }
                return;
            }

            if(result.length === 0) {
                err = new Error("~> getDataFromDB : there is no data src="+JSON.stringify(indicator));
                if(cb){
                    cb(err);
                }
                return;
            }
            if(result.length > 1){
                log.error('~> getDataFromDB : what happened??', result.length);
            }

            log.debug(JSON.stringify(result));

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
                            commonString.forEach(function(string){
                                newItem[string] = item[string];
                            });
                            shortString.forEach(function(string){
                                newItem[string] = item[string];
                            });
                            ret.push(newItem);
                        });
                    }
                }else if(result[0].currentData){
                    //ret = result[0].currentData;
                    result[0].currentData.forEach(function(item){
                        var newItem = {};
                        commonString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        curString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        ret.push(newItem);
                    });
                }else if(result[0].shortestData){
                    //ret = result[0].shortestData;
                    result[0].shortestData.forEach(function(item){
                        var newItem = {};
                        commonString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        shortestString.forEach(function(string){
                            newItem[string] = item[string];
                        });
                        ret.push(newItem);
                    });
                }
                else{
                    log.info('~> what???');
                    log.error(meta);
                    return [];
                }
                //log.info(ret);
                cb(0, ret);
            }
            return result[0];
        });
    }catch(e){
        log.error(meta);
        if (cb) {
            cb(e);
        }
        else {
            log.error(e);
        }
    }

    return [];
};

/**
 *   get mid data list from db
 * @param db
 * @param indicator
 * @param cb
 * @returns {Array}
 */
ControllerTown.prototype._getMidDataFromDB = function(db, indicator, cb){
    var meta = {};
    meta.method = '_getMidDataFromDB';
    meta.indicator = indicator;

    try{
        db.find({regId : indicator}, {_id: 0}).limit(1).lean().exec(function(err, result){
            if(err){
                log.error('~> _getMidDataFromDB : fail to find db item');
                if(cb){
                    cb(err);
                }
                return;
            }
            if(result.length === 0){
                log.error('~> _getMidDataFromDB : there is no data');
                if(cb){
                    cb(new Error("there is no data regId="+indicator));
                }
                return;
            }
            if(result.length > 1){
                log.error('~> _getMidDataFromDB : what happened?? ' + result.length + ' regId='+indicator);
            }

            if(cb){
                var ret = [];
                var privateString = [];
                if(result[0].data[0].hasOwnProperty('wfsv')){
                    privateString = forecastString;
                } else if(result[0].data[0].hasOwnProperty('wh10B')){
                    privateString = seaString;
                } else if(result[0].data[0].hasOwnProperty('taMax10')){
                    privateString = tempString;
                } else if(result[0].data[0].hasOwnProperty('wf10')){
                    privateString = landString;
                } else {
                    err = new Error('~> what is it???'+JSON.stringify(result[0].data[0]));
                    log.error(err);
                    log.error(meta);
                    cb(err);
                    return [];
                }

                result[0].data.forEach(function(item){
                    var newItem = {};
                    commonString.forEach(function(string){
                        newItem[string] = item[string];
                    });
                    privateString.forEach(function(string){
                        newItem[string] = item[string];
                    });
                    //log.info(newItem);
                    ret.push(newItem);
                });

                cb(0, ret);
            }
            return result[0];
        });
    }catch(e){
        log.error(meta);
        if (cb) {
            cb(e);
        }
        else {
            log.error(e);
        }
    }

    return [];
};

/**
 * merge short data with current data
 * @param shortList
 * @param currentList
 * @param cb
 * @returns {*}
 */
ControllerTown.prototype._mergeShortWithCurrent = function(shortList, currentList, cb){
    var meta = {};
    meta.method = '_mergeShortWithCurrent';
    meta.short = shortList[0];
    meta.current = currentList[0];

    var self = this;

    try{
        var requestTime = self._getTimeValue(9);
        var tmpList = [];
        var daySummaryList = [];

        // 과거의 current 데이터를 short 리스트에 넣을 수 있게 리스트를 구성한다
        currentList.forEach(function(curItem, index){
            if (curItem.date < shortList[0].date) {
                log.silly('skip');
                return;
            }

            var newItem = {};
            var daySummary = self._createOrGetDaySummaryList(daySummaryList, curItem.date);
            daySummary.taMax = daySummary.taMax === undefined ? -50:daySummary.taMax;
            daySummary.taMin = daySummary.taMin === undefined ? -50:daySummary.taMin;

            if (daySummary.taMax < curItem.t1h) {
                daySummary.taMax = curItem.t1h;
            }
            if (daySummary.taMin === -50 || daySummary.taMin > curItem.t1h) {
                daySummary.taMin = curItem.t1h;
            }
            //log.info(parseInt(curItem.date), parseInt(requestTime.date));
            //log.info(parseInt(curItem.time), parseInt(requestTime.time));
            // 현재 시간 보다 작은 current의 데이터를 사용해서 지난 정보는 실제 current 값을 사용한다
            if ((parseInt(curItem.date) < parseInt(requestTime.date)) ||
                ((parseInt(curItem.date) === parseInt(requestTime.date)) &&
                parseInt(curItem.time) <= parseInt(requestTime.time))){
                // 시간이 0시 이거나 3의 배수인 시간일때 데이터를 구성한다
                // 1시, 2시 같은 경우에는 마지막의 있는 1시, 2시 시간을 버린다.
                if(curItem.time === '0000' || (parseInt(curItem.time) % 3) === 0) {
                    newItem.time = curItem.time;
                    newItem.date = curItem.date;
                    if(index === 0) {
                        curString.forEach(function(string){
                            newItem[string] = curItem[string];
                        });
                    }
                    else {
                        var prv1;
                        if (index === 1) {
                            prv1 = {'t1h':-50, 'rn1':-1, 'sky':-1, 'uuu':-100, 'vvv':-100,
                                'reh':-1, 'pty':-1, 'lgt':-1, 'vec':-1, 'wsd':-1};
                        }
                        else {
                            prv1 = currentList[index-2];
                        }

                        var prv2 = currentList[index-1];

                        if (prv1 === undefined || !prv1.hasOwnProperty('sky') ||
                            prv2 === undefined || !prv2.hasOwnProperty('sky'))
                        {
                            log.warn(new Error('current is undefined or empty object'));
                            return;
                        }

                        curString.forEach(function(string) {
                            if(string === 'sky' || string === 'pty' || string === 'lgt') {
                                newItem[string] = self._max([prv1[string], prv2[string], curItem[string]], -1);
                            }
                            else if(string === 'uuu' || string === 'vvv') {
                                newItem[string] = self._average([prv1[string], prv2[string], curItem[string]], -100);
                            }
                            else if(string === 't1h') {
                                newItem[string] = Math.round(curItem[string]);
                            }
                            else if(string === 'rn1') {
                                newItem[string] = self._sum([prv1[string], prv2[string], curItem[string]], -1);
                            }
                            else{
                                newItem[string] = self._average([prv1[string], prv2[string], curItem[string]], -1);
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
                    shortList[index].rn1 = tmpItem.rn1;
                    shortList[index].reh = tmpItem.reh;
                    shortList[index].sky = tmpItem.sky;
                    shortList[index].t3h = tmpItem.t1h;
                    shortList[index].lgt = tmpItem.lgt;
                    shortList[index].wsd = tmpItem.wsd;
                    shortList[index].vec = tmpItem.vec;
                }
            });

            var currentTmn;
            var currentTmx;

            if (shortItem.time === '0600') {
                currentTmn = (self._createOrGetDaySummaryList(daySummaryList, shortItem.date)).taMin;
                currentTmn = currentTmn === undefined ? -50: currentTmn;
                if (currentTmn !== -50) {
                    //당일은 측정된 값과, 예보중에 큰값으로 결정.
                    if (shortItem.date === requestTime.date && shortList[index].tmn !== -50) {
                        log.silly(shortItem.date+shortItem.time+' short.tmn'+shortList[index].tmn+' curTmn='+currentTmn);
                        shortList[index].tmn = shortList[index].tmn < currentTmn ? shortList[index].tmn : currentTmn;
                    }
                    else {
                        shortList[index].tmn = currentTmn;
                    }
                }
                shortList[index].tmn = shortList[index].tmn.toFixed(1);
            }
            if (shortItem.time === '1500') {
                currentTmx = (self._createOrGetDaySummaryList(daySummaryList, shortItem.date)).taMax;
                currentTmx = currentTmx === undefined ? -50: currentTmx;
                if (currentTmx !== -50) {
                    //당일은 측정된 값과, 예보중에 큰값으로 결정.
                    if (shortItem.date === requestTime.date && shortList[index].tmx !== -50) {
                        log.silly(shortItem.date+shortItem.time+' short.tmx'+shortList[index].tmx+' curTmx='+currentTmx);
                        shortList[index].tmx = shortList[index].tmx > currentTmx ? shortList[index].tmx : currentTmx;
                    }
                    else {
                        shortList[index].tmx = currentTmx;

                    }
                }
                shortList[index].tmx = shortList[index].tmx.toFixed(1);
            }
        });

        if(cb){
            cb(0, shortList);
        }
    }
    catch(e){
        log.error(meta);
        if (cb) {
            cb(e)
        }
        else {
            log.error(e);
        }
        return [];
    }

    return shortList;
};

/**
 *   merge short data with RSS data
 * @param shortList
 * @param rssList
 * @param cb
 * @returns {*}
 */
ControllerTown.prototype._mergeShortWithRSS = function(shortList, rssList, cb){
    var meta = {};
    meta.method = '_mergeShortWithRSS';
    meta.short = shortList[0];
    meta.rssList = rssList[0];

    //log.info(rssList.length);
    //log.info(shortList.length);

    var self = this;

    try{
        var requestTime = self._getTimeValue(9);

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
                        shortList[i].r06 = Math.round(rssItem.r06);
                        shortList[i].reh = rssItem.reh;
                        shortList[i].s06 = Math.round(rssItem.s06);
                        shortList[i].sky = rssItem.sky;
                        shortList[i].t3h = Math.round(rssItem.temp);
                        if(shortList[i].time === '0600' && rssItem.tmn != -999) {
                            shortList[i].tmn = Math.round(rssItem.tmn);
                        }
                        if(shortList[i].time === '1500' && rssItem.tmn != -999){
                            shortList[i].tmx = Math.round(rssItem.tmx);
                        }
                    }
                }
                if(found === 0){
                    var item = {};
                    item.date = rssItem.date.slice(0, 8);
                    item.time = rssItem.date.slice(8, 12);
                    item.pop = rssItem.pop;
                    item.pty = rssItem.pty;
                    item.r06 = Math.round(rssItem.r06);
                    item.reh = rssItem.reh;
                    item.s06 = Math.round(rssItem.s06);
                    item.sky = rssItem.sky;
                    item.t3h = Math.round(rssItem.temp);
                    if(item.time === '0600' && rssItem.tmn != -999){
                        item.tmn = Math.round(rssItem.tmn);
                    } else{
                        item.tmn = -50;
                    }
                    if(item.time === '1500' && rssItem.tmx != -999){
                        item.tmx = Math.round(rssItem.tmx);
                    }else{
                        item.tmx = -50;
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
        if (cb) {
            cb(e);
        }
        else {
            log.error(e);
        }
        return [];
    }

    return shortList;
};

/**
 *   merge land and temp
 * @param landList
 * @param tempList
 * @param cb
 * @returns {Array}
 */
ControllerTown.prototype._mergeLandWithTemp = function(landList, tempList, cb){
    var meta = {};
    var result = [];

    meta.method = '_mergeLandWithTemp';

    var self = this;

    try{
        var todayLand = landList[landList.length - 1];
        var todayTemp = tempList[tempList.length - 1];
        var i;
        var currentDate;
        var item;

        //log.info(todayLand);
        //log.info(todayTemp);
        for(i=0 ; i<8 ; i++){
            currentDate = self._getCurrentTimeValue(9+ 72 + (i * 24));
            item = {
                date: currentDate.date
            };
            var index = i+3;

            if(i<5){
                item.wfAm = todayLand['wf' + index + 'Am'];
                item.wfPm = todayLand['wf' + index + 'Pm'];
            } else{
                item.wfAm = item.wfPm = todayLand['wf' + index];
            }
            item.taMin = todayTemp['taMin' + index];
            item.taMax = todayTemp['taMax' + index];

            result.push(item);
        }

        //log.info('res', result);
        // 11일 전의 데이터부터 차례차례 가져와서 과거의 날씨 정보를 채워 넣자...
        for(i = 10 ; i > 0 ; i--){
            currentDate = self._getCurrentTimeValue(9 - (i * 24));
            var targetDate = self._getCurrentTimeValue(9 + 72 - (i * 24)); // 찾은 데이터는 3일 후의 날씨를 보여주기때문에 72를 더해야 함
            item = {
                date: targetDate.date
            };
            var j;
            //log.info(currentDate, targetDate);
            for(j in landList){
                if(currentDate.date === landList[j].date && landList[j].time === '1800'){
                    item.wfAm = landList[j].wf3Am;
                    item.wfPm = landList[j].wf3Pm;
                    break;
                }
            }

            for(j in tempList){
                if(currentDate.date === tempList[j].date && tempList[j].time === '1800'){
                    item.taMin = tempList[j].taMin3;
                    item.taMax = tempList[j].taMax3;
                    result.push(item);
                    //log.info('> prev data', item);
                    break;
                }
            }
        }

        result.sort(self._sortByDateTime);

        //log.info(result);

        if(cb){
            cb(0, result);
        }

    } catch(e){
        log.error('> something wrong');
        log.error(meta);
        if (cb) {
            cb(e);
        }
        else {
            log.error(e);
        }
        return [];
    }

    return [];
};

/**
 *
 * @returns {Array}
 */
ControllerTown.prototype._makeBasicShortList = function(){
    var result = [];

    var self = this;

    var currentTime = parseInt(self._getCurrentTimeValue(9).time.slice(0,2));

    // make time table
    // the day before yesterday 00h ~ the day after tomorrow 24h
    for(var i=0 ; i < 41 ; i++){
        var item = self._getTimeValue(9-currentTime-24*2+(i*3));
        shortString.forEach(function(string){
            if(string == 'tmn' || string === 'tmx' || string === 't3h') {
                item[string] = -50;
            } else if (string === 'uuu' || string === 'vvv') {
                item[string] = -100;

            }else{
                item[string] = -1;
            }
        });
        result.push(item);
    }

    self._dataListPrint(result, 'route S', 'template short');

    return result;
};

/**
 *
 * @param shortList
 * @param basicList
 * @returns {*}
 */
ControllerTown.prototype._mergeShortWithBasicList = function(shortList, basicList){
    shortList.forEach(function(shortItem) {
        basicList.forEach(function(basicItem) {
            if(shortItem.date === basicItem.date && shortItem.time === basicItem.time){
                shortString.forEach(function(string){
                    if (string === 't3h') {
                        basicItem[string] = Math.round(shortItem[string]);
                    }
                    else {
                        basicItem[string] = shortItem[string];
                    }
                });
            }
        });
    });

    return basicList;
};

/**
 *
 * @param list
 * @param name
 * @param title
 */
ControllerTown.prototype._dataListPrint = function(list, name, title){
    log.silly(name, '> ' + title + 'List (size: ' +  list.length +' )========================================');
    list.forEach(function(item, index){
        log.silly('[' + index +']', item);
    });
    log.silly('==================================================================================');
};

ControllerTown.prototype._getNewWCT = function(Tdum,Wdum) {
    if (Wdum < 0) {
        log.warn('Wdum is invalid');
        return Tdum;
    }

    var T = Tdum;
    var W = Wdum*3.6;
    var result = 0.0;
    if ( W > 4.8 ) {
        W = Math.pow(W,0.16);
        result = 13.12 + 0.6215 * T - 11.37 * W + 0.3965 * W * T;
        if(result > T) {
            result = T;
        }
    }
    else {
        result = T;
    }
    return result;
};

ControllerTown.prototype._parseSensoryTem = function(sensoryTem) {
    if (sensoryTem >= 0 ) {
        return "";
    }
    else if ( -10 < sensoryTem && sensoryTem < 0) {
        return "관심";
    }
    else if ( -25 < sensoryTem && sensoryTem <= -10) {
        return "주의";
    }
    else if ( -45 < sensoryTem && sensoryTem <= -25) {
        return "경고";
    }
    else if (sensoryTem <= -45) {
        return "위험";
    }
    return "";
};

/**
 *
 * @param list
 * @param date
 * @returns {*}
 * @private
 */
ControllerTown.prototype._createOrGetDayCondition = function(list, date) {
    for(var i=0; i<list.length; i++) {
        if (list[i].date === date) {
            return list[i];
        }
    }

    list.push({date: date, lgt:[], pty:[], reh:[], rn1:[], sky:[], t1h:[], wsd:[], pop:[], r06:[], s06:[], t3h:[], tmx:-50, tmn:-50});
    return list[list.length-1];
};

/**
 *
 * @param list
 * @param date
 * @returns {*}
 * @private
 */
ControllerTown.prototype._createOrGetDaySummaryList = function(list, date) {
    for(var i=0; i<list.length; i++) {
        if (list[i].date === date) {
            return list[i];
        }
    }

    list.push({date:date});
    return list[list.length-1];
};

/**
 * -1, 0, 1
 * @param list
 * @param invalidValue
 * @returns {*}
 * @private
 */
ControllerTown.prototype._summaryLgt = function(list, invalidValue) {
    if (!Array.isArray(list)) {
        return -1;
    }

    var validList;
    if (invalidValue != undefined) {
        validList = list.filter(function (val) {
            return val !== invalidValue;
        });
    }
    else {
        validList = list;
    }

    for (var i=0; i<validList.length; i++) {
        if (validList[i] > 0) {
            return validList[i];
        }
    }

    return 0;
};

/**
 *  -1, 0, 1, 2, 3
 * @param list
 * @param invalidValue
 * @returns {number}
 * @private
 */
ControllerTown.prototype._summaryPty = function(list, invalidValue) {
    var pty = 0;

    if (!Array.isArray(list)) {
        return -1;
    }

    var validList;
    if (invalidValue != undefined) {
        validList = list.filter(function (val) {
            return val !== invalidValue;
        });
    }
    else {
        validList = list;
    }

    for (var i=0; i<validList.length; i++) {
        if (validList[i] === 2) {
            return 2;
        }
        else if (validList[i] === 1) {
            if (pty === 3) {
                return 2;
            }
            pty = 1;
        }
        else if (validList[i] === 3) {
            if (pty === 1) {
                return  2;
            }
            pty = 3;
        }
    }
    return pty;
};

/**
 *
 * @param sky
 * @param pty
 * @returns {*}
 * @private
 */
ControllerTown.prototype._convertSkyToKorStr = function(sky, pty) {
    var str = '';

    if (pty === 0) {
        switch (sky) {
            case 1: return '맑음';
            case 2: return '구름조금';
            case 3: return '구름많음';
            case 4: return '흐림';
        }
    }
    else {
        switch (sky) {
            case 1: str = '구름적고 ';
                log.warn("It's special case");
                break;
            case 2: str = '구름적고 ';
                break;
            case 3: str = '구름많고 ';
                break;
            case 4: str = '흐리고 ';
                break;
            default:
                break;
        }
        switch (pty) {
            case 1: return str+'비';
            case 2: return str+'비/눈';
            case 3: return str+'눈';
        }
    }
    log.error(new Error("Unknown state sky="+sky+" pty="+pty));
    return str;
};

/**
 *
 * @param shortList
 * @returns {Array}
 * @private
 */
ControllerTown.prototype._getDaySummaryListByShort = function(shortList) {
    var self = this;
    var dayConditionList = [];
    var daySummaryList = [];
    var dateInfo = self._getCurrentTimeValue(9);

    shortList.forEach(function (short, i) {
        if (short.date < dateInfo.date) {
            log.verbose('getDaySummaryListByShort skip date='+short.date+' before today');
            return;
        }
        if (i === shortList.length-1 && short.time === '0000') {
            //todo update way
           return;
        }

        //"pop":0,"pty":0,"r06":0,"reh":50,"s06":0,"sky":4,"t3h":4,"tmn":-50,"tmx":-50
        var dayCondition = self._createOrGetDayCondition(dayConditionList, short.date);
        if (short.pop !== -1) {
            dayCondition.pop.push(short.pop);
        }
        if (short.pty !== -1) {
            dayCondition.pty.push(short.pty);
        }
        if (short.r06 !== -1) {
            dayCondition.r06.push(short.r06);
        }
        if (short.reh !== -1) {
            dayCondition.reh.push(short.reh);
        }
        if (short.s06 !== -1) {
            dayCondition.s06.push(short.s06);
        }
        if (short.sky !== -1) {
            dayCondition.sky.push(short.sky);
        }
        dayCondition.t3h.push(short.t3h);
        if (short.tmx !== -50) {
            dayCondition.tmx = short.tmx;
        }
        if (short.tmn !== -50) {
            dayCondition.tmn = short.tmn;
        }
    });

    dayConditionList.forEach(function (dayCondition) {
        if (dayCondition.reh.length === 0) {
            log.warn(new Error("dayCondition is empty :" + dayCondition.date));
            return;
        }

        var daySummary = self._createOrGetDaySummaryList(daySummaryList, dayCondition.date);

        daySummary.pop = self._max(dayCondition.pop, -1);
        daySummary.pty = self._summaryPty(dayCondition.pty, -1);
        daySummary.r06 = self._sum(dayCondition.r06, -1);
        daySummary.reh = self._average(dayCondition.reh, -1);
        daySummary.s06 = self._sum(dayCondition.s06, -1);
        daySummary.sky = self._average(dayCondition.sky, -1);
        daySummary.wfAm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.wfPm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.t1d = self._average(dayCondition.t3h, -50);
        daySummary.taMax = Math.round(dayCondition.tmx);
        daySummary.taMin = Math.round(dayCondition.tmn);
    });

    return daySummaryList;
};

/**
 *
 * @param pastList
 * @returns {Array}
 * @private
 */
ControllerTown.prototype._getDaySummaryList = function(pastList) {

    var self = this;
    var dayConditionList = [];
    var daySummaryList = [];
    //var dateInfo = _getCurrentTimeValue(9);

    pastList.forEach(function (hourCondition) {
        //if (dateInfo.date - hourCondition.date > 7) {
        //    //skip
        //    log.info('getDaySummaryList skip date='+ hourCondition.date);
        //    return;
        //}
        var dayCondition = self._createOrGetDayCondition(dayConditionList, hourCondition.date);
        if (hourCondition.lgt !== -1) {
            dayCondition.lgt.push(hourCondition.lgt);
        }
        if (hourCondition.pty !== -1) {
            dayCondition.pty.push(hourCondition.pty);
        }
        if (hourCondition.reh !== -1) {
            dayCondition.reh.push(hourCondition.reh);
        }
        if (hourCondition.rn1 !== -1) {
            dayCondition.rn1.push(hourCondition.rn1);
        }
        if (hourCondition.sky !== -1) {
            dayCondition.sky.push(hourCondition.sky);
        }
        if (hourCondition.t1h !== -50) {
            dayCondition.t1h.push(hourCondition.t1h);
        }
        if (hourCondition.wsd !== -1) {
            dayCondition.wsd.push(hourCondition.wsd);
        }
    });

    dayConditionList.forEach(function (dayCondition) {
        if (dayCondition.reh.length === 0) {
            log.warn(new Error("dayCondition is empty :" + dayCondition.date));
            return;
        }

        var daySummary = self._createOrGetDaySummaryList(daySummaryList, dayCondition.date);

        daySummary.lgt = self._summaryLgt(dayCondition.lgt, -1);
        daySummary.pty = self._summaryPty(dayCondition.pty, -1);
        daySummary.reh = self._average(dayCondition.reh, -1);
        daySummary.rn1 = self._sum(dayCondition.rn1, -1);
        daySummary.sky = self._average(dayCondition.sky, -1);
        daySummary.wfAm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.wfPm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.t1d = self._average(dayCondition.t1h, -50);
        daySummary.wsd = self._average(dayCondition.wsd, -1);
        daySummary.taMax = Math.round(self._max(dayCondition.t1h, -50));
        daySummary.taMin = Math.round(self._min(dayCondition.t1h, -50));
    });

    return daySummaryList;
};

module.exports = ControllerTown;

