/**
 * Created by Peter on 2015. 8. 26..
 */
"use strict";

var collectTown = require('../lib/collectTownForecast');
var town = require('../models/town');
//var forecast = require('../models/forecast');
//var short = require('../models/short');
//var shortest = require('../models/shortest');
//var current = require('../models/current');
//var midLand = require('../models/midLand');
//var midTemp = require('../models/midTemp');
var fs = require('fs');
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
var keydata = require('../config/keydata');

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

    self.MAX_SHORT_COUNT = 100;
    self.MAX_CURRENT_COUNT = 100;
    self.MAX_SHORTEST_COUNT = 24;
    self.MAX_MID_COUNT = 20;

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
                cb(err, self.weatherDb[index]);
            }
            return;
        }
        var index = 0;
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
    var i=0;
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
    var areaCode = '';

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
    var areaCode = '';
    var i=0;

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

    for(i=0 ; i<8 ; i++){
        // 3일 후의 날짜를 계산한 다음 데이터를 가져와서 결과에 넣어 준다
        var currentDate = self.getWorldTime(9+ 72 + (i * 24));
        var item = {
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
    for(i = 10 ; i > 0 ; i--){
        var currentDate = self.getWorldTime(9 - (i * 24));
        var targetDate = self.getWorldTime(9 + 72 - (i * 24)); // 찾은 데이터는 3일 후의 날씨를 보여주기때문에 72를 더해야 함
        var item = {
            date: targetDate.slice(0, 8)
        };
        currentDate = currentDate.slice(0, 8) + '1800';

        //log.info('find previous data : ', currentDate);
        for(var j in self.midForecast.midLand){
            if(currentDate === self.midForecast.midLand[j].date){
                var matchedDay = self.midForecast.midLand[j].data;
                var matchedData = self.getMatchedData(areaCode, matchedDay);

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
    for(i=0 ;i < 8 ; i++){
        var notFound = 1;
        var currentDate = self.getWorldTime(9 + 72 + (i * 24));
        currentDate = currentDate.slice(0, 8);
        for(var j in midData.dailyData){
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
    for(i = 10 ; i > 0 ; i--){
        var currentDate = self.getWorldTime(9 - (i * 24));
        var targetDay = self.getWorldTime(9 + 72 - (i * 24));
        targetDay = targetDay.slice(0, 8);
        var notFound = 1;
        for(var x in midData.dailyData){
            if(targetDay === midData.dailyData[x].date){
                notFound = 0;
                break;
            }
        }
        if(notFound){
            continue;
        }

        var targetDate = currentDate;
        currentDate = currentDate.slice(0, 8) + '1800';
        //log.info('find previous data : ', currentDate);
        for(var j in self.midForecast.midTemp){
            if(currentDate === self.midForecast.midTemp[j].date){
                var matchedDay = self.midForecast.midTemp[j].data;
                var matchedData = self.getMatchedData(currentCode.cityCode, matchedDay);

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
        self.weatherDb.forEach(function(data, index){
            if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){
                var listShort = data.mData.data.short;
                var firstDate = 0;
                var firstTime = 0;
                var i=0;
                var popCount = 0;

                // find first item based on date&time
                for(var i in dataList){
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

    self.weatherDb.forEach(function(data, index){
        if(data.mData.mCoord.mx === coord.mx && data.mData.mCoord.my === coord.my){

            for(var i in dataList){
                var item = dataList[i];
                data.mData.data.current.push(JSON.parse(JSON.stringify(item)));
            }

            if(data.mData.data.current.length > 170){
                for(var i = 0 ; i < data.mData.data.current.length - 170 ; i++){
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
Manager.prototype.saveShort = function(newData){
    var self = this;

    //log.info('S> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    //log.info('S> db find :', coord);
    try{
        modelShort.find({mCoord: coord}, function(err, list){
            if(err){
                log.error('S> fail to find db item');
                return;
            }

            if(list.length === 0){
                var newItem = new modelShort({mCoord: coord, shortData: newData});
                newItem.save(function(err){
                    if(err){
                        log.error('S> fail to save to DB :', coord);
                        return;
                    }
                });

                //log.info('S> add new Item : ', newData);
                return;
            }

            //log.info('found db item : ', list.length);

            list.forEach(function(dbShortList, index){
                //log.info('S> coord :', dbShortList.mCoord.mx, dbShortList.mCoord.my);
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
                            dbShortList.shortData[i].pop = newItem.pop;
                            dbShortList.shortData[i].pty = newItem.pty;
                            dbShortList.shortData[i].r06 = newItem.r06;
                            dbShortList.shortData[i].reh = newItem.reh;
                            dbShortList.shortData[i].s06 = newItem.s06;
                            dbShortList.shortData[i].sky = newItem.sky;
                            dbShortList.shortData[i].t3h = newItem.t3h;
                            dbShortList.shortData[i].tmn = newItem.tmn;
                            dbShortList.shortData[i].tmx = newItem.tmx;
                            dbShortList.shortData[i].uuu = newItem.uuu;
                            dbShortList.shortData[i].vvv = newItem.vvv;
                            dbShortList.shortData[i].wav = newItem.wav;
                            dbShortList.shortData[i].vec = newItem.vec;
                            dbShortList.shortData[i].wsd = newItem.wsd;
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
                    dbShortList.shortData.slice(0, (dbShortList.shortData.length - self.MAX_SHORT_COUNT));
                }
                //log.info(dbShortList.shortData);
                dbShortList.save(function(err){
                    if(err){
                        log.error('S> fail to save');
                    }
                });
            });
        });
    }
    catch(e){
        log.error('S> error!!! saveShort');
    }
};


/*
 *   save current data to DB.
 *   @param newData - only one town's data list.
 */
Manager.prototype.saveCurrent = function(newData){
    var self = this;

    //log.info('C> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    //log.info('C> db find :', coord);
    try{
        modelCurrent.find({mCoord: coord}, function(err, list){
            if(err){
                log.error('C> fail to find db item');
                return;
            }

            if(list.length === 0){
                var newItem = new modelCurrent({mCoord: coord, currentData: newData});
                newItem.save(function(err){
                    if(err){
                        log.error('C> fail to save to DB :', coord);
                        return;
                    }
                });

                //log.info('C> add new Item : ', newData);
                return;
            }

            //log.info('C> found db item : ', list.length);

            list.forEach(function(dbCurrentList, index){
                //log.info('C> coord :', dbCurrentList.mCoord.mx, dbCurrentList.mCoord.my);
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
                            dbCurrentList.currentData[i].t1h = newItem.t1h;
                            dbCurrentList.currentData[i].rn1 = newItem.rn1;
                            dbCurrentList.currentData[i].sky = newItem.sky;
                            dbCurrentList.currentData[i].uuu = newItem.uuu;
                            dbCurrentList.currentData[i].vvv = newItem.vvv;
                            dbCurrentList.currentData[i].reh = newItem.reh;
                            dbCurrentList.currentData[i].pty = newItem.pty;
                            dbCurrentList.currentData[i].lgt = newItem.lgt;
                            dbCurrentList.currentData[i].vec = newItem.vec;
                            dbCurrentList.currentData[i].wsd = newItem.wsd;
                            isNew = 0;
                            break;
                        }
                    }

                    if(isNew){
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
                    dbCurrentList.currentData.slice(0, (dbCurrentList.currentData.length - self.MAX_CURRENT_COUNT));
                }
                //log.info(dbCurrentList.currentData);
                dbCurrentList.save(function(err){
                    if(err){
                        log.error('C> fail to save');
                    }
                });
            });
        });
    }
    catch(e){
        log.error('C> error!!! saveShort');
    }
};


/*
 *   save shortest data to DB.
 *   @param newData - only one town's data list.
 */
Manager.prototype.saveShortest = function(newData){
    var self = this;

    //log.info('ST> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    //log.info('ST> db find :', coord);
    try{
        modelShortest.find({mCoord: coord}, function(err, list){
            if(err){
                log.error('ST> fail to find db item');
                return;
            }

            if(list.length === 0){
                var newItem = new modelShortest({mCoord: coord, shortestData: newData});
                newItem.save(function(err){
                    if(err){
                        log.error('ST> fail to save to DB :', coord);
                        return;
                    }
                });

                //log.info('ST> add new Item : ', newData);
                return;
            }

            //log.info('ST> found db item : ', list.length);

            list.forEach(function(dbShortestList, index){
                //log.info('ST> coord :', dbShortestList.mCoord.mx, dbShortestList.mCoord.my);
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
                            dbShortestList.shortestData[i].pty = newItem.pty;
                            dbShortestList.shortestData[i].rn1 = newItem.rn1;
                            dbShortestList.shortestData[i].sky = newItem.sky;
                            dbShortestList.shortestData[i].lgt = newItem.lgt;
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

                if(dbShortestList.shortestData.length > self.MAX_CURRENT_COUNT){
                    dbShortestList.shortestData.slice(0, (dbShortestList.shortestData.length - self.MAX_SHORTEST_COUNT));
                }
                //log.info(dbShortestList.shortestData);
                dbShortestList.save(function(err){
                    if(err){
                        log.error('ST> fail to save');
                    }
                });
            });
        });
    }
    catch(e){
        log.error('ST> error!!! saveShort');
    }
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
        log.error('It is not known object');
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
Manager.prototype.saveMid = function(db, newData){
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

    //log.info(newData);
    try{
        // find data from DB
        db.find({regId: regId}, function(err, list){
            if(err){
                log.error('M> fail to find db item');
                return;
            }

            // If there is no data, it would make the new data list.
            if(list.length === 0){
                var newItem = new db({regId: regId, data: [newData]});
                newItem.save(function(err){
                    if(err){
                        log.error('M> fail to save to DB :', regId);
                        return;
                    }
                });

                //log.info('M> add new Item : ', newData);
                return;
            }

            list.forEach(function(dbShortestList, index){
                var isNew = 1;
                for(var i=0 ; i < dbShortestList.data.length ; i++){
                    var comparedDate = self.compareDate(
                        {date:dbShortestList.data[i].date, time:dbShortestList.data[i].time},
                        {date:newData.date, time:newData.time}
                    );

                    // If there is the same date in the DB, it would be replaced by new data.
                    if(comparedDate === 0){
                        // over write
                        dbShortestList.data[i] = self.dupMid(newData, dbShortestList.data[i]);
                        //log.info('overwrite :', newData);
                        isNew = 0;
                        break;
                    }
                }

                if(isNew){
                    //log.info('M> push data :', newItem);
                    dbShortestList.data.push(newData);
                }

                dbShortestList.data.sort(function(a, b){
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

                if(dbShortestList.data.length > self.MAX_MID_COUNT){
                    dbShortestList.data.slice(0, (dbShortestList.data.length - self.MAX_MID_COUNT));
                }
                dbShortestList.save(function(err){
                    if(err){
                        log.error('M> fail to save');
                    }
                });
            });
        });
    }
    catch(e){
        log.error('M> error!!! saveMid');
        log.error(meta);
    }
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
        dateString.date = temp.slice(0,8);
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
        return this;
    }

    /**************************************************
    * TEST CODE : KEY change
    ***************************************************/
    var key = '';
    //if(parseInt(dateString.time) < 800){
    //    key = listKey.keyString.pokers;
    //} else if(parseInt(dateString.time) < 1700) {
    //    key = listKey.keyString.pokers11;
    //} else {
    //    key = listKey.keyString.aleckim;
    //}
    key = config.keyString.cert_key;
    /***************************************************/

    log.info('S> +++ GET SHORT INFO : ', dateString);

    if(config.db.mode === 'ram'){
        log.info('+++ SHORT COORD LIST : ', self.coordDb.length);

        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(self.coordDb, collectShortInfo.DATA_TYPE.TOWN_SHORT, key, dateString.date, dateString.time, function(err, dataList){
            if(err){
                log.error('** getTownShortData : ', err);
                log.error(meta);
                return this;
            }

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
            }
        });
    }
    else{
        town.getCoord(function(err, listTownDb){
            if(err){
                log.error('** getTownShortData : ', err);
                log.error(meta);
                return this;
            }

            log.silly(listTownDb);
            //log.info('S> +++ SHORT COORD LIST : ', listTownDb.length);
            //log.info('S> try to get short data : ', listTownDb.length);

            var collectShortInfo = new collectTown();
            collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_SHORT, key, dateString.date, dateString.time, function(err, dataList){
                if(err){
                    log.error('** getTownShortData : ', err);
                    log.error(meta);
                    return this;
                }

                log.info('S> short data receive completed : %d\n', dataList.length);
                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i=0 ; i<10 ; i++){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                dataList.forEach(function(item){

                    self.saveShort(item.data);
                });
                //log.info('S> save OK');
            });
        });
    }

    return this;
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

    if(parseInt(minute) <= 40){
        currentDate = self.getWorldTime(+8);
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '30';
    }
    else{
        dateString.time = hour + '30';
    }

    log.info('ST> +++ GET SHORTEST INFO : ', dateString);
    /**************************************************
     * TEST CODE : KEY change
     ***************************************************/
    var key = '';
    //if(parseInt(dateString.time) < 800){
    //    key = keydata.keyString.sooyeon;
    //} else if(parseInt(dateString.time) < 1700) {
    //    key = keydata.keyString.pokers11;
    //} else {
    //    key = keydata.keyString.aleckim;
    //}

    key = keydata.keyString.cert_key;
    /***************************************************/

    if(config.db.mode === 'ram'){
        log.info('ST> +++ GET SHORTEST : ', self.coordDb.length);

        /**************************************************
         * TEST CODE
         ***************************************************/
        //var index = this.currentCount % 100;
        //this.currentCount++;
        //var dataList = config.mData.data.current.slice(index, index+1);

        var collectShortInfo = new collectTown();
        collectShortInfo.requestData(self.coordDb, collectShortInfo.DATA_TYPE.TOWN_SHORTEST, key, dateString.date, dateString.time, function (err, dataList) {

            log.info('ST> shortest data receive completed : %d\n', dataList.length);

            for (var i = 0; i < self.coordDb.length; i++) {
                if (Array.isArray(dataList[i].data)) {
                    self.setShortestData(self.coordDb[i], dataList[i].data);
                }

                /**************************************************
                 * TEST CODE
                 ***************************************************/
                //self.setCurrentData(self.coordDb[i], dataList);
            }
        });
    }
    else{
        town.getCoord(function(err, listTownDb){
            if(err){
                log.error('** getTownShortestData : ', err);
                log.error(meta);
                return this;
            }

            log.silly(listTownDb);
            //log.info('ST> +++ SHORTEST COORD LIST : ', listTownDb.length);

            var collectShortInfo = new collectTown();
            collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_SHORTEST, key, dateString.date, dateString.time, function(err, dataList){

                log.info('ST> shortest data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);

                dataList.forEach(function(item){
                    self.saveShortest(item.data);
                });

                //log.info('ST> save OK');
            });
        });
    }
};

Manager.prototype.getTownCurrentData = function(gmt){
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
    /**************************************************
     * TEST CODE : KEY change
     ***************************************************/
    var key = '';
    //if(parseInt(dateString.time) < 800){
    //    key = keydata.keyString.sooyeon;
    //} else if(parseInt(dateString.time) < 1700) {
    //    key = keydata.keyString.hyunsoo;
    //} else {
    //    key = keydata.keyString.aleckim;
    //}
    key = keydata.keyString.pokers;
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
            //log.info('C> try to get current data');
            var collectShortInfo = new collectTown();
            collectShortInfo.requestData(listTownDb, collectShortInfo.DATA_TYPE.TOWN_CURRENT, key, dateString.date, dateString.time, function (err, dataList) {

                log.info('C> current data receive completed : %d\n', dataList.length);

                dataList.forEach(function(item){
                    self.saveCurrent(item.data);
                });

                //log.info('C> save OK');
            });

        });
    }
};

// get breif middle range forecast data from data.org by using collectTownForecast.js
Manager.prototype.getMidForecast = function(gmt){
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

    var key = keydata.keyString.pokers;

    log.info('+++ GET MID Forecast : ', dateString);

    var collectShortInfo = new collectTown();
    collectShortInfo.requestData(collectShortInfo.listPointNumber, collectShortInfo.DATA_TYPE.MID_FORECAST, key, dateString.date, dateString.time, function(err, dataList){
        if(err){
            log.error("middle forecst data recdive faile");
            return;
        }
        log.info('mid forecast data receive completed : %d\n', dataList.length);

        //log.info(dataList);
        //log.info(dataList[0]);
        //for(var i in dataList){
        //    for(var j in dataList[i].data){
        //        log.info(i, j, ' : ', dataList[i].data[j]);
        //    }
        //}

        //self.midForecast.midForecast = dataList;
        dataList.forEach(function (item) {
            if(config.db.mode === 'ram') {
                self.midForecast.midForecast = [];
                self.midForecast.midForecast.push(JSON.parse(JSON.stringify(item)));
            } else{
                //log.info(item.data[0]);
                self.saveMid(modelMidForecast, item.data[0]);
            }
        });
    });
};

// get middle range LAND forecast data from data.org by using collectTownForecast.js
Manager.prototype.getMidLand = function(gmt){
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

    var key = config.keyString.cert_key;

    log.info('+++ GET MID LAND Forecast : ', dateString);

    var collectShortInfo = new collectTown();
    collectShortInfo.requestData(collectShortInfo.listAreaCode, collectShortInfo.DATA_TYPE.MID_LAND, key, dateString.date, dateString.time, function(err, dataList){
        if(err){
            log.error("middle land forecst data recdive faile");
            return;
        }
        log.info('mid Land forecast data receive completed : %d\n', dataList.length);

        //log.info(dataList);
        //for(var i in dataList){
        //    for(var j in dataList[i].data){
        //        log.info(i, j, ' : ', dataList[i].data[j]);
        //    }
        //}
        if(config.db.mode === 'ram'){
            var isNotExist = 1;
            var dataFormat = {
                date: dateString.date + dateString.time,
                data: []
            };

            dataList.forEach(function(item){
                dataFormat.data.push(JSON.parse(JSON.stringify(item.data[0])));
            });

            self.midForecast.midLand.forEach(function(item){
                if(item.date == dataFormat.date){
                    isNotExist = 0;
                    log.error('Land data> it is already existed : ', dataFormat.date);
                }
            });

            if(isNotExist) {
                self.midForecast.midLand.push(dataFormat);

                if (self.midForecast.midLand.length > 26) {
                    self.midForecast.midLand.shift();
                }
            }
        } else{
            dataList.forEach(function (item) {
                //log.info(item.data[0]);
                self.saveMid(modelMidLand, item.data[0]);
            });
        }

    });
};

// get middle range temperature data from data.org by using collectTownForecast.js
Manager.prototype.getMidTemp = function(gmt){
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

    var key = config.keyString.cert_key;

    log.info('+++ GET MID TEMP Forecast : ', dateString);

    var collectShortInfo = new collectTown();
    collectShortInfo.requestData(collectShortInfo.listCityCode, collectShortInfo.DATA_TYPE.MID_TEMP, key, dateString.date, dateString.time, function(err, dataList){
        if(err){
            log.error("middle TEMP forecst data recdive faile");
            return;
        }
        log.info('mid TEMP forecast data receive completed : %d\n', dataList.length);

        //log.info(dataList);
        //log.info(dataList[0]);
        //for(var i in dataList){
        //    for(var j in dataList[i].data){
        //        log.info(i, j, ' : ', dataList[i].data[j]);
        //    }
        //}

        if(config.db.mode === 'ram'){
            var isNotExist = 1;
            var dataFormat = {
                date: dateString.date + dateString.time,
                data: []
            };
            dataList.forEach(function(item){
                dataFormat.data.push(JSON.parse(JSON.stringify(item.data[0])));
            });

            self.midForecast.midTemp.forEach(function(item){
                if(item.date == dataFormat.date){
                    isNotExist = 0;
                    log.error('Temp Data> it is already existed : ', dataFormat.date);
                }
            });

            if(isNotExist){
                self.midForecast.midTemp.push(dataFormat);

                if(self.midForecast.midTemp.length > 26){
                    self.midForecast.midTemp.shift();
                }
            }
        }else{
            dataList.forEach(function (item) {
                //log.info(item.data[0]);
                self.saveMid(modelMidTemp, item.data[0]);
            });
        }
    });
};

// get middle range sea forecast data from data.org by using collectTownForecast.js
Manager.prototype.getMidSea = function(gmt){
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

    var key = config.keyString.cert_key;

    log.info('+++ GET MID SEA Forecast : ', dateString);

    var collectShortInfo = new collectTown();
    collectShortInfo.requestData(collectShortInfo.listSeaCode, collectShortInfo.DATA_TYPE.MID_SEA, key, dateString.date, dateString.time, function(err, dataList){
        if(err){
            log.error("middle SEA forecst data recdive faile");
            return;
        }
        log.info('mid SEA forecast data receive completed : %d\n', dataList.length);

        //log.info(dataList);
        //log.info(dataList[0]);
        //for(var i in dataList){
        //    for(var j in dataList[i].data){
        //        log.info(dataList[i].data[j]);
        //    }
        //}

        if(config.db.mode === 'ram'){
            var dataFormat = {
                date: dateString.date + dateString.time,
                data: []
            };
            dataList.forEach(function(item){
                dataFormat.data.push(JSON.parse(JSON.stringify(item.data[0])));
            });
            self.midForecast.midSea.push(dataFormat);

            if(self.midForecast.midSea.length > 26){
                self.midForecast.midSea.shift();
            }
        }else{
            dataList.forEach(function (item) {
                //log.info(item.data[0]);
                self.saveMid(modelMidSea, item.data[0]);
            });
        }
    });
};

Manager.prototype.startTownData = function(){
    var self = this;
    var periodValue = 15000;
    var midPeriod = 10000;
    var times = 0;
    var midTimes = 11;
    var curTimes = 24;
    if(config.mode === 'gather'){
        periodValue = 5 * 60 * 1000;
        midPeriod = 30 * 1000;
    }

    var loop = setInterval(function(){
        if(times === 3){
            self.getTownShortData(9);
        }else{
            self.getTownShortData(-45 + (24*times));
        }
        times+= 1;

        if(times > 3){
            clearInterval(loop);
        }
    }, periodValue);

    self.getTownShortestData();

    var curloop = setInterval(function(){

        self.getTownCurrentData(9 - curTimes);

        curTimes -= 1;

        if(curTimes < 0){
            clearInterval(curloop);
        }
    }, (periodValue/2));
    //self.getTownCurrentData(+9);

    var midLoop = setInterval(function(){
        log.info('mid : ', midTimes,(midTimes * 24));
        self.getMidLand(9 - (midTimes * 24));
        self.getMidTemp(9 - (midTimes * 24));
        midTimes-=1;

        if(midTimes < 0 ){
            clearInterval(midLoop);
        }
    }, midPeriod);

    self.getMidForecast(9);
    self.getMidSea(9);

    // get short forecast once every three hours.
    self.loopTownShortID = setInterval(function() {
        self.getTownShortData(9);

    }, self.TIME_PERIOD.TOWN_SHORT);


    // get shortest forecast once every hours.
    self.loopTownShortestID = setInterval(function(){
        self.getTownShortestData();
    }, self.TIME_PERIOD.TOWN_SHORTEST);

    // get shortest forecast once every hours.
    self.loopTownCurrentID = setInterval(function(){
        self.getTownCurrentData(+9);
    }, self.TIME_PERIOD.TOWN_CURRENT);

    // get middle range forecast once every 12 hours.
    self.loopMidForecastID = setInterval(function(){
        self.getMidForecast(9);
    }, self.TIME_PERIOD.MID_FORECAST);

    // get middle range land forecast once every 12 hours.
    self.loopMidLandID = setInterval(function(){
        self.getMidLand(9);
    }, self.TIME_PERIOD.MID_LAND);

    // get middle range temperature once every 12 hours.
    self.loopMidTempID = setInterval(function(){
        self.getMidTemp(9);
    }, self.TIME_PERIOD.MID_TEMP);

    // get middle range sea forecast  once every 12 hours.
    self.loopMidSeaID = setInterval(function(){
        self.getMidSea(9);
    }, self.TIME_PERIOD.MID_SEA);
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

    if(self.loopMidForecastID !== undefined){
        clearInterval(self.loopMidForecastID);
        self.loopMidForecastID = undefined;
    }

    if(self.loopMidLandID !== undefined){
        clearInterval(self.loopMidLandID);
        self.loopMidLandID = undefined;
    }

    if(self.loopMidTempID !== undefined){
        clearInterval(self.loopMidTempID);
        self.loopMidTempID = undefined;
    }

    if(self.loopMidSeaID !== undefined){
        clearInterval(self.loopMidSeaID);
        self.loopMidSeaID = undefined;
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
