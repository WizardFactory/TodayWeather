/**
 * Created by Peter on 2015. 8. 26..
 */
"use strict";

var collectTown = require('../lib/collectTownForecast');
var listKey = require('../config/keydata');
var town = require('../models/town');
var forecast = require('../models/forecast');

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
    self.TIME_PERIOD.TOWN_SHORT = (1000*5);
    //self.TIME_PERIOD.TOWN_SHORTEST = (1000*10);
    self.TIME_PERIOD.TOWN_CURRENT = (1000*10); //(1000*60*60)
    /****************************************************************************/
}

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

Manager.prototype.getTownShortData = function(){
    var self = this;
    //var testListTownDb = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

    var currentDate = self.getWorldTime(+9);
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
        var temp = self.getWorldTime(-15);
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

    log.info('+++ GET SHORT INFO : ', dateString);

    town.getCoord(function(err, listTownDb){
        if(err){
            log.error('** getTownShortData : ', err);
            log.error(meta);
            return;
        }

        log.info(listTownDb);
        log.info('+++ COORD LIST : ', listTownDb.length);

        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_SHORT, listKey.keyString.hyunsoo, dateString.date, dateString.time, function(err, dataList){
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

    town.getCoord(function(err, listTownDb){
        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_SHORTEST, listKey.keyString.pokers, dateString.date, dateString.time, function(err, dataList){

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

    town.getCoord(function(err, listTownDb){
        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_CURRENT, listKey.keyString.hyunsoo, dateString.date, dateString.time, function(err, dataList){

            log.info('current data receive completed : %d\n', dataList.length);

            for(var i = 0 ; i < listTownDb.length ; i ++){
                if(Array.isArray(dataList[i].data)){
                    forecast.setCurrentData(dataList[i].data, listTownDb[i], function(err, res){
                        if(err){
                            log.error('** getTownCurrentData : ', err);
                            return;
                        }
                        //log.info(res);
                    });
                }
            }
        });

    });
};

Manager.prototype.startTownData = function(){
    var self = this;

    // get short forecast once every three hours.
    self.loopTownShortID = setInterval(function() {
        "use strict";

        self.getTownShortData();
        clearInterval(self.loopTownShortID);

    }, self.TIME_PERIOD.TOWN_SHORT);

    // get shortest forecast once every hours.
    self.loopTownShortestID = setInterval(function(){
        "use strict";

        self.getTownShortestData();
    }, self.TIME_PERIOD.TOWN_SHORTEST);

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
