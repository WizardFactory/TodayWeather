/**
 * Created by aleckim on 2015. 10. 14..
 *
 * 자외선 uv 지수(3월~11월), 7시 19시 발표 오늘,내일, 모레까지 위험(11이상), 매우높음(8이상), 높음(6이상), 보통(3이상), 낮음(0)
 * 체감온도(11월~3월), 6시 발표 3시간~66시간까지 -45(위험), -25~45(경고), -10~-25(주의), 관심(~10)
 * 감기 (9월~4월) 6시, 18시에 오늘, 내일, 모레까지 발표됨, 매우높음(3), 높음(2), 보통(1), 낮음(0)
 * 식중독 fsn (3월~11월) 6시, 18시에 오늘, 내일, 모레까지 발표됨., 위험(95), 경고(70), 주의(35), 관심(35)
 * 불쾌지수(6월~9월), 3시 발표 3시간~66시간까지 80이상(매우높음), 75이상(높음), 68이상(보통), 60미만(낮음)
 */

"use strict";
var req = require('request');
var async = require('async');
var keyList = require('./dataGoKrKeys');
var rejection = require('./dataGoKrRejection');

var Town = require('../models/town');
var LifeIndexKma = require('../models/lifeIndexKma');
var LifeIndexKma2 = require('../models/kma/kma.lifeindex.model');

var kmaTimeLib = require('../lib/kmaTimeLib');

//var config = require('../config/config');

// The legacy UV list answers 307 -> /503.html; UV moved to data.go.kr V5 (#2587).
var UV_V5_URL = "http://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5";
var POLLEN_V3_BASE = 'https://apis.data.go.kr/1360000/HealthWthrIdxServiceV3/';
var POLLEN_OPERATIONS = {
    flowerWoody: 'getOakPollenRiskIdxV3',
    flowerPine: 'getPinePollenRiskIdxV3',
    flowerWeeds: 'getWeedsPollenRiskndxV3'
};
var UV_V5_ROWS = 1000;
// Current three-hour KST slot and earlier ones, to reach the latest issuance.
var UV_V5_SLOT_COUNT = 5;

/**
 * fsn 식중독지수, rot 부패지수, Sensorytem 체감온도, Frostbite 동상가능 지수, Heat 열, Dspls 불쾌
 * Winter 동파, Ultrv 자외선, Airpollution 대기 확산
 * _areaList(townList), nextTime - 데이터를 가지고 올 다음 시간,
 * @constructor
 */
function KmaIndexService() {
    this.serviceKey = "";
    this.serviceKeyList = [];
    this.serviceKeyIndex = -1;
    this._areaList = [];
    this.requestCount = {};

    //this.rot = {
    //    nextTime: null,
    //    offerMonth: {start: 2, end: 10}, //3~11
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getRotLifeList'
    //};

    //this.sensorytem = {
    //    nextTime: null,
    //    offerMonth: {start: 10, end: 3}, //3~11
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getSensorytemLifeList'
    //};

    //this.frostbite = {
    //    nextTime: null,
    //    offerMonth: {start: 11, end: 1}, //12~2
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getFrostbiteLifeList'
    //};

    //this.heat = {
    //    nextTime: null,
    //    offerMonth: {start: 5, end: 8}, //6~9
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getHeatLifeList'
    //};

    //this.dspls = {
    //    nextTime: null,
    //    offerMonth: {start: 5, end: 8}, //6~9
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getDsplsLifeList'
    //};

    //this.winter = {
    //    nextTime: null,
    //    offerMonth: {start: 11, end: 1},
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getWinterLifeList'
    //};

    // getUVIdxV5 is issued year-round every three hours (#2587).
    this.ultrv = {
        nextTime: null,
        offerMonth: {start: 0, end: 11},
        updateTimeTable: [0, 3, 6, 9, 12, 15, 18, 21], //kr 9, 12, 15, 18, 21, 0, 3, 6
        urlPath: 'getUltrvLifeList'
    };

    // KMA pollen risk is seasonal. Poll the current KST day at four UTC slots;
    // a missing publication is retried on the next hourly manager pass.
    ['flowerWoody', 'flowerPine', 'flowerWeeds'].forEach(function (name) {
        this[name] = {
            nextTime: null,
            offerMonth: name === 'flowerWeeds' ? {start: 7, end: 9} : {start: 3, end: 5},
            updateTimeTable: [0, 6, 12, 18]
        };
    }, this);

    //this.airpollution = {
    //    nextTime: null,
    //    offerMonth: {start: 10, end: 4},
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getAirpollutionLifeList'
    //};
}

/** Replace the active list; repeated setup never retains old credentials. */
KmaIndexService.prototype.setServiceKey = function(keys) {
    this.serviceKeyList = keyList.parse(keys);
    this.serviceKeyIndex = 0;
    this.serviceKey = this.serviceKeyList[0];
    return this;
};

KmaIndexService.prototype.changeServiceKey = function() {
    this.serviceKeyIndex++;
    if (this.serviceKeyIndex >= this.serviceKeyList.length) {
        this.serviceKeyIndex = 0;
        log.error('service key rotated!! for kma index service');
        return false;
    }

    log.info('service key is changed index='+this.serviceKeyIndex);
    this.serviceKey = this.serviceKeyList[this.serviceKeyIndex];
    return true;
};

/**
 * 원래는 자신의 디비에서 리스트 뽑아서 업데이트하면 되는데, 기존에 잘 못된 구조로, list를 따로 가지는 형태로 진행.
 */
KmaIndexService.prototype.loadAreaList = function(callback) {
    log.info("LOAD AREA LIST");

    var self = this;
    LifeIndexKma.find({},{_id:0}).lean().exec(function(err, lifeIndexList) {
        if (err)  {
            log.error("Fail to load town list");
            return err;
        }

        self._areaList = lifeIndexList.filter(function (lifeIndex) {
           return lifeIndex.activated;
        });

        log.info("kma index  areaList="+self._areaList.length);
        if (callback) {
            callback();
        }
    });

    return this;
};

/**
 *
 * @param indexName
 * @param time
 * @returns {boolean}
 */
KmaIndexService.prototype.checkGetTime = function (indexName, time) {
  return time.getTime() >= this[indexName].nextTime.getTime();
};

KmaIndexService.prototype.getLastGetTime = function (indexName) {
    var l = this[indexName];
    var time = new Date();
    time.setUTCMinutes(0);
    time.setUTCSeconds(0);
    time.setUTCMilliseconds(0);

    if (time.getUTCHours() < l.updateTimeTable[0]) {
        time.setUTCDate(time.getUTCDate()-1);
        time.setUTCHours(l.updateTimeTable[l.updateTimeTable.length-1]);
    }
    else if (time.getUTCHours() >= l.updateTimeTable[l.updateTimeTable.length-1]) {
        time.setUTCHours(l.updateTimeTable[l.updateTimeTable.length-1]);
    }
    else {
        for (var i=l.updateTimeTable.length-1; i>=0; i--) {
            if (l.updateTimeTable[i] < time.getUTCHours()) {
                time.setUTCHours(l.updateTimeTable[i]);
                break;
            }
        }
    }

    if (time.getUTCMonth() < l.offerMonth.start) {
        time.setUTCFullYear(time.getFullYear()-1);
        time.setUTCMonth(l.offerMonth.end+1);
        time.setUTCDate(0); //the last hour of the previous month
    }
    else if (time.getUTCMonth() > l.offerMonth.end) {
        time.setUTCMonth(l.offerMonth.end+1);
        time.setUTCDate(0); //the last hour of the previous month
    }

    return time;
};

/**
 *
 * @param indexName key
 * @param time next time to get data
 * @returns {KmaIndexService}
 */
KmaIndexService.prototype.setNextGetTime = function(indexName, time) {
    var l = this[indexName];

    // Pollen availability is determined from KST in taskPollenV3. The legacy UTC
    // month adjustment below can roll March 31 into May and July 31 into August 31.
    if (POLLEN_OPERATIONS[indexName]) {
        l.nextTime = time ? new Date(time.getTime()) : new Date((l.nextTime || new Date()).getTime() + 3*3600*1000);
        return this;
    }

    if (time) {
        l.nextTime = time;
    }
    else {
        var i;
        for (i=0; i< l.updateTimeTable.length; i++) {
            if (l.nextTime.getUTCHours() < l.updateTimeTable[i]) {
                l.nextTime.setUTCHours(l.updateTimeTable[i]);
                break;
            }
        }
        if (i === l.updateTimeTable.length) {
            l.nextTime.setUTCDate(l.nextTime.getUTCDate()+1);
            l.nextTime.setUTCHours(l.updateTimeTable[0]);
        }
        l.nextTime.setUTCMinutes(10);
        l.nextTime.setUTCSeconds(0);
        l.nextTime.setUTCMilliseconds(0);
    }

    //check offerMonth
    if (l.offerMonth.start < l.offerMonth.end) {
        // 6~9
        if (l.nextTime.getUTCMonth() < l.offerMonth.start) {
            l.nextTime.setUTCMonth(l.offerMonth.start);
        }
        else if (l.nextTime.getUTCMonth()> l.offerMonth.end) {
            l.nextTime.setUTCFullYear(l.nextTime.getUTCFullYear()+1);
            l.nextTime.setUTCMonth(l.offerMonth.start);
            l.nextTime.setUTCDate(0);
            l.nextTime.setUTCHours(0);
        }
        else {
            log.silly('continue to get data from kma');
        }
    }
    else {
        //like 10~3
       if (l.nextTime.getUTCMonth() > l.offerMonth.end)  {
           l.nextTime.setUTCMonth(l.offerMonth.start);
           l.nextTime.setUTCDate(0);
           l.nextTime.setUTCHours(0);
       }
    }


    log.info("SET next get "+indexName+" life list time=", this[indexName].nextTime.toString());
    return this;
};

/**
 *
 * @param indexName
 * @param areaNo
 * @param svcKey
 * @returns {string}
 */
KmaIndexService.prototype.getUrl = function (indexName, areaNo, svcKey) {
    throw new Error('Legacy life index API is retired; only UV V5 collection is supported');
};

/**
 "indexModel": {
    "code": "A01_2", "areaNo": 5013062000, "date": 2015101818, "today": "", "tomorrow": 55,"theDayAfterTomorrow": 55
  }
 * @param parsedData
 * @param indexModel
 * @private
 */
KmaIndexService.prototype._parseDailyLifeIndex = function (parsedData, indexModel) {

    var lastUpdateDate = ''+indexModel.date;

    var today = kmaTimeLib.convertStringToDate(lastUpdateDate);
    var tomorrowStr = kmaTimeLib.convertDateToYYYYMMDD(today.setDate(today.getDate()+1));
    var tdatStr = kmaTimeLib.convertDateToYYYYMMDD(today.setDate(today.getDate()+1));


    if (indexModel.today !== "") {
        parsedData.data.push({date: lastUpdateDate.substr(0,8), value: indexModel.today});
    }
    else {
        log.silly('skip invalid data of today');
    }

    parsedData.data.push({date: tomorrowStr, value: indexModel.tomorrow});
    parsedData.data.push({date: tdatStr, value: indexModel.theDayAfterTomorrow});
};

/**
 "indexModel":{"code":"A02","areaNo":5013062000,"date":2015103018,
    "h3":0,"h6":0,"h9":0,"h12":0,"h15":0,"h18":0,"h21":0,"h24":0,"h27":0,"h30":0,"h33":0,"h36":0,"h39":0,"h42":0,
    "h45":0,"h48":1,"h51":3,"h54":3,"h57":"","h60":"","h63":"","h66":""}
 * @param parsedData
 * @param indexModel
 * @private
 */
KmaIndexService.prototype._parseHourlyLifeIndex = function (parsedData, indexModel) {
    var lastUpdateDate = ''+indexModel.date;

    var startTime = kmaTimeLib.convertStringToDate(lastUpdateDate);

    for (var i=3;i<67;i+=3) {
        var propertyName = 'h'+i;
        startTime.setHours(startTime.getHours()+3);

        if (indexModel[propertyName] === '') {
            log.silly('skip invalid data');
            continue;
        }

        var data = {date: kmaTimeLib.convertDateToYYYYMMDD(startTime),
                    time: kmaTimeLib.convertDateToHHZZ(startTime),
                    value: indexModel[propertyName]};

        log.silly(data);
        parsedData.data.push(data);
    }
};

/* jshint ignore:start */
/**
 *
     "Response": {
        "header": {
            "successYN": "Y", "returnCode": "00","errMsg": "" },
        "body": {
            "@xsi.type": "idxBody",
            "indexModel": {}}}
    return - {*|{error: Error, data: {areaNo: String, $indexName: {}}}

 * @param indexName
 * @param data
 * @returns {*}
 */
/* jshint ignore:end */
KmaIndexService.prototype.parseLifeIndex = function(indexName, data) {
    var err;

    if (data.LegacyAPIResponse) {
        data.Response = data.LegacyAPIResponse;
    }

    if (!data.Response || !data.Response.header || !data.Response.header.successYN) {
        err = new Error("Fail to parse LifeList of " + indexName);
        log.error(err);
        return {error: err};
    }

    var header = data.Response.header;
    if (header.successYN === 'N') {
        if (header.returnCode == 99) {
            log.warn("Search result is nothing but continue getting data index="+indexName+" errMsg="+header.errMsg);
            log.debug(data);
            return {};
        }
        else {
            err = new Error("ReturnCode="+header.returnCode+" errMsg="+header.errMsg);
            err.returnCode = header.returnCode;
            return {error: err};
        }
    }

    if (!data.Response.body || !data.Response.body.indexModel) {
        err = new Error("We get success but, Fail to parse LifeList of " + indexName);
        log.error(err);
        return {error: err};
    }

    var indexModel = data.Response.body.indexModel;

    var areaNo = ''+indexModel.areaNo;
    var lastUpdateDate = ''+indexModel.date;
    var parsedData = {lastUpdateDate: lastUpdateDate, data: []};

    if (indexName === 'fsn' || indexName === 'ultrv') {
        this._parseDailyLifeIndex(parsedData, indexModel);
    }
    else {
        this._parseHourlyLifeIndex(parsedData, indexModel);
    }

    var result = {areaNo: areaNo};
    result[indexName]  = parsedData;
    return {error: undefined, data: result};
};

/**
 * 서버쪽 끊어짐이 심하고(503), request count 체크가 확실하지 않아, timeout 처리 최소화
 * @param indexName
 * @param areaNo
 * @param callback
 */
KmaIndexService.prototype.getLifeIndex = function (indexName, areaNo, callback) {
    var url = this.getUrl(indexName, areaNo, this.serviceKey);

    log.debug(url);
    if (this.requestCount[indexName] == undefined) {
        this.requestCount[indexName] = 0;
    }
    else {
        this.requestCount[indexName]++;
    }
    log.silly(indexName+" request count="+this.requestCount[indexName]);

    req(url, {timeout: 1000*30, json:true}, function (err, response, body) {
        if (err) {
            return callback(err);
        }
        if (response.statusCode >= 400) {
            err = new Error("response status Code="+response.statusCode);
            err.statusCode = response.statusCode;
           return callback(err);
        }
        callback(undefined, body);
    });
};

/**
 *
 * @param indexData
 * @param newData
 * @returns {*}
 */
KmaIndexService.prototype.updateOrAddLifeIndex = function (indexData, newData) {
    indexData.lastUpdateDate = newData.lastUpdateDate;

    var newDataList = newData.data;

    newDataList.forEach(function(newData) {
        for (var i=0; i<indexData.data.length; i++)   {
            if (indexData.data[i].date === newData.date) {
                indexData.data[i].value = newData.value;
                break;
            }
        }

        if (i>=indexData.data.length) {
            indexData.data.push(newData);
        }
    });

    return indexData;
};

/**
 *
 * @param indexName
 * @param town
 * @param data
 * @returns {*|exports|module.exports}
 */
KmaIndexService.prototype.createLifeIndex = function (indexName, town, data) {
    var lifeIndex =  new LifeIndexKma({town: town.town, mCoord: town.mCoord,
                areaNo: data.areaNo});
    lifeIndex[indexName] = data[indexName];

    return lifeIndex;
};

/**
 *
 * @param indexName
 * @param townObject
 * @param data
 * @param callback
 */
KmaIndexService.prototype.saveLifeIndex = function(indexName, townObject, data, callback) {
    var self = this;

    LifeIndexKma.find({areaNo: data.areaNo}, function(err, lifeIndexList) {
        if (err) {
            return callback(err);
        }
        if (lifeIndexList.length === 0) {
            var lifeIndex = self.createLifeIndex(indexName, townObject, data);
            lifeIndex.save(function (err) {
                return callback(err);
            });
            return;
        }

        //If you wants save perfect, have to use promise
        lifeIndexList.forEach(function (lifeIndex) {
            if (lifeIndex[indexName].lastUpdateDate === data[indexName].lastUpdateDate &&
                lifeIndex[indexName].data.length !== 0)
            {
                log.error('areaNo='+data.areaNo+' '+indexName+' life index has not updated yet lastUpdateDate='+
                            lifeIndex[indexName].lastUpdateDate);
                callback();
                return;
            }

            self.updateOrAddLifeIndex(lifeIndex[indexName], data[indexName]);
            lifeIndex.save(function (err) {
                if (err) {
                    log.error(err);
                }
                return callback();
            });
        });
    });

    return this;
};

/**
 *
 * @param indexName
 * @param town
 * @param callback
 */
KmaIndexService.prototype.getLifeIndexByIndexNameAreaNo = function(indexName, town, callback) {
    var self = this;

    async.waterfall([
        function(cb) {
            LifeIndexKma.find({areaNo: town.areaNo}).lean().exec(function(err, lifeIndexList) {
                if (err) {
                    return cb(err);
                }
                if (lifeIndexList.length === 0) {
                    log.info('Fail to find areaNo='+town.areaNo+' so get first time');
                    return cb();
                }
                var lastUpdateTime = kmaTimeLib.convertStringToDate(lifeIndexList[0][indexName].lastUpdateDate);
                var lastPublicTime = self.getLastGetTime.call(self, indexName);
                if (lastUpdateTime.getTime() < lastPublicTime.getTime()) {
                    //go to get new data
                }
                else {
                    log.verbose('areaNo='+town.areaNo+' life index data already updated skip '+indexName+
                        ' lateUpdateDate='+lifeIndexList[0][indexName].lastUpdateDate);
                    return cb('skip', lifeIndexList[indexName]);
                }
                return cb();
            });
        },
        function(cb) {
            self.getLifeIndex(indexName, town.areaNo, function(err, body){
                if (err) {
                    return cb(err, undefined);
                }
                cb(err, body);
            });
        },
        function(rcv, cb) {
            var ret = self.parseLifeIndex(indexName, rcv);
            cb(ret.error, ret.data);
        },
        function(data, cb) {
            if (!data) {
                log.debug('areaNo='+town.areaNo+' it means skip of ' + indexName);
                return cb();
            }
            self.saveLifeIndex(indexName, town, data, function (err) {
                cb(err, data[indexName]);
            });
        }
    ], function(err, result) {
        if (err === 'skip') {
           err = undefined;
        }
        return callback(err, {area: town, indexData: result});
    });
};

KmaIndexService.prototype._recursiveGetLifeIndex = function (indexName, list, retryCount, callback) {
    var self = this;
    var failList = [];
    var needChangeServiceKey = false;

    async.mapLimit(list, 500,
        function (area, cBack) {
            self.getLifeIndexByIndexNameAreaNo(indexName, area, function (err, data) {
                if (err) {
                    var errStr = 'Can not retry get life index of '+indexName;
                    err.message += ' indexName=' +indexName +' area'+ JSON.stringify(area);

                    if (err.returnCode && err.returnCode == 99) {
                        log.silly(errStr+': There is no result');
                        log.error(err);
                    }
                    else if (err.returnCode && (err.returnCode == 1 || err.returnCode == 22)) {
                        log.silly(errStr+': SERVICE REQUESTS EXCEEDS');
                        log.warn(err.message);
                        needChangeServiceKey = true;
                        failList.push(area);
                    }
                    else {
                        failList.push(area);
                        if (err.statusCode && err.statusCode === 503) {
                            log.debug(err.message);
                        }
                        else {
                            log.error(err);
                        }
                    }
                }
                else {
                    log.silly(JSON.stringify(data));
                }
                cBack(undefined, area);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err, results);
            }
            log.debug('rcv results.length='+results.length);
            if (failList.length != 0) {
                if (needChangeServiceKey) {
                    if (self.changeServiceKey() == false) {
                        err = new Error('Key Rotated!!');
                        return callback(err, results);
                    }
                    needChangeServiceKey = false;
                }
                retryCount--;
                if (retryCount <=0) {
                    err = new Error('Retry count is zero');
                    return callback(err, results);
                }
                log.warn('retry to get kma life index failList.length='+failList.length+' retryCount='+retryCount);
                return self._recursiveGetLifeIndex(indexName, failList, retryCount, callback);
            }
            return callback(err);
        }
    );
};

/**
 * townList를 돌면서, kma의 데이터를 가지고 와서, parsing하고 save한다, 중간에 오류가 발생하면,
 * recursiveGetLifeIndex에서 재시도한다.
 * 재시도에도 모두 가지고 오지 못하면, getTime은 update하지 않는다. 현재는 1시간마다, lifeIndex를 체크하기 때문에 1시간후에 재시도 된다.
 * @param indexName ultrv, fsn
 * @param callback
 * @returns {*}
 */
KmaIndexService.prototype.taskLifeIndex = function (indexName, callback) {
    var self = this;
    var time = new Date();

    if (!this.checkGetTime(indexName, time)) {
        log.info('skip '+indexName+' nextTime='+ this[indexName].nextTime);
        return callback();
    }

    var list = this._areaList;
    log.info('start to get '+indexName+' life length='+list.length+' time=' + time);

    self._recursiveGetLifeIndex(indexName, list, 30, function (err) {
        if (err) {
            return callback(err);
        }

        log.info('get all data of '+indexName);
        self.setNextGetTime(indexName);
        return callback(err);
    });

    return this;
};

KmaIndexService.prototype.findAreaByTown = function(townInfo, callback) {
    log.info("LOAD town info " +townInfo.toString());

    LifeIndexKma.find({town: townInfo}, function(err, townList) {
        if (err)  {
            log.error("Fail to load townlist");
            return err;
        }
        if (!townList) {
            err = new Error("Fail to find town "+ townInfo.toString());
        }

        var retTown;

        townList.every(function (town) {
           if (!town.areaNo || town.areaNo === '')  {
               log.warn("town didn't have areaNo");
               return true;
           }
            retTown = town;
            return false;
        });

        if (retTown) {
            log.debug("areaNo="+retTown.areaNo);
            return callback(undefined, retTown);
        }
        else {
            err = new Error("Fail to find areaNo "+ townInfo.toString());
            return callback(err);
        }
    });
};

/**
 * 없어져야 함.
 * @param townInfo
 * @param callback
 * @returns {*}
 */
KmaIndexService.prototype.getLifeIndexByTown = function(townInfo, callback) {
    log.info("Called KMA Index service By Town");
    if (!this.serviceKey) {
        var missing = new Error('No configured data.go.kr keys');
        if (callback) { return callback(missing); }
        return log.error(missing.message);
    }

    var self = this;
    var list = ['ultrv'];

    //findAreaNo from town
    this.findAreaByTown(townInfo, function (err, town) {
        if (err) {
            return callback(err);
        }

        async.mapSeries(list,
            function(indexName, cb) {
                self.getLifeIndexByIndexNameAreaNo(indexName, town, function (err, data) {
                   cb(err, {indexName:indexName, data: data.indexData});
                });
            },
            function(err, results) {
                if(err) {
                    log.error(err);
                    return callback(err);
                }
                log.silly(results);
                var lifeIndexKma = {town: townInfo, mCoord: town.mCoord, areaNo: town.areaNo};
                results.forEach(function(result) {
                    lifeIndexKma[result.indexName] = result.data;
                });
                return callback(undefined, lifeIndexKma);
            });
    });
};

/**
 * towns db로부터 areaNo정보를 life index kma에 추가함.
 * kma aws의 정보가 towns에 들어올때, areaNo가 없는 경우가 있음. 그것에 대해서는 추가하지 않음.
 * @param callback
 */
KmaIndexService.prototype.updateLifeIndexDbFromTowns = function (callback) {

    Town.find({},{_id:0}).lean().exec(function (err, townList) {
        if (err) {
            log.error(err);
            return callback();
        }

        async.map(townList,
            function (town, cb) {
                if(town.areaNo === undefined) {
                    log.warn("skip town="+JSON.stringify(town));
                    return cb(undefined, town.areaNo);
                }

                LifeIndexKma.find({"areaNo": town.areaNo}, function (err, lifeIndexList) {
                    if (err) {
                        return cb(err);
                    }
                    if (lifeIndexList.length > 0) {
                        log.silly("Already saved areaNo="+town.areaNo);
                        return cb(undefined);
                    }
                    var lifeIndexKma = new LifeIndexKma({town: town.town, mCoord: town.mCoord, areaNo: town.areaNo,
                                                        geo: [town.gCoord.lon, town.gCoord.lat]});
                    lifeIndexKma.save(function (err) {
                        if (err) {
                            return cb(err);
                        }
                        cb(undefined, lifeIndexKma.areaNo);
                    });
                });
            },
            function (err, results) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, results);
            });
    });
};

/**
 * KMA 기상지수는 동시에 가지고 오면 503에러가 발생함
 * @param self
 * @param callback
 * @returns {*}
 */
KmaIndexService.prototype.cbKmaIndexProcess = function(self, callback) {
    log.info("Called KMA Index service Main process");
    if (!self.serviceKey) {
        var missing = new Error('No configured data.go.kr keys');
        if (callback) { return callback(missing); }
        return log.error(missing.message);
    }

    //SensorytemLife
    //FrostbiteLife
    //WinterLife
    //RotLife
    //HeatLife
    //AirpollutionLife
    var list = ['ultrv', 'flowerWoody', 'flowerPine', 'flowerWeeds'];
    async.mapSeries(list,
        function(indexName, cb) {
            self.taskLifeIndex2(indexName, function (err) {
                if(err) {
                    log.error(err);
                }
                cb();
            });
        },
        function(err, results) {
            if(err) {
                log.error(err);
            }
            log.silly(results);
            if (callback) {
               callback(err);
            }
            else {
                setTimeout(self.cbKmaIndexProcess, 60*1000*10, self); //10mins
            }
        });
};

/**
 *
 */
KmaIndexService.prototype.start = function() {
    log.info('start KMA INDEX SERVICE');
    this.loadAreaList();
    //rot, sensorytem, dspls는 routing시에 계산하여 추가.
    //this.setNextGetTime('rot', new Date());
    //this.setNextGetTime('sensorytem', new Date());
    //this.setNextGetTime('dspls', new Date());
    this.setNextGetTime('ultrv', new Date());
    ['flowerWoody', 'flowerPine', 'flowerWeeds'].forEach(function (name) {
        this.setNextGetTime(name, new Date());
    }, this);
    setTimeout(this.cbKmaIndexProcess, 3*1000, this); //start after 3secs
};


KmaIndexService.prototype.getLifeIndex2 = function (indexName, callback) {
    var url = this.getUrl(indexName, undefined, this.serviceKey);

    log.info('request '+indexName+' life list');
    if (this.requestCount[indexName] == undefined) {
        this.requestCount[indexName] = 0;
    }
    else {
        this.requestCount[indexName]++;
    }

    log.silly(indexName+" request count="+this.requestCount[indexName]);

    req(url, {timeout: 1000*30, json:true}, function (err, response, body) {
        if (err) {
            return callback(err);
        }
        if (response.statusCode >= 400) {
            err = new Error("response status Code="+response.statusCode);
            err.statusCode = response.statusCode;
           return callback(err);
        }
        callback(undefined, body);
    });
};

/**
 "indexModel": {
    "code": "A01_2", "areaNo": 5013062000, "date": 2015101818, "today": "", "tomorrow": 55,"theDayAfterTomorrow": 55
  }
 * @param parsedData
 * @param indexModel
 * @private
 */
KmaIndexService.prototype._parseDailyLifeIndex2 = function (indexModel) {

    var lastUpdateDate = ''+indexModel.date;
    lastUpdateDate = lastUpdateDate.slice(0,8);

    var today = kmaTimeLib.convertStringToDate(lastUpdateDate);
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate()+1);
    var tdat = new Date(tomorrow);
    tdat.setDate(tdat.getDate()+1);

    var data = [];
    if (indexModel.today !== "") {
        data.push({date: today, index: indexModel.today});
    }
    else {
        log.silly('skip invalid data of today');
    }
    data.push({date: tomorrow, index: indexModel.tomorrow});
    data.push({date: tdat, index: indexModel.theDayAfterTomorrow});

    return data;
};

/* jshint ignore:start */
/**
 *
     "Response": {
        "header": {
            "successYN": "Y", "returnCode": "00","errMsg": "" },
        "body": {
            "indexModels": [
                {"code":"A01_2","areaNo":"1100000000","date":"2018020106",
                    "today":"56","tomorrow":"53","theDayAfterTomorrow":"55"},
                {"code":"A01_2","areaNo":"1111000000","date":"2018020106",
                     "today":"56","tomorrow":"53","theDayAfterTomorrow":"55"}
            ]}
    return - {*|{error: Error, data: {areaNo: String, $indexName: {}}}

 * @param indexName
 * @param data
 * @returns {*}
 */
/* jshint ignore:end */
KmaIndexService.prototype.parseLifeIndex2 = function(indexName, data) {
    var err;
    var self = this;

    if (data.LegacyAPIResponse) {
        data.Response = data.LegacyAPIResponse;
    }

    if (!data.Response || !data.Response.header || !data.Response.header.successYN) {
        err = new Error("Fail to parse LifeList of " + indexName);
        log.error(err);
        return {error: err};
    }

    var header = data.Response.header;
    if (header.successYN === 'N') {
        if (header.returnCode == 99) {
            log.warn("Search result is nothing but continue getting data index="+indexName+" errMsg="+header.errMsg);
            log.debug(data);
            return {};
        }
        else {
            err = new Error("ReturnCode="+header.returnCode+" errMsg="+header.errMsg);
            err.returnCode = header.returnCode;
            return {error: err};
        }
    }

    if (!data.Response.body || !data.Response.body.indexModels) {
        err = new Error("We get success but, Fail to parse LifeList of " + indexName);
        log.error(err);
        return {error: err};
    }

    var indexModels = data.Response.body.indexModels;
    var results = [];
    indexModels.forEach(function (indexModel) {
        var data = self._parseDailyLifeIndex2(indexModel);
        data.forEach(function (obj) {
           obj.areaNo = parseInt(indexModel.areaNo);
           obj.lastUpdateDate = ''+indexModel.date;
           obj.indexType = indexName;
           results.push(obj);
        });
    });

    return {error: undefined, data: results};
};

/**
 * results = [
        {"areaNo": "1100000000",
            "fsn": {
                "lastUpdateDate": "2018020106",
                "data": [{"date": "20180201", "value": "56"},
                    {"date": "20180202", "value": "53"},
                    {"date": "20180203", "value": "55"}]
            }
        },
        {"areaNo": "5019099000",
            "fsn": {
                "lastUpdateDate": "2018020106",
                "data": [{"date": "20180201", "value": "58"},
                    {"date": "20180202", "value": "57"},
                    {"date": "20180203", "value": "55"}]
            }
        }];
 * @param indexName
 * @param results
 * @param callback
 * @returns {KmaIndexService}
 */
KmaIndexService.prototype.saveLifeIndex2 = function(indexName, results, callback) {
    async.mapSeries(results,
        function (result, callback) {
            var query = {date: result.date, areaNo: result.areaNo, indexType: result.indexType};
            LifeIndexKma2.update(query, result, {upsert:true}, function (err) {
                if(err) {
                    log.error(err.message + " in insert DB(lifeIndex)");
                    log.info(JSON.stringify(result));
                }
                callback(err);
            });
        },
        function (err, result) {
            callback(err, result ? result.length : 0);
        });
    return this;
};

KmaIndexService.prototype._removeOldData = function () {
    var removeDate = new Date();
    removeDate.setDate(removeDate.getDate()-10);

    LifeIndexKma2.remove({"date": {$lt:removeDate} }, function (err) {
        log.info('removed kma life index from date : ' + removeDate.toString());
    });
};

KmaIndexService.prototype.taskLifeIndex2 = function (indexName, callback) {
    var self = this;
    var time = new Date();

    if (!this.checkGetTime(indexName, time)) {
        log.info('skip '+indexName+' nextTime='+ this[indexName].nextTime);
        return callback();
    }

    if (indexName === 'ultrv') {
        this._removeOldData();
        return this.taskUltrvV5(time, callback);
    }
    if (POLLEN_OPERATIONS[indexName]) {
        return this.taskPollenV3(indexName, time, callback);
    }

    async.waterfall([
        function(cb) {
            self.getLifeIndex2(indexName, function(err, body){
                if (err) {
                    return cb(err, undefined);
                }
                cb(err, body);
            });
        },
        function(rcv, cb) {
            var ret = self.parseLifeIndex2(indexName, rcv);
            cb(ret.error, ret.data);
        },
        function(data, cb) {
            self.saveLifeIndex2(indexName, data, function (err, savedCount) {
                cb(err, savedCount);
            });
        }
    ], function(err, result) {
        return callback(err, result);
    });

    this._removeOldData();
    return this;
};

/**
 * @param key raw or percent-encoded data.go.kr key
 * @returns {string} key encoded once as a query component
 * @private
 */
KmaIndexService.prototype._encodeServiceKey = function (key) {
    try {
        return encodeURIComponent(decodeURIComponent(key));
    }
    catch (err) {
        return encodeURIComponent(key);
    }
};

KmaIndexService.prototype.getUvUrlV5 = function (time, pageNo, svcKey) {
    return UV_V5_URL + '?serviceKey=' + this._encodeServiceKey(svcKey || this.serviceKey) +
        '&pageNo=' + pageNo + '&numOfRows=' + UV_V5_ROWS + '&dataType=JSON&areaNo=&time=' + time;
};

/**
 * @param now
 * @returns {Array} YYYYMMDDHH issuance candidates in KST, newest first
 */
KmaIndexService.prototype.getUvTimeSlotsV5 = function (now) {
    var kst = new Date(now.getTime() + 9*3600*1000);
    var base = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(),
                        Math.floor(kst.getUTCHours()/3)*3);
    var slots = [];
    for (var i=0; i<UV_V5_SLOT_COUNT; i++) {
        var d = new Date(base - i*3*3600*1000);
        slots.push(d.getUTCFullYear() + ('0'+(d.getUTCMonth()+1)).slice(-2) + ('0'+d.getUTCDate()).slice(-2) +
                   ('0'+d.getUTCHours()).slice(-2));
    }
    return slots;
};

/**
 * @param body response of getUVIdxV5 (dataType=JSON) or of the data.go.kr gateway
 * @returns {{error: Error}|{noData: boolean}|{items: Array, totalCount: number}}
 */
KmaIndexService.prototype.parseUvIdxV5 = function (body, label) {
    var err;
    label = label || 'uv index v5';

    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        }
        catch (e) {
            // The data.go.kr gateway can answer in XML even when JSON is requested.
            var match = /<(returnReasonCode|resultCode)>\s*(\d+)\s*</.exec(body);
            if (match && (match[2] === '03' || match[2] === '99')) {
                return {noData: true};
            }
            err = new Error('Fail to parse '+label+' body' + (match ? ' code='+match[2] : ''));
            if (match) {
                err.returnCode = match[2];
                err.isAuthError = rejection.isAuth(200, match[2]) || rejection.isQuota(200, match[2]);
            }
            return {error: err};
        }
    }

    if (body && body.OpenAPI_ServiceResponse && body.OpenAPI_ServiceResponse.cmmMsgHeader) {
        var gateway = body.OpenAPI_ServiceResponse.cmmMsgHeader;
        err = new Error(label+' reasonCode='+gateway.returnReasonCode+' errMsg='+gateway.errMsg);
        err.returnCode = ''+gateway.returnReasonCode;
        err.isAuthError = rejection.isAuth(200, err.returnCode) || rejection.isQuota(200, err.returnCode);
        return {error: err};
    }

    if (!body || !body.response || !body.response.header) {
        return {error: new Error('Fail to find header of '+label)};
    }

    var resultCode = ''+body.response.header.resultCode;
    if (resultCode === '03' || resultCode === '99') {
        return {noData: true};
    }
    if (resultCode !== '00' && resultCode !== '0') {
        err = new Error(label+' resultCode='+resultCode+' resultMsg='+body.response.header.resultMsg);
        err.returnCode = resultCode;
        err.isAuthError = rejection.isAuth(200, resultCode) || rejection.isQuota(200, resultCode);
        return {error: err};
    }

    var resBody = body.response.body || {};
    var items = resBody.items && resBody.items.item;
    if (items == undefined || items === '') {
        return {noData: true};
    }
    if (!Array.isArray(items)) {
        items = [items];
    }
    if (items.length === 0) {
        return {noData: true};
    }

    var totalCount = parseInt(resBody.totalCount, 10);
    return {items: items, totalCount: isNaN(totalCount) ? items.length : totalCount,
            // Pollen collection needs these response fields to prove that all pages
            // of one issuance were received before it marks the batch complete.
            pageNo: Number(resBody.pageNo),
            reportedTotalCount: Number(resBody.totalCount)};
};

/**
 * One life index record per area and KST day. hN is N hours after the issuance time (KST).
 * A day is emitted only when its 12:00 value is present, so a partly covered day keeps its earlier value.
 * @param items getUVIdxV5 items
 * @returns {Array} {areaNo, date, index, indexType, lastUpdateDate}
 */
KmaIndexService.prototype.convertUvItemsV5 = function (items) {
    var results = [];

    items.forEach(function (item) {
        var issued = ''+item.date;
        var areaNo = parseInt(item.areaNo, 10);
        if (!/^\d{10}$/.test(issued) || isNaN(areaNo)) {
            log.warn('skip invalid uv item areaNo='+item.areaNo+' date='+item.date);
            return;
        }

        var base = Date.UTC(parseInt(issued.slice(0,4), 10), parseInt(issued.slice(4,6), 10)-1,
                            parseInt(issued.slice(6,8), 10), parseInt(issued.slice(8,10), 10));
        var days = {};
        for (var n=0; n<=78; n+=3) {
            var value = item['h'+n];
            if (value === undefined || value === null || value === '') {
                continue;
            }
            var index = Number(value);
            if (!isFinite(index) || index < 0) {
                continue;
            }
            var t = new Date(base + n*3600*1000);
            var day = t.getUTCFullYear() + ('0'+(t.getUTCMonth()+1)).slice(-2) + ('0'+t.getUTCDate()).slice(-2);
            if (days[day] === undefined) {
                days[day] = {index: index, noon: false};
            }
            days[day].index = Math.max(days[day].index, index);
            if (t.getUTCHours() === 12) {
                days[day].noon = true;
            }
        }

        Object.keys(days).sort().forEach(function (day) {
            if (!days[day].noon) {
                return;
            }
            results.push({areaNo: areaNo, date: kmaTimeLib.convertStringToDate(day), index: days[day].index,
                          indexType: 'ultrv', lastUpdateDate: issued});
        });
    });

    return results;
};

KmaIndexService.prototype._useServiceKeyV5 = function (index) {
    this.serviceKeyIndex = index;
    this.serviceKey = this.serviceKeyList[index];
};

/**
 * @param time YYYYMMDDHH
 * @param pageNo
 * @param callback (err, parsed)
 * @private
 */
KmaIndexService.prototype._requestUvPageV5 = function (time, pageNo, callback) {
    var self = this;
    if (!self.serviceKeyList.length) { return callback(new Error('No configured data.go.kr keys')); }
    var keyCount = self.serviceKeyList.length;
    var startIndex = Math.max(self.serviceKeyIndex, 0) % keyCount;
    var offset = 0;

    function attempt() {
        if (self.serviceKeyList.length > 0) {
            self._useServiceKeyV5((startIndex + offset) % keyCount);
        }
        req(self.getUvUrlV5(time, pageNo), {timeout: 1000*30, json: true}, function (err, response, body) {
            if (err) {
                err.message = 'uv index v5 time='+time+' page='+pageNo+' '+err.message;
                return callback(err);
            }
            var parsed = self.parseUvIdxV5(body);
            if (!parsed.error && response.statusCode >= 400) {
                parsed = {error: new Error('uv index v5 statusCode='+response.statusCode)};
            }
            if (parsed.error) {
                if (rejection.isAuth(response.statusCode, parsed.error.returnCode) || rejection.isQuota(response.statusCode, parsed.error.returnCode)) {
                    parsed.error.isAuthError = true;
                }
                if (parsed.error.isAuthError && offset + 1 < keyCount) {
                    offset++;
                    return attempt();
                }
                if (parsed.error.isAuthError && self.serviceKeyList.length > 0) {
                    // Every key was rejected: keep the previous choice.
                    self._useServiceKeyV5(startIndex);
                }
                parsed.error.message += ' time='+time+' page='+pageNo;
                return callback(parsed.error);
            }
            if (self.serviceKeyIndex !== startIndex) {
                log.warn('uv index v5 service key changed index='+self.serviceKeyIndex);
            }
            callback(null, parsed);
        });
    }
    attempt();
};

/**
 * All pages of one issuance. The service answers a request time with the latest issuance at or
 * before it (e.g. time=11 returns the 09 issuance), so the issuance comes from the items.
 * @param time YYYYMMDDHH
 * @param callback (err, items, issued) items is undefined when there is no data, or when the
 *        issuance is not newer than the last saved one (remaining pages are then not requested)
 * @private
 */
KmaIndexService.prototype._getUvIssueV5 = function (time, callback) {
    var self = this;

    self._requestUvPageV5(time, 1, function (err, first) {
        if (err) {
            return callback(err);
        }
        if (first.noData) {
            return callback();
        }

        var issued = ''+first.items[0].date;
        // Issuances are YYYYMMDDHH strings, so string order is time order.
        if (self.ultrv.lastIssued && issued <= self.ultrv.lastIssued) {
            return callback(null, undefined, issued);
        }

        var pageCount = Math.ceil(first.totalCount / UV_V5_ROWS);
        var pageList = [];
        for (var pageNo=2; pageNo<=pageCount; pageNo++) {
            pageList.push(pageNo);
        }

        async.mapSeries(pageList,
            function (pageNo, cb) {
                self._requestUvPageV5(time, pageNo, function (err, page) {
                    if (err) {
                        return cb(err);
                    }
                    if (page.noData) {
                        return cb(new Error('uv index v5 missing page='+pageNo+' time='+time));
                    }
                    cb(null, page.items);
                });
            },
            function (err, pages) {
                if (err) {
                    return callback(err);
                }
                var items = first.items;
                pages.forEach(function (pageItems) {
                    items = items.concat(pageItems);
                });
                callback(null, items, issued);
            });
    });
};

/**
 * Once the current slot's issuance is saved, wait for the next three-hour slot.
 * A failed run, or an issuance older than the current slot (not published yet), leaves nextTime
 * unchanged, so the next manager tick retries with one page request.
 * @param now
 * @param issued YYYYMMDDHH of the saved or already-saved issuance
 * @param currentSlot YYYYMMDDHH of the current KST three-hour slot
 * @private
 */
KmaIndexService.prototype._scheduleNextUvV5 = function (now, issued, currentSlot) {
    if (issued < currentSlot) {
        log.info('uv index v5 slot '+currentSlot+' not published yet; latest='+issued);
        return;
    }
    this.ultrv.nextTime = new Date(now.getTime());
    this.setNextGetTime('ultrv');
};

/**
 * Get the latest UV issuance of all areas and save daily values (#2587).
 * @param now
 * @param callback
 */
KmaIndexService.prototype.taskUltrvV5 = function (now, callback) {
    var self = this;
    var slots = self.getUvTimeSlotsV5(now);
    var lastErr;

    function trySlot(i) {
        if (i >= slots.length) {
            return callback(lastErr || new Error('uv index v5 has no data slots='+slots.join(',')));
        }

        self._getUvIssueV5(slots[i], function (err, items, issued) {
            if (err) {
                lastErr = err;
                log.warn(err.message);
                // Only a provider result code means this slot has no issuance; a transport or page
                // failure must not let an older issuance replace a newer one.
                if (err.isAuthError || err.returnCode == undefined) {
                    return callback(err);
                }
                return trySlot(i+1);
            }
            if (!items && issued) {
                log.info('uv index v5 already saved issued='+issued+' last='+self.ultrv.lastIssued);
                self._scheduleNextUvV5(now, issued, slots[0]);
                return callback(null, 0);
            }
            if (!items) {
                log.info('uv index v5 no data time='+slots[i]);
                return trySlot(i+1);
            }

            var results = self.convertUvItemsV5(items);
            log.info('uv index v5 time='+slots[i]+' issued='+issued+' items='+items.length+' days='+results.length);
            self.saveLifeIndex2('ultrv', results, function (err, savedCount) {
                if (err) {
                    return callback(err);
                }
                self.ultrv.lastIssued = issued;
                self._scheduleNextUvV5(now, issued, slots[0]);
                callback(null, savedCount);
            });
        });
    }

    trySlot(0);
    return this;
};

KmaIndexService.prototype.getPollenUrlV3 = function (indexName, time, pageNo, svcKey) {
    if (!POLLEN_OPERATIONS[indexName]) {
        throw new Error('Unknown pollen index '+indexName);
    }
    return POLLEN_V3_BASE + POLLEN_OPERATIONS[indexName] + '?serviceKey=' +
        this._encodeServiceKey(svcKey || this.serviceKey) + '&pageNo=' + pageNo +
        '&numOfRows=' + UV_V5_ROWS + '&dataType=JSON&areaNo=&time=' + time;
};

KmaIndexService.prototype.convertPollenItemsV3 = function (indexName, items) {
    if (!POLLEN_OPERATIONS[indexName]) {
        throw new Error('Unknown pollen index '+indexName);
    }
    var rows = [];
    items.forEach(function (item) {
        var issued = String(item.date);
        var areaNo = Number(item.areaNo);
        if (!/^\d{10}$/.test(issued) || !Number.isSafeInteger(areaNo)) {
            return;
        }
        // lifeIndexKma2 dates and its response reader use host-local calendar days.
        var day = kmaTimeLib.convertStringToDate(issued.slice(0, 8));
        if (!day) {
            return;
        }
        ['today', 'tomorrow', 'theDayAfterTomorrow'].forEach(function (field, offset) {
            var raw = item[field];
            if ((typeof raw !== 'string' && typeof raw !== 'number') ||
                    (typeof raw === 'string' && raw.trim() === '')) {
                return;
            }
            var index = Number(raw);
            if (!Number.isInteger(index) || index < 0 || index > 3) {
                return;
            }
            var date = new Date(day.getTime());
            date.setDate(date.getDate() + offset);
            rows.push({areaNo: areaNo, date: date, indexType: indexName,
                       index: index, lastUpdateDate: issued});
        });
    });
    return rows;
};

KmaIndexService.prototype._requestPollenPageV3 = function (indexName, time, pageNo, callback) {
    var self = this;
    if (!this.serviceKeyList.length) { return callback(new Error('No configured data.go.kr keys')); }
    var keyCount = this.serviceKeyList.length;
    var firstKey = Math.max(this.serviceKeyIndex, 0) % keyCount;
    var offset = 0;
    function attempt() {
        if (self.serviceKeyList.length) {
            self._useServiceKeyV5((firstKey + offset) % keyCount);
        }
        req(self.getPollenUrlV3(indexName, time, pageNo), {timeout: 30000, json: true},
            function (err, response, body) {
                if (err) {
                    return callback(err);
                }
                var parsed = self.parseUvIdxV5(body, 'pollen v3');
                if (!parsed.error && response.statusCode >= 400) {
                    parsed = {error: new Error('pollen v3 HTTP '+response.statusCode)};
                }
                if (parsed.error) {
                    if (rejection.isAuth(response.statusCode, parsed.error.returnCode) || rejection.isQuota(response.statusCode, parsed.error.returnCode)) {
                        parsed.error.isAuthError = true;
                    }
                    if (parsed.error.isAuthError && offset + 1 < keyCount) {
                        offset++;
                        return attempt();
                    }
                    if (parsed.error.isAuthError && self.serviceKeyList.length) {
                        self._useServiceKeyV5(firstKey);
                    }
                    parsed.error.message += ' '+indexName+' time='+time+' page='+pageNo;
                    return callback(parsed.error);
                }
                callback(null, parsed);
            });
    }
    attempt();
};

KmaIndexService.prototype._validatePollenPageV3 = function (indexName, page, expectedPage,
                                                            totalCount, issued, seenAreas) {
    if (!Number.isSafeInteger(totalCount) || totalCount <= 0 ||
            page.reportedTotalCount !== totalCount || page.pageNo !== expectedPage) {
        return new Error('pollen v3 inconsistent page metadata '+indexName+' page='+expectedPage);
    }
    var expectedRows = Math.min(UV_V5_ROWS, totalCount - (expectedPage-1)*UV_V5_ROWS);
    if (expectedRows <= 0 || page.items.length !== expectedRows) {
        return new Error('pollen v3 incomplete page '+indexName+' page='+expectedPage);
    }
    for (var i=0; i<page.items.length; i++) {
        var item = page.items[i];
        var areaNo = Number(item.areaNo);
        if (String(item.date) !== issued || !Number.isSafeInteger(areaNo) ||
                areaNo <= 0 || seenAreas.has(areaNo)) {
            return new Error('pollen v3 duplicate or inconsistent item '+indexName+
                             ' page='+expectedPage);
        }
        seenAreas.add(areaNo);
    }
    return null;
};

KmaIndexService.prototype.taskPollenV3 = function (indexName, now, callback) {
    var self = this;
    var kst = new Date(now.getTime() + 9*3600*1000);
    var month = kst.getUTCMonth();
    var season = this[indexName].offerMonth;
    if (month < season.start || month > season.end) {
        this[indexName].nextTime = new Date(now.getTime() + 24*3600*1000);
        return callback(null, 0);
    }
    // Query as of the current KST hour so a later publication can replace the
    // previous one during this season. Pagination keeps this exact request time.
    var time = kst.getUTCFullYear() + ('0'+(month+1)).slice(-2) +
        ('0'+kst.getUTCDate()).slice(-2) + ('0'+kst.getUTCHours()).slice(-2);
    this._requestPollenPageV3(indexName, time, 1, function (err, first) {
        if (err) {
            return callback(err);
        }
        if (first.noData) {
            self[indexName].nextTime = new Date(now.getTime() + 3*3600*1000);
            return callback(null, 0);
        }
        var issued = String(first.items[0].date);
        if (!/^\d{10}$/.test(issued)) {
            return callback(new Error('pollen v3 invalid issuance '+indexName));
        }
        var seenAreas = new Set();
        var firstErr = self._validatePollenPageV3(indexName, first, 1,
                                                  first.totalCount, issued, seenAreas);
        if (firstErr) {
            return callback(firstErr);
        }
        if (self[indexName].lastIssued && issued <= self[indexName].lastIssued) {
            self[indexName].nextTime = new Date(now.getTime() + 3*3600*1000);
            return callback(null, 0);
        }
        var pages = [];
        for (var pageNo=2; pageNo<=Math.ceil(first.totalCount / UV_V5_ROWS); pageNo++) {
            pages.push(pageNo);
        }
        async.mapSeries(pages, function (page, cb) {
            self._requestPollenPageV3(indexName, time, page, function (pageErr, parsed) {
                if (pageErr || parsed.noData) {
                    return cb(pageErr || new Error('pollen v3 missing page '+page));
                }
                var validationErr = self._validatePollenPageV3(indexName, parsed, page,
                                                               first.totalCount, issued, seenAreas);
                if (validationErr) {
                    return cb(validationErr);
                }
                cb(null, parsed.items);
            });
        }, function (pageErr, pageItems) {
            if (pageErr) {
                return callback(pageErr);
            }
            var items = first.items;
            pageItems.forEach(function (part) { items = items.concat(part); });
            var rows = self.convertPollenItemsV3(indexName, items);
            if (rows.length === 0) {
                self[indexName].nextTime = new Date(now.getTime() + 3*3600*1000);
                return callback(null, 0);
            }
            self.saveLifeIndex2(indexName, rows, function (saveErr, count) {
                if (saveErr) {
                    return callback(saveErr);
                }
                self[indexName].lastIssued = issued;
                self[indexName].nextTime = new Date(now.getTime() + 3*3600*1000);
                callback(null, count);
            });
        });
    });
    return this;
};

module.exports = KmaIndexService;
