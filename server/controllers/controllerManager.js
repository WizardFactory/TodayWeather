/**
 * Created by Peter on 2015. 8. 26..
 */
"use strict";

var fs = require('fs');
var async = require('async');

var collectTown = require('../lib/collectTownForecast');
var town = require('../models/town');
var config = require('../config/config');
var convert = require('../utils/coordinate2xy');
var convertGeocode = require('../utils/convertGeocode');

var modelCurrent = require('../models/modelCurrent');
var modelShort = require('../models/modelShort');
var modelShortest = require('../models/modelShortest');
var modelMidForecast = require('../models/modelMidForecast');
var modelMidLand = require('../models/modelMidLand');
var modelMidSea = require('../models/modelMidSea');
var modelMidTemp = require('../models/modelMidTemp');

var midRssKmaRequester = new (require('../lib/midRssKmaRequester'))();
//var PastConditionGather = require('../lib/PastConditionGather');
var keco = new (require('../lib/kecoRequester.js'))();
var taskKmaIndexService = new (require('../lib/lifeIndexKmaRequester'))();

var awsCloudFront = require('../utils/awsCloudFront');

/*
    New DB Format
 */
var kmaTownCurrent = new (require('./kma/kma.town.current.controller.js'));
var kmaTownShort = new (require('./kma/kma.town.short.controller.js'));

/*********************/

function Manager(){
    var self = this;

    self.kmaTownCurrent = kmaTownCurrent;
    self.kmaTownShort = kmaTownShort;

    self.TIME_PERIOD = {
        TOWN_SHORT: (1000*60*60*3),
        TOWN_SHORTEST: (1000*60*60),
        TOWN_CURRENT: (1000*60*60),
        MID_FORECAST: (1000*60*60*12),
        MID_LAND: (1000*60*60*12),
        MID_TEMP: (1000*60*60*12),
        MID_SEA: (1000*60*60*12)
    };

    self.saveOnlyLastOne = true;
    self.MAX_SHORT_COUNT = 64;    //8days * 8times
    self.MAX_CURRENT_COUNT = 192; //8days * 24hours
    self.MAX_SHORTEST_COUNT = 192; //8days * 24 hours
    self.MAX_MID_COUNT = 20;

    self.asyncTasks = [];

    /****************************************************************************
     *   THIS IS FOR TEST.
     ****************************************************************************/
    //self.TIME_PERIOD.TOWN_SHORT = (1000*25);
    //self.TIME_PERIOD.TOWN_SHORTEST = (1000*10);
    //self.TIME_PERIOD.TOWN_CURRENT = (1000*10); //(1000*60*60)
    /****************************************************************************/

    self.makeRegIdTable();
}

Manager.prototype.getRegIdByTown = function(region, city, cb){
    var self = this;
    var i;

    city = city.slice(0,3);
    //log.info(self.codeTable);
    for(i=0 ; i<self.codeTable.length ; i++){
        if(self.codeTable[i].first === region){
            // 0~7번까지는 특별시 혹은 광역시, 세종특별자치시
            // city name이 없는 경우 일단 첫번째 매칭되는 시를 기준으로 보내주자..
            if(i<8 || city === ''){
                if(cb) {
                    cb(0, self.codeTable[i]);
                }
                return;
            }
            else {
                if(self.codeTable[i].second === city){
                    if(cb) {
                        cb(0, self.codeTable[i]);
                    }
                    return;
                }
            }
        }
    }

    if(cb){
        cb(new Error('Fail to find code table ' + region + city));
    }

    return self.codeList;
};

Manager.prototype.makeRegIdTable = function(){
    var self = this;

    self.codeTable = [];

    self.codeList = fs.readFileSync('./utils/data/region.csv').toString().split('\n');
    self.codeList.forEach(function(line){
        var codeItem = {
            first: '',
            second: '',
            regionName: '',
            pointNumber: '',
            cityCode : ''
        };
        line.split(',').forEach(function(item, i){
            if(i === 0){
                codeItem.first = item;
            }else if(i===1){
                codeItem.second = item;
            }else if(i===2){
                codeItem.regionName = item;
            }else if(i===3){
                codeItem.pointNumber = item;
            }else if(i===4){
                codeItem.cityCode = item;

                self.codeTable.push(JSON.parse(JSON.stringify(codeItem)));
            }
        });
    });

    log.info('code table count : ', self.codeTable.length);
};

Manager.prototype.getMatchedData = function(code, dataList){
    for(var i in dataList){
        if(code === dataList[i].regId){
            return dataList[i];
        }
    }
    return {};
};

Manager.prototype.leadingZeros = function(n, digits) {
    var zero = '';
    n = n.toString();

    if(n.length < digits) {
        for(var i = 0; i < digits - n.length; i++){
            zero += '0';
        }
    }
    return zero + n;
};

Manager.prototype.getWorldTime = function(tzOffset) {
    var self = this;
    var now = new Date();
    var result;
    var tz = now.getTime() + (now.getTimezoneOffset() * 60000) + (tzOffset * 3600000);
    now.setTime(tz);

    result =
        self.leadingZeros(now.getFullYear(), 4) +
        self.leadingZeros(now.getMonth() + 1, 2) +
        self.leadingZeros(now.getDate(), 2) +
        self.leadingZeros(now.getHours(), 2) +
        self.leadingZeros(now.getMinutes(), 2);

    return result;
};

/*
*   It's to compare the date object.
*           - If the oldDate is future time, it would return -1
*           - If the newDate is future time, it would return 1
*           - If two dates object is same, it would return 0
*   @oldDate
*   @newDAte
*/
Manager.prototype.compareDate = function(oldDate, newDate){
    if((oldDate.date === newDate.date) && (oldDate.time === newDate.time)){
        return 0;
    }

    if(oldDate.date > newDate.date){
        return -1;
    }

    if(oldDate.date < newDate.date){
        return 1;
    }
    if((oldDate.date === newDate.date) && (oldDate.time < newDate.time)){
        return 1;
    }

    if((oldDate.date === newDate.date) && (oldDate.time > newDate.time)){
        return -1;
    }

    log.error('something wrong date!!!', oldDate, newDate);
    return 0;
};

/*
 *   save short data to DB.
 *   @param newData - only one town's data list.
 */
Manager.prototype.saveShort = function(newData, callback){
    var self = this;

    //log.info('S> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    var pubDate = newData[0].pubDate;
    log.verbose('S> pubDate :', pubDate);
    //log.info('S> db find :', coord);
    try{
        modelShort.find({mCoord: coord}, function(err, list){
            if(err){
                log.error('S> fail to find db item :', coord);
                if(callback){
                    callback(err);
                }
                return;
            }

            if(list.length === 0){
                var newItem = new modelShort({mCoord: coord, pubDate: pubDate, shortData: newData});
                newItem.save(function(err){
                    if(err){
                        log.error('S> fail to save to DB :', coord);
                    }
                    if(callback){
                        callback(err);
                    }
                });
                //log.info('S> add new Item : ', newData);
                return;
            }

            //log.info('found db item : ', list.length);

            list.forEach(function(dbShortList){
                //log.info('S> coord :', dbShortList.mCoord.mx, dbShortList.mCoord.my);
                //if (self.saveOnlyLastOne) {
                //    dbShortList.shortData = newData;
                //}
                //else
                {
                    newData.forEach(function(newItem){
                        var isNew = 1;
                        //log.info('S> newItem : ', newItem);
                        //log.info('S> dbshortlist count : ', dbShortList.shortData.length);
                        //for(var i in dbShortList.shortData){
                        for(var i=0 ; i < dbShortList.shortData.length ; i++){
                            //log.info(i,'>', dbShortList.shortData[i].date, '|', dbShortList.shortData[i].time);
                            var comparedDate = self.compareDate(
                                {date:dbShortList.shortData[i].date, time:dbShortList.shortData[i].time},
                                {date:newItem.date, time:newItem.time}
                            );
                            if(comparedDate === 0){
                                //log.info('S> over write :', newItem);
                                //dbShortList.shortData[i] = newItem;
                                isNew = 0;
                                if (newItem.pop !== -1) {
                                    dbShortList.shortData[i].pop = newItem.pop;
                                }
                                else {
                                    log.warn(new Error("new short("+newItem.date+newItem.time+") data is invalid!"));
                                }
                                if (newItem.pty !== -1) {
                                    dbShortList.shortData[i].pty = newItem.pty;
                                }
                                if (newItem.r06 !== -1) {
                                    dbShortList.shortData[i].r06 = newItem.r06;
                                }
                                if (newItem.reh !== -1) {
                                    dbShortList.shortData[i].reh = newItem.reh;
                                }
                                if (newItem.s06 !== -1) {
                                    dbShortList.shortData[i].s06 = newItem.s06;
                                }
                                if (newItem.sky !== -1) {
                                    dbShortList.shortData[i].sky = newItem.sky;
                                }
                                if (newItem.t3h !== -50) {
                                    dbShortList.shortData[i].t3h = newItem.t3h;
                                }
                                if (newItem.tmn !== -50) {
                                    dbShortList.shortData[i].tmn = newItem.tmn;
                                }
                                if (newItem.tmx !== -50) {
                                    dbShortList.shortData[i].tmx = newItem.tmx;
                                }
                                if (newItem.uuu !== -100) {
                                    dbShortList.shortData[i].uuu = newItem.uuu;
                                }
                                if (newItem.vvv !== -100) {
                                    dbShortList.shortData[i].vvv = newItem.vvv;
                                }
                                if (newItem.wav !== -1) {
                                    dbShortList.shortData[i].wav = newItem.wav;
                                }
                                if (newItem.vec !== -1) {
                                    dbShortList.shortData[i].vec = newItem.vec;
                                }
                                if (newItem.wsd !== -1) {
                                    dbShortList.shortData[i].wsd = newItem.wsd;
                                }
                                break;
                            }
                        }

                        if(isNew){
                            //log.info('push data :', newItem);
                            dbShortList.shortData.push(newItem);
                        }
                    });

                    dbShortList.shortData.sort(function(a, b){
                        if(a.date > b.date){
                            return 1;
                        }
                        if(a.date < b.date){
                            return -1;
                        }
                        if(a.date === b.date && a.time > b.time){
                            return 1;
                        }
                        if(a.date === b.date && a.time < b.time){
                            return -1;
                        }
                        return 0;
                    });

                    if(dbShortList.shortData.length > self.MAX_SHORT_COUNT){
                        dbShortList.shortData = dbShortList.shortData.slice((dbShortList.shortData.length - self.MAX_SHORT_COUNT));
                    }
                }

                dbShortList.pubDate = pubDate;
                //log.info(dbShortList.shortData);
                dbShortList.save(function(err){
                    if(err){
                        log.error('S> fail to save : ', coord);
                    }
                    if(callback){
                        callback(err);
                    }
                });
            });
        });
    }
    catch(e){
        log.error('S> error!!! saveShort');
        if(callback){
            callback(e);
        }
    }
    return this;
};


/*
 *   save current data to DB.
 *   @param newData - only one town's data list.
 */
Manager.prototype.saveCurrent = function(newData, callback){
    var self = this;
    var invalid = false;

    //log.info('C> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    var pubDate = newData[0].pubDate;
    log.verbose('C> pubDate :', pubDate);
    //log.info('C> db find :', coord);
    try{
        modelCurrent.find({mCoord: coord}, function(err, list){
            if(err){
                log.error('C> fail to find db item :', coord);
                if (callback) {
                    callback(err);
                }
                return;
            }

            if(list.length === 0){
                var newItem = new modelCurrent({mCoord: coord, pubDate: pubDate, currentData: newData});
                newItem.save(function(err){
                    if(err){
                        log.error('C> fail to save to DB :', coord);
                    }
                    if(callback){
                        callback(err);
                    }
                });
                //log.info('C> add new Item : ', newData);
                return;
            }

            //log.info('C> found db item : ', list.length);

            list.forEach(function(dbCurrentList){
                //log.info('C> coord :', dbCurrentList.mCoord.mx, dbCurrentList.mCoord.my);
                //if (self.saveOnlyLastOne) {
                //    dbCurrentList.currentData = newData;
                //}
                //else
                {
                    var checkInvalid = false;
                    newData.forEach(function(newItem){
                        var isNew = 1;
                        //log.info('C> newItem : ', newItem);
                        //log.info('C> dbCurrentList count : ', dbCurrentList.currentData.length);
                        //for(var i in dbCurrentList.currentData){
                        for(var i=0 ; i < dbCurrentList.currentData.length ; i++){
                            //log.info(i,'>', dbCurrentList.currentData[i].date, '|', dbCurrentList.currentData[i].time);
                            var comparedDate = self.compareDate(
                                {date:dbCurrentList.currentData[i].date, time:dbCurrentList.currentData[i].time},
                                {date:newItem.date, time:newItem.time}
                            );
                            if(comparedDate === 0){
                                //log.info('C> over write :', newItem);
                                if (newItem.t1h !== -50) {
                                    dbCurrentList.currentData[i].t1h = newItem.t1h;
                                }
                                else {
                                    log.warn(new Error("new current("+newItem.date+newItem.time+") data is invalid!"));
                                }
                                if (newItem.rn1 !== -1) {
                                    dbCurrentList.currentData[i].rn1 = newItem.rn1;
                                }
                                if (newItem.sky !== -1) {
                                    dbCurrentList.currentData[i].sky = newItem.sky;
                                }
                                if (newItem.uuu !== -100) {
                                    dbCurrentList.currentData[i].uuu = newItem.uuu;
                                }
                                if (newItem.vvv !== -100) {
                                    dbCurrentList.currentData[i].vvv = newItem.vvv;
                                }
                                if (newItem.reh !== -1) {
                                    dbCurrentList.currentData[i].reh = newItem.reh;
                                }
                                if (newItem.pty !== -1) {
                                    dbCurrentList.currentData[i].pty = newItem.pty;
                                }
                                if (newItem.lgt !== -1) {
                                    dbCurrentList.currentData[i].lgt = newItem.lgt;
                                }
                                if (newItem.vec !== -1) {
                                    dbCurrentList.currentData[i].vec = newItem.vec;
                                }
                                if (newItem.wsd !== -1) {
                                    dbCurrentList.currentData[i].wsd = newItem.wsd;
                                }
                                isNew = 0;
                                break;
                            }
                        }

                        if(isNew){
                            //although newItem is invaild, it is saved.
                            //log.info('C> push data :', newItem);
                            dbCurrentList.currentData.push(newItem);
                            checkInvalid = true;    // 추가되는 데이터가 있는 경우에만 기존데이터의 t1h데이터를 체크한다
                        }
                    });

                    dbCurrentList.currentData.sort(function(a, b){
                        if(a.date > b.date){
                            return 1;
                        }
                        if(a.date < b.date){
                            return -1;
                        }
                        if(a.date === b.date && a.time > b.time){
                            return 1;
                        }
                        if(a.date === b.date && a.time < b.time){
                            return -1;
                        }
                        return 0;
                    });

                    if(dbCurrentList.currentData.length > self.MAX_CURRENT_COUNT){
                        dbCurrentList.currentData = dbCurrentList.currentData.slice((dbCurrentList.currentData.length - self.MAX_CURRENT_COUNT));
                    }

                    // check invalid t1h
                    if(checkInvalid){
                        invalid = self._checkInvalidt1h(dbCurrentList.currentData);
                    }
                }

                //skip to update pubDate when pastCondition gather
                if (pubDate !== '') {
                    dbCurrentList.pubDate = pubDate;
                }
                //log.info(dbCurrentList.currentData);
                dbCurrentList.save(function(err){
                    if(err){
                        log.error('C> fail to save');
                    }
                    if(callback){
                        callback(err, invalid);
                    }
                });
            });
        });
    }
    catch(e){
        if(callback){
            callback(e);
        }
        else {
            log.error(e);
        }
    }

    return this;
};


Manager.prototype._checkInvalidt1h = function(currentData){
    var beforePreIndex = currentData.length - 3;  // 두시간전 index
    var preIndex = currentData.length - 2;        // 한시간전 index
    var curIndex = currentData.length - 1;        // 현재 데이터 index

    if(currentData.length > 1){
        var pret1h = currentData[preIndex].t1h;        // 한시간전
        var preDateMonth = parseInt(currentData[preIndex].date.slice(4, 6));
        var startMonth = 4;
        var endMonth = 9;

        // my가 140이 넘는 지역(철원, 포천시 등)은 4월에도 0도 이하의 기온이 나타나는 경우가 있기 때문에 시작 월을 3월로 설정
        if(parseInt(currentData[preIndex].my) >= 140){
            startMonth = 3;
        }
        log.info('C> Month(', preDateMonth, '), StartMonth(', startMonth, '), EndMonth(', endMonth, ')');

        // 4월에서 9월 사이에 t1h가 0.0이 나타나는 경우는 없기 때문에 이 경우 invalid data로 판단한다
        // 단 my가 140이 넘는 북쪽지역의 경우 4월까지 0도가 나타나는 경우가 있기 때문에 시작 월이 3월로 조정됨.
        if(pret1h === 0.0 && (preDateMonth >= startMonth && preDateMonth <= endMonth )){
            log.info('C> 1. Found invalid data : ', currentData[preIndex].toString());
            return true;
        }
    }

    if(currentData.length > 2){
        var limitedVector = 4;
        log.info('C> Pre data : ', currentData[preIndex].toString());

        // 한시간 전의 t1h가 0일 경우 t1h가 invalid일 가능성이 있으니 check해야함
        if(currentData[preIndex].t1h === 0.0){
            // 한시간 전의 t1h를 기준으로 2시간 전과 현재 데이터 간의 vector값을 구한다
            var vectorFromPast = Math.abs(currentData[beforePreIndex].t1h);
            var vectorFromCur = Math.abs(currentData[curIndex].t1h);
            if(currentData[curIndex].t1h === 0.0){
                // 지금 받은 current data의 t1h가 0.0이기 때문에 이것 또한 invalid data의 가능성이 있다
                // 따라서 이경우 두시간 전의 데이터만 이용
                if(vectorFromPast > limitedVector){
                    // 한시간 전의 t1h가 0인데, 2시간전 t1h데이터는 -5도 이하 혹은 5도 이상의 기온이다.
                    // 따라서 한시간 전의 t1h의 데이터가 invalid한 데이터일 가능성이 높기 때문에
                    // 한시간전의 current data를 다시 받을 수 있도록 설정한다
                    log.info('C> 2. Found invalid data : ', currentData[preIndex].toString());
                    return true;
                }
            }else{
                if(vectorFromPast > limitedVector && vectorFromCur > limitedVector){
                    // 두시간 전의 t1h와 지금 받은 현재의 t1h 모두를 이용
                    // 한시간전의 t1h가 0.0이고 2시간전 t1h와 지금 받은 현재의 t1h데이터가 -5도 이하 혹은 5도 이상일때
                    // 온도의 차이가 너무 크기 때문에 invalid data의 가능성이 높다.
                    // 한시간전의 current data를 다시 받을 수 있도록 설정
                    log.info('C> 3. Found invalid data : ', currentData[preIndex].toString());
                    return true;
                }
            }
        }
    }

    return false;
};


/*
 *   save shortest data to DB.
 *   @param newData - only one town's data list.
 */
Manager.prototype.saveShortest = function(newData, callback){
    var self = this;

    //log.info('ST> save :', newData);
    try{
        var coord = {
            mx: newData[0].mx,
            my: newData[0].my
        };
        //log.info('ST> db find :', coord);

        var pubDate = newData[0].pubDate;
        log.verbose('ST> pubDate :', pubDate);

        modelShortest.find({mCoord: coord}, function(err, list){
            if(err){
                log.error('ST> fail to find db item');
                if (callback) {
                    callback(err);
                }
                return;
            }

            if(list.length === 0){
                var newItem = new modelShortest({mCoord: coord, pubDate: pubDate, shortestData: newData});
                newItem.save(function(err){
                    if(err){
                        log.error('ST> fail to save to DB :', coord);
                    }
                    if (callback) {
                        callback(err);
                    }
                });

                //log.info('ST> add new Item : ', newData);
                return;
            }

            log.silly('ST> found db item : ', list.length);

            list.forEach(function(dbShortestList){
                //log.info('ST> coord :', dbShortestList.mCoord.mx, dbShortestList.mCoord.my);
                //if (self.saveOnlyLastOne) {
                //    dbShortestList.shortestData = newData;
                //}
                //else
                {
                    newData.forEach(function(newItem){
                        var isNew = 1;
                        //log.info('ST> newItem : ', newItem);
                        //log.info('ST> dbShortestList count : ', dbShortestList.shortestData.length);
                        //for(var i in dbShortestList.shortestData){
                        for(var i=0 ; i < dbShortestList.shortestData.length ; i++){
                            //log.info(i,'>', dbShortestList.shortestData[i].date, '|', dbShortestList.shortestData[i].time);
                            var comparedDate = self.compareDate(
                                {date:dbShortestList.shortestData[i].date, time:dbShortestList.shortestData[i].time},
                                {date:newItem.date, time:newItem.time}
                            );
                            if(comparedDate === 0) {
                                //log.info('ST> over write :', newItem);
                                if (newItem.pty !== -1) {
                                    dbShortestList.shortestData[i].pty = newItem.pty;
                                }
                                else {
                                    log.warn(new Error("new shortest("+newItem.date+newItem.time+") data is invalid!"));
                                }
                                if (newItem.rn1 !== -1) {
                                    dbShortestList.shortestData[i].rn1 = newItem.rn1;
                                }
                                if (newItem.sky !== -1) {
                                    dbShortestList.shortestData[i].sky = newItem.sky;
                                }
                                if (newItem.lgt !== -1) {
                                    dbShortestList.shortestData[i].lgt = newItem.lgt;
                                }
                                if (newItem.t1h !== -50) {
                                    dbShortestList.shortestData[i].t1h = newItem.t1h;
                                }
                                if (newItem.reh !== -1) {
                                    dbShortestList.shortestData[i].reh = newItem.reh;
                                }
                                if (newItem.uuu !== -100) {
                                    dbShortestList.shortestData[i].uuu = newItem.uuu;
                                }
                                if (newItem.vvv !== -100) {
                                    dbShortestList.shortestData[i].vvv = newItem.vvv;
                                }
                                if (newItem.vec !== -1) {
                                    dbShortestList.shortestData[i].vec = newItem.vec;
                                }
                                if (newItem.wsd !== -1) {
                                    dbShortestList.shortestData[i].wsd = newItem.wsd;
                                }
                                isNew = 0;
                                break;
                            }
                        }

                        if(isNew){
                            //log.info('ST> push data :', newItem);
                            dbShortestList.shortestData.push(newItem);
                        }
                    });

                    dbShortestList.shortestData.sort(function(a, b){
                        if(a.date > b.date){
                            return 1;
                        }
                        if(a.date < b.date){
                            return -1;
                        }
                        if(a.date === b.date && a.time > b.time){
                            return 1;
                        }
                        if(a.date === b.date && a.time < b.time){
                            return -1;
                        }
                        return 0;
                    });

                    if(dbShortestList.shortestData.length > self.MAX_SHORTEST_COUNT){
                        dbShortestList.shortestData = dbShortestList.shortestData.slice((dbShortestList.shortestData.length - self.MAX_SHORTEST_COUNT));
                    }
                }

                dbShortestList.pubDate = pubDate;
                //log.info(dbShortestList.shortestData);
                dbShortestList.save(function(err){
                    if(err){
                        log.error('ST> fail to save');
                    }
                    if (callback) {
                        callback(err);
                    }
                });
            });
        });
    }
    catch(e){
        if (callback) {
            callback(e);
        }
        else {
            log.error(e);
        }
    }
    return this;
};

/*
 *   return duplicate data from src to des.
 *   @param src
 *   @param des
 *
 *   in this function, it doesn't copy the data that is not known by us such as _id that is only used and made by moongDB.
 */
Manager.prototype.dupMid = function(src, des){
    var forecastString = ['cnt', 'wfsv'];
    var tempString = ['taMin3', 'taMax3', 'taMin4', 'taMax4', 'taMin5', 'taMax5', 'taMin6', 'taMax6',
        'taMin7', 'taMax7', 'taMin8', 'taMax8', 'taMin9', 'taMax9', 'taMin10', 'taMax10'];
    var seaString = ['wf3Am', 'wf3Pm', 'wf4Am', 'wf4Pm', 'wf5Am', 'wf5Pm', 'wf6Am', 'wf6Pm',
        'wf7Am', 'wf7Pm', 'wf8', 'wf9', 'wf10',
        'wh3AAm', 'wh3APm', 'wh3BAm', 'wh3BPm', 'wh4AAm', 'wh4APm', 'wh4BAm', 'wh4BPm',
        'wh5AAm', 'wh5APm', 'wh5BAm', 'wh5BPm', 'wh6AAm', 'wh6APm', 'wh6BAm', 'wh6BPm',
        'wh7AAm', 'wh7APm', 'wh7BAm', 'wh7BPm', 'wh8A', 'wh8B', 'wh9A', 'wh9B', 'wh10A', 'wh10B'];
    var landString = ['wf3Am', 'wf3Pm', 'wf4Am', 'wf4Pm', 'wf5Am', 'wf5Pm',
        'wf6Am', 'wf6Pm', 'wf7Am', 'wf7Pm', 'wf8', 'wf9', 'wf10'];
    var stringList = [];

    if(src.wfsv !== undefined){
        // forecast
        stringList = forecastString;
    } else if(src.taMax10 !== undefined){
        // temp
        stringList = tempString;
    } else if(src.wh10B !== undefined){
        // sea
        stringList = seaString;
    } else if(src.wf10 !== undefined){
        // land
        stringList = landString;
    } else {
        log.error(new Error('It is not known object'));
        log.error(src);
        return des;
    }

    stringList.forEach(function(string){
        des[string] = src[string];
    });

    return des;
};

/*
 *   save MidForecast data to DB.
 *   @param db
 *   @param newData
 */
Manager.prototype.saveMid = function(db, newData, callback){
    var self = this;
    var regId = '';
    var meta = {};

    if(newData.pointNumber !== undefined){
        regId = newData.pointNumber;
    }else{
        regId = newData.regId;
    }

    meta.method = 'saveMid';
    meta.regId = 'regId';
    meta.data = newData;

    var pubDate = newData.pubDate;
    log.verbose('M> pubDate :', pubDate);

    //log.info(newData);
    try{
        // find data from DB
        db.find({regId: regId}, function(err, list){
            if(err){
                log.error('M> fail to find db item :', regId);
                if (callback) {
                    callback(err);
                }
                return;
            }

            // If there is no data, it would make the new data list.
            if(list.length === 0){
                var newItem = new db({regId: regId, pubDate: pubDate, data: [newData]});
                newItem.save(function(err){
                    if(err){
                        log.error('M> fail to save to DB :', regId);
                    }
                    if (callback) {
                        callback(err);
                    }
                });

                //log.info('M> add new Item : ', newData);
                return;
            }

            if (list.length > 1) {
               log.error("DB has two data about regid=",regId);
            }

            list.forEach(function(dbMidList, index){
                if (self.saveOnlyLastOne) {
                    dbMidList.data = [newData];
                }
                else {
                    var isNew = 1;
                    for(var i=0 ; i < dbMidList.data.length ; i++){
                        var comparedDate = self.compareDate(
                            {date:dbMidList.data[i].date, time:dbMidList.data[i].time},
                            {date:newData.date, time:newData.time}
                        );

                        // If there is the same date in the DB, it would be replaced by new data.
                        if(comparedDate === 0){
                            // over write
                            dbMidList.data[i] = self.dupMid(newData, dbMidList.data[i]);
                            //log.info('overwrite :', newData);
                            isNew = 0;
                            break;
                        }
                    }

                    if(isNew){
                        //log.info('M> push data :', newItem);
                        dbMidList.data.push(newData);
                    }

                    dbMidList.data.sort(function(a, b){
                        if(a.date > b.date){
                            return 1;
                        }
                        if(a.date < b.date){
                            return -1;
                        }
                        if(a.date === b.date && a.time > b.time){
                            return 1;
                        }
                        if(a.date === b.date && a.time < b.time){
                            return -1;
                        }
                        return 0;
                    });

                    if(dbMidList.data.length > self.MAX_MID_COUNT){
                        dbMidList.data = dbMidList.data.slice((dbMidList.data.length - self.MAX_MID_COUNT));
                    }
                }

                dbMidList.pubDate = pubDate;
                dbMidList.save(function(err){
                    if(err){
                        log.error('M> fail to save');
                    }
                    if (callback && index === 0) {
                        callback(err);
                    }
                });
            });
        });
    }
    catch(e){
        if (callback) {
            callback(e);
        }
        else {
            log.error(e);
        }
    }
    return this;
};

Manager.prototype.saveMidForecast = function(newData, callback) {
    this.saveMid(modelMidForecast, newData[0], callback);
    return this;
};

Manager.prototype.saveMidLand = function(newData, callback) {
    this.saveMid(modelMidLand, newData[0], callback);
    return this;
};

Manager.prototype.saveMidTemp = function(newData, callback) {
    this.saveMid(modelMidTemp, newData[0], callback);
    return this;
};

Manager.prototype.saveMidSea = function(newData, callback) {
    this.saveMid(modelMidSea, newData[0], callback);
    return this;
};

Manager.prototype._recursiveRequestData = function(srcList, dataType, key, dateString, retryCount, invalidDataList, callback) {
    var self = this;
    var failedList = [];
    var invalidList = [];
    var collectInfo = new collectTown();
    var dataTypeName = self.getDataTypeName(dataType);
    var err;

    if(invalidDataList != undefined && invalidDataList.length > 0){
        invalidList = JSON.parse(JSON.stringify(invalidDataList));
    }

    if (!retryCount) {
        err = new Error("retryCount is zero for request DATA : " + dataTypeName);
        if (callback) {
            callback(err);
        }
        else {
            log.error(err);
        }
        return this;
    }

    if (srcList.length) {
        log.info(dataTypeName, 'start request data : ', srcList.length);
    }
    else {
        err = new Error(dataTypeName + ' srcList is not array or empty');
        if (callback) {
            callback(err);
        }
        else {
            log.error(err);
        }
        return this;
    }

    collectInfo.requestData(srcList, dataType, key, dateString.date, dateString.time, function(err, dataList) {
        if (err) {
            log.verbose(dataTypeName, " It has items rcvFailed ");
            log.verbose(err);
        }
        log.info(dataTypeName, 'data receive completed : ', dataList.length);

        //log.info(JSON.stringify(dataList));
        //log.info(dataList[0]);

        async.mapSeries(dataList,
            function(item, cb) {
                if (item.isCompleted) {
                    self.getSaveFunc(dataType).call(self, item.data, function (err, invalid) {
                        if(invalid != undefined && invalid == true){
                            if(invalidList.indexOf(item.mCoord) === -1){
                                log.info('C> Found invalid t1h', item.mCoord);
                                invalidList.push(item.mCoord);
                            }
                        }
                        cb(err);
                    });
                }
                else {
                    log.silly(item);
                    log.verbose(dataTypeName, " request retry mx:",item.mCoord.mx,' my:',item.mCoord.my);
                    failedList.push(item.mCoord);
                    //this index was not rcvData
                    cb();
                }
            },
            function (err, results) {
                log.info(dataTypeName + ' saved data');
                if (err) {
                    log.error(err);
                }

                if (failedList.length) {
                    return self._recursiveRequestData(failedList, dataType, key, dateString, --retryCount, invalidList, callback);
                }

                if(invalidList.length){
                    var adjustedDateString = self.getShortestQueryTime(8);
                    return self._recursiveRequestData(invalidList, dataType, key, adjustedDateString, --retryCount, undefined, callback);
                }
                log.info('received All ', dataTypeName, ' of ', dateString);
                if (callback) {
                    callback(err, invalidList);
                }
            });
        //log.info('ST> save OK');
    });

    return this;
};

Manager.prototype._recursiveRequestDataByBaseTimList = function(dataType, key, mCoord, baseTimeList, retryCount, callback) {
    var self = this;
    var failedList = [];
    var collectInfo = new collectTown();
    var dataTypeName = self.getDataTypeName(dataType);

    if (!retryCount) {
        var err = new Error("retryCount is zero for request DATA : ", dataTypeName);
        if (callback) {
            callback(err);
        }
        else {
            log.error(err);
        }
        return this;
    }

    collectInfo.requestDataByBaseTimeList(mCoord, dataType, key, baseTimeList, function(err, dataList) {
        if (err) {
            log.verbose(dataTypeName, " It has items rcvFailed ");
            log.verbose(err);
        }
        log.info(dataTypeName, 'data receive completed : ', dataList.length);

        async.mapSeries(dataList,
            function(item, cb) {
                if (item.isCompleted) {
                    //will not update pubDate
                    item.data[0].pubDate = '';
                    self.getSaveFunc(dataType).call(self, item.data, function (err) {
                        if (err) {
                            log.error(err);
                        }
                        cb(err, item);
                    });
                }
                else {
                    log.silly(item);
                    log.verbose(dataTypeName, " request retry date:",item.options.date,' time:',item.options.time);
                    var baseTime = {date: item.options.date, time: item.options.time};
                    failedList.push(baseTime);
                    //this index was not rcvData
                    cb(undefined, item);
                }
            },
            function (err, results) {
                log.info(dataTypeName + ' saved data');
                if (err) {
                    log.error(err);
                }
                log.info(dataTypeName + ' failedList='+failedList.length);
                if (failedList.length) {
                    return self._recursiveRequestDataByBaseTimList(dataType, key, mCoord, failedList, --retryCount, callback);
                }
                log.info('received All ', dataTypeName, ' of baseTimes=', baseTimeList.length);
                if (callback) {
                    callback(err, results);
                }
            });
    });
};

Manager.prototype.requestDataByUpdateList = function (dataType, key, updateList, retryCount, callback) {
    var self = this;
    var dataTypeName = self.getDataTypeName(dataType);

    async.mapLimit(updateList, 20,
        function(updateObject, cb){
            log.info(updateObject);
            self._recursiveRequestDataByBaseTimList(dataType, key, updateObject.mCoord, updateObject.baseTimeList, retryCount, function(err, result){
                log.info(dataTypeName+' '+JSON.stringify(updateObject.mCoord)+' was updated counts='+updateObject.baseTimeList.length);
                if (err) {
                    log.error(err);
                }
                //unless previous item was failed, continues next item
                cb();
            });
        },
        function (err, results) {
            log.info('Finished '+dataTypeName+' requests='+updateList.length);
            if (callback) {
                callback(err, results);
            }
            else if (err) {
                log.error(err);
            }
        });

    return this;
};

Manager.prototype._checkPubDate = function(model, srcList, dateString, callback) {
    model.find(null, {_id: 0, mCoord: 1, regId: 1, pubDate: 1}).lean().exec(function(err, modelList) {
        if (err) {
            return callback(err);
        }
        try {
            /* collect mCoord that's not updated when baseDate+baseTime */
            srcList = srcList.filter(function (src) {
                var data;
                for (var i = 0; i < modelList.length; i++) {

                    //for short, shortest, current
                    if (src.hasOwnProperty('mx')) {
                        if (modelList[i].mCoord.mx === src.mx && modelList[i].mCoord.my === src.my) {
                            data = modelList[i];
                            break;
                        }
                    }
                    else if (src.hasOwnProperty('code')) {
                        if (modelList[i].regId === src.code) {
                            data = modelList[i];
                            break;
                        }
                    }
                }

                if (data && data.pubDate) {
                    if (data.pubDate === dateString.date + dateString.time) {
                        log.debug('src:'+JSON.stringify(src)+', index:'+i+' was updated pubDate=' + data.pubDate);
                        return false;
                    }
                    else {
                        log.silly('It need to update');
                    }
                }
                else {
                    log.debug('Fail to find src :'+JSON.stringify(src)+' it maybe new');
                }
                return true;
            });
        }
        catch (e) {
            return callback(e);
        }

        callback(err, srcList);
    });
    return this;
};

Manager.prototype.getShortQueryTime = function (baseTime) {
    var self = this;
    var currentDate = self.getWorldTime(baseTime);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };
    var time = currentDate.slice(8, 12);

    /*
     * The server is only responsed with there hours 2, 5, 8, 11, 14, 17, 20, 23
     */
    if(parseInt(time) < 210){
        var temp = self.getWorldTime(baseTime - 24);
        dateString.date = temp.slice(0,8);
        dateString.time = '2300';
    }
    else if(parseInt(time) < 510) {
        dateString.time = '0200';
    }
    else if(parseInt(time) < 810){
        dateString.time = '0500';
    }
    else if(parseInt(time) < 1110){
        dateString.time = '0800';
    }
    else if(parseInt(time) < 1410){
        dateString.time = '1100';
    }
    else if(parseInt(time) < 1710){
        dateString.time = '1400';
    }
    else if(parseInt(time) < 2010){
        dateString.time = '1700';
    }
    else if(parseInt(time) < 2310){
        dateString.time = '2000';
    }
    else if(parseInt(time) >= 2310){
        dateString.time = '2300';
    }
    else{
        log.error('unknown TimeString');
    }

    return dateString;
};

Manager.prototype.getShortestQueryTime = function (baseTime) {
    var self = this;
    var currentDate = self.getWorldTime(baseTime);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };

    var hour = currentDate.slice(8,10);
    var minute = currentDate.slice(10,12);

    //log.info(currentDate);
    //log.info(hour, minute);

    if(parseInt(minute) < 45) {
        currentDate = self.getWorldTime(+8);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '30';
    }
    else{
        dateString.time = hour + '30';
    }

    return dateString;
};

Manager.prototype.getCurrentQueryTime = function (baseTime) {
    var self = this;
    var currentDate = self.getWorldTime(baseTime);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    // 아직 발표 전 시간 대라면 1시간을 뺀 시간을 가져온다.
    if(parseInt(currentDate.slice(10,12)) < 40) {
        currentDate = self.getWorldTime(baseTime - 1);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '00'
    }

    return dateString;
};

Manager.prototype.getTownShortData = function(baseTime, key, callback){
    var self = this;
    var meta = {};
    meta.fName = 'getTownShortData';
    //var testListTownDb = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

    var dateString = self.getShortQueryTime(baseTime);

    log.info('S> +++ GET SHORT INFO : ', dateString);

    town.getCoord(function(err, listTownDb){
        if(err){
            if(callback){
                callback(err);
            }
            else {
                log.error(err);
            }
            return this;
        }

        var checkPubDate = self._checkPubDate;
        if(config.db.version === '2.0'){
            checkPubDate = self.kmaTownShort.checkPubDate;
        }
        checkPubDate(modelShort, listTownDb, dateString, function (err, srcList) {
            if (err) {
                if (callback) {
                    callback(err);
                }
                else {
                    log.error(err);
                }
                return;
            }
            if (srcList.length === 0) {
                log.info('S> All data was already updated');
                if (callback) {
                    callback(undefined, []);
                }
                return;
            }
            else {
                log.info('S> srcList length=', srcList.length);
            }

            self._recursiveRequestData(srcList, self.DATA_TYPE.TOWN_SHORT, key, dateString, 20, undefined, function (err, results) {
                log.info('S> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err)  {
                    return log.error(err);
                }
            });
        });
        return this;
    });

    return this;
};

Manager.prototype.getTownShortestData = function(baseTime, key, callback){
    var self = this;

    var dateString = self.getShortestQueryTime(baseTime);

    log.info('ST> +++ GET SHORTEST INFO : ', dateString);

    /***************************************************/

    town.getCoord(function(err, listTownDb){
        if(err){
            if (callback) {
                callback(err);
            }
            else {
                log.error(err);
            }
            return this;
        }
        self._checkPubDate(modelShortest, listTownDb, dateString, function (err, srcList) {
            if (err) {
                if (callback) {
                    callback(err);
                }
                else {
                    log.error(err);
                }
                return;
            }
            if (srcList.length === 0) {
                log.info('ST> All shortest was already updated');
                if (callback) {
                    callback(undefined, []);
                }
                return;
            }
            else {
                log.info('ST> srcList',srcList.length);
            }

            //log.info('ST> +++ SHORTEST COORD LIST : ', listTownDb.length);
            self._recursiveRequestData(srcList, self.DATA_TYPE.TOWN_SHORTEST, key, dateString, 20, undefined, function (err, results) {
                log.info('ST> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err)  {
                    return log.error(err);
                }
            });
        });

        return this;
    });
    return this;
};

Manager.prototype.getTownCurrentData = function(baseTime, key, callback){
    var self = this;

    var dateString = self.getCurrentQueryTime(baseTime);
    //log.info(currentDate);
    //log.info(hour, minute);

    log.info('C> +++ GET CURRENT INFO : ', dateString);

    town.getCoord(function (err, listTownDb) {
        if (err) {
            if (callback) {
                callback(err);
            }
            else {
                log.error(err);
            }
            return this;
        }

        var checkPubDate = self._checkPubDate;
        if(config.db.version === '2.0'){
            checkPubDate = self.kmaTownCurrent.checkPubDate;
        }
        checkPubDate(modelCurrent, listTownDb, dateString, function (err, srcList) {
            if (err) {
                if (callback) {
                    callback(err);
                }
                else {
                    log.error(err);
                }
                return;
            }
            //log.info('C> try to get current data');
            if (srcList.length === 0) {
                log.info('C> All current was already updated');
                if (callback) {
                    callback(undefined, []);
                }
                return;
            }
            else {
                log.info('C> srcList length=', srcList.length);
            }

            self._recursiveRequestData(srcList, self.DATA_TYPE.TOWN_CURRENT, key, dateString, 20, undefined, function (err, results) {
                log.info('C> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err) {
                    return log.error(err);
                }
            });
        });
        return this;
    });
    return this;
};


Manager.prototype.updateInvalidT1hData = function(baseTime, key, callback){
    var self = this;
    var dateString = self.getCurrentQueryTime(baseTime);

    log.info('C> +++ Update Invalid T1h : ', dateString);

    modelCurrent.find({'currentData':{$elemMatch:{'t1h':0.0}}}, function(err, list){
        if(err){
            log.warn('C> Fail to find current data which has 0 t1h data');
            if (callback) {
                return callback(err);
            }
            return this;
        }

        if(list.length === 0){
            log.info('C> There is no invalid t1h data');
            if (callback) {
                return callback(err);
            }
            return this;
        }

        var invalidList = [];
        log.info('C> There are invalid t1h data : ', list.length);

        // 최근에 받은 current data의 t1h가 invalid일 경우에만 업데이트 하기 위해서 필터링 한다
        list.forEach(function(item){
            var latestData = item.currentData.pop();

            log.info('C> check Item : ', item.mCoord.mx, item.mCoord.my, latestData.date, latestData.time);
            // check whether invalid data is latest or not.
            if(latestData != undefined /*&& latestData.t1h === 0.0*/){
                var updateLocation = {
                    mx: latestData.mx,
                    my: latestData.my
                };

                // 최신 current data의 t1h가 invalid한경우 해당 mx, my값을 array에 저장한다
                invalidList.push(updateLocation);

                dateString = {
                    date: latestData.date,
                    time: latestData.time
                }
            }
        });

        if(invalidList.length === 0){
            log.info('C> no need to update');
            if (callback) {
                return callback(err);
            }
        }

        log.info('C> need to update :', dateString, 'count : ', invalidList.length);
        // 위 loop에서 필터링 된 invalid t1h값을 가지는 mx, my 좌표에 대해서 업데이트를 실행 한다
        self._recursiveRequestData(invalidList, self.DATA_TYPE.TOWN_CURRENT, key, dateString, 5, undefined, function (err, results) {
            log.info('C> update OK for invalid t1h');
            if (callback) {
                return callback(err, results);
            }
            if (err) {
                return log.error(err);
            }
        });
    });

    return this;
};

// get breif middle range forecast data from data.org by using collectTownForecast.js
Manager.prototype.getMidForecast = function(gmt, key, callback){
    var self = this;

    var currentDate = self.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    if(parseInt(dateString.time) < 800){
        currentDate = self.getWorldTime(-15);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = '1800';
    }
    else if(parseInt(dateString.time) < 2000){
        dateString.time = '0600';
    }
    else {
        dateString.time = '1800';
    }

    log.info('+++ GET MID Forecast : ', dateString);

    self._checkPubDate(modelMidForecast, (new collectTown()).listPointNumber, dateString, function (err, srcList) {
        if (err) {
            if (callback) {
                callback(err);
            }
            else {
                log.error(err);
            }
            return;
        }
        if (srcList.length === 0) {
            log.info('MF> All current was already updated');
            if (callback) {
                callback(undefined, []);
            }
            return;
        }
        else {
            log.info('MF> srcList length=', srcList.length);
        }

        self._recursiveRequestData(srcList, self.DATA_TYPE.MID_FORECAST, key, dateString, 20, undefined, function (err, results) {
            log.info('MF> save OK');
            if (callback) {
                return callback(err, results);
            }
            if (err) {
                return log.error(err);
            }
        });
    });
    return this;
};

// get middle range LAND forecast data from data.org by using collectTownForecast.js
Manager.prototype.getMidLand = function(gmt, key, callback){
    var self = this;

    var currentDate = self.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    if(parseInt(dateString.time) < 800){
        currentDate = self.getWorldTime(gmt - 24);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = '1800';
    }
    else if(parseInt(dateString.time) < 2000){
        dateString.time = '0600';
    }
    else {
        dateString.time = '1800';
    }

    // check wehter today or prevous day
    var today = self.getWorldTime(9);
    today = today.slice(0, 8);
    if(today > dateString.date){
        dateString.time = '1800';
    }

    log.info('+++ GET MID LAND Forecast : ', dateString);

    self._checkPubDate(modelMidLand, (new collectTown()).listAreaCode, dateString, function (err, srcList) {
        if (err) {
            if (callback) {
                callback(err);
            }
            else {
                log.error(err);
            }
            return;
        }
        if (srcList.length === 0) {
            log.info('ML> All current was already updated');
            if (callback) {
                callback(undefined, []);
            }
            return;
        }
        else {
            log.info('ML> srcList length=', srcList.length);
        }

        self._recursiveRequestData(srcList, self.DATA_TYPE.MID_LAND, key, dateString, 20, undefined, function (err, results) {
            log.info('ML> save OK');
            if (callback) {
                return callback(err, results);
            }
            if (err) {
                return log.error(err);
            }
        });
    });

    return this;
};

// get middle range temperature data from data.org by using collectTownForecast.js
Manager.prototype.getMidTemp = function(gmt, key, callback) {
    var self = this;

    var currentDate = self.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    if(parseInt(dateString.time) < 800){
        currentDate = self.getWorldTime(gmt - 24);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = '1800';
    }
    else if(parseInt(dateString.time) < 2000){
        dateString.time = '0600';
    }
    else {
        dateString.time = '1800';
    }

    // check wehter today or prevous day
    var today = self.getWorldTime(9);
    today = today.slice(0, 8);
    if(today > dateString.date){
        dateString.time = '1800';
    }

    log.info('+++ GET MID TEMP Forecast : ', dateString);

    self._checkPubDate(modelMidTemp, (new collectTown()).listCityCode, dateString, function (err, srcList) {
        if (err) {
            if (callback) {
                callback(err);
            }
            else {
                log.error(err);
            }
            return;
        }
        if (srcList.length === 0) {
            log.info('MT> All current was already updated');
            if (callback) {
                callback(undefined, []);
            }
            return;
        }
        else {
            log.info('MT> srcList length=', srcList.length);
        }

        self._recursiveRequestData(srcList, self.DATA_TYPE.MID_TEMP, key, dateString, 20, undefined, function (err, results) {
            log.info('MT> save OK');
            if (callback) {
                return callback(err, results);
            }
            if (err) {
                return log.error(err);
            }
        });
    });

    return this;
};

// get middle range sea forecast data from data.org by using collectTownForecast.js
Manager.prototype.getMidSea = function(gmt, key, callback){
    var self = this;

    var currentDate = self.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    if(parseInt(dateString.time) < 800){
        currentDate = self.getWorldTime(gmt - 24);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = '1800';
    }
    else if(parseInt(dateString.time) < 2000){
        dateString.time = '0600';
    }
    else {
        dateString.time = '1800';
    }

    log.info('+++ GET MID SEA Forecast : ', dateString);

    self._checkPubDate(modelMidSea, (new collectTown()).listSeaCode, dateString, function (err, srcList) {
        if (err) {
            if (callback) {
                callback(err);
            }
            else {
                log.error(err);
            }
            return;
        }
        if (srcList.length === 0) {
            log.info('MS> All current was already updated');
            if (callback) {
                callback(undefined, []);
            }
            return;
        }
        else {
            log.info('Ms> srcList length=', srcList.length);
        }

        self._recursiveRequestData(srcList, self.DATA_TYPE.MID_SEA, key, dateString, 20, undefined, function (err, results) {
            log.info('MD> save OK');
            if (callback) {
                return callback(err, results);
            }
            if (err)  {
                return log.error(err);
            }
        });
    });

    return this;
};

Manager.prototype.getKmaData = function (typeStr, mCoord, serviceKey, callback) {
    var self = this;
    var collectInfo = new collectTown();

    var dateString;
    var dataType = collectInfo.DATA_TYPE.TOWN_CURRENT;

    if (typeStr == 'current') {
        dataType = collectInfo.DATA_TYPE.TOWN_CURRENT;
        dateString= self.getCurrentQueryTime(9);
    }
    else if (typeStr == 'shortest') {
        dataType = collectInfo.DATA_TYPE.TOWN_SHORTEST;
        dateString = self.getShortestQueryTime(9);
    }
    else if (typeStr == 'short') {
        dataType = collectInfo.DATA_TYPE.TOWN_SHORT;
        dateString = self.getShortQueryTime(9);
    }

    collectInfo.srcList = [mCoord];
    collectInfo.listCount = 1;
    collectInfo.resetResult();
    var url = collectInfo.getUrl(dataType, serviceKey, dateString.date, dateString.time, mCoord);

    collectInfo.getData(0, dataType, url, undefined, function (err) {
        if (err)  {
            callback(err);
            return;
        }

        if (collectInfo.resultList && collectInfo.resultList[0].data) {
            log.info(collectInfo.resultList[0].data);
            var data = collectInfo.resultList[0].data[0];
            if (data == undefined) {
               return callback("Fail to get "+typeStr+" mCoord="+JSON.stringify(mCoord));
            }
            var modelObj = {mCoord: mCoord, pubDate: data.pubDate};
            //controllerTown에서는 db에서 데이터를 꺼내, ret에 data array를 넣음.
            modelObj.ret = collectInfo.resultList[0].data;

            self.getSaveFunc(dataType).call(self, collectInfo.resultList[0].data, function (err) {
                if (err) {
                    log.error(err.message);
                    return;
                }
                log.info("save new "+typeStr+" mCoord="+JSON.stringify(mCoord));
            });

            callback(err, modelObj);
        }
        else {
            callback(new Error("Fail to get current mCoord"+JSON.stringify(mCoord)));
        }
    });
};

/**
 * it needs to sync with collectTownForecast DATA_TYPE
 * @type {Object}
 */
Manager.prototype.DATA_TYPE = Object.freeze({
    TOWN_CURRENT: 0,
    TOWN_SHORTEST: 1,
    TOWN_SHORT: 2,
    MID_FORECAST: 3,
    MID_LAND: 4,
    MID_TEMP: 5,
    MID_SEA: 6
});

/**
 *
 * @param value
 * @returns {string}
 */
Manager.prototype.getDataTypeName = function(value) {
    for (var name in this.DATA_TYPE) {
        if (this.DATA_TYPE[name] === value) {
            return name;
        }
    }
};

/**
 *
 * @param value
 * @returns {*}
 */
Manager.prototype.getSaveFunc = function(value) {
    switch (value) {
        case this.DATA_TYPE.TOWN_CURRENT:
            if(config.db.version === '2.0'){
                return kmaTownCurrent.saveCurrent;
            }else{
                return this.saveCurrent;
            }
        case this.DATA_TYPE.TOWN_SHORTEST:
            return this.saveShortest;
        case this.DATA_TYPE.TOWN_SHORT:
            if(config.db.version === '2.0'){
                return kmaTownShort.saveShort;
            }else{
                return this.saveShort;
            }
        case this.DATA_TYPE.MID_FORECAST:
            return this.saveMidForecast;
        case this.DATA_TYPE.MID_LAND:
            return this.saveMidLand;
        case this.DATA_TYPE.MID_TEMP:
            return this.saveMidTemp;
        case this.DATA_TYPE.MID_SEA:
            return this.saveMidSea;
        default:
            log.error("Fail to find save func for ", this.getDataTypeName(value));
            return function(){};
    }
};

Manager.prototype.task = function(callback) {
    var self = this;
    var tempTasks = [];

    while(self.asyncTasks.length) {
        tempTasks.push(self.asyncTasks.pop());
    }

    log.info('start tasks counts '+tempTasks.length+' '+new Date());

    async.series(tempTasks, function (err) { 
        if(err) { 
            log.error(err); 
        }  
        log.info("Finished task counts:"+tempTasks.length+ " "+ new Date());
        if (callback) {
            callback(err);
        }
        else {
            return setTimeout(function() {
                self.task();
            }, 1000*30); //30 secs
        }
    });
};

//It is unused.
//Manager.prototype.checkTimeAndPushTask = function (putAll) {
//    var self = this;
//    var time = (new Date()).getUTCMinutes();
//
//    var server_key = config.keyString.cert_key;
//    var normal_key = config.keyString.normal;
//
//    log.info('check time and push task');
//
//    if (time === 1 || putAll) {
//        //short rss
//        log.info('push short rss');
//        self.asyncTasks.push(function (callback) {
//            //need to update sync
//            townRss.mainTask(function(){
//                log.info('Rss>complete mainTask for Rss');
//                callback();
//            });
//        //    setTimeout(function () {
//       //         log.info('Finished ShortRss '+new Date());
//       //         callback();
//       //     }, 1000*60); //1min
//        });
//        log.info('push mid rss');
//        self.asyncTasks.push(function (callback) {
//            midRssKmaRequester.mainProcess(midRssKmaRequester, function (self, err) {
//                log.info('Finished MidRss '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//    }
//
//    if (time === 2 || putAll) {
//        log.info('push MidTemp');
//        self.asyncTasks.push(function (callback) {
//            self.getMidTemp(9, normal_key, function (err) {
//                log.info('Finished MidTemp '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//        log.info('push MidLand');
//        self.asyncTasks.push(function (callback) {
//            self.getMidLand(9, normal_key, function (err) {
//                log.info('Finished MidLand '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//        log.info('push MidForecast');
//        self.asyncTasks.push(function (callback) {
//            self.getMidForecast(9, normal_key, function (err) {
//                log.info('Finished MidForecast '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//        log.info('push MidSea');
//        self.asyncTasks.push(function (callback) {
//            self.getMidSea(9, normal_key, function (err) {
//                log.info('Finished MidSea '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//    }
//
//    if (time === 10 || putAll) {
//        log.info('push PastConditionGather');
//        self.asyncTasks.push(function (callback) {
//            var pastGather = new PastConditionGather();
//
//            pastGather.start(1, server_key, function (err) {
//                log.info('Finished PastConditionGather '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//    }
//
//    //1:06분 일부만 업데이트 됨. 20분에 대부분 갱신됨.
//    if (time === 20 || putAll) {
//        log.info('push keco main process');
//        self.asyncTasks.push(function (callback) {
//            keco.cbKmaIndexProcess(keco, function (err) {
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//    }
//
//    if (time === 31 || putAll) {
//        log.info('push Short');
//        self.asyncTasks.push(function (callback) {
//            self.getTownShortData(9, server_key, function (err) {
//                log.info('Finished Short '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//    }
//
//    if (time === 41 || putAll) {
//        log.info('push Shortest');
//        self.asyncTasks.push(function (callback) {
//            self.getTownShortestData(9, server_key, function (err) {
//                log.info('Finished Shortest '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//        log.info('push Current');
//        self.asyncTasks.push(function (callback) {
//            self.getTownCurrentData(9, server_key, function (err) {
//                log.info('Finished Current '+new Date());
//                if (err) {
//                    log.error(err);
//                }
//                callback();
//            });
//        });
//    }
//
//    log.info('wait '+self.asyncTasks.length+' tasks');
//};

/**
 *
 * @param items
 * @param region
 * @param accessKey
 * @param secretKey
 * @param apiVersion
 * @param distributionId
 * @param callback
 */
Manager.prototype.deleteCacheOnCloudFront = function(items, region, accessKey, secretKey, apiVersion, distributionId, callback){
    var cf = new awsCloudFront(region, accessKey, secretKey, apiVersion);

    cf.invalidateCloudFront(items, distributionId, function(err){
        if(err){
            log.error(err);
            if(callback){
                callback(new Error('Can not invalidate cloudfront'));
            }
        }

        if(callback){
            callback();
        }
    });
};

Manager.prototype._requestApi = function (apiName, callback) {
    var req = require('request');
    var timeout = 1000*60*60*24;
    var url = "http://"+config.ipAddress+":"+config.port+"/gather/";

    log.info('Start url='+url+apiName+' '+new Date());
    req(url+apiName, {timeout: timeout}, function(err, response) {
        log.info('Finished '+apiName+' '+new Date());
        if (err) {
            log.error(err);
            return callback();
        }
        if ( response.statusCode >= 400) {
            log.error(new Error("response.statusCode="+response.statusCode));
        }
        callback();
    });
};

Manager.prototype.checkTimeAndRequestTask = function (putAll) {
    var self = this;
    var time = (new Date()).getUTCMinutes();
    var hours = (new Date()).getUTCHours();

    log.verbose('check time and request task');

    if (time === 2 || putAll) {
        //spend long time
        log.info('push past');
        self.asyncTasks.push(function (callback) {
            self._requestApi("past", callback);
        });

        log.info('push keco_forecast');
        self.asyncTasks.push(function (callback) {
            self._requestApi("kecoForecast", callback);
        });

        log.info('push mid temp');
        self.asyncTasks.push(function (callback) {
            self._requestApi("midtemp", callback);
        });
        log.info('push mid land');
        self.asyncTasks.push(function (callback) {
            self._requestApi("midland", callback);
        });
        log.info('push mid forecast');
        self.asyncTasks.push(function (callback) {
            self._requestApi("midforecast", callback);
        });
        log.info('push mid sea');
        self.asyncTasks.push(function (callback) {
            self._requestApi("midsea", callback);
        });

        log.info('push mid rss');
        self.asyncTasks.push(function (callback) {
            self._requestApi("midrss", callback);
        });

        log.info('push short rss');
        self.asyncTasks.push(function (callback) {
            self._requestApi("shortrss", callback);
        });
    }

    if (time === 10 || putAll) {
        log.info('push health day');

        var hour = (new Date()).getUTCHours()+9;

        if(hour === 6 || hour === 18 || putAll) {
            self.asyncTasks.push(function (callback) {
                self._requestApi('healthday', callback);
            });
        }
    }

    if (time === 3 || time === 13 || time === 23 || time === 33 || time === 43 || time === 53 || putAll) {
        //direct request keco
        log.info('push keco');
        //self.asyncTasks.push(function (callback) {
            self._requestApi("keco", function() {
                log.info('keco done');
        //        callback();
            });
        //});
    }

    /**
     * setNextGetTime 에서 10분으로 설정하므로 10분보다 늦어야 함.
     */
    if (time === 10 || putAll) {
        log.info('push life index');
        self.asyncTasks.push(function (callback) {
            self._requestApi("lifeindex", callback);
        });
    }

    if (time === 10 || putAll) {
        log.info('push short');
        self.asyncTasks.push(function (callback) {
            self._requestApi("short", callback);
        });
    }

    if (time === 40 || putAll) {
        //direct request current
        log.info('push current');
        //self.asyncTasks.push(function (callback) {
        self._requestApi("current", function () {
            log.info('current done');
            //        callback();
        });
        //});
    }

    if (time === 45 || putAll) {
        log.info('push shortest');
        self.asyncTasks.push(function (callback) {
            self._requestApi("shortest", function () {
                log.info('shortest done');
                callback();
            });
        });
    }

    if(time === 50) {
        log.info('update stn rns hit rate');
        self._requestApi('updateStnRnsHitRate', function () {
            log.info('update stn rns hit rate done');
        });
    }

    //if(time === 50 || putAll){
    //    log.info('push invalidateCloudFront');
    //    self.asyncTasks.push(function(callback){
    //        self._requestApi("invalidateCloudFront/ALL", callback);
    //    })
    //}

    if ((time === 55 && hours === 18)|| putAll) {
        log.info('push kasi rise set');
        self.asyncTasks.push(function (callback) {
            self._requestApi("gatherKasiRiseSet", function () {
                log.info('kasi rise set done');
                callback();
            });
        });
    }

    if (time === 55 || putAll) {
        //direct request updateInvalidt1h
        log.info('push updateInvalidt1h');
        //self.asyncTasks.push(function (callback) {
        self._requestApi("updateInvalidt1h", function () {
            log.info('updateInvalidt1h done');
            //        callback();
        });
        //});
    }

    if (self.asyncTasks.length <= 17) {
        log.debug('wait '+self.asyncTasks.length+' tasks');
    }
    else {
        log.error('ERROR WAIT '+self.asyncTasks.length+' tasks');
        log.error('ERROR WAIT '+self.asyncTasks.length+' tasks');
        log.error('ERROR WAIT '+self.asyncTasks.length+' tasks');
        process.exit(1);
    }
};

/**
 *
 * @returns {Manager}
 */
Manager.prototype.startManager = function(){
    var self = this;

    midRssKmaRequester.setNextGetTime(new Date());
    self.midRssKmaRequester = midRssKmaRequester;

    keco.setServiceKey(config.keyString.normal);
    keco.setDaumApiKey(config.keyString.daum_key);
    keco.getCtprvnSidoList();

    self.keco = keco;

    taskKmaIndexService.setServiceKey(config.keyString.cert_key, config.keyString);
    taskKmaIndexService.setNextGetTime('fsn', new Date());
    taskKmaIndexService.setNextGetTime('ultrv', new Date());
    self.taskKmaIndexService = taskKmaIndexService;

    async.parallel([
        function (callback) {
            keco.getAllMsrStnInfo(function (err) {
                if (err) {
                    log.error(err);
                }
                else {
                    log.info('keco get all msr stn info list');
                }
                callback();
            });
        },
        function (callback) {
            taskKmaIndexService.loadAreaList(function () {
                log.info('KmaIndex> complete loadAreaList for KMA Index.');
                callback();
            });
        },
        function (callback) {
            taskKmaIndexService.updateLifeIndexDbFromTowns(function (err) {
                if (err) {
                    log.error(err);
                }
                log.info('Finish updating life index db from towns');
                callback();
            });
        }
    ], function () {

        /**
         * currents를  과거 8일까지 복원하지 못하는 경우에 사용한다
         * 단독으로 돌리는 경우에는 testKmaScraper를 사용하는 용이함.
         */
        //self.asyncTasks.push(function (callback) {
        //    self._requestApi("kmaStnPastHourly", callback);
        //});

        //self.checkTimeAndPushTask(true);
        self.checkTimeAndRequestTask(true);
        self.task();
        setInterval(function() {
            self.checkTimeAndRequestTask(false) ;
        }, 1000*60);
    });

    return this;
};

Manager.prototype.stopManager = function(){
    //var self = this;
    //self.stopTownData();
};

Manager.prototype.startScrape = function () {
    var self = this;
    var Scrape = require('../lib/kmaScraper');
    var scrape = new Scrape();

    function _getStnHourlyWeather(callback) {
        log.info('request kma stn hourly time='+(new Date()));
        scrape.getStnHourlyWeather(undefined, function (err, results) {
            if (err) {
                if (err === 'skip') {
                    log.info('stn hourly weather info is already updated');
                }
                else {
                    log.error(err);
                }
            }
            else {
                log.silly(results);
                log.info('kma stn hourly done time='+(new Date()));
            }
            callback();
        });
    }

    function _getStnMinuteWeather(callback) {
        log.info('request kma stn minute time='+(new Date()));
        scrape.getStnMinuteWeather(function (err, results) {
            if (err) {
                if (err === 'skip') {
                    log.info('stn minute weather info is already updated');
                }
                else {
                    log.error(err);
                }
            }
            else {
                log.silly(results);
                log.info('kma stn minute done time='+(new Date()));
            }
            callback();
        });
    }

    function _gatherSpecialWeatherSituation(callback) {
        log.info('request kma special weather situation time='+(new Date()));
        scrape.gatherSpecialWeatherSituation(function (err) {
            if (err) {
                if (err === 'skip') {
                    log.info('special weather situation is already updated');
                }
                else {
                    log.error(err);
                }
            }
            else {
                log.info('kma special weather situation done time='+(new Date()));
            }
            callback();
        });
    }

    self.asyncTasks.push(function (callback) {
        _getStnMinuteWeather(function () {
            callback();
        });
    });

    self.asyncTasks.push(function (callback) {
        _getStnHourlyWeather(function () {
            callback();
        });
    });

    self.asyncTasks.push(function (callback) {
        _gatherSpecialWeatherSituation(function () {
            callback();
        });
    });

    setInterval(function () {
        var time = (new Date()).getUTCMinutes();
        if(time % 2 == 0) {
            self.asyncTasks.push(function (callback) {
                _getStnMinuteWeather(function () {
                    callback();
                });
            });
        }
        if(time % 3 == 0) {
            self.asyncTasks.push(function (callback) {
                _gatherSpecialWeatherSituation(function () {
                    callback();
                });
            });
        }
        if (time === 4 || time === 6 || time === 9 || time === 15) {
            self.asyncTasks.push(function (callback) {
                _getStnHourlyWeather(function () {
                    callback();
                });
            });
        }
    }, 1000*60);

    self.task();
};

module.exports = Manager;
