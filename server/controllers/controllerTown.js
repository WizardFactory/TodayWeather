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
var modelHealthDay = require('../models/modelHealthDay');
var modelAreaNo = require('../models/modelAreaNo');

var convertGeocode = require('../utils/convertGeocode');

var LifeIndexKmaController = require('../controllers/lifeIndexKmaController');
var KecoController = require('../controllers/kecoController');
var controllerKmaStnWeather = require('../controllers/controllerKmaStnWeather');
var kmaTimeLib = require('../lib/kmaTimeLib');

var kasiRiseSetController = require('../controllers/kasi.riseset.controller');

var townArray = [
    {db:modelShort, name:'modelShort'},
    {db:modelCurrent, name:'modelCurrent'},
    {db:modelShortest, name:'modelShortest'},
    {db:modelShortRss, name:'modelShortRss'}
];

var midArray = [
    {db:modelMidForecast, name:'modelMidForecast'},
    {db:modelMidLand, name:'modelMidLand'},
    {db:modelMidTemp, name:'modelMidTemp'}
];

/**
 * router callback에서 getShort 호출시에, this는 undefined되기 때문에, 생성시에 getShort를 만들어주고, self는 생성자에서 만들어준다.
 * @constructor
 */
function ControllerTown() {
    this.dbTownList = [];

    var self = this;
    this.checkParamValidation = function(req, res, next) {
        var regionName = req.params.region;
        var townName = req.params.town;
        if (regionName == '중국' || regionName == '일본' || regionName == '미국' || regionName == '하늘시') {
            log.error('We did not support this region '+regionName);
            res.status(400).send("We didn't support this region");
        }
        else if (townName == 'KR') {
            log.error('Invalid params='+JSON.stringify(req.params));
            req.params.region = req.params.city;
            req.params.city= regionName;
            req.params.town = undefined;
            next();
        }
        else if (townName == 'JP') {
            log.error('Invalid params='+JSON.stringify(req.params));
            res.status(400).send("We didn't support this region");
        }
        else {
            next();
        }
        return this;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     */
    this.getAllDataFromDb = function(req, res, next){
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

        meta.method = 'get AllDataFromDb';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('## + ' + decodeURI(req.originalUrl) + ' sID=' + req.sessionID);
        log.info('>sID=',req.sessionID, meta);

        try{
            self._getCoord(regionName, cityName, townName, function(err, coord) {
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }

                log.silly('GaD> coord : ', coord);
                //townInfo를 통째로 달고 싶지만, 아쉽.
                req.coord = coord;

                async.parallel([
                    function(callback){
                        // get town weather
                        async.map(townArray,
                            function(item, cb){
                                self._getTownDataFromDB(item.db, coord, undefined, function(err, data){
                                    if (err) {
                                        log.error(new Error('GaD> error to get data : '+ err.message + ' name='+item.name));
                                        return cb(err);
                                    }
                                    req[item.name] = data;
                                    log.info('T DATA[' + item.name + '] sID=',req.sessionID);
                                    log.silly('T DATA[' + item.name + '] : ', req[item.name]);
                                    cb(null);
                                });
                            },
                            function(err){
                                if(err){
                                    log.error(new Error('Gad> something is wrong on the townWeather'));
                                    return callback(err);
                                }
                                callback(null);
                            }
                        );
                    },
                    function(callback) {
                        // get mid weather
                        manager.getRegIdByTown(regionName, cityName, function (err, code) {
                            if (err) {
                                log.error(new Error('GaD> error to get pointnumber : ' + err.message));
                                return callback(err);
                            }

                            log.silly('point number : ', code);
                            async.map(midArray,
                                function (item, cb) {
                                    var parm;
                                    if(item.db === modelMidForecast){
                                        parm = code.pointNumber;
                                    }
                                    else if(item.db === modelMidLand){
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
                                        parm = areaCode;
                                    }else{
                                        parm = code.cityCode
                                    }

                                    self._getMidDataFromDB(item.db, parm, undefined, function (err, midData) {
                                        if (err) {
                                            log.error(new Error('GaD> error to get midData : '+ err.message));
                                            return cb(err);
                                        }
                                        req[item.name] = midData;
                                        log.info('M DATA[' + item.name + '] sID=',req.sessionID);
                                        log.silly('M DATA[' + item.name + '] : ', req[item.name]);
                                        cb(null);
                                    });
                                },
                                function (err) {
                                    if (err) {
                                        log.error(new Error('Gad> something is wrong on the Mid : ' + err.message));
                                        return callback(err);
                                    }
                                    callback(null);
                                }
                            );
                        });
                    },
                    function (callback) {
                        var dateList = [];
                        dateList.push(self._getCurrentTimeValue(+9).date); //today
                        dateList.push(self._getCurrentTimeValue(+33).date); //tomorrow
                        KecoController.getDustFrcst({region:req.params.region, city:req.params.city}, dateList, function (err, results) {
                            if (err) {
                                return callback(err);
                            }
                            log.info('K DATA[DustFrcst] sID='+req.sessionID);
                            req.dustFrcstList = results;
                            callback();
                        });
                    }
                    ],
                    function(err){
                        if(err){
                            log.error(new Error('Gad> something is wrong to get weather data : ' + err.message));
                        }
                        log.info('>sID=',req.sessionID, 'go next');
                        next();
                    }
                );
            });
        }catch(e){
            log.error('ERROR>>', meta);
            log.error(e);
            next();
        }
    };

    /**
     * 추후 url를 gather나 requester의 주소로 변경.
     * @param apiName
     * @param callback
     * @private
     */
    this._requestApi = function (apiName, callback) {
        var req = require('request');
        var url = "http://"+config.ipAddress+":"+config.port+"/gather/";

        log.info('Start url='+url+apiName);
        req(url+apiName, {json: true}, function(err, response, body) {
            log.info('Finished '+apiName+' '+new Date());
            if (err) {
                log.error(err);
                return callback();
            }
            if (response.statusCode >= 400) {
                err = new Error("api="+apiName+" statusCode="+response.statusCode);
            }
            callback(err, body);
        });
    };

    this.checkDBValidation = function(req, res, next) {
        var funcArray = [];
        if (req.modelCurrent == undefined) {
            funcArray.push(function (callback) {
                var apiName = "current/"+req.coord.mx+"/"+req.coord.my;
                self._requestApi(apiName, function (err, result) {
                    if (err == undefined) {
                        req.modelCurrent = result;
                    }
                    callback();
                });
            });
        }

        if (req.modelShort == undefined) {
            funcArray.push(function (callback) {
                var apiName = "short/"+req.coord.mx+"/"+req.coord.my;
                self._requestApi(apiName, function (err, result) {
                    if (err == undefined) {
                        req.modelShort = result;
                    }
                    callback();
                });
            });
        }

        if (req.modelShortest == undefined) {
            funcArray.push(function (callback) {
                var apiName = "shortest/"+req.coord.mx+"/"+req.coord.my;
                self._requestApi(apiName, function (err, result) {
                    if (err == undefined) {
                        req.modelShortest = result;
                    }
                    callback();
                });
            });
        }

        if (funcArray.length ) {
            async.parallel(funcArray, function () {
               next();
            });
        }
        else {
            next();
        }
        return;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     */
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
        log.info('>sID=',req.sessionID, meta);

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

                self._getTownDataFromDB(modelShort, coord, req, function(err, shortInfo){
                    if (err) {
                        log.error(new Error('error to get short '+ err.message));
                        return next();
                    }

                    var shortList=shortInfo.ret;

                    self._dataListPrint(shortList, 'route S', 'original short');

                    basicShortlist = self._mergeShortWithBasicList(shortList,basicShortlist);
                    self._dataListPrint(basicShortlist, 'route S', 'First, merged short');

                    req.shortPubDate = shortInfo.pubDate;
                    req.short = basicShortlist;
                    next();
                });
            });
        } catch(e){
            log.error('ERROR>>', meta);
            log.error(e);
            next();
        }
    };

    /**
     * rss를 req.short에 overwrite
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
        log.info('>sID=',req.sessionID, meta);

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
            self._getTownDataFromDB(modelShortRss, coord, req, function(err, shortRssInfo) {
                if(err) {
                    log.error(new Error('error to get short RSS '+ err.message));
                    return next();
                }

                if (parseInt(shortRssInfo.pubDate) < parseInt(req.shortPubDate)) {
                    log.warn('short rss was updated yet!! rss pubDate=', shortRssInfo.pubDate);
                    return next();
                }

                var rssList = shortRssInfo.ret;

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
                
                //동일한 경우뿐만 아니라 동일한 경우 없이 바로 적은 경우에도 해당하는 인덱스 다음부터 사용해야 함.
                i = i+1;
                
                var j;
                var found;
                var overwrite = false;

                req.shortRssPubDate = shortRssInfo.pubDate;

                if (parseInt(req.shortPubDate) < parseInt(req.shortRssPubDate)) {
                   overwrite = true;
                }
                // rss 데이터를 모두 가져온다.
                for(i;i<rssList.length;i++) {
                    found = 0;

                    for(j=0;j<req.short.length;j++) {
                        if(parseInt(req.short[j].date + req.short[j].time) === parseInt(rssList[i].date)) {
                            found = 1;

                            if (overwrite || req.short[j].pop == undefined || req.short[j].pop == -1) {
                                req.short[j].pop = rssList[i].pop;
                            }
                            if (overwrite || req.short[j].pty == undefined || req.short[j].pty == -1) {
                                req.short[j].pty = rssList[i].pty;
                            }
                            //s06, r06은 6시간 단위로 오기 때문에 3,9,15,21은 원래 -1이며, RSS는 다른 시간대의 값과 동일하게 옴.
                            //지금 -1을 덮어쓰고, adjustShort에서 나누어서 저장하게 되어있는데, adjustShort를 사용안하면 주의 필요.
                            if (overwrite || req.short[j].r06 == undefined || req.short[j].r06 == -1) {
                                req.short[j].r06 = +(rssList[i].r06).toFixed(1);
                            }
                            if (overwrite || req.short[j].s06 == undefined || req.short[j].s06 == -1) {
                                req.short[j].s06 = +(rssList[i].s06).toFixed(1);
                            }
                            if (overwrite || req.short[j].reh == undefined || req.short[j].reh == -1) {
                                req.short[j].reh = rssList[i].reh;
                            }
                            if (overwrite || req.short[j].sky == undefined || req.short[j].sky == -1) {
                                req.short[j].sky = rssList[i].sky;
                            }
                            if (overwrite || req.short[j].t3h == undefined || req.short[j].t3h == -50) {
                                req.short[j].t3h = +(rssList[i].temp).toFixed(1);
                            }
                            if(req.short[j].time === '0600' && rssList[i].tmn != -999) {
                                if (overwrite || req.short[j].tmn == undefined || req.short[j].tmn == -50) {
                                    req.short[j].tmn = rssList[i].tmn;
                                }
                            } else if(req.short[j].time === '1500' && rssList[i].tmn != -999) {
                                if (overwrite || req.short[j].tmx == undefined || req.short[j].tmx == -50) {
                                    req.short[j].tmx = rssList[i].tmx;
                                }
                            }
                            if (overwrite || req.short[j].wsd == undefined || req.short[j].wsd == -1) {
                                req.short[j].wsd = rssList[i].wsd;
                            }
                            if (overwrite || req.short[j].vec == undefined || req.short[j].vec == -1) {
                                req.short[j].vec = rssList[i].vec;
                            }
                            if (overwrite || req.short[j].wav == undefined || req.short[j].wav == -1) {
                                req.short[j].wav = rssList[i].wav;
                            }
                            if (overwrite || req.short[j].uuu == undefined || req.short[j].uuu == -100) {
                                req.short[j].uuu = rssList[i].uuu;
                            }
                            if (overwrite || req.short[j].vvv == undefined || req.short[j].vvv == -100) {
                                req.short[j].vvv = rssList[i].vvv;
                            }
                            break;
                        }
                    }
                }
                next();
            });
        });
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
        log.info('>sID=',req.sessionID, meta);

        try{
            self._getCoord(regionName, cityName, townName, function(err, coord){
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelShortest, coord, req, function(err, shortestInfo){
                    if (err) {
                        log.error(new Error('error to get shortest '+ err.message));
                        return next();
                    }

                    var shortestList = shortestInfo.ret;

                    log.debug(shortestList.length);
                    //log.info(listShortest);

                    var nowDate = self._getShortestTimeValue(+9);
                    req.shortest = shortestList.filter(function (shortest) {
                        return nowDate.date + nowDate.time <= shortest.date + shortest.time;
                    });

                    //재사용을 위해 req에 달아둠..
                    req.shortestList = shortestList;
                    req.shortestPubDate = shortestInfo.pubDate;
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
     * 현시간 데이터가 없으면, 3시간 이내 데이터 사용 없으면, short,shortest로 만듬.
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
        log.info('>sID=',req.sessionID, meta);

        try{
            self._getCoord(regionName, cityName, townName, function(err, coord) {
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelCurrent, coord, req, function(err, currentInfo) {
                    if (err) {
                        log.error(new Error('error to get current ' + err.message));
                        return next();
                    }

                    var currentList = currentInfo.ret;

                    var nowDate = self._getCurrentTimeValue(+9);
                    var currentItem = currentList[currentList.length - 1];
                    var resultItem = {};

                    if(nowDate.date === currentItem.date && nowDate.time === currentItem.time)  {
                        resultItem = JSON.parse(JSON.stringify(currentItem));
                    }
                    else {
                        //현재 시간의 데이터가 없다면, 3시간 내에 있는 데이터를 사용함.
                        var acceptedDate = self._getCurrentTimeValue(+6);
                        var currentTimeObj = kmaTimeLib.convertStringToDate(currentItem.date+currentItem.time);
                        var acceptedTimeObj = kmaTimeLib.convertStringToDate(acceptedDate.date+acceptedDate.time);
                        if (acceptedTimeObj.getTime() < currentTimeObj.getTime()) {
                            resultItem = JSON.parse(JSON.stringify(currentItem));
                        }
                        else {
                            resultItem = self._makeCurrent(req.short, req.shortestList, nowDate.date, nowDate.time);
                            resultItem.time = nowDate.time;
                            resultItem.date = nowDate.date;
                            resultItem.overwrite = true;
                        }
                    }

                    if (resultItem.t1h == -50) {
                       resultItem.t1h = undefined;
                    }
                    else {
                        resultItem.t1h = +(resultItem.t1h).toFixed(1);
                    }

                    if (resultItem.rn1 == -1) {
                        resultItem.rn1 = undefined;
                    }
                    else {
                        if (resultItem.rn1 < 10) {
                            resultItem.rn1 = +(resultItem.rn1).toFixed(1);
                        }
                        else {
                            resultItem.rn1 = Math.round(resultItem.rn1);
                        }
                    }
                    if (resultItem.sky == -1) {
                        resultItem.sky = undefined;
                    }
                    if (resultItem.uuu == -100) {
                        resultItem.uuu = undefined;
                    }
                    if (resultItem.vvv == -100) {
                        resultItem.vvv = undefined;
                    }
                    if (resultItem.reh == -1) {
                        resultItem.reh = undefined;
                    }
                    if (resultItem.pty == -1) {
                        resultItem.pty = undefined;
                    }
                    if (resultItem.lgt == -1) {
                        resultItem.lgt = undefined;
                    }
                    if (resultItem.vec == -1) {
                        resultItem.vec = undefined;
                    }
                    if (resultItem.wsd == -1) {
                        resultItem.wsd = undefined;
                    }
                    else {
                        resultItem.wsd = +(resultItem.wsd).toFixed(1);
                    }

                    // get freeze string(동파가능지수)
                    if(req.short !== undefined) {
                        var yesterday = kmaTimeLib.convertStringToDate(resultItem.date);
                        var yesterdayMinTemperature = -50;

                        yesterday.setDate(yesterday.getDate()-1);

                        // convert yesterday string from Date object
                        var yesterdayString = kmaTimeLib.convertDateToYYYYMMDD(yesterday);

                        for(var i=0;i<req.short.length;i++) {
                            if((req.short[i].date ===  yesterdayString)
                                && (req.short[i].reh !== -1))
                            {
                                yesterdayMinTemperature = req.short[i].tmn;
                                break;
                            }
                        }
                        // 값이 없을 경우 0
                        if(yesterdayMinTemperature === -50) {
                            yesterdayMinTemperature = 0;
                        }

                        req.yesterdayMinTemperature = yesterdayMinTemperature;
                    }

                    req.current = resultItem;
                    req.currentPubDate = currentInfo.pubDate;

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
     * 0시를 이전날 24시로 변경함
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.convert0Hto24H = function (req, res, next) {

        if (req.current) {
            if (req.current.time === "0000") {
                kmaTimeLib.convert0Hto24H(req.current);
            }
        }

        if (req.short) {
           req.short.forEach(function (data) {
               kmaTimeLib.convert0Hto24H(data);
           });
        }

        if (req.shortest) {
           req.shortest.forEach(function (data) {
               kmaTimeLib.convert0Hto24H(data);
           });
        }

        if (req.currentList) {
            req.currentList.forEach(function (data) {
                kmaTimeLib.convert0Hto24H(data);
            });
        }

        next();
        return this;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {*}
     */
    this.mergeShortWithCurrentList = function (req, res, next) {

        if (req.currentList == undefined || req.short == undefined) {
            log.error("You have to need current list and short");
            return next();
        }

        self._mergeShortWithCurrent(req.short, req.currentList, function(err, resultShortList) {
            if (err) {
                log.error(err);
                return next();
            }

            self._dataListPrint(resultShortList, 'route S', 'Merged with Current');

            req.short = resultShortList;
            next();
        });
    };

    /**
     *
     * @param current
     * @param shortestList
     * @param currentTime
     * @returns {boolean}
     * @private
     */
    this._mergeCurrentByShortest = function (current, shortestList, currentTime) {
        if (current == undefined) {
            return false;
        }
        if (shortestList == undefined || shortestList.length == 0) {
            return false;
        }
        //req.current가 1시간 이전 데이터(0분~30분)이면 shortest를 적용하면서 실제 시간에 맞춤.
        if (current.date == currentTime.date && parseInt(current.time) < parseInt(currentTime.time)) {

            shortestList.forEach(function(shortestItem){
                if(shortestItem.date === currentTime.date && shortestItem.time === currentTime.time){
                    log.silly('MRbyST> update current data');
                    shortestString.forEach(function(string){
                        if (string == 't1h'){
                            if (shortestItem[string] != -50) {
                                current[string] = shortestItem[string];
                                return;
                            }
                        }
                        else if (string == 'uuu' || string == 'vvv') {
                            if (shortestItem[string] != -100) {
                                current[string] = shortestItem[string];
                                return;
                            }
                        }
                        else if (shortestItem[string] != -1) {
                            current[string] = shortestItem[string];
                            return;
                        }
                        if (string == 'wsd') {
                            log.warn('MRbyST> '+string+' item is invalid item='+JSON.stringify(shortestItem));
                        }
                        else {
                            log.error('MRbyST> '+string+' item is invalid item='+JSON.stringify(shortestItem));
                        }
                    });
                    current.date = currentTime.date;
                    current.time = currentTime.time;
                    current.overwrite = true;
                }
            });

            if (current.overwrite) {
                return true;
            }
        }

        return false;
    };

    this.updateCurrentListForValidation = function (req, res, next) {
        if (req.currentList == undefined) {
            req.currentList = [];
        }

        var tempCurrent = {date:"", time:"", mx: -1, my:-1, t1h: -50, rn1: -1, sky: -1, uuu:-1, vvv:-1, reh:-1,
            pty: -1, lgt: -1, vec: -1, wsd: -1};

        var currentDateList = [];
        for(var i=8*24 ; i>=0; i--){
            var currentDate = self._getCurrentTimeValue(9-i);
            currentDateList.push(currentDate) ;
        }

        currentDateList.forEach(function (currentDate) {
            for (var i=0; i<req.currentList.length; i++) {
                var current =  req.currentList[i];
                if (current.date == currentDate.date && current.time == currentDate.time) {
                    return;
                }
            }

            //log.info("add date="+currentDate.date+" time="+currentDate.time);
            tempCurrent.date = currentDate.date;
            tempCurrent.time = currentDate.time;
            req.currentList.push(JSON.parse(JSON.stringify(tempCurrent)));
        });

        req.currentList.sort(function (a, b) {
            if(a.date > b.date){
                return 1;
            }
            else if(a.date < b.date){
                return -1;
            }
            else if(a.date === b.date){
                if (a.time > b.time) {
                    return 1;
                }
                else if (a.time < b.time){
                    return -1;
                }
            }
            return 0;
        });

        if (req.currentList.length >= manager.MAX_CURRENT_COUNT) {
            req.currentList = req.currentList.slice((req.currentList.length - manager.MAX_CURRENT_COUNT));
        }

        next();
        return this;
    };

    function _convertCloud2SKy(cloud) {
        if (cloud <= 2) {
            return 1;
        }
        else if (cloud <= 5) {
            return 2;
        }
        else if (cloud <= 8) {
            return 3;
        }
        else {
            return 4;
        }

        return 0;
    }

    function _convertStnWeather2Pty(rns, weather) {
        if (weather == undefined) {
            return 0;
        }
        if (weather.indexOf("끝") >= 0) {
            return 0;
        }
        else if (weather.indexOf("비") >= 0) {
            return 1;
        }
        else if (weather.indexOf("진눈깨비") >= 0) {
            return 2;
        }
        else if (weather.indexOf("눈") >= 0) {
            return 3;
        }
        else if (weather.indexOf("얼음") >= 0) { //얼음싸라기
            return 3;
        }
        else if (rns == true) {
            return 1;
        }
        return 0;
    }

    function _convertStnWeather2Lgt(weather) {
        if (weather == undefined) {
            return 0;
        }
        if (weather.indexOf("뇌우") >= 0 || weather.indexOf("번개") >= 0 || weather.indexOf("뇌전") >= 0) {
           return 1;
        }

        return 0;
    }

    this.mergeCurrentByStnHourly = function (req, res, next) {
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = 'mergeCurrentByStnHourly';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>sID=',req.sessionID, meta);

        self._getTownInfo(req.params.region, req.params.city, req.params.town, function (err, townInfo) {
            controllerKmaStnWeather.getCityHourlyList(townInfo,  function (err, stnWeatherInfo) {
                if (stnWeatherInfo == undefined) {
                    log.error("Fail to find stnWeatherInfo");
                    next();
                    return;
                }
                var hourlyList = stnWeatherInfo;
                req.currentList.forEach(function (current) {
                    if (current.t1h != -50) {
                       return;
                    }

                    var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(current.date+current.time);
                    for (var i=0; i<hourlyList.length; i++) {
                        var hourlyData = hourlyList[i];
                        if (hourlyData.date == stnDateTime)  {
                            current.t1h = hourlyData.t1h;
                            current.rn1 = hourlyData.rs1h;
                            current.sky = _convertCloud2SKy(hourlyData.cloud);
                            current.reh = hourlyData.reh;
                            current.pty = _convertStnWeather2Pty(hourlyData.rns, hourlyData.weather);
                            current.lgt = _convertStnWeather2Lgt(hourlyData.weather);
                            current.vec = hourlyData.vec;
                            current.wsd = hourlyData.wsd;
                            return;
                        }
                    }
                });

                if (req.current == undefined || req.current.t1h == undefined || req.current.t1h == -50) {
                    if (!(req.current == undefined)) {
                        var stnDateTime = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM(req.current.date+req.current.time);

                        for (var i=hourlyList.length-1; i>=0; i--) {
                            var hourlyData = hourlyList[i];
                            if (hourlyData.date == stnDateTime)  {
                                req.current.t1h = hourlyData.t1h;
                                req.current.rn1 = hourlyData.rs1h;
                                req.current.sky = _convertCloud2SKy(hourlyData.cloud);
                                req.current.reh = hourlyData.reh;
                                req.current.pty = _convertStnWeather2Pty(hourlyData.rns, hourlyData.weather);
                                req.current.lgt = _convertStnWeather2Lgt(hourlyData.weather);
                                req.current.vec = hourlyData.vec;
                                req.current.wsd = hourlyData.wsd;
                                break;
                            }
                        }
                    }
                }
                next();
            });
        });

        return this;
    };

    /**
     * 사용하지 않음. #823
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.mergeCurrentByShortest = function (req, res, next) {
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = 'mergeCurrentByShortest';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>sID=',req.sessionID, meta);

        var currentTime = self._getCurrentTimeValue(9);

        if (req.shortestList) {
            var merged = self._mergeCurrentByShortest(req.current, req.shortestList, currentTime);
            if (merged && req.currentList) {
                req.currentList.push(req.current);
            }
            next();
        }
        else {
            self._getCoord(regionName, cityName, townName, function(err, coord){
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelShortest, coord, req, function(err, shortestInfo) {
                    if (err) {
                        log.error(new Error('error to get shortest for merge' + err.message));
                        return next();
                    }

                    var shortestList = shortestInfo.ret;

                    log.verbose(shortestList);
                    if (shortestList && shortestList.length > 0) {
                        req.shortestList = shortestList;

                        var merged = self._mergeCurrentByShortest(req.current, shortestList, currentTime);

                        if(merged && req.currentList) {
                            req.currentList.push(req.current);
                        }
                    }

                    next();
                });
            });
        }

        return this;
    };

    /**
     *
     * @param shortList
     * @param shortestList
     * @param currentTime
     * @param useTime - shortest가 적용될 시간임. 10시일 경우 12시로 넘어옴.
     * @private
     */
    this._mergeShortByShortest = function (shortList, shortestList, currentTime, useTime) {

        if(shortList == undefined || shortList.length == 0) {
            return;
        }
        if(shortestList == undefined || shortestList.length == 0) {
            return;
        }

        //사용대 시간보다 3시간전데이터부터 사용함.
        var filterdList = shortestList.filter(function (obj) {
            var objTime = parseInt(obj.time.substr(0,2));
            if(parseInt(currentTime.date) < parseInt(obj.date)) {
                return true;
            }
            else if (parseInt(currentTime.date) == parseInt(obj.date) && useTime-3 < objTime) {
                return true;
            }
            return false;
        });

        var tmpList = self._convert1Hto3H(filterdList, false);
        var shortLen = shortList.length;
        var i;
        var short;
        tmpList.forEach(function (shortest3h) {
            for (i=0; i<shortLen; i++) {
                short = shortList[i];
                if (shortest3h.date === short.date && shortest3h.time === short.time) {
                    for (var key in shortest3h) {
                        if (key === 'rn1') {
                            if (shortest3h[key] == -1) {
                                continue;
                            }
                            short.shortestRn1 = shortest3h[key]
                        }
                        else if (key === 't1h') {
                            if (shortest3h[key] == -50) {
                                continue;
                            }
                           short.t3h = shortest3h.t1h;
                        }
                        else {
                            if (key == 'uuu' || key == 'vvv') {
                                if (shortest3h[key] == -100) {
                                    continue;
                                }
                            }
                            else {
                                if (shortest3h[key] == -1) {
                                    continue;
                                }
                            }
                            short[key] = shortest3h[key];
                        }
                    }
                    break;
                }
            }
        });
    };

    /**
     *   merge short/current with shortest.
     *   shortest는 temp를 가지고 있지 않기 때문에 tmx,tmn을 재조정하지 않아도 됨. 있다 해도, adjustShort에서 전체적인 보정을 해줌.
     *   rn1이 3시간 강수/적설량이기 때문에, adjustShort에서 r06,s06를 3시간 단위로 쪼갠 후에 적용해야 함.
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
        log.info('>sID=',req.sessionID, meta);

        var currentTime = self._getCurrentTimeValue(9);
        var useTime = Math.ceil(parseInt(currentTime.time.substr(0, 2)) / 3)*3;
        if (useTime >= 24) {
           useTime -= 24;
        }

        if (req.shortestList) {
            self._mergeShortByShortest(req.short, req.shortestList, currentTime, useTime);
            next();
        }
        else {

            self._getCoord(regionName, cityName, townName, function(err, coord){
                if (err) {
                    log.error(new Error('error to get coord ' + err.message + ' '+ JSON.stringify(meta)));
                    return next();
                }
                self._getTownDataFromDB(modelShortest, coord, req, function(err, shortestInfo) {
                    if (err) {
                        log.error(new Error('error to get shortest for merge'+err.message));
                        return next();
                    }

                    var shortestList = shortestInfo.ret;

                    log.verbose(shortestList);
                    if(shortestList && shortestList.length > 0) {
                        req.shortestList = shortestList;
                        self._mergeShortByShortest(req.short, shortestList, currentTime, useTime);
                    }

                    next();
                });
            });
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
        log.info('>sID=',req.sessionID, meta);

        if (!req.current)  {
            req.current={};
            var nowDate = self._getCurrentTimeValue(+9);
            req.current.time = nowDate.time;
            req.current.date = nowDate.date;
        }

        try {
            self._getTownInfo(req.params.region, req.params.city, req.params.town, function (err, townInfo) {
                if (err) {
                    log.error(err);
                    next();
                    return;
                }

                var now = new Date();
                now = kmaTimeLib.toTimeZone(9, now);

                var date = kmaTimeLib.convertDateToYYYYMMDD(now);
                var time = kmaTimeLib.convertDateToHHZZ(now);
                log.info(date+time, meta);
                controllerKmaStnWeather.getStnHourly(townInfo, date+time, req.current.t1h, function (err, stnWeatherInfo) {
                    if (err) {
                        log.error(err);
                        next();
                        return;
                    }

                    var stnHourlyFirst = true;
                    var stnWeatherInfoTime = new Date(stnWeatherInfo.stnDateTime);
                    var currentTime = kmaTimeLib.convertStringToDate(req.current.date+req.current.time);

                    if (currentTime.getTime() >= stnWeatherInfoTime.getTime()) {
                        log.info('use api first, just append new data of stn hourly weather info');
                        stnHourlyFirst = false;
                    }
                    else {
                        log.info('overwrite all data');
                    }

                    //체크 가능한 값이 아래 3가지뿐임. t1h는 실제로 0도일 수 있지만, 에러인 경우에도 0으로 옴.
                    if (stnWeatherInfo.t1h === 0 && stnWeatherInfo.vec === 0 && stnWeatherInfo.wsd === 0) {
                        log.warn('stnWeatherInfo is invalid!', meta);
                        stnHourlyFirst = false;
                    }

                    for (var key in stnWeatherInfo) {
                        if (stnHourlyFirst || req.current[key] == undefined) {
                            req.current[key] = stnWeatherInfo[key];
                        }
                    }

                    req.current.date = date;
                    req.current.time = time;

                    if (stnHourlyFirst) {
                        req.current.overwrite = true;
                    }

                    //update currentList of req.
                    if (req.currentList) {
                        var lastObj = req.currentList[req.currentList.length-1];
                        if (lastObj.date === req.current.date && lastObj.time === req.current.time ) {
                            req.currentList[req.currentList.length-1] = req.current;
                        }
                        else {
                            req.currentList.push(JSON.parse(JSON.stringify(req.current)));
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
     * req.current에만 적용하고 currentlist에는 적용안함.
     * req.current에 liveTime이라고 새로운 시간 정보를 추가함.
     * @param req
     * @param res
     * @param next
     */
    this.getKmaStnMinuteWeather = function (req, res, next) {
        var meta = {};
        meta.method = 'getKmaStnMinuteWeather';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>sID=',req.sessionID, meta);

        if (!req.current)  {
            req.current={};
            var nowDate = self._getCurrentTimeValue(+9);
            req.current.time = nowDate.time;
            req.current.date = nowDate.date;
        }

        try {
            self._getTownInfo(req.params.region, req.params.city, req.params.town, function (err, townInfo) {
                if (err) {
                    log.error(err);
                    next();
                    return;
                }

                var now = new Date();
                now = kmaTimeLib.toTimeZone(9, now);

                var date = kmaTimeLib.convertDateToYYYYMMDD(now);
                var time = kmaTimeLib.convertDateToHHMM(now);
                log.debug(date+time, meta);
                controllerKmaStnWeather.getStnHourlyAndMinRns(townInfo, date+time, req.current, function (err, stnWeatherInfo) {
                    if (err) {
                        log.error(err);
                        next();
                        return;
                    }

                    //체크 가능한 값이 아래 3가지뿐임. t1h는 실제로 0도일 수 있지만, 에러인 경우에도 0으로 옴.
                    if (stnWeatherInfo.t1h === 0 && stnWeatherInfo.vec === 0 && stnWeatherInfo.wsd === 0) {
                        log.warn('stnWeatherInfo is invalid!', meta);
                        next();
                        return;
                    }

                    /* 분단위 데이터지만, 분단위 데이터가 없는 경우 시간단위 데이터가 올수 있음. */
                    /* todo: 분단위 데이터와 시단위 데이터를 분리해서 시단위는 동네예보와 우선순위 선정하는게 더 정확함.
                        current -> 도시별 날씨 -> AWS 분단위 -> 초단기 */

                    var stnWeatherInfoTime = new Date(stnWeatherInfo.stnDateTime);
                    var stnFirst = true;
                    if (!(req.currentPubDate == undefined)) {
                        var currentTime = kmaTimeLib.convertStringToDate(req.currentPubDate);

                        if (currentTime.getTime() >= stnWeatherInfoTime.getTime()) {

                            log.info('>sID=',req.sessionID,
                                'use api first, just append new data of stn hourly weather info', meta);
                            stnFirst = false;
                        }
                        else {
                            log.info('>sID=',req.sessionID, 'overwrite all data', meta);
                        }
                    }

                    for (var key in stnWeatherInfo) {
                        if (stnFirst || req.current[key] == undefined) {
                            req.current[key] = stnWeatherInfo[key];
                        }
                    }

                    if (stnFirst) {
                        req.current.date = kmaTimeLib.convertDateToYYYYMMDD(stnWeatherInfoTime);
                        req.current.time = kmaTimeLib.convertDateToHHZZ(stnWeatherInfoTime);
                    }

                    if (req.current.rn1 == undefined || stnFirst) {
                        if (!(stnWeatherInfo.rs1h == undefined)) {
                            req.current.rn1 = stnWeatherInfo.rs1h;
                        }
                    }
                    if (req.current.sky == undefined || stnFirst) {
                        if (!(stnWeatherInfo.cloud == undefined)) {
                            req.current.sky = _convertCloud2SKy(stnWeatherInfo.cloud);
                        }
                    }
                    if (req.current.pty == undefined || stnFirst) {
                        if (!(stnWeatherInfo.weather == undefined) && !(stnWeatherInfo.rns == undefined)) {
                            req.current.pty = _convertStnWeather2Pty(stnWeatherInfo.rns, stnWeatherInfo.weather);
                        }
                    }
                    if (req.current.lgt == undefined || stnFirst) {
                        if (!(stnWeatherInfo.weather == undefined)) {
                            req.current.lgt = _convertStnWeather2Lgt(stnWeatherInfo.weather);
                        }
                    }

                    if (stnFirst) {
                        //24시 01분부터 1시까지 날짜 맞지 않음.
                        //req.current.date = date;
                        req.current.liveTime = stnWeatherInfo.stnDateTime.substr(11, 5).replace(":","");

                        req.current.overwrite = true;
                        if (req.current.rns === true) {
                            if (req.current.pty === 0) {
                                log.info('change pty to rain or snow by get Kma Stn Hourly Weather town=' +
                                    req.params.region + req.params.city + req.params.town);

                                //온도에 따라 눈/비 구분.. 대충 잡은 값임. 추후 최적화 필요함.
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
                            if (req.current.rs1h > 0) {
                                req.current.rn1 = req.current.rs1h;
                                if (req.current.rn1 > 10) {
                                    req.current.rn1 = Math.round(req.current.rn1);
                                }
                                else {
                                    req.current.rn1 = +(req.current.rn1).toFixed(1);
                                }
                            }
                        }
                        else if (req.current.rns === false) {
                            //눈, 비가 오지 않는다 경우에 대해서는 overwrite하지 않음. 에러가 많음.
                            //if (req.current.pty != 0) {
                            //    log.info('change pty to zero by get Kma Stn Hourly Weather town=' +
                            //        req.params.region + req.params.city + req.params.town);
                            //    req.current.pty = 0;
                            //}
                        }
                        else {
                            log.debug('we did not get rns info');
                        }
                    }
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
     * 중기 예보의 wfAm, wfPm을 sky, pty, lgt로 변환함. Am, Pm을 합친 값도 추가.
     * @param req
     * @param res
     * @param next
     */
    this.convertMidKorStrToSkyInfo = function (req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;

        var meta = {};
        meta.method = 'convertMidKorStrToSkyInfo';
        meta.region = regionName;
        meta.city = cityName;
        log.info('>sID=',req.sessionID, meta);

        if (!req.hasOwnProperty('midData')) {
            log.warn("mid data is undefined", meta);
            next();
            return this;
        }
        if (!req.midData.hasOwnProperty('dailyData') || !Array.isArray(req.midData.dailyData)) {
            log.warn("daily data is undefined or isnot array", meta);
            next();
            return this;
        }

        req.midData.dailyData.forEach(function (dailyData) {
            var skyInfoAm = self._convertKorStrToSky(dailyData.wfAm);
            if (skyInfoAm == undefined) {
                log.warn(JSON.stringify(dailyData), meta);
                skyInfoAm = {sky: 1, pty: 0, lgt: 0};
            }
            var skyInfoPm = self._convertKorStrToSky(dailyData.wfPm);
            if (skyInfoPm == undefined) {
                log.warn(JSON.stringify(dailyData), meta);
                skyInfoPm = {sky: 1, pty: 0, lgt: 0};
            }

            dailyData.skyAm = skyInfoAm.sky;
            dailyData.ptyAm = skyInfoAm.pty;
            dailyData.lgtAm = skyInfoAm.lgt;

            dailyData.skyPm = skyInfoPm.sky;
            dailyData.ptyPm = skyInfoPm.pty;
            dailyData.lgtPm = skyInfoPm.lgt;

            if (dailyData.skyAm > dailyData.skyPm) {
                dailyData.sky = dailyData.skyAm;
            }
            else {
                dailyData.sky = dailyData.skyPm;
            }

            dailyData.pty = 0;
            if (dailyData.ptyPm == 2 || dailyData.ptyAm == 2) {
                dailyData.pty = 2;
            }
            else if (dailyData.ptyPm == 3) {
                if (dailyData.ptyAm == 1) {
                    dailyData.pty = 2;
                }
                else {
                    dailyData.pty = 3;
                }
            }
            else if (dailyData.ptyAm == 3) {
                if (dailyData.ptyPm == 1) {
                    dailyData.pty = 2;
                }
                else {
                    dailyData.pty = 3;
                }

            }
            else if (dailyData.ptyPm == 1 || dailyData.ptyAm == 1) {
                dailyData.pty = 1;
            }

            if (dailyData.lgtPm == 1 || dailyData.lgtAm == 1) {
                dailyData.lgt = 1;
            }
            else {
                dailyData.lgt = 0;
            }

        });

        next();
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
        log.info('>sID=',req.sessionID, meta);

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
        log.info('>sID=',req.sessionID, meta);

        try{
            manager.getRegIdByTown(regionName, cityName, function(err, code){
                if(err){
                    log.error(new Error('RM> there is no code '+ err.message));
                    return next();
                }

                self._getMidDataFromDB(modelMidForecast, code.pointNumber, req, function(err, forecastInfo){
                    if(err){
                        log.error('RM> no forecast data '+err.message);
                        return next();
                    }

                    var forecastList = forecastInfo.ret;
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

                    self._getMidDataFromDB(modelMidLand, areaCode, req, function(err, landInfo){
                        if(err){
                            log.error('RM> no land data ' + err.message);
                            return next();
                        }
                        var landList = landInfo.ret;
                        //log.info(landList);
                        self._getMidDataFromDB(modelMidTemp, code.cityCode, req, function(err, tempInfo){
                            if(err){
                                log.error('RM> no temp data ' + err.message);
                                log.error(meta);
                                return next();
                            }
                            var tempList = tempInfo.ret;
                            //log.info(tempList);
                            if (landInfo.pubDate != tempInfo.pubDate) {
                                log.error('RM> publishing date of land and temp are different');
                            }
                            self._mergeLandWithTemp(landList, tempList, function(err, dataList){
                                if(err){
                                    log.error('RM> failed to merge land and temp');
                                    log.error(meta);
                                    return next();
                                }
                                //log.info(dataList);
                                req.midData.dailyData = dataList;
                                req.midData.landPubDate = landInfo.pubDate;
                                req.midData.tempPubDate = tempInfo.pubDate;
                                next();
                            });
                        });
                    });
                })
            });
        }catch(e){
            log.error('ERROR>>', meta);
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
        log.info('>sID=',req.sessionID, meta);

        if (!req.current || !req.currentList)  {
            var err = new Error("Fail to find current weather or current list "+JSON.stringify(meta));
            log.warn(err);
            next();
            return this;
        }

        var yesterdayDate = self._getCurrentTimeValue(+9-24);
        var yesterdayItem;
        if (yesterdayDate.time == '0000') {
           kmaTimeLib.convert0Hto24H(yesterdayDate);
        }

        /**
         * short 만들때, 당시간에 데이터가 없는 경우에 그 이전 데이터를 사용하지만,
         * 새로 데이터를 수집하면 23시간전부터 있음.
         * 그래서 해당 시간 데이터가 없는 경우 그 이후 데이터를 사용.
         */
        for (var i=0; i<req.currentList.length-1; i++) {
            if (req.currentList[i].date == yesterdayDate.date &&
                parseInt(req.currentList[i].time) >= parseInt(req.current.time))
            {
                yesterdayItem =  req.currentList[i];
                break;
            }
        }

        if (yesterdayItem) {
            req.current.summary = self._makeSummary(req.current, yesterdayItem);
            req.current.yesterday = yesterdayItem;
        }
        else {
            log.error('Fail to gt yesterday weather info');
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
        log.info('>sID=',req.sessionID, meta);

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
                req.params.areaNo = townInfo.areaNo;
                req.geocode = {
                    lat: townInfo.gCoord.lat,
                    lon: townInfo.gCoord.lon
                };

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
        log.info('>sID=',req.sessionID, meta);

        if (!req.current)  {
            req.current={};
            var nowDate = self._getCurrentTimeValue(+9);
            req.current.time = nowDate.time;
            req.current.date = nowDate.date;
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
        log.info('>sID=',req.sessionID, meta);

        if (!req.midData)  {
            var err = new Error("Fail to find midData weather "+JSON.stringify(meta));
            log.warn(err);
            next();
            return this;
        }

        function addDustFrcstList(list, dustFrcstList) {
            dustFrcstList.forEach(function (result) {
                list.forEach(function (dailyData) {
                    if (dailyData.date === result.date) {
                        dailyData.dustForecast = result.dustForecast;
                    }
                });
            });
        }

        if (req.hasOwnProperty('dustFrcstList') && Array.isArray(req.dustFrcstList)) {
            addDustFrcstList(req.midData.dailyData, req.dustFrcstList);
            next();
            return this;
        }
        try {
            var dateList = [];
            dateList.push(self._getCurrentTimeValue(+9).date); //today
            dateList.push(self._getCurrentTimeValue(+33).date); //tomorrow
            KecoController.getDustFrcst({region:req.params.region, city:req.params.city}, dateList, function (err, results) {
                if (err) {
                    log.error(err);
                    next();
                    return;
                }
                addDustFrcstList(req.midData.dailyData, results);
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
     * @brief Daily 데이터에 보건지수를 추가한다
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown}
     */
    this.getHealthDay = function (req, res, next) {
        var meta = {};
        meta.method = 'getHealthDay';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>sID=',req.sessionID, meta);

        var townName = {
            first: req.params.region? req.params.region:'',
            second: req.params.city? req.params.city:'',
            third: req.params.town? req.params.town:''
        };
        var townGeocode = [];

        async.waterfall([
                function(cb){
                    if (req.params.areaNo == undefined) {
                        log.warn('Heath> There is no areaNo, goto finding areaNo');
                        return cb(null);
                    }

                    modelHealthDay.find({areaNo:parseInt(req.params.areaNo)}).lean().exec(function(err, res) {
                        if(err || res.length === 0){
                            log.info('No areaNo from Health DB : ', req.params.areaNo);
                            cb(null);
                            return;
                        }
                        return cb('success_byAreaNO', res);
                    });
                },
                function(cb){
                    // find areaNo from areaNo DB
                    log.info('Try to find areaNo from AreaNoDB', townName);

                    modelAreaNo.find({town:townName}, function(err, areaList){
                        if(err || areaList.length === 0){
                            return cb(null);
                        }

                        var item = areaList[0];
                        log.info('AreaNo Item : ', item.geo);
                        townGeocode = item.geo;

                        log.info('Try to find Health data by AreaNo which comes from AreaNoDB');

                        modelHealthDay.find({areaNo:parseInt(item.areaNo)}).lean().exec(function(err, res) {
                            if(err || res.length === 0){
                                return cb(null);
                            }
                            log.info('success_byAreaNoDB');
                            return cb('success_byAreaNoDB', res);
                        });
                    });
                },
                function(cb){
                    log.info('Try to find near AreaNo by geocode');

                    if(townGeocode.length === 0){
                        if(req.geocode){
                            townGeocode = [req.geocode.lon, req.geocode.lat];
                        }else{
                            log.error('Health> 1. Cannot find any areaNo data :', townName);
                            return cb('fail to get AreaNo data', undefined);
                        }
                    }
                    log.info('center geocode : ', townGeocode);
                    // There is no areaNo in the DB
                    modelAreaNo.find({geo: {$near:townGeocode, $maxDistance: 0.3}}).limit(3).lean().exec(function (err, areaNoList) {
                        if(err || areaNoList.length == 0){
                            log.error('Health> 2. cannot get areaNo near by ', townName, townGeocode, err);
                            return cb('fail to get areaNo', undefined);
                        }

                        log.info('Get AreaNo which is near by townName');
                        async.mapSeries(areaNoList,
                            function(areaNo, callback){
                                log.info('AreaNo : ', areaNo.areaNo);
                                modelHealthDay.find({areaNo:parseInt(areaNo.areaNo)}).lean().exec(function(err, res) {
                                    if(err || res.length === 0){
                                        log.warn('Health> cannot fild areaNo near by geocode, goto next : ', townGeocode, areaNo.areaNo);
                                        return callback(null);
                                    }
                                    log.info('succes HealthDay : ', res.length, areaNo.areaNo);
                                    cb('find by near AreaNo', res);
                                    return callback('success_byNearbyGeocode');
                                });
                            },
                            function(err, result){
                                if(!err){
                                    log.error('Heath> 3. Cannot Find Heath Data');
                                    return cb('fail to find by near AreaNo', undefined);
                                }
                            }
                        );
                    });
                }
            ],
            function(err, result){
                if (result && result.length > 0) {
                    req.midData.dailyData.forEach(function(day) {
                        var date = kmaTimeLib.convertStringToDate(day.date);
                        for(var i=0; i<result.length; i++) {
                            if(result[i].date.getTime() == date.getTime()) {
                                day[result[i].indexType] = result[i].index;
                            }
                        }
                    });
                }
                next();
            }
        );

        /*
        modelHealthDay.find({areaNo:parseInt(req.params.areaNo)}).lean().exec(function(err, results) {
            if (results && results.length > 0) {
                req.midData.dailyData.forEach(function(day) {
                    var date = kmaTimeLib.convertStringToDate(day.date);
                    for(var i=0; i<results.length; i++) {
                        if(results[i].date.getTime() == date.getTime()) {
                            day[results[i].indexType] = results[i].index;
                        }
                    }
                });
            }
            else {
                log.error("Fail to find area no=" + req.params.areaNo, meta);
            }
            next();
        });
        */
        return this;
    };

    this._mergeMidByCurrent = function (dailyData, currentList, requestTime) {
        var daySummaryList;

        //log.info(parseInt(curItem.date), parseInt(requestTime.date));
        var pastData = currentList.filter(function (current) {
            return parseInt(current.date) >= parseInt(requestTime.date);
        });

        daySummaryList = self._getDaySummaryList(pastData);
        self._mergeList(dailyData, daySummaryList);

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
        log.info('>sID=',req.sessionID, meta);

        if (!req.hasOwnProperty('midData')) {
            req.midData = {};
        }
        if (!req.midData.hasOwnProperty('dailyData') || !Array.isArray(req.midData.dailyData)) {
            req.midData.dailyData = [];
        }

        var requestTime = self._getTimeValue(9-7*24); //지난주 동일 요일까지

        if (req.currentList) {
            try {
                self._mergeMidByCurrent(req.midData.dailyData, req.currentList, requestTime);
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
                self._getTownDataFromDB(modelCurrent, coord, req, function (err, currentInfo) {
                    if (err) {
                        log.error(new Error('error to get current for past' + err.message));
                        return next();
                    }

                    try {
                        req.currentList = currentInfo.ret;
                        req.currentList.forEach(function (data) {
                            kmaTimeLib.convert0Hto24H(data);
                        });

                        self._mergeMidByCurrent(req.midData.dailyData, req.currentList, requestTime);
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
        log.info('>sID=',req.sessionID, meta);

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
        log.info('>sID=',req.sessionID, meta);

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

    /**
     * 계산 가능한 지수들 추가하기
     * @param req
     * @param res
     * @param next
     */
    this.insertIndex = function (req, res, next) {

        if (req.current) {
            if (req.current.t1h != undefined) {
                if (req.current.wsd != undefined) {
                    //체감온도
                    req.current.sensorytem = +(self._getNewWCT(req.current.t1h, req.current.wsd)).toFixed(1);
                }
                if (req.current.reh != undefined) {
                    // get discomfort index(불괘지수)
                    req.current.dspls = LifeIndexKmaController.getDiscomfortIndex(req.current.t1h, req.current.reh);
                    req.current.dsplsGrade = LifeIndexKmaController.convertGradeFromDiscomfortIndex(req.current.dspls);
                    req.current.dsplsStr = LifeIndexKmaController.convertStringFromDiscomfortIndex(req.current.dspls);

                    // get decomposition index(부패지수)
                    req.current.decpsn = LifeIndexKmaController.getDecompositionIndex(req.current.t1h, req.current.reh);
                    req.current.decpsnStr = LifeIndexKmaController.convertStringFromDecompositionIndex(req.current.decpsn);

                    // get heat index(열지수)
                    req.current.heatIndex = LifeIndexKmaController.getHeatIndex(req.current.t1h, req.current.reh);
                    req.current.heatIndexStr = LifeIndexKmaController.convertStringFromHeatIndex(req.current.heatIndex);

                    //new sensorytem = old sensorytem + head index
                    req.current.sensorytem = req.current.t1h + (req.current.sensorytem - req.current.t1h) + (req.current.heatIndex - req.current.t1h);
                    req.current.sensorytem = Math.round(req.current.sensorytem);

                    if (req.yesterdayMinTemperature) {
                        req.current.freezeStr = LifeIndexKmaController.getFreezeString(req.current.t1h, req.yesterdayMinTemperature);
                    }
                }

                // get frost string(동상가능지수)
                req.current.frostStr = LifeIndexKmaController.getFrostString(req.current.t1h);
            }
        }

        if (req.short) {
            req.short.forEach(function (short) {
                if (short.t3h == undefined) {
                    return;
                }

                if (short.wsd != undefined) {
                    //체감온도
                    short.sensorytem = +(self._getNewWCT(short.t3h, short.wsd)).toFixed(1);
                }

                if (short.reh != undefined) {
                    // get discomfort index(불괘지수)
                    short.dspls = LifeIndexKmaController.getDiscomfortIndex(short.t3h, short.reh);
                    short.dsplsGrade = LifeIndexKmaController.convertGradeFromDiscomfortIndex(short.dspls);
                    short.dsplsStr = LifeIndexKmaController.convertStringFromDiscomfortIndex(short.dspls);

                    // get decomposition index(부패지수)
                    short.decpsn = LifeIndexKmaController.getDecompositionIndex(short.t3h, short.reh);
                    short.decpsnStr = LifeIndexKmaController.convertStringFromDecompositionIndex(short.decpsn);

                    // get heat index(열지수)
                    short.heatIndex = LifeIndexKmaController.getHeatIndex(short.t3h, short.reh);
                    short.heatIndexStr = LifeIndexKmaController.convertStringFromHeatIndex(short.heatIndex);

                    //new sensorytem = old sensorytem + head index
                    short.sensorytem = short.t3h + (short.sensorytem - short.t3h) + (short.heatIndex - short.t3h);
                    short.sensorytem = Math.round(short.sensorytem);

                    if (req.yesterdayMinTemperature) {
                        short.freezeStr = LifeIndexKmaController.getFreezeString(short.t3h, req.yesterdayMinTemperature);
                    }
                }

                // get frost string(동상가능지수)
                short.frostStr = LifeIndexKmaController.getFrostString(short.t3h);
            });
        }

        next();

        return this;
    };

    /**
     * t1h, t3h, taMin, taMax 를 정수로 변환, old version 호환용이며, 0.8.4 초과버전부터는 소수한자리로 데이터 전달하고, 필요시 client에서 정수로 변환.
     * @param req
     * @param res
     * @param next
     */
    this.dataToFixed = function (req, res, next) {
        //log.info('data to fixed');
        if (req.current) {
            req.current.t1h = Math.round(req.current.t1h);
        }
        if (req.short) {
            req.short.forEach(function (short) {
                short.t3h = Math.round(short.t3h);
                short.tmn = Math.round(short.tmn);
                short.tmx = Math.round(short.tmx);
            });
        }
        if (req.midData && req.midData.dailyData) {
            req.midData.dailyData.forEach(function (data) {
                data.taMin = Math.round(data.taMin);
                data.taMax = Math.round(data.taMax);
            });
        }
        next();
        return this;
    };

    this.insertStrForData = function (req, res, next) {
        if(req.short){
            req.short.forEach(function (data) {
               self._makeStrForKma(data, res);
            });
        }
        if(req.shortest){
            req.shortest.forEach(function (data) {
                self._makeStrForKma(data, res);
            });
        }
        if(req.current){
            self._makeStrForKma(req.current, res);
            if (req.current.arpltn) {
                self._makeArpltnStr(req.current.arpltn, res);
            }
        }
        if(req.midData){
            req.midData.dailyData.forEach(function (data) {
                self._makeStrForKma(data, res);
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
        log.info('## - ' + decodeURI(req.originalUrl)  + ' sID=' + req.sessionID);

        result.regionName = regionName;
        result.cityName = cityName;
        result.townName = townName;

        if(req.shortPubDate) {
            result.shortPubDate = req.shortPubDate;
        }
        if(req.shortRssPubDate) {
            result.shortRssPubDate = req.shortRssPubDate;
        }
        if(req.short){
            result.short = req.short;
        }
        if (req.shortestPubDate) {
            result.shortestPubDate = req.shortestPubDate;
        }
        if(req.shortest){
            result.shortest = req.shortest;
        }
        if(req.currentPubDate) {
            result.currentPubDate = req.currentPubDate;
        }

        if (req.current.t1h == undefined) {
            req.current.t1h = -50;
        }
        if (req.current.rn1 == undefined) {
            req.current.rn1 = -1;
        }
        if (req.current.sky == undefined) {
            req.current.sky = -1;
        }
        if (req.current.uuu == undefined) {
            req.current.uuu = -100;
        }
        if (req.current.vvv == undefined) {
            req.current.vvv = -100;
        }
        if (req.current.reh == undefined) {
            req.current.reh = -1;
        }
        if (req.current.pty == undefined) {
            req.current.pty = -1;
        }
        if (req.current.lgt == undefined) {
            req.current.lgt = -1;
        }
        if (req.current.vec == undefined) {
            req.current.vec = -1;
        }
        if (req.current.wsd == undefined) {
            req.current.wsd = -1;
        }
        if(req.current){
            result.current = req.current;
        }

        if (req.midData.pubDate == undefined) {
            req.midData.pubDate = req.midData.tempPubDate;
        }
        if (req.midData.province == undefined) {
           req.midData.province = '';
        }
        if (req.midData.city == undefined) {
            req.midData.city = '';
        }
        if (req.midData.stnId == undefined) {
            req.midData.stnId = '';
        }
        if (req.midData.regId == undefined) {
            req.midData.regId = '';
        }
        if (req.midData.pubDate == undefined) {
            req.midData.pubDate = '';
        }
        if(req.midData){
            result.midData = req.midData;
        }

        res.json(result);

        return this;
    };


    this.getRiseSetInfo = function (req, res, next) {
        var meta = {};
        meta.method = 'get rise set info';
        meta.region = req.params.region;
        meta.city = req.params.city;
        meta.town = req.params.town;
        log.info('>sID=',req.sessionID, meta);

        if(req.midData == undefined || req.midData.dailyData == undefined || !Array.isArray(req.midData.dailyData)) {
            log.error("daily data is undefined");
            return next();
        }

        var dateList = [];
        req.midData.dailyData.forEach(function (dayInfo) {
            dateList.push(dayInfo.date);
        });

        //town: {first: String, second: String, third: String},
        async.waterfall([
                function (callback) {
                    if(req.geocode) {
                        return callback(null, req.geocode);
                    }
                    var town = {"town.first":req.params.region,
                        "town.second": req.params.city,
                        "town.third": req.params.town};

                    dbTown.find(town, {_id:0}).limit(1).lean().exec(function (err, tList) {
                        if(err) {
                            return callback(err);
                        }
                        if(tList.length == 0) {
                            err = new Error("Fail to get town info town="+JSON.stringify(town));
                            return callback(err);
                        }

                        req.geocode = tList[0].gCoord;
                        callback(null, tList[0].gCoord);
                    });
                },
                function (geocode, callback) {
                    kasiRiseSetController.getRiseSetList(geocode, dateList, function (err, rsList) {
                        if(err) {
                            callback(err);
                        }
                        callback(null, rsList);
                    });
                },
                function (rsList, callback) {
                    rsList.forEach(function (riseSet) {
                        var dailyData = req.midData.dailyData;
                        for (var i=0; i<dailyData.length; i++) {
                            if (dailyData[i].date == riseSet.date)  {
                                for (var key in riseSet)  {
                                    dailyData[i][key] = riseSet[key];
                                }
                                break;
                            }
                        }
                    });
                    callback();
                }
            ],
            function (err) {
                if (err) {
                    log.error(err);
                }
                next();
            });
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
    var item;
    var itemList = [];
    var diffTemp;
    var tmpGrade;

    if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
        diffTemp = Math.round(current.t1h) - Math.round(yesterday.t1h);

        str = "어제";
        if (diffTemp == 0) {
            str += "와 동일";
        }
        else {
            str += "보다 ";
            if (diffTemp < 0) {
                str += diffTemp+"˚";
            }
            else if (diffTemp > 0) {
                str += "+"+diffTemp+"˚";
            }
        }
        item = {str: str, grade: Math.abs(diffTemp)};
        itemList.push(item);
    }

    if (current.weather) {
        if(current.weather == '구름많음' ||
            current.weather == '구름조금' ||
            current.weather == '맑음' ||
            current.weather == '흐림') {
            //skip
            item = {str: current.weather, grade: 1};
        }
        else {
           item = {str: current.weather, grade: 3};
        }
        itemList.push(item);
    }

    if (current.arpltn) {
        str = "통합대기" + " " + current.arpltn.khaiStr;
        tmpGrade = current.arpltn.khaiGrade;
        if (tmpGrade < current.arpltn.pm25Grade) {
            str = "초미세먼지"+" "+ current.arpltn.pm25Str;
            tmpGrade = current.arpltn.pm25Grade;
        }
        if (tmpGrade < current.arpltn.pm10Grade) {
            str = "미세먼지" + " " + current.arpltn.pm10Str;
            tmpGrade = current.arpltn.pm10Grade;
        }

        item = {str: str, grade: tmpGrade};
        itemList.push(item);
    }

    if (current.rn1 && current.rn1Str && current.ptyStr) {
        item = {str: current.ptyStr + " " + current.rn1Str, grade: current.rn1+3};
        itemList.push(item);
    }

    if (current.dsplsGrade && current.dsplsGrade && current.t1h >= 20) {
        tmpGrade = current.dsplsGrade;
        item = {str:"불쾌지수"+" "+current.dsplsStr, grade: tmpGrade};
        itemList.push(item);
    }

    if (current.sensorytem && current.sensorytem !== current.t1h) {
        diffTemp = Math.round(current.sensorytem - current.t1h);
        item = {str :"체감온도" +" "+ current.sensorytem +"˚", grade: Math.abs(diffTemp)};
        itemList.push(item);
    }

    if (current.ultrv && Number(current.time) < 1800) {
        tmpGrade = current.ultrvGrade;
        item = {str:"자외선"+" "+current.ultrvStr, grade: tmpGrade+1};
        itemList.push(item);
    }

    if (current.wsdGrade && current.wsdStr) {
        //약함(1)을 보통으로 보고 보정 1함.
        item = {str: current.wsdStr, grade: current.wsdGrade+1};
        itemList.push(item);
    }

    if (current.fsnStr) {
        //주의(1)를 보통으로 보고 보정 1함.
        item = {str: "식중독"+" "+current.fsnStr, grade: current.fsnGrade+1};
        itemList.push(item);
    }

    //감기

    itemList.sort(function (a, b) {
        if(a.grade > b.grade){
            return -1;
        }
        if(a.grade < b.grade){
            return 1;
        }
        return 0;
    });

    log.debug(JSON.stringify(itemList));

    if (itemList.length == 0) {
        log.error("Fail to make summary");
        return "";
    }
    else if(itemList.length > 1) {
        return itemList[0].str+", "+itemList[1].str;
    } else {
        return itemList[0].str;
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
                currentItem.t1h = +(self._calcValue3hTo1h(intTime%3, short.t3h, prvShort.t3h)).toFixed(1);
                currentItem.reh = Math.round(self._calcValue3hTo1h(intTime%3, short.reh, prvShort.reh));
                currentItem.wsd = +(self._calcValue3hTo1h(intTime%3, short.wsd, prvShort.wsd)).toFixed(1);
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
ControllerTown.prototype._convertKmaPtyToStr = function(pty, translate) {
    var ret = "";
    var ts = translate == undefined ? global : translate;
    if (pty === 1) {
        ret = ts.__("LOC_PRECIPITATION");
    }
    else if (pty === 2) {
        //return "강수/적설량"
        ret = ts.__("LOC_PRECIPITATION");
    }
    else if (pty === 3) {
        ret = ts.__("LOC_SNOWFALL");
    }

    return ret;
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
            case 1: return "~1mm";
            case 5: return "1~4mm";
            case 10: return "5~9mm";
            case 20: return "10~19mm";
            case 40: return "20~39mm";
            case 70: return "40~69mm";
            case 100: return "70~?mm";
            default : log.debug('convert Kma Rain Rxx To Str : unknown data='+rXX);
        }
        /* spec에 없지만 2로 오는 경우가 있었음 related to #347 */
        if (0 < rXX) {
            if (rXX >= 10) {
                rXX = Math.ceil(rXX);
            }
            return "~"+rXX+"mm";
        }
    }
    else if (pty === 3) {
        switch (rXX) {
            case 0: return "0cm";
            case 1: return "~1cm";
            case 5: return "1~4cm";
            case 10: return "5~9cm";
            case 20: return "10~19cm";
            case 100: return "20~?cm";
            default : log.debug('convert Kma Snow Rxx To Str : unknown data='+rXX);
        }
        /* spec에 없지만 2로 오는 경우가 있었음 */
        if (0 < rXX) {
            if (rXX >= 10) {
                rXX = Math.ceil(rXX);
            }
            return "~"+rXX+"cm";
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
ControllerTown.prototype._makeArpltnStr = function (data, res) {

    if (data.hasOwnProperty('pm10Grade')) {
        data.pm10Str = KecoController.grade2str(data.pm10Grade, "pm10", res);
    }
    if (data.hasOwnProperty('pm25Grade')) {
        data.pm25Str = KecoController.grade2str(data.pm25Grade, "pm25", res);
    }
    if (data.hasOwnProperty('o3Grade')) {
        data.o3Str = KecoController.grade2str(data.o3Grade, "o3", res);
    }
    if (data.hasOwnProperty('no2Grade')) {
        data.no2Str = KecoController.grade2str(data.no2Grade, "no2", res);
    }
    if (data.hasOwnProperty('coGrade')) {
        data.coStr = KecoController.grade2str(data.coGrade, "co", res);
    }
    if (data.hasOwnProperty('so2Grade')) {
        data.so2Str = KecoController.grade2str(data.so2Grade, "so2", res);
    }
    if (data.hasOwnProperty('khaiGrade')) {
        data.khaiStr = KecoController.grade2str(data.khaiGrade, "khai", res);
    }
    return this;
};

ControllerTown.prototype._makeStrForKma = function(data, res) {

    var self = this;

    if (data.hasOwnProperty('sensorytem') && data.sensorytem < 0) {
        data.sensorytemStr = self._parseSensoryTem(data.sensorytem, res);
    }

    if (data.hasOwnProperty('ultrvGrade')) {
        data.ultrvStr = LifeIndexKmaController.ultrvStr(data.ultrvGrade, res);
    }

    if (data.hasOwnProperty('fsnGrade')) {
        data.fsnStr = LifeIndexKmaController.fsnStr(data.fsnGrade, res);
    }

    if (data.hasOwnProperty('wsd')) {
        data.wsdGrade = self._convertKmaWsdToGrade(data.wsd);
        data.wsdStr = self._convertKmaWsdToStr(data.wsdGrade, res);
    }

    /**
     * pty가 없어도, 즉 지금 시간 안와도, 한시간 안에는 비가 왔을 수 있음.
     * 그런때에 rn1이 있을 수 있음.
     * 차후 업데이트 필요할 수 있음.
     */
    if (data.hasOwnProperty('pty') && data.pty > 0) {
        data.ptyStr = self._convertKmaPtyToStr(data.pty, res);
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
 * if wsd is null, return -1
 * @param wsd
 * @returns {number}
 * @private
 */
ControllerTown.prototype._convertKmaWsdToGrade = function (wsd) {
    if (wsd < 0) {
        return 0;
    }
    else if (wsd < 4) {
        return 1;
    }
    else if(wsd < 9) {
        return 2;
    }
    else if(wsd < 14) {
        return 3;
    }
    else if(wsd >= 14) {
        return 4;
    }
    else {
        return -1;
    }
};

/**
 *
 * @param wsdGrade
 * @returns {*}
 * @private
 */
ControllerTown.prototype._convertKmaWsdToStr = function (wsdGrade, translate) {
    var ts = translate == undefined?global:translate;
    switch (wsdGrade) {
        case 0: return "";
        case 1: return ts.__("LOC_LIGHT_WIND");
        case 2: return ts.__("LOC_MODERATE_WIND");
        case 3: return ts.__("LOC_STRONG_WIND");
        case 4: return ts.__("LOC_VERY_STRONG_WIND");
    }
    return "";
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
 * @returns {{date: string, time: string}}
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
 * 분까지 전달.
 * @param gmt
 * @returns {{date: *, time: *}}
 * @private
 */
ControllerTown.prototype._getCurrentTimeMinuteValue = function(gmt) {
    var timeFunction = manager;
    var currentDate = timeFunction.getWorldTime(gmt);
    return {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8, 12)
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
        return +total.toFixed(1);
    }
};

/**
 *
 * @param list
 * @param invalidValue
 * @param digits
 * @returns {number}
 * @private
 */
ControllerTown.prototype._average = function(list, invalidValue, digits) {
    var self = this;

    if (!Array.isArray(list)) {
        return -1;
    }

    if (digits == undefined) {
        digits = 0;
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

    if (validList.length == 0) {
       return -1;
    }

    return +(self._sum(validList)/validList.length).toFixed(digits);
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
                        my: result.my,
                        mx: result.mx
                    },
                    town:{
                        first: region,
                        second: city,
                        third: town
                    }
                };

                var i;
                var townObj;
                for(i=0; i<list.length; i++) {
                    townObj = list[i];
                    if (townObj.mCoord.mx === newTown.mCoord.mx && townObj.mCoord.my === newTown.mCoord.my) {
                        if (townObj.areaNo) {
                            newTown.areaNo = townObj.areaNo;
                        }
                        break;
                    }
                }
                if (newTown.areaNo == undefined) {
                    for(i=0; i<list.length; i++) {
                        townObj = list[i];
                        if (townObj.town.first === region && townObj.town.second === city) {
                            if (townObj.areaNo) {
                                newTown.areaNo = townObj.areaNo;
                            }
                            break;
                        }
                    }
                }
                //log.info(newTown);
                list.push(newTown);

                var newItem = new dbTown(newTown);
                newItem.save(function(err){
                    if(err){
                        log.error('towns> fail to save to DB :', JSON.stringify(newTown));
                    }
                    else {
                        log.info('towns> save to DB :', JSON.stringify(newTown));
                    }
                });

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
 * @param req
 * @param cb
 * @returns {*}
 * @private
 */
ControllerTown.prototype._getTownDataFromDB = function(db, indicator, req, cb){
    var self = this;
    var meta = {};
    meta.method = '_getTownDataFromDB';
    meta.indicator = indicator;

    try{
        if(req != undefined){
            for (var i=0; i<townArray.length; i++) {
                var item =  townArray[i];
                if(item.db == db && req[item.name] != undefined){
                    log.silly('data is already received');
                    log.silly(req[item.name]);
                    return cb(0, req[item.name]);
                }
            }
        }

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
                    log.error(JSON.stringify(meta));
                    cb(new Error(JSON.stringify(meta)));
                    return [];
                }
                //log.info(ret);
                cb(0, {pubDate: result[0].pubDate, ret:ret});
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
 * @param req
 * @param cb
 * @returns {*}
 * @private
 */
ControllerTown.prototype._getMidDataFromDB = function(db, indicator, req, cb) {
    var meta = {};
    meta.method = '_getMidDataFromDB';
    meta.indicator = indicator;

    try{
        if(req != undefined){
            for (var i=0; i<midArray.length; i++) {
                var item =  midArray[i];
                if(item.db == db && req[item.name] != undefined){
                    log.silly('data is already received');
                    log.silly(req[item.name]);
                    return cb(0, req[item.name]);
                }
            }
        }

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

                cb(0, {pubDate: result[0].pubDate, ret: ret});
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

ControllerTown.prototype._createOrGet3hSummaryList = function(list, date, strTime) {
    var nTime = parseInt(strTime.substr(0,2));
    var targetTime = Math.ceil(nTime/3)*3;
    if (targetTime < 10) {
        targetTime = "0"+targetTime+"00";
    }
    else {
        targetTime = targetTime+"00";
    }

    for(var i=0; i<list.length; i++) {
        if (list[i].date3h === date && list[i].time3h === targetTime) {
            return list[i];
        }
    }

    list.push({date3h: date, time3h: targetTime});
    return list[list.length-1];

};

/**
 * object에가 key값 아래 3개의 array로 데이터가 들어 있음.
 * t1h 등 당시 시간 데이터에서 에러가 있는 경우 이전 시간 데이터 사용하게 수정.
 * @param summary
 * @returns {{}}
 * @private
 */
ControllerTown.prototype._convertSummaryTo3H = function (summary) {
    var newItem = {};
    var key;
    var self = this;

    for (key in summary) {

        if( key === 'pty') {
            newItem[key] = self._summaryPty(summary[key], -1);
        }
        else if (key === 'lgt') {
            newItem[key] = self._summaryLgt(summary[key], -1);
        }
        else if(key === 't1h' || key === 'wsd' || key == 'reh' || key === 'uuu' || key === 'vvv' || key === 'vec') {
            var invalidValue = -50;
            switch (key) {
                case 't1h': invalidValue = -50; break;
                case 'wsd': invalidValue = -1; break;
                case 'reh': invalidValue = -1; break;
                case 'uuu': invalidValue = -100; break;
                case 'vvv': invalidValue = -100; break;
                case 'vec': invalidValue = -1; break;
            }

            var time = parseInt(summary.time[summary.time.length-1].substr(0, 2));
            if (time%3 === 0) {
                var arrayIndex = -1;
                for (var i=summary[key].length-1; i>=0; i--) {
                    if (summary[key][i] == undefined || summary[key][i] == invalidValue) {
                        continue;
                    }
                    arrayIndex = i;
                    break;
                }
                if (arrayIndex < 0) {
                    log.debug("Fail to find current data :" + key + " " + summary.date3h+" "+summary.time3h);
                }
                else {
                    log.debug("set :" + key + " arrayIndex:" + arrayIndex + " "+ summary.date3h+" "+summary.time3h);
                    newItem[key] = +(summary[key][arrayIndex]).toFixed(1);
                }
            }
            else {
                log.debug("Fail to find current data :" + key + " " + summary.date3h+" "+summary.time3h);
            }
        }
        else if(key === 'rn1') {
            newItem[key] = self._sum(summary[key], -1);
        }
        else if(key === 'sky')  {
            newItem[key] = self._average(summary[key], -1, 0);
        }
    }

    return newItem;
};

/**
 *
 * @param srcList
 * @param usePartial 3개를 못 채우도 사용할 것인가? 결정.
 * @returns {Array}
 * @private
 */
ControllerTown.prototype._convert1Hto3H = function (srcList, usePartial) {
    var self = this;
    var dstList = [];
    var summaryList = [];
    var key;
    var summary;
    var newItem;

    srcList.forEach(function (src) {
        summary = self._createOrGet3hSummaryList(summaryList, src.date, src.time);
        for (key in src) {
            if (summary[key] == undefined) {
                summary[key] = [];
            }
            summary[key].push(src[key]);
        }
    });

    summaryList.forEach(function (summary) {
        if (usePartial === false) {
            if (summary.date.length != 3) {
                return;
            }
        }

        newItem = self._convertSummaryTo3H(summary);
        newItem.date = summary.date3h;
        newItem.time = summary.time3h;

        dstList.push(newItem);
    });

    return dstList;
};

/**
 * merge short data with current data
 * adjustShort에서 tmx, tmn을 계산하지만, 3시간 간격 온도에 없는 높은 온도를 확인하기 위해서 있어야 함.
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
        //var restList = [];

        // 과거의 current 데이터를 short 리스트에 넣을 수 있게 리스트를 구성한다
        currentList.forEach(function(curItem){
            if (curItem.date < shortList[0].date) {
                log.silly('skip');
                return;
            }

            var daySummary = self._createOrGetDaySummaryList(daySummaryList, curItem.date);
            daySummary.taMax = daySummary.taMax === undefined ? -50:daySummary.taMax;
            daySummary.taMin = daySummary.taMin === undefined ? -50:daySummary.taMin;

            if (daySummary.taMax < curItem.t1h) {
                daySummary.taMax = curItem.t1h;
            }
            if (daySummary.taMin === -50 || daySummary.taMin > curItem.t1h) {
                daySummary.taMin = curItem.t1h;
            }
        });

        tmpList = self._convert1Hto3H(currentList, true);

        //log.info('~> tmpList :',tmpList);

        shortList.forEach(function(shortItem, index){
            tmpList.forEach(function(tmpItem){
                if(shortItem.date === tmpItem.date && shortItem.time === tmpItem.time){
                    for (var key in tmpItem) {
                        if (tmpItem.hasOwnProperty(key)) {
                            if (key === 't1h') {
                                shortList[index]['t3h'] = tmpItem[key];
                            }
                            else {
                                shortList[index][key] = tmpItem[key];
                            }
                        }
                    }
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
                shortList[index].tmn = +shortList[index].tmn.toFixed(1);
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
                shortList[index].tmx = +shortList[index].tmx.toFixed(1);
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
                        shortList[i].r06 = +(rssItem.r06).toFixed(1);
                        shortList[i].reh = rssItem.reh;
                        shortList[i].s06 = +(rssItem.s06).toFixed(1);
                        shortList[i].sky = rssItem.sky;
                        shortList[i].t3h = +(rssItem.temp).toFixed(1);
                        if(shortList[i].time === '0600' && rssItem.tmn != -999) {
                            shortList[i].tmn = +(rssItem.tmn).toFixed(1);
                        }
                        if(shortList[i].time === '1500' && rssItem.tmn != -999){
                            shortList[i].tmx = +(rssItem.tmx).toFixed(1);
                        }
                    }
                }
                if(found === 0){
                    var item = {};
                    item.date = rssItem.date.slice(0, 8);
                    item.time = rssItem.date.slice(8, 12);
                    item.pop = rssItem.pop;
                    item.pty = rssItem.pty;
                    item.r06 = +(rssItem.r06).toFixed(1);
                    item.reh = rssItem.reh;
                    item.s06 = +(rssItem.s06).toFixed(1);
                    item.sky = rssItem.sky;
                    item.t3h = +(rssItem.temp).toFixed(1);
                    if(item.time === '0600' && rssItem.tmn != -999){
                        item.tmn = +(rssItem.tmn).toFixed(1);
                    } else{
                        item.tmn = -50;
                    }
                    if(item.time === '1500' && rssItem.tmx != -999){
                        item.tmx = +(rssItem.tmx).toFixed(1);
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
        var index;

        //log.info(todayLand);
        var startDate = kmaTimeLib.convertStringToDate(todayLand.date);
        startDate.setDate(startDate.getDate()+3);

        for(i=0 ; i<8 ; i++){
            currentDate = kmaTimeLib.convertDateToYYYYMMDD(startDate);
            item = {
                date: currentDate
            };
            index = i+3;

            if(todayLand.hasOwnProperty('wf' + index + 'Am')) {
                item.wfAm = todayLand['wf' + index + 'Am'];
                item.wfPm = todayLand['wf' + index + 'Pm'];
            }
            else {
                item.wfAm = item.wfPm = todayLand['wf' + index];
            }

            result.push(item);
            startDate.setDate(startDate.getDate()+1);
        }

        //log.info(todayTemp);
        startDate = kmaTimeLib.convertStringToDate(todayTemp.date);
        startDate.setDate(startDate.getDate()+3);
        for(i=0 ; i<8 ; i++) {
            var isNew = false;
            currentDate = kmaTimeLib.convertDateToYYYYMMDD(startDate);
            item = result.find(function (obj) {
                return obj.date === currentDate;
            });
            if (item == null) {
                item = {date: currentDate};
                isNew = true;
            }

            index = i+3;
            item.taMin = todayTemp['taMin' + index];
            item.taMax = todayTemp['taMax' + index];
            if (isNew) {
                result.push(item);
            }
            startDate.setDate(startDate.getDate()+1);
        }

        //log.info('res', result);
        // 11일 전의 데이터부터 차례차례 가져와서 과거의 날씨 정보를 채워 넣자...
        if (landList > 1) {
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
                        basicItem[string] = +(shortItem[string]).toFixed(1);
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
        log.debug('Wdum is invalid');
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

ControllerTown.prototype._parseSensoryTem = function(sensoryTem, translate) {
    var ts = translate == undefined?global:translate;
    if (sensoryTem >= 0 ) {
        return "";
    }
    else if ( -10 < sensoryTem && sensoryTem < 0) {
        return ts.__("LOC_ATTENTION");
    }
    else if ( -25 < sensoryTem && sensoryTem <= -10) {
        return ts.__("LOC_CAUTION");
    }
    else if ( -45 < sensoryTem && sensoryTem <= -25) {
        return ts.__("LOC_WARNING");
    }
    else if (sensoryTem <= -45) {
        return ts.__("LOC_HAZARD");
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

    list.push({date: date, lgt:[], pty:[], reh:[], rn1:[], sky:[], t1h:[], wsd:[], pop:[], r06:[], s06:[], t3h:[],
        tmx:-50, tmn:-50, lgtAm:[], lgtPm:[], ptyAm:[], ptyPm:[], skyAm:[], skyPm:[]});
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
    if (list.length == 0) {
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
 * make lgt, sky, pty
 * @private
 */
ControllerTown.prototype._convertKorStrToSky = function (skyKorStr) {
    var sky = 1;
    var pty = 0;
    var lgt = 0;

    switch (skyKorStr) {
        case "맑음":
            sky = 1;
            break;
        case "구름조금":
            sky = 2;
            break;
        case "구름많음":
            sky = 3;
            break;
        case "흐림":
            sky = 4;
            break;
        case "흐리고 한때 비":
        case "흐리고 비":
            sky = 4;
            pty = 1;
            break;
        case "구름적고 한때 비":
        case "구름적고 비":
            sky = 2;
            pty = 1;
            break;
        case "구름많고 한때 비":
        case "구름많고 비":
            sky = 3;
            pty = 1;
            break;
        case "흐리고 한때 눈":
        case "흐리고 눈":
            sky = 4;
            pty = 3;
            break;
        case "구름적고 한때 눈":
        case "구름적고 눈":
            sky = 2;
            pty = 3;
            break;
        case "구름많고 한때 눈":
        case "구름많고 눈":
            sky = 3;
            pty = 3;
            break;
        case "구름적고 비/눈":
        case "구름적고 눈/비":
            sky = 2;
            pty = 2;
            break;
        case "구름많고 비/눈":
        case "구름많고 눈/비":
            sky = 3;
            pty = 2;
            break;
        case "흐리고 비/눈":
        case "흐리고 눈/비":
            sky = 4;
            pty = 2;
            break;
        default :
            log.error("Fail to convert skystring="+skyKorStr);
            return undefined;
    }
    return  {sky: sky, pty: pty, lgt: lgt};
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
    var tmpPty;
    //var dateInfo = self._getCurrentTimeValue(9);

    shortList.forEach(function (short, i) {

        //24로 변환하면 처음 앞에 데이터는 하루 전으로 변경되어서 버림.
        if (i == 0 && short.time === '2400') {
            log.silly('skip one item what is change date');
            return;
        }

        //v000705 이전 버전에서 0시 데이터 하나 버림.
        if (i === shortList.length-1 && short.time === '0000') {
            log.silly('skip one item on old api');
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
        if (short.wsd !== -1) {
            dayCondition.wsd.push(short.wsd);
        }

        if (parseInt(short.time) <= 1200 ) {
            if (short.lgt !== -1) {
                dayCondition.lgtAm.push(short.lgt);
            }
            if (short.sky !== -1) {
                dayCondition.skyAm.push(short.sky);
            }
            if (short.pty !== -1) {
                dayCondition.ptyAm.push(short.pty);
            }
        }
        else {
            if (short.lgt !== -1) {
                dayCondition.lgtPm.push(short.lgt);
            }
            if (short.sky !== -1) {
                dayCondition.skyPm.push(short.sky);
            }
            if (short.pty !== -1) {
                dayCondition.ptyPm.push(short.pty);
            }
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
        daySummary.reh = self._average(dayCondition.reh, -1, 0);
        daySummary.s06 = self._sum(dayCondition.s06, -1);
        daySummary.sky = self._average(dayCondition.sky, -1, 0);
        daySummary.lgtAm = self._summaryLgt(dayCondition.lgtAm, -1);
        daySummary.ptyAm = self._summaryPty(dayCondition.ptyAm, -1);
        if (dayCondition.skyAm.length > 0) {
            daySummary.skyAm = self._average(dayCondition.skyAm, -1, 0);
            daySummary.wfAm = self._convertSkyToKorStr(daySummary.skyAm, daySummary.ptyAm);
        }
        daySummary.lgtPm = self._summaryLgt(dayCondition.lgtPm, -1);
        daySummary.ptyPm = self._summaryPty(dayCondition.ptyPm, -1);
        if (dayCondition.skyPm.length > 0) {
            daySummary.skyPm = self._average(dayCondition.skyPm, -1, 0);
            daySummary.wfPm = self._convertSkyToKorStr(daySummary.skyPm, daySummary.ptyPm);
        }
        daySummary.t1d = self._average(dayCondition.t3h, -50, 1);
        daySummary.taMax = dayCondition.tmx;
        daySummary.taMin = dayCondition.tmn;
        daySummary.wsd = self._average(dayCondition.wsd, -1, 1);

        if (daySummary.skyAm == undefined) {
            if (daySummary.sky != undefined) {
                daySummary.skyAm = self._average(dayCondition.sky, -1, 0);
                if (daySummary.ptyAm != -1) {
                    tmpPty = daySummary.ptyAm;
                }
                else {
                    tmpPty = daySummary.pty;
                }
                daySummary.wfAm = self._convertSkyToKorStr(daySummary.skyAm, tmpPty);
            }
            else if (daySummary.skyPm != undefined) {
               daySummary.skyAm = daySummary.skyPm;
                daySummary.wfAm = daySummary.wfPm;
            }
        }
        if (daySummary.skyPm == undefined) {
            if (daySummary.sky != undefined) {
                if (daySummary.ptyPm != -1) {
                    tmpPty = daySummary.ptyPm;
                }
                else {
                    tmpPty = daySummary.pty;
                }
                daySummary.skyPm = self._average(dayCondition.sky, -1, 0);
                daySummary.wfPm = self._convertSkyToKorStr(daySummary.skyPm, tmpPty);
            }
            else if (daySummary.skyAm != undefined) {
                daySummary.skyPm = daySummary.skyAm;
                daySummary.wfPm = daySummary.wfAm;
            }
        }
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

    pastList.forEach(function (hourCondition, i) {
        if (hourCondition.time === "0000") {
            var D = kmaTimeLib.convertStringToDate(hourCondition.date);
            D.setDate(D.getDate()-1);
            //date = back one day
            //date = (parseInt(hourCondition.date)-1).toString();
            hourCondition.time = "2400";
            hourCondition.date = kmaTimeLib.convertDateToYYYYMMDD(D);
        }
        //index 0번 0000시가 하루전으로 변경되므로, 한개는 버려야 함.
        if (i == 0) {
            return;
        }

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
        if (parseInt(hourCondition.time) <= 1200 ) {
            if (hourCondition.lgt !== -1) {
                dayCondition.lgtAm.push(hourCondition.lgt);
            }
            if (hourCondition.sky !== -1) {
                dayCondition.skyAm.push(hourCondition.sky);
            }
            if (hourCondition.pty !== -1) {
                dayCondition.ptyAm.push(hourCondition.pty);
            }
        }
        else {
            if (hourCondition.lgt !== -1) {
                dayCondition.lgtPm.push(hourCondition.lgt);
            }
            if (hourCondition.sky !== -1) {
                dayCondition.skyPm.push(hourCondition.sky);
            }
            if (hourCondition.pty !== -1) {
                dayCondition.ptyPm.push(hourCondition.pty);
            }
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
        daySummary.reh = self._average(dayCondition.reh, -1, 0);
        daySummary.rn1 = self._sum(dayCondition.rn1, -1);
        daySummary.sky = self._average(dayCondition.sky, -1, 0);
        daySummary.lgtAm = self._summaryLgt(dayCondition.lgtAm, -1);
        daySummary.ptyAm = self._summaryPty(dayCondition.ptyAm, -1);
        if (dayCondition.skyAm.length > 0) {
            daySummary.skyAm = self._average(dayCondition.skyAm, -1, 0);
            daySummary.wfAm = self._convertSkyToKorStr(daySummary.skyAm, daySummary.ptyAm);
        }
        else {
            //측정날씨의 경우에는 당일 데이터가 없을 수 있음. short에서 덮어쓰게 됨.
        }
        daySummary.lgtPm = self._summaryLgt(dayCondition.lgtPm, -1);
        daySummary.ptyPm = self._summaryPty(dayCondition.ptyPm, -1);
        if (dayCondition.skyPm.length > 0) {
            daySummary.skyPm = self._average(dayCondition.skyPm, -1, 0);
            daySummary.wfPm = self._convertSkyToKorStr(daySummary.skyPm, daySummary.ptyPm);
        }
        else {
            //측정날씨의 경우에는 당일 데이터가 없을 수 있음. short에서 덮어쓰게 됨.
        }

        daySummary.t1d = self._average(dayCondition.t1h, -50, 1);
        daySummary.wsd = self._average(dayCondition.wsd, -1, 1);
        daySummary.taMax = +(self._max(dayCondition.t1h, -50)).toFixed(1);
        daySummary.taMin = +(self._min(dayCondition.t1h, -50)).toFixed(1);
    });

    return daySummaryList;
};

module.exports = ControllerTown;

