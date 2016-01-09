/**
 * Created by Peter on 2015. 8. 26..
 */
"use strict";

var fs = require('fs');
var async = require('async');

var collectTown = require('../lib/collectTownForecast');
var town = require('../models/town');
//var forecast = require('../models/forecast');
//var short = require('../models/short');
//var shortest = require('../models/shortest');
//var current = require('../models/current');
//var midLand = require('../models/midLand');
//var midTemp = require('../models/midTemp');
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
//var keydata = require('../config/keydata');

var midRssKmaRequester = new (require('../lib/midRssKmaRequester'))();
var PastConditionGather = require('../lib/PastConditionGather');

function Manager(){
    var self = this;

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
    self.MAX_SHORT_COUNT = 33;      //for pop
    self.MAX_CURRENT_COUNT = 192; //8days * 24hours
    self.MAX_SHORTEST_COUNT = 4; //4 hours
    self.MAX_MID_COUNT = 20;

    self.asyncTasks = [];

    /****************************************************************************
     *   THIS IS FOR TEST.
     ****************************************************************************/
    //self.TIME_PERIOD.TOWN_SHORT = (1000*25);
    //self.TIME_PERIOD.TOWN_SHORTEST = (1000*10);
    //self.TIME_PERIOD.TOWN_CURRENT = (1000*10); //(1000*60*60)
    /****************************************************************************/

    if(config.db.mode === 'ram'){
        self.makeTownlist();
    }else{
        self.makeRegIdTable();
    }
}

Manager.prototype.getRegIdByTown = function(region, city, cb){
    var self = this;
    var i;

    city = city.slice(0,3);
    //log.info(self.codeTable);
    for(i=0 ; i<self.codeTable.length ; i++){
        if(self.codeTable[i].first === region){
            // 0~7번까지는 특별시 혹은 광역시
            if(i<7){
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
        cb(new Error('Fail to find code table ', region, ' ', city));
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

Manager.prototype.makeTownlist = function(){
    var self = this;
    self.weatherDb = [];
    self.coordDb = [];
    self.midForecast = {
        midForecast: [],
        midLand: [],
        midTemp: [],
        midSea: []
    };
    self.codeTable = [];

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
                shortest: []
            }
        }
    };

    self.townCoordList = fs.readFileSync('./utils/data/part.csv').toString().split('\n');
    //self.townCoordList = fs.readFileSync('./utils/data/test.csv').toString().split('\n');
    self.townCoordList.shift(); // header remove

    self.townCoordList.forEach(function(line){
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

                log.info('mx:', weatherData.mData.mCoord.mx, 'my:',weatherData.mData.mCoord.my);
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
    //self.codeTable.forEach(function(item){
    //    log.info(item);
    //});
};

Manager.prototype.getWeatherDb = function(region, city, town, cb){
    var self = this;
    var err = 0;

    for(var index = 0 ; index < self.weatherDb.length; index++){
        var item = self.weatherDb[index];
        if(item.town.first === region && item.town.second === city && item.town.third === town){
            if(cb !== undefined){
                cb(err, self.weatherDb[index]);
            }
            return;
        }
    }

    convertGeocode(region, city,town, function(errCode, result){
        if(errCode){
            log.error('can not get mx, my');
            if(cb !== undefined){
                err = 1;
                cb(err);
            }
            return;
        }
        var index;
        for(index = 0 ; index < self.weatherDb.length; index++){
            var item = self.weatherDb[index];
            log.info('>> ', item.mData.mCoord.mx, item.mData.mCoord.my);
            if(item.mData.mCoord.mx === result.mx && item.mData.mCoord.my === result.my){
                if(cb !== undefined){
                    cb(err, self.weatherDb[index]);
                }
                return;
            }
        }

        if(index === self.weatherDb.length){
            err = 1;
        }

        if(cb !== undefined){
            cb(err, self.weatherDb[index]);
        }
    });
};

Manager.prototype.getSummary = function(cb){
    var self = this;

    var err = 0;
    var i;
    var result = {};

    log.info('getSummary');
    for(i=0 ; i<self.midForecast.midForecast.length ; i++){
        if('108' === self.midForecast.midForecast[i].data[0].pointNumber){
            result = self.midForecast.midForecast[i].data[0];
            break;
        }
    }

    log.info(result);
    if(cb != undefined){
        cb(err, result);
    }
};

Manager.prototype.getRegionSummary = function(region, cb){
    var self = this;
    var result = {
        forecast:{}
    };
    var err = 0;
    var currentCode = {};

    log.info('> getRegionSummary : ', region);

    // Get Code data
    for(var i=0 ; i<self.codeTable.length ; i++){
        if(self.codeTable[i].first === region){
            currentCode = self.codeTable[i];
            break;
        }
    }
    if(i >= self.codeTable.length){
        return {};
    }
    // find forecast data matched with code
    log.info('> pointNumber : ', currentCode.pointNumber);
    for(i=0 ; i<self.midForecast.midForecast.length ; i++){
        log.info('point number : ', self.midForecast.midForecast[i].data[0].pointNumber);
        if(currentCode.pointNumber === self.midForecast.midForecast[i].data[0].pointNumber){
            result.forecast = self.midForecast.midForecast[i].data[0];
            break;
        }
    }

    if(cb != undefined){
        cb(err, result);
    }

};

Manager.prototype.getMatchedData = function(code, dataList){
    for(var i in dataList){
        if(code === dataList[i].regId){
            return dataList[i];
        }
    }
    return {};
};

/*
 * 추후 이 method는 route로 빼야 할듯....
 */
Manager.prototype.getMidDb = function(region, city, cb){
    var self = this;
    var result = {
        forecast:{},
        land: {},
        temp: {}
    };
    var midData = {
        forecast: {},
        dailyData: []
    };

    var err = 0;
    var currentCode = {};
    var areaCode;
    var i;

    city = city.slice(0,3);
    log.info('> getMidDb : ', region, city);
    //log.info(self.midForecast.midLand[0].data[0].regId);
    // Get Code data
    for(i=0 ; i<self.codeTable.length ; i++){
        if(self.codeTable[i].first === region){
            // 0~7번까지는 특별시 혹은 광역시
            if(i<7){
                currentCode = self.codeTable[i];
                break;
            }
            else {
                if(self.codeTable[i].second === city){
                    currentCode = self.codeTable[i];
                    break;
                }
            }
        }
    }
    if(i >= self.codeTable.length){
        if(cb){
            cb(1);
        }
        return {};
    }

    // find forecast data matched with code
    log.info('> pointNumber : ', currentCode.pointNumber);
    for(i=0 ; i<self.midForecast.midForecast.length ; i++){
        log.info('point number : ', self.midForecast.midForecast[i].data[0].pointNumber);
        if(currentCode.pointNumber === self.midForecast.midForecast[i].data[0].pointNumber){
            midData.forecast = self.midForecast.midForecast[i].data[0];
            break;
        }
    }

    if(i>= self.midForecast.midForecast.length){
        if(cb){
            cb(1);
        }
        return {};
    }

    // find land forecast data matched with code
    areaCode = currentCode.cityCode.slice(0, 3);
    if(areaCode === '11B'){
        areaCode = '11B00000';
    }
    else if(areaCode === '21F'){
        areaCode = '11F10000';
    }
    else{
        areaCode = currentCode.cityCode.slice(0, 4) + '0000';
    }

    if(self.midForecast.midLand.length == 0){
        if(cb){
            cb(1);
        }
        return {};
    }
    log.info('> area Code : ', areaCode);
    // 가장 최근(오늘)데이터를 가져온다
    var todayData = self.midForecast.midLand[self.midForecast.midLand.length - 1].data;
    for(i=0 ; i<todayData.length ; i++){
        //log.info('reg id : ', todayData[i].regId);
        if(areaCode === todayData[i].regId){
            result.land = todayData[i];
            break;
        }
    }
    if(i >= todayData.length){
        if(cb){
            cb(1);
        }
        return {};
    }

    var item;
    var currentDate;
    for(i=0 ; i<8 ; i++){
        // 3일 후의 날짜를 계산한 다음 데이터를 가져와서 결과에 넣어 준다
        currentDate = self.getWorldTime(9+ 72 + (i * 24));
        item = {
            date: currentDate.slice(0, 8)
        };
        if(i===0){
            item.wfAm = result.land.wf3Am;
            item.wfPm = result.land.wf3Pm;
        }else if(i === 1){
            item.wfAm = result.land.wf4Am;
            item.wfPm = result.land.wf4Pm;
        }
        else if(i === 2){
            item.wfAm = result.land.wf5Am;
            item.wfPm = result.land.wf5Pm;
        }
        else if(i === 3){
            item.wfAm = result.land.wf6Am;
            item.wfPm = result.land.wf6Pm;
        }
        else if(i === 4){
            item.wfAm = result.land.wf7Am;
            item.wfPm = result.land.wf7Pm;
        }
        else if(i === 5){
            item.wfAm = result.land.wf8;
            item.wfPm = result.land.wf8;
        }
        else if(i === 6){
            item.wfAm = result.land.wf9;
            item.wfPm = result.land.wf9;
        }
        else if(i === 7){
            item.wfAm = result.land.wf10;
            item.wfPm = result.land.wf10;
        }
        else{
            log.error('there is no information');
        }

        midData.dailyData.push(JSON.parse(JSON.stringify(item)));
    }

    //log.info('get today data, go next : ', self.midForecast.midLand.length);
    // 11일 전의 데이터부터 차례차례 가져와서 과거의 날씨 정보를 채워 넣자...
    var targetDate;
    var j;
    var matchedDay;
    var matchedData;

    for(i = 10 ; i > 0 ; i--){
        currentDate = self.getWorldTime(9 - (i * 24));
        targetDate = self.getWorldTime(9 + 72 - (i * 24)); // 찾은 데이터는 3일 후의 날씨를 보여주기때문에 72를 더해야 함
        item = {
            date: targetDate.slice(0, 8)
        };
        currentDate = currentDate.slice(0, 8) + '1800';

        //log.info('find previous data : ', currentDate);
        for(j in self.midForecast.midLand){
            if(currentDate === self.midForecast.midLand[j].date){
                matchedDay = self.midForecast.midLand[j].data;
                matchedData = self.getMatchedData(areaCode, matchedDay);

                item.wfAm = matchedData.wf3Am;
                item.wfPm = matchedData.wf3Pm;
                midData.dailyData.push(JSON.parse(JSON.stringify(item)));
                break;
            }
        }
    }

    if(self.midForecast.midTemp.length == 0){
        if(cb){
            cb(1);
        }
        return {};
    }
    // find temperature data matched with code
    log.info('> city Code : ', currentCode.cityCode);
    todayData = self.midForecast.midTemp[self.midForecast.midTemp.length - 1].data;
    for(i=0 ; i<todayData.length ; i++){
        //log.info('reg id : ', todayData[i].regId);
        if(currentCode.cityCode === todayData[i].regId){
            result.temp = todayData[i];
            break;
        }
    }
    if(i>= todayData.length){
        if(cb){
            cb(1);
        }
        return {};
    }

    // temp값도 날짜별로 결과 오브젝트에 넣자..
    var notFound;
    for(i=0 ;i < 8 ; i++){
        notFound = 1;
        currentDate = self.getWorldTime(9 + 72 + (i * 24));
        currentDate = currentDate.slice(0, 8);
        for(j in midData.dailyData){
            if(currentDate === midData.dailyData[j].date){
                notFound = 0;
                break;
            }
        }

        if(notFound){
            continue;
        }

        if(i===0){
            midData.dailyData[j].taMin = result.temp.taMin3;
            midData.dailyData[j].taMax = result.temp.taMax3;
        }else if(i === 1){
            midData.dailyData[j].taMin = result.temp.taMin4;
            midData.dailyData[j].taMax = result.temp.taMax4;
        }
        else if(i === 2){
            midData.dailyData[j].taMin = result.temp.taMin5;
            midData.dailyData[j].taMax = result.temp.taMax5;
        }
        else if(i === 3){
            midData.dailyData[j].taMin = result.temp.taMin6;
            midData.dailyData[j].taMax = result.temp.taMax6;
        }
        else if(i === 4){
            midData.dailyData[j].taMin = result.temp.taMin7;
            midData.dailyData[j].taMax = result.temp.taMax7;
        }
        else if(i === 5){
            midData.dailyData[j].taMin = result.temp.taMin8;
            midData.dailyData[j].taMax = result.temp.taMax8;
        }
        else if(i === 6){
            midData.dailyData[j].taMin = result.temp.taMin9;
            midData.dailyData[j].taMax = result.temp.taMax9;
        }
        else if(i === 7){
            midData.dailyData[j].taMin = result.temp.taMin10;
            midData.dailyData[j].taMax = result.temp.taMax10;
        }
        else{
            log.error('there is no information');
        }
    }

    //log.info('get today data, go next : ', self.midForecast.midTemp.length);
    // 여기도 land와 마찬가지로 11일 전의 데이터부터 뒤져서 예전 예보 정보를 넣자..
    var targetDay;

    for(i = 10 ; i > 0 ; i--){
        currentDate = self.getWorldTime(9 - (i * 24));
        targetDay = self.getWorldTime(9 + 72 - (i * 24));
        targetDay = targetDay.slice(0, 8);
        notFound = 1;
        for(var x in midData.dailyData){
            if(targetDay === midData.dailyData[x].date){
                notFound = 0;
                break;
            }
        }
        if(notFound){
            continue;
        }

        currentDate = currentDate.slice(0, 8) + '1800';
        //log.info('find previous data : ', currentDate);
        for(j in self.midForecast.midTemp){
            if(currentDate === self.midForecast.midTemp[j].date){
                matchedDay = self.midForecast.midTemp[j].data;
                matchedData = self.getMatchedData(currentCode.cityCode, matchedDay);

                midData.dailyData[x].taMin = matchedData.taMin3;
                midData.dailyData[x].taMax = matchedData.taMax3;
                break;
            }
        }
    }

    log.info('result >> ', midData);

    midData.dailyData.sort(function(a, b){
        if(a.date > b.date){
            return 1;
        }

        if(a.date < b.date){
            return -1;
        }
        return 0;
    });

    if(cb !== undefined){
        cb(err, midData);
    }
    return midData;
};

Manager.prototype.setShortData = function(coord, dataList){
    var self = this;

    try{
        self.weatherDb.forEach(function(data){
            if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){
                var listShort = data.mData.data.short;
                var firstDate = 0;
                var firstTime = 0;
                var i;
                var popCount = 0;

                // find first item based on date&time
                for(i in dataList){
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

                //log.info('before len : ', listShort.length);
                //log.info('first date&time : ', firstDate, firstTime);

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
                            //log.info('remove : ' , listShort[i].date,' : ', listShort[i].time);
                        }
                    }
                }

                //log.info('before pop : ', popCount);
                for(i=0 ; i<popCount ; i++){
                    data.mData.data.short.pop();
                }

                if(data.mData.data.short.length > 16){
                    for(i=0 ; i< data.mData.data.short.length - 16 ; i++){
                        data.mData.data.short.shift();
                    }
                }

                //log.info('after pop : ', data.mData.data.short.length);
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

    return this;
};

Manager.prototype.setShortestData = function(coord, dataList){
    var self = this;

    self.weatherDb.forEach(function(data){
        if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){
            dataList.forEach(function(item){
                data.mData.data.shortest.push(JSON.parse(JSON.stringify(item)));
            });

            if(data.mData.data.shortest.length > 60){
                for(var i = 0 ; i < data.mData.data.shortest.length - 60 ; i++){
                    data.mData.data.shortest.shift();
                }
            }
        }
    });
};

Manager.prototype.setCurrentData = function(coord, dataList){
    var self = this;

    self.weatherDb.forEach(function(data){
        if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){
            var i;

            for(i in dataList){
                var item = dataList[i];
                data.mData.data.current.push(JSON.parse(JSON.stringify(item)));
            }

            if(data.mData.data.current.length > 170){
                for(i = 0 ; i < data.mData.data.current.length - 170 ; i++){
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
                        callback(err);
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
                if (self.saveOnlyLastOne) {
                    dbShortestList.shortestData = newData;
                }
                else {
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
                            if(comparedDate === 0){
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

            list.forEach(function(dbMidList){
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

Manager.prototype._recursiveRequestData = function(srcList, dataType, key, dateString, retryCount, callback) {
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

    collectInfo.requestData(srcList, dataType, key, dateString.date, dateString.time, function(err, dataList) {
        if (err) {
            log.verbose(dataTypeName, " It has items rcvFailed ");
            log.verbose(err);
        }
        log.info(dataTypeName, 'data receive completed : ', dataList.length);

        //log.info(dataList);
        //log.info(dataList[0]);

        async.mapSeries(dataList,
            function(item, cb) {
                if (item.isCompleted) {
                    self.getSaveFunc(dataType).call(self, item.data, function (err) {
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
                if (err) {
                    log.error(err);
                }
                if (failedList.length) {
                    return self._recursiveRequestData(failedList, dataType, key, dateString, --retryCount, callback);
                }
                log.info('received All ', dataTypeName, ' of ', dateString);
                if (callback) {
                    callback(err, results);
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
                    log.verbose(dataTypeName, " request retry mx:",item.mCoord.mx,' my:',item.mCoord.my);
                    failedList.push(item.mCoord);
                    //this index was not rcvData
                    cb(undefined, item);
                }
            },
            function (err, results) {
                if (err) {
                    log.error(err);
                }
                if (failedList.length) {
                    return self._recursiveRequestDataByBaseTimList(dataType, key, mCoord, baseTimeList, --retryCount, callback);
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

Manager.prototype.getTownShortData = function(baseTime, key, callback){
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
    if(parseInt(time) < 230){
        var temp = self.getWorldTime(baseTime - 24);
        dateString.date = temp.slice(0,8);
        dateString.time = '2300';
    }
    else if(parseInt(time) < 530) {
        dateString.time = '0200';
    }
    else if(parseInt(time) < 830){
        dateString.time = '0500';
    }
    else if(parseInt(time) < 1130){
        dateString.time = '0800';
    }
    else if(parseInt(time) < 1430){
        dateString.time = '1100';
    }
    else if(parseInt(time) < 1730){
        dateString.time = '1400';
    }
    else if(parseInt(time) < 2030){
        dateString.time = '1700';
    }
    else if(parseInt(time) < 2330){
        dateString.time = '2000';
    }
    else if(parseInt(time) >= 2330){
        dateString.time = '2300';
    }
    else{
        log.error('unknown TimeString');
        return this;
    }

    log.info('S> +++ GET SHORT INFO : ', dateString);

    if(config.db.mode === 'ram'){
        log.info('+++ SHORT COORD LIST : ', self.coordDb.length);

        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(self.coordDb, collect.DATA_TYPE.TOWN_SHORT, key, dateString.date, dateString.time, function(err, dataList) {
            if(err){
                log.error('** getTownShortData : ', err);
                /* 모두 가지고 오지 못하더라도 일부 저장함 */
            }

            log.info('S> data receive completed : ', dataList.length);
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
            }
            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else{
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

            self._checkPubDate(modelShort, listTownDb, dateString, function (err, srcList) {
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

                self._recursiveRequestData(srcList, self.DATA_TYPE.TOWN_SHORT, key, dateString, 30, function (err, results) {
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
    }

    return this;
};

Manager.prototype.getTownShortestData = function(baseTime, key, callback){
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

    if(parseInt(minute) <= 40){
        currentDate = self.getWorldTime(+8);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '30';
    }
    else{
        dateString.time = hour + '30';
    }

    log.info('ST> +++ GET SHORTEST INFO : ', dateString);

    /***************************************************/

    if(config.db.mode === 'ram'){
        log.info('ST> +++ GET SHORTEST : ', self.coordDb.length);

        /**************************************************
         * TEST CODE
         ***************************************************/
        //var index = this.currentCount % 100;
        //this.currentCount++;
        //var dataList = config.mData.data.current.slice(index, index+1);

        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(self.coordDb, collect.DATA_TYPE.TOWN_SHORTEST, key, dateString.date, dateString.time, function (err, dataList) {

            log.info('ST> data receive completed : ', dataList.length);

            for (var i = 0; i < self.coordDb.length; i++) {
                if (Array.isArray(dataList[i].data)) {
                    self.setShortestData(self.coordDb[i], dataList[i].data);
                }

                /**************************************************
                 * TEST CODE
                 ***************************************************/
                //self.setCurrentData(self.coordDb[i], dataList);
            }
            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else{
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
                self._recursiveRequestData(srcList, self.DATA_TYPE.TOWN_SHORTEST, key, dateString, 30, function (err, results) {
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
    }
    return this;
};

Manager.prototype.getTownCurrentData = function(gmt, key, callback){
    var self = this;

    var currentDate = self.getWorldTime(gmt);
    var dateString = {
        date: currentDate.slice(0, 8),
        time: currentDate.slice(8,10) + '00'
    };

    // 아직 발표 전 시간 대라면 1시간을 뺀 시간을 가져온다.
    if(parseInt(currentDate.slice(10,12)) < 35){
        currentDate = self.getWorldTime(gmt - 1);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '00'
    }

    //log.info(currentDate);
    //log.info(hour, minute);

    log.info('C> +++ GET CURRENT INFO : ', dateString);

    if(config.db.mode === 'ram'){
        log.info('C> +++ COORD LIST : ', self.coordDb.length);

        /**************************************************
         * TEST CODE
         ***************************************************/
        //var index = this.currentCount % 100;
        //this.currentCount++;
        //var dataList = config.mData.data.current.slice(index, index+1);

        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(self.coordDb, collect.DATA_TYPE.TOWN_CURRENT, key, dateString.date, dateString.time, function (err, dataList) {

            log.info('C> data receive completed : ', dataList.length);

            for (var i = 0; i < self.coordDb.length; i++) {
                if (Array.isArray(dataList[i].data)) {
                    self.setCurrentData(self.coordDb[i], dataList[i].data);
                }

                /**************************************************
                 * TEST CODE
                 ***************************************************/
                //self.setCurrentData(self.coordDb[i], dataList);
            }
            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else {
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

            self._checkPubDate(modelCurrent, listTownDb, dateString, function (err, srcList) {
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

                self._recursiveRequestData(srcList, self.DATA_TYPE.TOWN_CURRENT, key, dateString, 30, function (err, results) {
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
    }
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

    if(config.db.mode === 'ram'){
        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(collect.listPointNumber, collect.DATA_TYPE.MID_FORECAST, key, dateString.date, dateString.time, function(err, dataList){
            if(err){
                log.error("middle forecast data receive failed");
                /* 모두 가지고 오지 못하더라도 일부 저장함 */
            }
            log.info('MF> data receive completed : ', dataList.length);

            //log.info(dataList);
            //log.info(dataList[0]);
            //for(var i in dataList){
            //    for(var j in dataList[i].data){
            //        log.info(i, j, ' : ', dataList[i].data[j]);
            //    }
            //}

            //self.midForecast.midForecast = dataList;
            dataList.forEach(function (item) {
                    self.midForecast.midForecast = [];
                    self.midForecast.midForecast.push(JSON.parse(JSON.stringify(item)));
            });
            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else {
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

            self._recursiveRequestData(srcList, self.DATA_TYPE.MID_FORECAST, key, dateString, 10, function (err, results) {
                log.info('MF> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err) {
                    return log.error(err);
                }
            });
        });
    }
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

    if(config.db.mode === 'ram') {
        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(collect.listAreaCode, collect.DATA_TYPE.MID_LAND, key, dateString.date, dateString.time, function (err, dataList) {
            if (err) {
                log.error("middle land data receive failed");
                /* 모두 가지고 오지 못하더라도 일부 저장함 */
            }
            log.info('ML> data receive completed : ', dataList.length);

            //log.info(dataList);
            //for(var i in dataList){
            //    for(var j in dataList[i].data){
            //        log.info(i, j, ' : ', dataList[i].data[j]);
            //    }
            //}
            var isNotExist = 1;
            var dataFormat = {
                date: dateString.date + dateString.time,
                data: []
            };

            dataList.forEach(function (item) {
                if (item.isCompleted) {
                    dataFormat.data.push(JSON.parse(JSON.stringify(item.data[0])));
                }
            });

            self.midForecast.midLand.forEach(function (item) {
                if (item.date == dataFormat.date) {
                    isNotExist = 0;
                    log.error('Land data> it is already existed : ', dataFormat.date);
                }
            });

            if (isNotExist) {
                self.midForecast.midLand.push(dataFormat);

                if (self.midForecast.midLand.length > 26) {
                    self.midForecast.midLand.shift();
                }
            }
            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else {
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

            self._recursiveRequestData(srcList, self.DATA_TYPE.MID_LAND, key, dateString, 10, function (err, results) {
                log.info('ML> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err) {
                    return log.error(err);
                }
            });
        });
    }

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

    if(config.db.mode === 'ram') {
        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(collect.listCityCode, collect.DATA_TYPE.MID_TEMP, key, dateString.date, dateString.time, function (err, dataList) {
            if (err) {
                log.error("middle TEMP forecast data receive failed");
                /* 모두 가지고 오지 못하더라도 일부 저장함 */
            }
            log.info('MT> data receive completed : ', dataList.length);

            //log.info(dataList);
            //log.info(dataList[0]);
            //for(var i in dataList){
            //    for(var j in dataList[i].data){
            //        log.info(i, j, ' : ', dataList[i].data[j]);
            //    }
            //}

            var isNotExist = 1;
            var dataFormat = {
                date: dateString.date + dateString.time,
                data: []
            };
            dataList.forEach(function (item) {
                if (item.isCompleted) {
                    dataFormat.data.push(JSON.parse(JSON.stringify(item.data[0])));
                }
            });

            self.midForecast.midTemp.forEach(function (item) {
                if (item.date == dataFormat.date) {
                    isNotExist = 0;
                    log.error('Temp Data> it is already existed : ', dataFormat.date);
                }
            });

            if (isNotExist) {
                self.midForecast.midTemp.push(dataFormat);

                if (self.midForecast.midTemp.length > 26) {
                    self.midForecast.midTemp.shift();
                }
            }

            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else {
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

            self._recursiveRequestData(srcList, self.DATA_TYPE.MID_TEMP, key, dateString, 10, function (err, results) {
                log.info('MT> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err) {
                    return log.error(err);
                }
            });
        });
    }

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

    if(config.db.mode === 'ram') {
        var collect = new collectTown({timeout: 2000, retryCount: 3});
        collect.requestData(collect.listSeaCode, collect.DATA_TYPE.MID_SEA, key, dateString.date, dateString.time, function (err, dataList) {
            if (err) {
                log.error("middle SEA forecast data receive failed");
                /* 모두 가지고 오지 못하더라도 일부 저장함 */
            }
            log.info('MS> data receive completed : ', dataList.length);

            //log.info(dataList);
            //log.info(dataList[0]);
            //for(var i in dataList){
            //    for(var j in dataList[i].data){
            //        log.info(dataList[i].data[j]);
            //    }
            //}

            var dataFormat = {
                date: dateString.date + dateString.time,
                data: []
            };
            dataList.forEach(function (item) {
                if (item.isCompleted) {
                    dataFormat.data.push(JSON.parse(JSON.stringify(item.data[0])));
                }
            });
            self.midForecast.midSea.push(dataFormat);

            if (self.midForecast.midSea.length > 26) {
                self.midForecast.midSea.shift();
            }
            if (callback) {
                callback(err, dataList);
            }
        });
    }
    else {

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

            self._recursiveRequestData(srcList, self.DATA_TYPE.MID_SEA, key, dateString, 10, function (err, results) {
                log.info('MD> save OK');
                if (callback) {
                    return callback(err, results);
                }
                if (err)  {
                    return log.error(err);
                }
            });
        });
    }
    return this;
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
            return this.saveCurrent;
        case this.DATA_TYPE.TOWN_SHORTEST:
            return this.saveShortest;
        case this.DATA_TYPE.TOWN_SHORT:
            return this.saveShort;
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

Manager.prototype.checkTimeAndPushTask = function (putAll) {
    var self = this;
    var time = (new Date()).getUTCMinutes();

    var server_key = config.keyString.cert_key;
    var normal_key = config.keyString.normal;

    log.info('check time and push task');

    if (time === 1 || putAll) {
        //short rss
        log.info('push short rss');
        self.asyncTasks.push(function (callback) {
            //need to update sync
            townRss.mainTask();
            setTimeout(function () {
                log.info('Finished ShortRss '+new Date());
                callback();
            }, 1000*60); //1min
        });
        log.info('push mid rss');
        self.asyncTasks.push(function (callback) {
            midRssKmaRequester.mainProcess(midRssKmaRequester, function (self, err) {
                log.info('Finished MidRss '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
    }

    if (time === 2 || putAll) {
        log.info('push MidTemp');
        self.asyncTasks.push(function (callback) {
            self.getMidTemp(9, normal_key, function (err) {
                log.info('Finished MidTemp '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
        log.info('push MidLand');
        self.asyncTasks.push(function (callback) {
            self.getMidLand(9, normal_key, function (err) {
                log.info('Finished MidLand '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
        log.info('push MidForecast');
        self.asyncTasks.push(function (callback) {
            self.getMidForecast(9, normal_key, function (err) {
                log.info('Finished MidForecast '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
        log.info('push MidSea');
        self.asyncTasks.push(function (callback) {
            self.getMidSea(9, normal_key, function (err) {
                log.info('Finished MidSea '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
    }

    if (time === 10 || putAll) {
        log.info('push PastConditionGather');
        self.asyncTasks.push(function (callback) {
            var pastGather = new PastConditionGather();

            pastGather.start(1, server_key, function (err) {
                log.info('Finished PastConditionGather '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
    }

    if (time === 31 || putAll) {
        log.info('push Short');
        self.asyncTasks.push(function (callback) {
            self.getTownShortData(9, server_key, function (err) {
                log.info('Finished Short '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
    }

    if (time === 41 || putAll) {
        log.info('push Shortest');
        self.asyncTasks.push(function (callback) {
            self.getTownShortestData(9, server_key, function (err) {
                log.info('Finished Shortest '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
        log.info('push Current');
        self.asyncTasks.push(function (callback) {
            self.getTownCurrentData(9, server_key, function (err) {
                log.info('Finished Current '+new Date());
                if (err) {
                    log.error(err);
                }
                callback();
            });
        });
    }

    log.info('wait '+self.asyncTasks.length+' tasks');
};

Manager.prototype.startManager = function(){
    var self = this;

    midRssKmaRequester.setNextGetTime(new Date());
    townRss.loadList();

    self.checkTimeAndPushTask(true);
    self.task();
    setInterval(function() {
       self.checkTimeAndPushTask(false) ;
    }, 1000*60);
};

Manager.prototype.stopManager = function(){
    //var self = this;
    //self.stopTownData();
};

module.exports = Manager;
