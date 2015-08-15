/**
 * Created by Peter on 2015. 7. 27..
 */

/*
* Collect weather data by using coordinate list.
* Usage :
*       var callectData = require('../lib/collectTownForecast.js');
*
*       var collection = new callectData(testArray);
*       collection.getDataFromList(collection.DATA_TYPE.SHORT, config.key.kma, '20150730', '0800', function(err, dataList){
*           log.info('recieve completed : ', dataList.length);
*           if(err){
*               log.error('there are some failed data');
*               return;
*           }
*           Store data to DB.
*       });
*
* */

"use strict";

var events = require('events');
var req = require('request');
var xml2json  = require('xml2js').parseString;

/*
* constructor
* - Parameter
*        list : coordinate list - ex. list = [{x:1, y:2},{x:1, y:2},{x:1, y:2},{x:1, y:2}];
 *       options : there are some options. timeout, retryCount
 *       callback : It will get the result notify.
*/
function CollectData(list, options, callback){
    var self = this;

    self.DATA_TYPE = Object.freeze({
        CURRENT: 0,
        SHORTEST: 1,
        SHORT: 2
    });

    /*
    * 현재 동네별예보 정보 서비스만 등록. 해당 서비스에 실황,초단기,단기 세개의 예보정보 제공됨.
    */
    self.DATA_URL = Object.freeze({
        CURRENT: 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastGrib',
        SHORTEST: 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastTimeData',
        SHORT: 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastSpaceData'
    });

    events.EventEmitter.call(this);

    if(list) {
        self.srcList = list;
        self.listCount = list.length;
        self.resetResult();
    }
    else{
        log.info('There is no list. The list is required when you want to use this module.');
        return;
    }

    if(options){
        if(options.timeout){
            self.timeout = options.timeout;
        }
        if(options.retryCount){
            self.retryCount = options.retryCount;
        }
    }
    else{
        self.timeout = 3000;
        self.retryCount = 1;
    }

    if(callback){
        self.callback = callback;
    }

    /*
    * If it fails to get data from server,
    * we can get the notify by request event and will decide whether to retry or ignore this item
    */
    self.on('recvFail', function(listIndex){
        log.error('receive fail[%d]', listIndex);
        if(self.resultList[listIndex].retryCount > 0){
            log.info('try again:', listIndex);

            self.resultList[listIndex].retryCount--;
            self.getData(listIndex, self.resultList[listIndex].url);
        }
        else
        {
            self.recvFailed = false;
            self.receivedCount++;

            log.info('ignore this: ', listIndex);

            if(self.receivedCount === self.listCount){
                self.emit('dataComplated');
            }
        }
    });

    /*
    * If it sucesses to get data from server,
    * we can store data and increase the receive count to decide whether to send the complete MSG or not
    * */
    self.on('recvData', function(listIndex, data){
        self.receivedCount++;
        self.resultList[listIndex].isCompleted = true;
        self.resultList[listIndex].data = data;

        //log.info('index[%d], totalCount[%d], receivedCount[%d]', listIndex, self.listCount, self.receivedCount);
        if(self.receivedCount === self.listCount){
            self.emit('dataComplated');
        }
    });

    log.info('The list was created for the weather data:',
        self.listCount, self.timeout, self.resultList.length,
        self.resultList[0].isCompleted, self.resultList[self.resultList.length - 1].isCompleted);

    return self;
}

CollectData.prototype.__proto__ = events.EventEmitter.prototype;


CollectData.prototype.makeUrl = function(base, key, date, time, x, y){
    //var url1 = 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastSpaceData?serviceKey='+ config.key.kma +'&base_date=20150727&base_time=0800&nx=' + nx + '&ny=' + ny;
    return base + '?serviceKey=' + key + '&base_date=' + date + '&base_time=' + time + '&nx=' + x + '&ny=' + y + '&pageNo=1&numOfRows=999';
};

CollectData.prototype.resetResult = function(){
    var self = this;
    self.resultList = [];
    for(var i=0 ; i < self.srcList.length ; i++) {
        var item = {
            isCompleted: false,
            data: {},
            url:'',
            retryCount: self.retryCount
        };
        self.resultList.push(item);
    }
    self.receivedCount = 0;
    self.recvFailed = false;
};

/*
* Description : request and get weather data from server by using coordinate list
*               객체 초기화시 parameter로 넘겨준 좌표 리스트를 이용해서 각 좌표에 해당하는 날씨 데이터를 서버로 요청한다.
* Parameter
*      dataType : data type(current, shortest, short)- Which data do you want to get?
*      key : key string you already got by DATA.go.kr
*      date : data string - ex.) 20150730
*      time : time string - ex.) 0800
*      callback : callback function - when receiving data is completed, it would be called.
* */
CollectData.prototype.getTownData = function(dataType, key, date, time, callback){
    var self = this;
    var url = '';
    var meta = {};

    meta.method = 'getDataFromList';
    meta.dataType = dataType;
    meta.key = key;
    meta.date = date;
    meta.time = time;

    if(!self.srcList) {
        log.error('There is no location list');
        return;
    }

    if(callback || self.callback){
        self.on('dataComplated', function() {
            try{
                if (self.callback) {
                    self.callback(self.recvFailed, self.resultList);
                }
                if (callback) {
                    callback(self.recvFailed, self.resultList);
                }
            }
            catch(e){
                log.error("ERROR !!! in event dataComplated");
            }
        });
    }

    switch(dataType) {
        case self.DATA_TYPE.CURRENT:
            url = self.DATA_URL.CURRENT;
            break;
        case self.DATA_TYPE.SHORTEST:
            url = self.DATA_URL.SHORTEST;
            break;
        case self.DATA_TYPE.SHORT:
            url = self.DATA_URL.SHORT;
            break;
        default:
            log.error('unknown data type. please check your input parameter.');
            return;
            break;
    }

    try {
        self.resetResult();
        for (var i in self.srcList) {
            // Should I need to use closure ??? What do you think?
            self.resultList[i].url = self.makeUrl(url, key, date, time, self.srcList[i].x, self.srcList[i].y);
            self.getData(parseInt(i), dataType, self.resultList[i].url);
        }
    }
    catch(e){
        log.err('ERROR !!! ', meta);
    }
};

/*
* Description : It request the weather data from server lead to url.
*               If it successes to get data, it would send 'recvData' event to this.
*               If it fail to get data, it would send 'recvFail' event to this.
* */
CollectData.prototype.getData = function(index, dataType, url,callback){
    var self = this;
    var meta = {};

    meta.method = 'getData';
    meta.index = index;
    meta.url = url;

    //log.info(meta);
    //log.info('url[', index, ']: ', self.resultList[index].url);

    req.get(url, null, function(err, response, body){
        if(err) {
            log.error(err);
            self.emit('recvFail', index);
            if(callback){
                callback(err, index);
            }
            return;
        }
        //log.info(body);
        xml2json(body, function(err, result){
            try {
                /*
                * I want to show you the data structure on the result.
                * If you want to know this, turn off comment below.
                */
                 //log.info(result);
                 //log.info(result.response);
                 //log.info(result.response.header[0]);
                 //log.info(result.response.header[0].resultCode[0]);
                 //log.info(result.response.body[0]);
                 //log.info(result.response.body[0].totalCount[0]);

                if(err
                    || (result.response.header[0].resultCode[0] !== '0000')
                    ||(result.response.body[0].totalCount[0] === '0')) {
                    // there is error code or totalcount is zero as no valid data.
                    log.error('There are no data');
                }
                else{
                    switch(dataType) {
                        case self.DATA_TYPE.CURRENT:
                            self.organizeCurrentData(index, result);
                            break;
                        case self.DATA_TYPE.SHORTEST:
                            self.organizeShortestData(index, result);
                            break;
                        case self.DATA_TYPE.SHORT:
                            self.organizeShortData(index, result);
                            break;
                        default:
                            log.error('can not organize data as it is unknown data type');
                            break;
                    }
                }
            }
            catch(e){
                log.error('Error!!!', meta);
            }
            finally{
                if(callback){
                    callback(err, index, result);
                }
            }
        });
    });
};

CollectData.prototype.organizeShortData = function(index, listData){
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('shortData count : ' + listItem.length);

    try{
        var result = {};
        var template = {
            date: '',
            time: '',
            mx: -1,
            my: -1,
            pop: -1,    /* 강수 확률 : 1% 단위, invalid : -1 */
            pty: -1,    /* 강수 형태 : 없음(0) 비(1) 비/눈(2) 눈(3) , invalid : -1 */
            r06: -1,    /* 6시간 강수량 : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
            reh: -1,    /* 습도 : 1% , invalid : -1 */
            s06: -1,    /* 6시간 신적설 : 0미만(0) ~1cm(1) 1~4cm(5) 5~9cm(10) 10~19cm(20) 20cm~(100), invalid : -1 */
            sky: -1,    /* 하늘 상태 : 맑음(1) 구름조금(2) 흐림(4) , invalid : -1 */
            t3h: -50,   /* 3시간 기온 : 0.1'c , invalid : -50 */
            tmn: -50,   /* 일 최저 기온 : 0.1'c , invalid : -50 */
            tmx: -50,   /* 일 최고 기온 : 0.1'c , invalid : -50 */
            uuu: -100,  /* 풍속(동서성분) : 0.1m/s 동풍(+표기) 서풍(-표기), invalid : -100 */
            vvv: -100,  /* 풍속(남북성분) : 0.1m/s 북풍(+표기) 남풍(-표기), invalid : -100 */
            wav: -1,    /* 파고 : 0.1m , invalid : -1 */
            vec: -1,    /* 풍향 : 0 , invalid : -1 */
            wsd: -1     /* 풍속 : 1 , invalid : -1 */
        };

        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if((item.fcstDate === undefined)
                && (item.fcstTime === undefined)
                && (item.fcstValue === undefined)){
                log.error('organizeShortData : There is not forecast date');
                continue;
            }

            if((item.fcstDate[0].length > 1) && (item.fcstTime[0].length > 1)){
                //log.info(i, item);
                if(result.date === undefined){
                    /* into the loop first time */
                    result = template;
                    //log.info('start collecting items');

                }
                else if(result.date === item.fcstDate[0] && result.time === item.fcstTime[0]){
                    /* same date between prv date and current date */
                    //log.info('same date --> keep going');
                }
                else{
                    /* changed date value with prv date, so result should be pushed into the list and set new result */
                    //log.info('changed date --> push it to list and reset result');
                    //log.info(result);
                    var insertItem = JSON.parse(JSON.stringify(result));
                    listResult.push(insertItem);
                    result = template;
                }

                result.date = item.fcstDate[0];
                result.time = item.fcstTime[0];
                result.mx = parseInt(item.nx[0]);
                result.my = parseInt(item.ny[0]);

                if(item.category[0] === 'POP') {result.pop = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'PTY') {result.pty = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'R06') {result.r06 = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'REH') {result.reh = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'S06') {result.s06 = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'SKY') {result.sky = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'T3H') {result.t3h = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'TMN') {result.tmn = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'TMX') {result.tmx = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'UUU') {result.uuu = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'VVV') {result.vvv = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'WAV') {result.wav = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'VEC') {result.vec = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'WSD') {result.wsd = parseInt(item.fcstValue[0]);}
                else{
                    log.error('organizeShortData : Known property', item.category[0]);
                }
            }
        }

        if(result.date !== undefined && result.date.length > 1){
            var insertItem = JSON.parse(JSON.stringify(result));
            listResult.push(insertItem);
        }

        //log.info('result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        self.emit('recvData', index, listResult);
    }
    catch(e){
        log.error('Error!! organizeShortData : failed data organized');
    }
};

CollectData.prototype.organizeShortestData = function(index, listData) {
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('shortestData count : ' + listItem.length);

    try{
        var result = {};
        var template = {
            date: '',
            time: '',
            mx: -1,
            my: -1,
            pty: -1, /* 강수 형태 : 1%, invalid : -1 */
            rn1: -1, /* 1시간 강수량 : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
            sky: -1, /* 하늘상태 : 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1*/
            lgt: -1 /* 낙뢰 : 확률없음(0) 낮음(1) 보통(2) 높음(3), invalid : -1 */
        };

        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if((item.fcstDate === undefined)
                && (item.fcstTime === undefined)
                && (item.fcstValue === undefined)){
                log.error('organizeShortestData : There is not shortest forecast date');
                continue;
            }

            if((item.fcstDate[0].length > 1) && (item.fcstTime[0].length > 1)){
                //log.info(i, item);
                if(result.date === undefined){
                    /* into the loop first time */
                    result = template;
                    //log.info('organizeShortestData : start collecting items');

                }
                else if(result.date === item.fcstDate[0] && result.time === item.fcstTime[0]){
                    /* same date between prv date and current date */
                    //log.info('organizeShortestData : same date --> keep going');
                }
                else{
                    /* changed date value with prv date, so result should be pushed into the list and set new result */
                    //log.info('organizeShortestData : changed date --> push it to list and reset result');
                    //log.info(result);
                    var insertItem = JSON.parse(JSON.stringify(result));
                    listResult.push(insertItem);
                    result = template;
                }

                result.date = item.fcstDate[0];
                result.time = item.fcstTime[0];
                result.mx = parseInt(item.nx[0]);
                result.my = parseInt(item.ny[0]);

                if(item.category[0] === 'PTY') {result.pty = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'RN1') {result.rn1 = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'SKY') {result.sky = parseInt(item.fcstValue[0]);}
                else if(item.category[0] === 'LGT') {result.lgt = parseInt(item.fcstValue[0]);}
                else{
                    log.error('organizeShortestData : Known property', item.category[0]);
                }
            }
        }

        if(result.date !== undefined && result.date.length > 1){
            var insertItem = JSON.parse(JSON.stringify(result));
            listResult.push(insertItem);
        }

        //log.info('organizeShortestData result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        self.emit('recvData', index, listResult);
    }
    catch(e){
        log.error('Error!! organizeShortestData : failed data organized');
    }
};

CollectData.prototype.organizeCurrentData = function(index, listData) {
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('currentData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            date: '',
            time: '',
            mx: -1,
            my: -1,
            t1h: -50, /* 기온 : 0.1'c , invalid : -50 */
            rn1: -1, /* 1시간 강수량 : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
            sky: -1, /* 하늘상태: 맑음(1) 구름조금(2) 구름많음(3) 흐림(4), invalid : -1 */
            uuu: -100, /* 동서바람성분 : 0.1m/s, invalid : -100 */
            vvv: -100, /* 남북바람성분 : 0.1m/s, invalid : -100 */
            reh: -1, /* 습도: 1%, invalid : -1 */
            pty: -1, /* 강수형태 : 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1 */
            lgt: -1, /* 낙뢰 : 없음(0) 있음(1), invalid : -1 */
            vec: -1, /* 풍향 : 0, invalid : -1 */
            wsd: -1 /* 풍속 : 4미만(약하다) 4~9(약간강함) 9~14(강함) 14이상(매우강함), invalid : -1 */
        };

        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if((item.baseDate === undefined)
                && (item.baseTime === undefined)
                && (item.obsrValue === undefined)){
                log.info(item);
                log.error('organizeCurrentData : There is not forecast date');
                continue;
            }

            if((item.baseDate[0].length > 1) && (item.baseTime[0].length > 1)){
                //log.info(i, item);
                if(result.date === undefined){
                    /* into the loop first time */
                    result = template;
                    //log.info('organizeCurrentData : start collecting items');

                }
                else if(result.date === item.baseDate[0] && result.time === item.baseTime[0]){
                    /* same date between prv date and current date */
                    //log.info('organizeCurrentData : same date --> keep going');
                }
                else{
                    /* changed date value with prv date, so result should be pushed into the list and set new result */
                    //log.info('organizeCurrentData : changed date --> push it to list and reset result');
                    //log.info(result);
                    var insertItem = JSON.parse(JSON.stringify(result));
                    listResult.push(insertItem);
                    result = template;
                }

                result.date = item.baseDate[0];
                result.time = item.baseTime[0];
                result.mx = parseInt(item.nx[0]);
                result.my = parseInt(item.ny[0]);

                if(item.category[0] === 'T1H') {result.t1h = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'RN1') {result.rn1 = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'SKY') {result.sky = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'UUU') {result.uuu = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'VVV') {result.vvv = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'REH') {result.reh = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'PTY') {result.pty = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'LGT') {result.lgt = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'VEC') {result.vec = parseInt(item.obsrValue[0]);}
                else if(item.category[0] === 'WSD') {result.wsd = parseInt(item.obsrValue[0]);}
                else{
                    log.error('organizeCurrentData : Known property', item.category[0]);
                }
            }
        }

        if(result.date !== undefined && result.date.length > 1){
            var insertItem = JSON.parse(JSON.stringify(result));
            listResult.push(insertItem);
        }

        //log.info('result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        self.emit('recvData', index, listResult);
    }
    catch(e){
        log.error('Error!! organizeCurrentData : failed data organized');
    }
};

module.exports = CollectData;

