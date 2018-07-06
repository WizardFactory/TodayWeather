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

var Town = require('../models/town');
var LifeIndexKma = require('../models/lifeIndexKma');
var LifeIndexKma2 = require('../models/kma/kma.lifeindex.model');

var kmaTimeLib = require('../lib/kmaTimeLib');

//var config = require('../config/config');

var DOMAIN_KMA_INDEX_SERVICE = "http://203.247.66.146";
var PATH_RETRIEVE_LIFE_INDEX_SERVICE = "iros/RetrieveLifeIndexService";
// var DOMAIN_KMA_INDEX_SERVICE = "http://newsky2.kma.go.kr";
// var PATH_RETRIEVE_LIFE_INDEX_SERVICE = "iros/RetrieveLifeIndexService3";

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

    this.fsn = {
        nextTime: null,
        offerMonth: {start: 0, end: 11}, //1~12
        updateTimeTable: [9, 21],   //kr 06, 18
        urlPath: 'getFsnLifeList'
    };

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

    this.ultrv = {
        nextTime: null,
        offerMonth: {start: 2, end: 10},
        updateTimeTable: [9, 21], //kr 6, 18
        urlPath: 'getUltrvLifeList'
    };

    //this.airpollution = {
    //    nextTime: null,
    //    offerMonth: {start: 10, end: 4},
    //    updateTimeTable: [3, 6, 9, 12, 15, 18, 21],   //per 3hours
    //    urlPath: 'getAirpollutionLifeList'
    //};
}

/**
 * #984 이슈 문제와, 차후 키가 늘어날 경우를 위해서 array처리함
 * 깔끔하게 만들어지는 형태가 아니라 아쉬움.
 * @param key
 * @param keyBox
 * @returns {KmaIndexService}
 */
KmaIndexService.prototype.setServiceKey = function(key, keyBox) {
    this.serviceKeyList.push(key);
    if (keyBox && keyBox.test_cert) {
        this.serviceKeyList.push(keyBox.test_cert);
    }
    this.serviceKeyIndex = 0;
    this.serviceKey = this.serviceKeyList[this.serviceKeyIndex];
    log.info('Set KEY!!');
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
    var lifeIndex = this[indexName];
    if (!svcKey) {
        svcKey = this.serviceKey;
    }

    var url = DOMAIN_KMA_INDEX_SERVICE + "/" + PATH_RETRIEVE_LIFE_INDEX_SERVICE;
    url += "/" + lifeIndex.urlPath;
    url += "?serviceKey="+svcKey;
    if (areaNo) {
        url += "&AreaNo="+areaNo;
    }
    url += "&_type=json";

    return url;
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
        return log.error("You have to set KEY first!");
    }

    var self = this;
    var list = ['ultrv', 'fsn'];

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
        return log.error("You have to set KEY first!");
    }

    //SensorytemLife
    //FrostbiteLife
    //WinterLife
    //RotLife
    //HeatLife
    //AirpollutionLife
    var list = ['ultrv', 'fsn'];
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
    this.setNextGetTime('fsn', new Date());
    this.setNextGetTime('ultrv', new Date());
    setTimeout(this.cbKmaIndexProcess, 3*1000, this); //start after 3secs
};


KmaIndexService.prototype.getLifeIndex2 = function (indexName, callback) {
    var url = this.getUrl(indexName, undefined, this.serviceKey);

    log.info(url);
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
                    log.error(err.message + "in insert DB(healthData)");
                    log.info(JSON.stringify(result));
                }
                callback();
            });
        },
        function (err, result) {
            callback(err, result.length);
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

module.exports = KmaIndexService;

