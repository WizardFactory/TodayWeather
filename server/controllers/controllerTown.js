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
            var requestTime = self._getTimeValue(9);

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

                    var i;

                    self._dataListPrint(shortList, 'route S', 'original short');

                    for(i=0 ; i < shortList.length ; i++){
                        //log.info(shortList[i]);
                        if(shortList[i].date === requestTime.date && shortList[i].time >= requestTime.time){
                            //log.info('found same date');
                            break;
                        }
                    }

                    log.silly('route S> short remove count :', i);
                    for(var j=0 ; j<i ; j++){
                        shortList.shift();
                    }

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
                                req.short[j].tmn = Math.round(rssList[i].tmn);
                            } else if(req.short[j].time === '1500' && rssList[i].tmn != -999) {
                                req.short[j].tmx = Math.round(rssList[i].tmx);
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
                            item.tmn = Math.round(rssList[i].tmn);
                        } else{
                            item.tmn = -50;
                        }
                        if(item.time === '1500' && rssList[i].tmx != -999){
                            item.tmx = Math.round(rssList[i].tmx);
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
     *   merge short/current with shorest.
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

                log.info(shortestList);
                if(shortestList && shortestList.length > 0){
                    if(req.short && req.short.length > 0){
                        shortestList.forEach(function(shortestItem){
                            if(currentTime.date <= shortestItem.date && currentTime.time <= shortestItem.date){
                                req.short.forEach(function(shortItem){
                                    if(shortestItem.date === shortItem.date && shortestItem.time === shortItem.time){
                                        log.silly('MRbyST> update short data');
                                        shortestString.forEach(function(string){
                                            shortItem[string] = shortestItem[string];
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
                                    req.current[string] = shortestItem[string];
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

                    var nowDate = self._getShortestTimeValue(+9);
                    var resultItem = shortestList.filter(function (shortest) {
                        return nowDate.date + nowDate.time <= shortest.date + shortest.time;
                    });

                    //log.info(listShortest);
                    req.shortest = resultItem;
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
    this.getCurrent = function(req, res, next){
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

                    if((nowDate.date !== currentItem.date) ||
                        (nowDate.date === currentItem.date && acceptedDate.time >= currentItem.time)){
                        // 없으면 short를 가져다 쓸까?? 일단은 그냥 current꺼 쓰자.
                        resultItem = currentItem;

                    }else{
                        // 현재 시간으로 넣어준
                        resultItem = currentItem;
                    }
                    resultItem.time = nowDate.time;
                    resultItem.date = currentItem.date;

                    resultItem.sensorytem = Math.round(self._getNewWCT(resultItem.t1h, resultItem.wsd));
                    resultItem.sensorytemStr = self._parseSensoryTem(resultItem.sensorytem);
                    //log.info(listCurrent);
                    req.current = resultItem;
                    next();
                });
            });
        } catch(e){
            log.error('ERROE>>', meta);
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
        var townName = '';
        if(req.params.town != undefined){
            townName = req.params.town;
        }
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
     *
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getSummary = function(req, res, next){
        var meta = {};

        meta.method = 'getSummary';

        log.info('>', meta);

        next();
        return this;
    };

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
        meta.method = 'getLifeIndeKma';
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
            var LifeIndexKmaController = require('../controllers/lifeIndexKmaController');
            LifeIndexKmaController.appendData({third: req.params.town, second: req.params.city, first: req.params.region},
                req.short, req.midData.dailyData, function (err) {
                    if (err) {
                        log.error(err);
                    }
                    //add lifeIndex to current
                    if (req.hasOwnProperty('current')) {
                        self._appendLifeIndexToCurrent(req.current, req.short, req.midData.dailyData);
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
        return this;
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
                        req.pastData = currentList;
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
            if (daySum.taMax === -50 || daySum.taMin === -50) {
                log.error("short date:"+short.date+" fail to get daySummary");
                return;
            }
            if (short.time === "0600") {
                short.tmn = daySum.taMin;
            }
            if (short.time === "1500") {
                short.tmx = daySum.taMax;
            }
        });

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
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8, 10) + '00'
    };

    return dateString;
};

/**
 *
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
 *
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
        return;
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
 * @returns {number}
 * @private
 */
ControllerTown.prototype._sum = function(list) {
    var total = 0;
    if (!Array.isArray(list)) {
        return -1;
    }
    list.forEach(function (num) {
        total += num;
    });
    return total;
};

/**
 *
 * @param list
 * @returns {number}
 * @private
 */
ControllerTown.prototype._average = function(list) {
    var self = this;

    if (!Array.isArray(list)) {
        return -1;
    }
    return Math.round(self._sum(list)/list.length);
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
                    if (src[key] !== -50) {
                        dstList[i][key] = src[key];
                    }
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
ControllerTown.prototype._findTownCode = function(list, region, city, town, cb) {
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
                    callback('goto exit', dbTown.mCoord);
                    return;
                }
            }
            log.error("_findTownCode : Fail to find " + region + city + town);
            callback(null);
        },
        function(callback){
            log.silly('get getcode');
            convertGeocode(region, city, town, function (err, result) {
                if(err){
                    log.error('_findTownCode : Cannot get mx, my ' + region + city + town + " "+err.message);
                    return callback(null);
                }

                var newTown = {
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
                log.silly('_findCode XY>',result);
                callback('goto exit', {mx:result.mx, my: result.my});
            });
        }
    ],
    function(err, result){
        log.silly('FindCode>', result);
        if(result){
            cb(0, result);
            return;
        }

        cb(new Error("can not find code"));
    });
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
            self._findTownCode(self.dbTownList, region, city, town, cb);
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
                self._findTownCode(self.dbTownList, region, city, town, cb);
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

            log.debug(result.toString());

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
 *
 * @param list
 * @param invalidValue
 * @returns {*}
 * @private
 */
ControllerTown.prototype._getMax = function(list, invalidValue) {
    var ret;
    list.forEach(function (data) {
        if (data !== invalidValue && (data > ret || ret === undefined)) {
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
ControllerTown.prototype._getAverage = function(list, invalidValue) {
    var ret=0;
    var len=0;

    list.forEach(function (data) {
        if (data !== invalidValue) {
            ret += data;
            len++;
        }
    });

    if (len > 0) {
        ret = Math.round(ret/len);
    }
    else {
        ret = invalidValue;
    }

    return ret;
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
                if(curItem.time === '0000' || (parseInt(curItem.time) % 3) === 0){
                    newItem.time = curItem.time;
                    newItem.date = curItem.date;
                    if(index === 0) {
                        curString.forEach(function(string){
                            newItem[string] = curItem[string];
                        });
                    }
                    else if (index === 1) {
                        var tmp = {};
                        tmp = currentList[index - 1];

                        if (tmp === undefined || !tmp.hasOwnProperty('sky')) {
                            log.warn(new Error('current is undefined or empty object'));
                            return;
                        }

                        //log.info(tmp);
                        curString.forEach(function(string){
                            if(string === 'sky' || string === 'pty' || string === 'lgt') {
                                newItem[string] = self._getMax([tmp[string], curItem[string]], -1);
                            }
                            else if(string === 'uuu' || string === 'vvv') {
                                newItem[string] = self._getAverage([tmp[string], curItem[string]], -100);
                            }
                            else if(string === 't1h') {
                                newItem[string] = self._getAverage([tmp[string], curItem[string]], -50);
                            }
                            else{
                                newItem[string] = self._getAverage([tmp[string], curItem[string]], -1);
                            }
                        });
                    } else {
                        var prv1 = currentList[index-2];
                        var prv2 = currentList[index-1];
                        //var next = currentList[index+1];
                        curString.forEach(function(string){
                            if(string === 'sky' || string === 'pty' || string === 'lgt') {
                                newItem[string] = self._getMax([prv1[string], prv2[string], curItem[string]], -1);
                            }
                            else if(string === 'uuu' || string === 'vvv') {
                                newItem[string] = self._getAverage([prv1[string], prv2[string], curItem[string]], -100);
                            }
                            else if(string === 't1h') {
                                newItem[string] = self._getAverage([prv1[string], prv2[string], curItem[string]], -50);
                            }
                            else{
                                newItem[string] = self._getAverage([prv1[string], prv2[string], curItem[string]], -1);
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
            }
            if (shortItem.time === '1500') {
                currentTmx = (self._createOrGetDaySummaryList(daySummaryList, shortItem.date)).taMax;
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
                    basicItem[string] = shortItem[string];
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

    list.push({date:date, lgt:-1, pty:-1, reh:-1, rn1:-1, sky:-1, pop:-1, s06:-1, wfAm:'', wfPm:'', t1d:-50, wsd:-1, taMax:-50, taMin:-50});
    return list[list.length-1];
};

/**
 * -1, 0, 1
 * @param list
 * @returns {*}
 * @private
 */
ControllerTown.prototype._summaryLgt = function(list) {
    if (!Array.isArray(list)) {
        return -1;
    }
    for (var i=0; i<list.length; i++) {
        if (list[i] > 0) {
            return list[i];
        }
    }
    return 0;
};

/**
 *  -1, 0, 1, 2, 3
 * @param list
 * @returns {number}
 * @private
 */
ControllerTown.prototype._summaryPty = function(list) {
    var pty = 0;

    if (!Array.isArray(list)) {
        return -1;
    }
    for (var i=0; i<list.length; i++) {
        if (list[i] === 2) {
            return 2;
        }
        else if (list[i] === 1) {
            if (pty === 3) {
                return 2;
            }
            pty = 1;
        }
        else if (list[i] === 3) {
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
            case 1: //str = '맑고 ';
                log.warn("It's special case");
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

        daySummary.pop = Math.max.apply(null, dayCondition.pop);
        daySummary.pty = self._summaryPty(dayCondition.pty);
        //daySummary.r06 = _sum(dayCondition.r06);
        daySummary.reh = self._average(dayCondition.reh);
        //daySummary.s06 = _sum(dayCondition.s06);
        daySummary.sky = self._average(dayCondition.sky);
        daySummary.wfAm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.wfPm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.t1d = self._average(dayCondition.t3h);
        daySummary.taMax = dayCondition.tmx;
        daySummary.taMin = dayCondition.tmn;
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

        daySummary.lgt = self._summaryLgt(dayCondition.lgt);
        daySummary.pty = self._summaryPty(dayCondition.pty);
        daySummary.reh = self._average(dayCondition.reh);
        daySummary.rn1 = self._sum(dayCondition.rn1);
        daySummary.sky = self._average(dayCondition.sky);
        daySummary.wfAm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.wfPm = self._convertSkyToKorStr(daySummary.sky, daySummary.pty);
        daySummary.t1d = self._average(dayCondition.t1h);
        daySummary.wsd = self._average(dayCondition.wsd);
        daySummary.taMax = Math.max.apply(null, dayCondition.t1h);
        daySummary.taMin = Math.min.apply(null, dayCondition.t1h);
    });

    return daySummaryList;
};

module.exports = ControllerTown;

