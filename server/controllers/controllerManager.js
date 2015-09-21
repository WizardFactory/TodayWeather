/**
 * Created by Peter on 2015. 8. 26..
 */
"use strict";

var collectTown = require('../lib/collectTownForecast');
var listKey = require('../config/keydata');
var town = require('../models/town');
var forecast = require('../models/forecast');
var fs = require('fs');
var config = require('../config/config');
var convert = require('../utils/coordinate2xy');

function Manager(){
    var self = this;

    self.TIME_PERIOD = {
        TOWN_SHORT: (1000*60*60*3),
        TOWN_SHORTEST: (1000*60*60),
        TOWN_CURRENT: (1000*60*60)
    };

    /****************************************************************************
     *   THIS IS FOR TEST.
     ****************************************************************************/
    //self.TIME_PERIOD.TOWN_SHORT = (1000*25);
    //self.TIME_PERIOD.TOWN_SHORTEST = (1000*10);
    //self.TIME_PERIOD.TOWN_CURRENT = (1000*10); //(1000*60*60)
    /****************************************************************************/

    if(config.db.mode === 'ram'){
        self.makeTownlist();
    }
}

Manager.prototype.makeTownlist = function(list){
    var self = this;
    self.weatherDb = [];
    self.coordDb = [];

    var weatherData = {
        town: {
            first: '',
            second: '',
            third: ''
        },
        coord: {
            lon: 0,
            lat: 0
        },
        mData: {
            mCoord:{
                mx: 0,
                my: 0
            },
            data: {
                current: [],
                short: [],
                shortest: [],
                midForecast: [],
                midLand: [],
                midTemp: [],
                midSea: []
            }
        }
    };

    self.townCoordList = fs.readFileSync('./utils/data/part.csv').toString().split('\n');
    //self.townCoordList = fs.readFileSync('./utils/data/test.csv').toString().split('\n');
    self.townCoordList.shift(); // header remove

    self.townCoordList.forEach(function(line, lineNumber){
        var townCoord = {lat: 0, lon: 0};
        line.split(',').forEach(function(item, index){
            if(index === 0){
                weatherData.town.first = item;
            }
            else if(index === 1){
                weatherData.town.second = item;
            }
            else if(index === 2){
                weatherData.town.third = item;
            }
            else if(index === 3){
                weatherData.coord.lat = item;
                townCoord.lat = item;
            }
            else if(index === 4){
                weatherData.coord.lon = item;
                townCoord.lon = item;
            }
            if(townCoord.lat != 0 && townCoord.lon != 0) {
                var isPush = true;
                var conv = new convert(townCoord, {}).toLocation();
                weatherData.mData.mCoord.mx = conv.getLocation().x;
                weatherData.mData.mCoord.my = conv.getLocation().y;

                self.weatherDb.push(JSON.parse(JSON.stringify(weatherData)));

                for(var i=0 ; i < self.coordDb.length ; i++){
                    if((self.coordDb[i].mx === weatherData.mData.mCoord.mx) &&(self.coordDb[i].my === weatherData.mData.mCoord.my)){
                        isPush = false;
                        break;
                    }
                }
                if(isPush) {
                    self.coordDb.push(JSON.parse(JSON.stringify(weatherData.mData.mCoord)));
                }

                townCoord.lat = 0;
                townCoord.lon = 0;
            }
        });
    });

    log.info('coord count : ', self.coordDb.length);
    log.info('town count : ', self.weatherDb.length);

    self.count = 0;
    self.currentCount = 0;

    //self.coordDb.forEach(function(item, i) {
    //    log.info(item);
    //});
    //self.weatherDb.forEach(function(item, i) {
    //    log.info(item);
    //});
};

Manager.prototype.getWeatherDb = function(region, city, town, cb){
    var self = this;
    var err = 0;

    for(var index = 0 ; index < self.weatherDb.length; index++){
        var item = self.weatherDb[index];
        if(item.town.first === region && item.town.second === city && item.town.third === town){
            break;
        }
    }

    if(index === self.weatherDb.length){
        err = 1;
    }

    if(cb !== undefined){
        cb(err, self.weatherDb[index]);
    }
};

Manager.prototype.setShortData = function(coord, dataList){
    var self = this;

    try{
        self.weatherDb.forEach(function(data, index){
            if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){
                var listShort = data.mData.data.short;
                var firstDate = 0;
                var firstTime = 0;
                var i=0;
                var popCount = 0;

                // find first item based on date&time
                for(var i = 0 in dataList){
                    if((dataList[i].date !== undefined) &&
                        (dataList[i].time !== undefined) &&
                        (dataList[i].date !== '') &&
                        (dataList[i].time !== '')){
                        firstDate = dataList[i].date;
                        firstTime = dataList[i].time;
                        break;
                    }
                    popCount++;
                    //dataList.shift();
                }
                if(popCount > 0){
                    for(i=0 ; i<popCount ; i++){
                        dataList.shift();
                    }
                }

                log.info('before len : ', listShort.length);
                log.info('first date&time : ', firstDate, firstTime);

                popCount = 0;
                if(listShort.length > 0){
                    if(parseInt(listShort[listShort.length - 1].date) > parseInt(firstDate) ||
                        ((parseInt(listShort[listShort.length - 1].date) === parseInt(firstDate)) &&
                        (parseInt(listShort[listShort.length - 1].time) >= parseInt(firstTime)))) {
                        for (i = listShort.length - 1; i >= 0; i--) {
                            if (listShort[i].date === firstDate &&
                                listShort[i].time === firstTime){
                                popCount++;
                                break;
                            }
                            if((parseInt(listShort[i].date) === parseInt(firstDate) &&
                                parseInt(listShort[i].time) < parseInt(firstTime)) ||
                                (parseInt(listShort[i].date) < parseInt(firstTime))){
                                break;
                            }
                            popCount++;
                            log.info('remove : ' , listShort[i].date,' : ', listShort[i].time);
                        }
                    }
                }

                log.info('before pop : ', popCount);
                for(i=0 ; i<popCount ; i++){
                    data.mData.data.short.pop();
                }

                if(data.mData.data.short.length > 16){
                    for(i=0 ; i< data.mData.data.short.length - 16 ; i++){
                        data.mData.data.short.shift();
                    }
                }

                log.info('after pop : ', data.mData.data.short.length);
                for(i=0 ; i< dataList.length ; i++){
                    //data.mData.data.short.push(JSON.parse(JSON.stringify(dataList[i])));
                    data.mData.data.short.push(dataList[i]);
                }

                //if(data.mData.data.short.length > 40){
                //    for(i=0 ; i< 40 - data.mData.data.short.length ; i++) {
                //        data.mData.data.short.shift();
                //    }
                //    log.info('make 40 counts');
                //}
            }
        });
    }
    catch(e){
        log.error('something wrong!!! : ', e);
    }
};

Manager.prototype.setCurrentData = function(coord, dataList){
    var self = this;

    self.weatherDb.forEach(function(data, index){
        if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){

            for(var i=0 in dataList){
                var item = dataList[i];
                data.mData.data.current.push(JSON.parse(JSON.stringify(item)));
            }

            if(data.mData.data.current.length > 60){
                for(var i = 0 ; i < data.mData.data.current.length - 60 ; i++){
                    data.mData.data.current.shift();
                }
            }
        }
    });
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

Manager.prototype.getTownShortData = function(baseTime){
    var self = this;
    //var testListTownDb = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

    if(baseTime === undefined){
        baseTime = 9;
    }

    var currentDate = self.getWorldTime(baseTime);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };
    var time = currentDate.slice(8, 12);
    var meta = {};
    meta.fName = 'getTownShortData';

    //log.info(currentDate);
    //log.info(time);

    /*
     * The server is only responsed with there hours 2, 5, 8, 11, 14, 17, 20, 23
     */
    if(parseInt(time) < 300){
        var temp = self.getWorldTime(baseTime - 24);
        dateString.date = temp.slice(0.8);
        dateString.time = '2300';
    }
    else if(parseInt(time) < 600) {
        dateString.time = '0200';
    }
    else if(parseInt(time) < 900){
        dateString.time = '0500';
    }
    else if(parseInt(time) < 1200){
        dateString.time = '0800';
    }
    else if(parseInt(time) < 1500){
        dateString.time = '1100';
    }
    else if(parseInt(time) < 1800){
        dateString.time = '1400';
    }
    else if(parseInt(time) < 2100){
        dateString.time = '1700';
    }
    else if(parseInt(time) < 2400){
        dateString.time = '2000';
    }
    else{
        log.error('unknown TimeString');
        return;
    }

    /**************************************************
    * TEST CODE : KEY change
    ***************************************************/
    var key = '';
    if(parseInt(dateString.time) < 800){
        key = listKey.keyString.pokers;
    } else if(parseInt(dateString.time) < 1700) {
        key = listKey.keyString.pokers11;
    } else {
        key = listKey.keyString.aleckim;
    }
    /***************************************************/

    log.info('+++ GET SHORT INFO : ', dateString);

    if(config.db.mode === 'ram'){
        log.info('+++ COORD LIST : ', self.coordDb.length);

        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(self.coordDb, collectShortInfo.DATA_TYPE.TOWN_SHORT, key, dateString.date, dateString.time, function(err, dataList){
            if(err){
                log.error('** getTownShortData : ', err);
                log.error(meta);
                return;
            }

            /**************************************************
             * TEST CODE
             ***************************************************/
            //var dataList = [];
            //if(self.count == 0){
            //    dataList = config.mData.data.short.slice(0, 15);
            //}
            //else if(self.count === 1){
            //    dataList = config.mData.data.short.slice(2, 17);
            //}else if(self.count === 2){
            //    dataList = config.mData.data.short.slice(21, 36);
            //}
            //else{
            //    dataList = config.mData.data.short.slice(22, 37);
            //}
            //self.count++;

            log.info('short data receive completed : %d\n', dataList.length);
            //log.info(dataList);
            //log.info(dataList[0]);
            //for(var i=0 ; i<10 ; i++){
            //    for(var j in dataList[i].data){
            //        log.info(dataList[i].data[j]);
            //    }
            //}

            for(var i = 0 ; i < self.coordDb.length ; i ++){
                 if(Array.isArray(dataList[i].data)) {
                    self.setShortData(self.coordDb[i], dataList[i].data);
                }
                /**************************************************
                 * TEST CODE
                 ***************************************************/
                //self.setShortData(self.coordDb[i], dataList);
            }
        });
    }
    else{
        town.getCoord(function(err, listTownDb){
            if(err){
                log.error('** getTownShortData : ', err);
                log.error(meta);
                return;
            }

            log.info(listTownDb);
            log.info('+++ COORD LIST : ', listTownDb.length);

            var collectShortInfo = new collectTown();
            collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_SHORT, key, dateString.date, dateString.time, function(err, dataList){
                if(err){
                    log.error('** getTownShortData : ', err);
                    log.error(meta);
                    return;
                }

                log.info('short data receive completed : %d\n', dataList.length);
                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i=0 ; i<10 ; i++){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                for(var i = 0 ; i < listTownDb.length ; i ++){
                    if(Array.isArray(dataList[i].data)) {
                        forecast.setShortData(dataList[i].data, listTownDb[i], function (err, res) {
                            if (err) {
                                log.error('** getTownShortData : ', err);
                                log.error(meta);
                            }
                            //log.info(res);
                        });
                    }
                }
            });
        });
    }
};

Manager.prototype.getTownShortestData = function(){
    var self = this;

    var currentDate = self.getWorldTime(+9);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: ''
    };

    var hour = currentDate.slice(8,10);
    var minute = currentDate.slice(10,12);

    //log.info(currentDate);
    //log.info(hour, minute);

    if(parseInt(minute) <= 30){
        if(parseInt(hour) > 0){
            var temp = (parseInt(hour) - 1);
            dateString.time = temp.toString() + '30';
        }
        else{
            currentDate = self.getWorldTime(-15);
            dateString.date = currentDate.slice(0.8);
            dateString.time = '2330';
        }
    }
    else{
        dateString.time = hour + '30';
    }

    log.info('+++ GET SHORTEST INFO : ', dateString);
    /**************************************************
     * TEST CODE : KEY change
     ***************************************************/
    var key = '';
    if(parseInt(dateString.time) < 800){
        key = listKey.keyString.sooyeon;
    } else if(parseInt(dateString.time) < 1700) {
        key = listKey.keyString.pokers11;
    } else {
        key = listKey.keyString.aleckim;
    }
    /***************************************************/
    town.getCoord(function(err, listTownDb){
        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_SHORTEST, key, dateString.date, dateString.time, function(err, dataList){

            log.info('shortest data receive completed : %d\n', dataList.length);

            //log.info(dataList);
            //log.info(dataList[0]);
            for(var i in dataList){
                for(var j in dataList[i].data){
                    log.info(dataList[i].data[j]);
                }
            }

            // TODO: Store data to DB.
        });
    });
};

Manager.prototype.getTownCurrentData = function(){
    var self = this;

    var currentDate = self.getWorldTime(+9);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    // 아직 발표 전 시간 대라면 1시간을 뺀 시간을 가져온다.
    if(parseInt(currentDate.slice(10,12)) < 35){
        currentDate = self.getWorldTime(+8);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '00'
    }

    //log.info(currentDate);
    //log.info(hour, minute);

    log.info('+++ GET CURRENT INFO : ', dateString);
    /**************************************************
     * TEST CODE : KEY change
     ***************************************************/
    var key = '';
    if(parseInt(dateString.time) < 800){
        key = listKey.keyString.sooyeon;
    } else if(parseInt(dateString.time) < 1700) {
        key = listKey.keyString.hyunsoo;
    } else {
        key = listKey.keyString.aleckim;
    }
    /***************************************************/

    if(config.db.mode === 'ram'){
        log.info('+++ COORD LIST : ', self.coordDb.length);

        /**************************************************
         * TEST CODE
         ***************************************************/
        //var index = this.currentCount % 100;
        //this.currentCount++;
        //var dataList = config.mData.data.current.slice(index, index+1);

        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(self.coordDb, collectShortInfo.DATA_TYPE.TOWN_CURRENT, key, dateString.date, dateString.time, function (err, dataList) {

            log.info('current data receive completed : %d\n', dataList.length);

            for (var i = 0; i < self.coordDb.length; i++) {
                if (Array.isArray(dataList[i].data)) {
                    self.setCurrentData(self.coordDb[i], dataList[i].data);
                }

                /**************************************************
                 * TEST CODE
                 ***************************************************/
                //self.setCurrentData(self.coordDb[i], dataList);
            }
        });
    }
    else {
        town.getCoord(function (err, listTownDb) {
            var collectShortInfo = new collectTown();
            collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_CURRENT, key, dateString.date, dateString.time, function (err, dataList) {

                log.info('current data receive completed : %d\n', dataList.length);

                for (var i = 0; i < listTownDb.length; i++) {
                    if (Array.isArray(dataList[i].data)) {
                        forecast.setCurrentData(dataList[i].data, listTownDb[i], function (err, res) {
                            if (err) {
                                log.error('** getTownCurrentData : ', err);
                                return;
                            }
                            //log.info(res);
                        });
                    }
                }
            });

        });
    }
};

Manager.prototype.startTownData = function(){
    var self = this;

    // When the server is about to start, it would get the first data immediately.
    self.getTownShortData(-39);
    self.getTownShortData(9);
    //self.getTownShortestData();
    self.getTownCurrentData();

    // get short forecast once every three hours.
    self.loopTownShortID = setInterval(function() {
        "use strict";

        self.getTownShortData(9);

    }, self.TIME_PERIOD.TOWN_SHORT);

    /*
    // get shortest forecast once every hours.
    self.loopTownShortestID = setInterval(function(){
        "use strict";

        self.getTownShortestData();
    }, self.TIME_PERIOD.TOWN_SHORTEST);
    */

    // get shortest forecast once every hours.
    self.loopTownCurrentID = setInterval(function(){
        "use strict";

        self.getTownCurrentData();
    }, self.TIME_PERIOD.TOWN_CURRENT);
};

Manager.prototype.stopTownData = function(){
    var self = this;

    if(self.loopTownShortID !== undefined){
        clearInterval(self.loopTownShortID);
        self.loopTownShortID = undefined;
    }

    if(self.loopTownShortestID !== undefined){
        clearInterval(self.loopTownShortestID);
        self.loopTownShortestID = undefined;
    }

    if(self.loopTownCurrentID !== undefined){
        clearInterval(self.loopTownCurrentID);
        self.loopTownCurrentID = undefined;
    }
};

Manager.prototype.startManager = function(){
    var self = this;

    self.startTownData();
};

Manager.prototype.stopManager = function(){
    var self = this;

    self.stopTownData();
};

module.exports = Manager;
