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
function CollectData(options, callback){
    var self = this;

    self.listPointNumber = Object.freeze(
        [
            {name: '강원도', code: '105'},
            {name: '전국', code: '108'},
            {name: '경기도', code: '109'},
            {name: '충청도', code: '133'},
            {name: '전라도', code: '156'},
            {name: '경상도', code: '159'},
            {name: '제주도', code: '184'}
        ]
    );

    self.listAreaCode = Object.freeze(
        [
            {name: '경기도', code: '11B00000'},
            {name: '강원도 영서', code: '11D10000'},
            {name: '강원도 영동', code: '11D20000'},
            {name: '충청남도', code: '11C20000'},
            {name: '충청북도', code: '11C10000'},
            {name: '전라남도', code: '11F20000'},
            {name: '전라북도', code: '11F10000'},
            {name: '경상북도', code: '11H10000'},
            {name: '경상남도', code: '11H20000'},
            {name: '제주도', code: '11G00000'}
        ]
    );

    self.listCityCode = Object.freeze(
        [
            {name: '서울', code: '11B10101'}, // 서울
            {name: '인천', code: '11B20201'}, // 경기 서부
                {name: '수원', code: '11B20601'}, // 경기 남부
            {name: '문산', code: '11B20305'}, // 경기 북부

            {name: '춘천', code: '11D10301'}, // 강원 서부
            {name: '원주', code: '11D10401'}, // 강원 남서
            {name: '강릉', code: '11D20501'}, // 강원 동부

            {name: '대전', code: '11C20401'}, // 충남
            {name: '서산', code: '11C20101'}, // 충남 서부

            {name: '청주', code: '11C10301'}, // 충북
            {name: '세종', code: '11C20404'}, // 충북 서부

            {name: '광주', code: '11F20501'}, // 전남 북부
            {name: '여수', code: '11F20401'}, // 전남 남부
            {name: '목포', code: '21F20801'}, // 전남 서부

            {name: '군산', code: '21F10501'}, // 전북 서부
            {name: '전주', code: '11F10201'}, // 전북

            {name: '부산', code: '11H20201'}, // 경남
            {name: '울산', code: '11H20101'}, // 경남 동부
            {name: '창원', code: '11H20301'}, // 경남 서부

            {name: '대구', code: '11H10701'}, // 경북
            {name: '안동', code: '11H10501'}, // 경북 북부
            {name: '포항', code: '11H10201'}, // 경북 동부

            {name: '제주', code: '11G00201'}, // 제주 북부
            {name: '서귀포', code: '11G00401'} // 제주 남부
        ]
    );

    self.listSeaCode = Object.freeze(
        [
            {name: '서해북부 ', code: '12A30000'},
            {name: '서해중부 ', code: '12A20000'},
            {name: '서해남부 ', code: '12A10000'},
            {name: '남해서부 ', code: '12B10000'},
            {name: '남해동부 ', code: '12B20000'},
            {name: '제주도 ', code: '12B10500'},
            {name: '동해남부 ', code: '12C10000'},
            {name: '동해중부 ', code: '12C20000'},
            {name: '동해북부 ', code: '12C30000'}
        ]
    );

    self.DATA_TYPE = Object.freeze({
        TOWN_CURRENT: 0,
        TOWN_SHORTEST: 1,
        TOWN_SHORT: 2,
        MID_FORECAST: 3,
        MID_LAND: 4,
        MID_TEMP: 5,
        MID_SEA: 6
    });

    self.DATA_URL = Object.freeze({
        TOWN_CURRENT: 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastGrib',
        TOWN_SHORTEST: 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastTimeData',
        TOWN_SHORT: 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService/ForecastSpaceData',
        MID_FORECAST: 'http://newsky2.kma.go.kr/service/MiddleFrcstInfoService/getMiddleForecast',
        MID_LAND: 'http://newsky2.kma.go.kr/service/MiddleFrcstInfoService/getMiddleLandWeather',
        MID_TEMP: 'http://newsky2.kma.go.kr/service/MiddleFrcstInfoService/getMiddleTemperature',
        MID_SEA: 'http://newsky2.kma.go.kr/service/MiddleFrcstInfoService/getMiddleSeaWeather'
    });

    events.EventEmitter.call(this);

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
        //log.error('receive fail[%d]', listIndex);
        if(self.resultList[listIndex].retryCount > 0){
            //log.error('try again:', listIndex);
            //log.error('URL : ', self.resultList[listIndex].url);
            //log.error(self.resultList[listIndex].options);

            self.resultList[listIndex].retryCount--;
            self.getData(listIndex, self.resultList[listIndex].options.dataType, self.resultList[listIndex].url, self.resultList[listIndex].options);
        }
        else
        {
            self.recvFailed = true;
            self.receivedCount++;

            log.error('ignore this: ', listIndex);
            log.error('URL : ', self.resultList[listIndex].url);

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

    //log.info('The list was created for the weather data');

    return self;
}

CollectData.prototype.__proto__ = events.EventEmitter.prototype;

CollectData.prototype.getUrl = function(dataType, key, date, time, data){
    var self = this;
    var url = '';

    // start from base address
    switch(dataType){
        case self.DATA_TYPE.TOWN_CURRENT:
            url = self.DATA_URL.TOWN_CURRENT;
            break;
        case self.DATA_TYPE.TOWN_SHORTEST:
            url = self.DATA_URL.TOWN_SHORTEST;
            break;
        case self.DATA_TYPE.TOWN_SHORT:
            url = self.DATA_URL.TOWN_SHORT;
            break;
        case self.DATA_TYPE.MID_FORECAST:
            url = self.DATA_URL.MID_FORECAST;
            break;
        case self.DATA_TYPE.MID_LAND:
            url = self.DATA_URL.MID_LAND;
            break;
        case self.DATA_TYPE.MID_TEMP:
            url = self.DATA_URL.MID_TEMP;
            break;
        case self.DATA_TYPE.MID_SEA:
            url = self.DATA_URL.MID_SEA;
            break;
    }

    // add key data
    url += '?serviceKey=' + key;

    try{
        // add additional data such as location info, code
        if(dataType <= self.DATA_TYPE.TOWN_SHORT){
            url += '&base_date=' + date + '&base_time=' + time + '&nx=' + data.mx + '&ny=' + data.my;
        }
        else if(dataType <= self.DATA_TYPE.MID_SEA){
            if(time !== '0600' && time !== '1800'){
                log.error('getMidRangeForecast : Only both 0600 and 0800 is accepted by server');
                return '';
            }

            url += (dataType === self.DATA_TYPE.MID_FORECAST)? '&stnId=':'&regId=';
            url += data.code + '&tmFc=' + date + time;
        }
        else{
            log.error('getUrl : unknown data type');
            return '';
        }
    }
    catch(e){
        log.error('failed to make URL');
    }

    // add count that would to get.
    url += '&pageNo=1&numOfRows=999';

    return url;
};

CollectData.prototype.resetResult = function(){
    var self = this;
    self.resultList = [];
    for(var i=0 ; i < self.listCount ; i++) {
        var item = {
            isCompleted: false,
            data: {},
            url:'',
            retryCount: self.retryCount,
            options: {
                date: '',
                time: '',
                dataType: -1,
                code: ''
            }
        };
        self.resultList.push(item);
    }
    self.receivedCount = 0;
    self.recvFailed = false;
};

/*
* Description : It request the weather data from server lead to url.
*               If it successes to get data, it would send 'recvData' event to this.
*               If it fail to get data, it would send 'recvFail' event to this.
* */
CollectData.prototype.getData = function(index, dataType, url,options, callback){
    var self = this;
    var meta = {};

    meta.method = 'getData';
    meta.index = index;
    meta.url = url;

    //log.info(meta);
    //log.info('url[', index, ']: ', self.resultList[index].url);

    req.get(url, null, function(err, response, body){
        var statusCode = response.statusCode;
        if(err) {
            //log.error(err);
            //log.error('#', meta);

            self.emit('recvFail', index);
            if(callback){
                callback(err, index);
            }
            return;
        }

        if(statusCode === 404 || statusCode === 403){
            //log.error('ERROR!!! StatusCode : ', statusCode);
            //log.error('#', meta);

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
                 //log.info('> ', result.response);
                 //log.info(result.response.header[0]);
                 //log.info(result.response.header[0].resultCode[0]);
                 //log.info(result.response.body[0]);
                 //log.info(result.response.body[0].totalCount[0]);

                if(err
                    || (result.response.header[0].resultCode[0] !== '0000')
                    ||(result.response.body[0].totalCount[0] === '0')) {
                    // there is error code or totalcount is zero as no valid data.
                    log.error('There are no data', result.response.header[0].resultCode[0], result.response.body[0].totalCount[0]);
                    log.error(meta);

                    self.emit('recvFail', index);
                }
                else{
                    switch(dataType) {
                        case self.DATA_TYPE.TOWN_CURRENT:
                            self.organizeCurrentData(index, result);
                            break;
                        case self.DATA_TYPE.TOWN_SHORTEST:
                            self.organizeShortestData(index, result);
                            break;
                        case self.DATA_TYPE.TOWN_SHORT:
                            self.organizeShortData(index, result);
                            break;
                        case self.DATA_TYPE.MID_FORECAST:
                            self.organizeForecastData(index, result, options);
                            break;
                        case self.DATA_TYPE.MID_LAND:
                            self.organizeLandData(index, result, options);
                            break;
                        case self.DATA_TYPE.MID_TEMP:
                            self.organizeTempData(index, result, options);
                            break;
                        case self.DATA_TYPE.MID_SEA:
                            self.organizeSeaData(index, result, options);
                            break;
                        default:
                            log.error('can not organize data as it is unknown data type');
                            break;
                    }
                }
            }
            catch(e){
                log.error('& Error!!!', meta);
                self.emit('recvFail', index);
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
    var temperMap = new Map(); // key : date, value : temp { tmn : '', tmx : '' }

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
            sky: -1,    /* 하늘 상태 : 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1 */
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

            if((item.fcstDate === undefined)
                && (item.fcstTime === undefined)
                && (item.fcstValue === undefined)){
                log.error('organizeShortData : There is not forecast date');
                continue;
            }
            var temper = {
                tmn: -50,
                tmx: -50
            }

            if((item.fcstDate[0].length > 1) && (item.fcstTime[0].length > 1)){
                if(temperMap.has(item.fcstDate[0])){
                    var o = temperMap.get(item.fcstDate[0]);
                    if(item.fcstTime[0] === '0600'){
                        if(item.category[0] === 'TMN') o.tmn = parseInt(item.fcstValue[0]);
                    } else if(item.fcstTime[0] === '1500'){
                        if(item.category[0] === 'TMX') o.tmx = parseInt(item.fcstValue[0]);
                    }
                }else{
                    if(item.fcstTime[0] === '0600'){
                        if(item.category[0] === 'TMN') temper.tmn = parseInt(item.fcstValue[0]);
                    } else if(item.fcstTime[0] === '1500'){
                        if(item.category[0] === 'TMX') temper.tmx = parseInt(item.fcstValue[0]);
                    }
                    temperMap.set(item.fcstDate[0], temper);
                }
            }
        }

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
                else if(item.category[0] === 'TMN') {result.tmn = temperMap.get(result.date).tmn;}
                else if(item.category[0] === 'TMX') {result.tmx = temperMap.get(result.date).tmx;}
                //else if(item.category[0] === 'TMX') {result.tmx = parseInt(item.fcstValue[0]);}
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

CollectData.prototype.organizeForecastData = function(index, listData, options){
    var self = this;
    var meta = {};
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('organizeForecastData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            date: options.date,
            time: options.time,
            pointNumber: options.code,
            cnt: 0,
            wfsv: ''
        };

        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if(item.wfSv === undefined){
                log.info(item);
                log.error('organizeForecastData : There is not forecast date');
                continue;
            }
            result = template;
            result.wfsv = item.wfSv[0];
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
        log.error('Error!! organizeForecastData : failed data organized');
    }
};

CollectData.prototype.organizeLandData = function(index, listData, options){
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('currentData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            date: options.date,
            time: options.time,
            regId: 0, /* 예보 구역 코드 */
            wf3Am: '', /* 3일 후 오전 날씨 예보 */
            wf3Pm: '', /* 3일 후 오후 날씨 예보 */
            wf4Am: '', /* 4일 후 오전날씨 예보 */
            wf4Pm: '', /* 4일 후 오후 날씨 예보 */
            wf5Am: '', /* 5일 후 오전 날씨 예보 */
            wf5Pm: '', /* 5일 후 오후 날씨 예보 */
            wf6Am: '', /* 6일 후 오전 날씨 예보 */
            wf6Pm: '', /* 6일 후 오후 날씨 예보 */
            wf7Am: '', /* 7일 후 오전 날씨 예보 */
            wf7Pm: '', /* 7일 후 오후 날씨 예보 */
            wf8: '', /* 8일 후 날씨 예보 */
            wf9: '', /* 9일 후 날씨 예보 */
            wf10: '' /* 10일 후 날씨 예보 */
        };

        listItem.forEach(function(item, i){
            if(item.regId === undefined){
                log.error('There is no data');
                return;
            }

            result = template;
            result.regId = item.regId[0];
            result.wf3Am = item.wf3Am[0];
            result.wf3Pm = item.wf3Pm[0];
            result.wf4Am = item.wf4Am[0];
            result.wf4Pm = item.wf4Pm[0];
            result.wf5Am = item.wf5Am[0];
            result.wf5Pm = item.wf5Pm[0];
            result.wf6Am = item.wf6Am[0];
            result.wf6Pm = item.wf6Pm[0];
            result.wf7Am = item.wf7Am[0];
            result.wf7Pm = item.wf7Pm[0];
            result.wf8 = item.wf8[0];
            result.wf9 = item.wf9[0];
            result.wf10 = item.wf10[0];

            var insertItem = JSON.parse(JSON.stringify(result));
            listResult.push(insertItem);
        });


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

CollectData.prototype.organizeTempData = function(index, listData, options){
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('currentData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            date: options.date,
            time: options.time,
            regId: 0, /* 예보 구역 코드 */
            taMin3: -100, /* 3일 후 예상 최저 기온 */
            taMax3: -100, /* 3일 후 예상 최고 기온 */
            taMin4: -100, /* 4일 후 예상 최저 기온 */
            taMax4: -100, /* 4일 후 예상 최고 기온 */
            taMin5: -100, /* 5일 후 예상 최저 기온 */
            taMax5: -100, /* 5일 후 예상 최고 기온 */
            taMin6: -100, /* 6일 후 예상 최저 기온 */
            taMax6: -100, /* 6일 후 예상 최고 기온 */
            taMin7: -100, /* 7일 후 예상 최저 기온 */
            taMax7: -100, /* 7일 후 예상 최고 기온 */
            taMin8: -100, /* 8일 후 예상 최저 기온 */
            taMax8: -100, /* 8일 후 예상 최고 기온 */
            taMin9: -100, /* 9일 후 예상 최저 기온 */
            taMax9: -100, /* 9일 후 예상 최고 기온 */
            taMin10: -100, /* 10일 후 예상 최저 기온 */
            taMax10: -100 /* 10일 후 예상 최고 기온 */
        };

        listItem.forEach(function(item, i){
            if(item.regId === undefined){
                log.error('There is no data');
                return;
            }

            result = template;
            result.regId = item.regId[0];
            result.taMin3 = parseInt(item.taMin3[0]);
            result.taMax3 = parseInt(item.taMax3[0]);
            result.taMin4 = parseInt(item.taMin4[0]);
            result.taMax4 = parseInt(item.taMax4[0]);
            result.taMin5 = parseInt(item.taMin5[0]);
            result.taMax5 = parseInt(item.taMax5[0]);
            result.taMin6 = parseInt(item.taMin6[0]);
            result.taMax6 = parseInt(item.taMax6[0]);
            result.taMin7 = parseInt(item.taMin7[0]);
            result.taMax7 = parseInt(item.taMax7[0]);
            result.taMin8 = parseInt(item.taMin8[0]);
            result.taMax8 = parseInt(item.taMax8[0]);
            result.taMin9 = parseInt(item.taMin9[0]);
            result.taMax9 = parseInt(item.taMax9[0]);
            result.taMin10 = parseInt(item.taMin10[0]);
            result.taMax10 = parseInt(item.taMax10[0]);

            var insertItem = JSON.parse(JSON.stringify(result));
            listResult.push(insertItem);
        });


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

CollectData.prototype.organizeSeaData = function(index, listData, options){
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('currentData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            date: options.date,
            time: options.time,
            regId: 0, /* 예보 구역 코드 */
            wf3Am: '', /* 3일 후 오전 날씨 예보 */
            wf3Pm: '', /* 3일 후 오후 날씨 예보 */
            wf4Am: '', /* 4일 후 오전날씨 예보 */
            wf4Pm: '', /* 4일 후 오후 날씨 예보 */
            wf5Am: '', /* 5일 후 오전 날씨 예보 */
            wf5Pm: '', /* 5일 후 오후 날씨 예보 */
            wf6Am: '', /* 6일 후 오전 날씨 예보 */
            wf6Pm: '', /* 6일 후 오후 날씨 예보 */
            wf7Am: '', /* 7일 후 오전 날씨 예보 */
            wf7Pm: '', /* 7일 후 오후 날씨 예보 */
            wf8: '', /* 8일 후 날씨 예보 */
            wf9: '', /* 9일 후 날씨 예보 */
            wf10: '', /* 10일 후 날씨 예보 */
            wh3AAm: -100, /* 3일 후 오전 최저 예상 파고(m) */
            wh3APm: -100, /* 3일 후 오후 최저 예상 파고(m) */
            wh3BAm: -100, /* 3일 후 오전 최고 예상 파고(m) */
            wh3BPm: -100, /* 3일 후 오후 최고 예상 파고(m) */
            wh4AAm: -100, /* 4일 후 오전 최저 예상 파고(m) */
            wh4APm: -100, /* 4일 후 오후 최저 예상 파고(m) */
            wh4BAm: -100, /* 4일 후 오전 최고 예상 파고(m) */
            wh4BPm: -100, /* 4일 후 오후 최고 예상 파고(m) */
            wh5AAm: -100, /* 5일 후 오전 최저 예상 파고(m) */
            wh5APm: -100, /* 5일 후 오후 최저 예상 파고(m) */
            wh5BAm: -100, /* 5일 후 오전 최고 예상 파고(m) */
            wh5BPm: -100, /* 5일 후 오후 최고 예상 파고(m) */
            wh6AAm: -100, /* 6일 후 오전 최저 예상 파고(m) */
            wh6APm: -100, /* 6일 후 오후 최저 예상 파고(m) */
            wh6BAm: -100, /* 6일 후 오전 최고 예상 파고(m) */
            wh6BPm: -100, /* 6일 후 오후 최고 예상 파고(m) */
            wh7AAm: -100, /* 7일 후 오전 최저 예상 파고(m) */
            wh7APm: -100, /* 7일 후 오후 최저 예상 파고(m) */
            wh7BAm: -100, /* 7일 후 오전 최고 예상 파고(m) */
            wh7BPm: -100, /* 7일 후 오후 최고 예상 파고(m) */
            wh8A: -100, /* 8일 후 최저 예상 파고(m) */
            wh8B: -100, /* 8일 후 최고 예상 파고(m) */
            wh9A: -100, /* 9일 후 최저 예상 파고(m) */
            wh9B: -100, /* 9일 후 최고 예상 파고(m) */
            wh10A: -100, /* 10일 후 최저 예상 파고(m) */
            wh10B: -100 /* 10일 후 최고 예상 파고(m) */
        };

        listItem.forEach(function(item, i){
            if(item.regId === undefined){
                log.error('There is no data');
                return;
            }

            result = template;
            result.regId = item.regId[0];
            result.wf3Am = item.wf3Am[0];
            result.wf3Pm = item.wf3Pm[0];
            result.wf4Am = item.wf4Am[0];
            result.wf4Pm = item.wf4Pm[0];
            result.wf5Am = item.wf5Am[0];
            result.wf5Pm = item.wf5Pm[0];
            result.wf6Am = item.wf6Am[0];
            result.wf6Pm = item.wf6Pm[0];
            result.wf7Am = item.wf7Am[0];
            result.wf7Pm = item.wf7Pm[0];
            result.wf8 = item.wf8[0];
            result.wf9 = item.wf9[0];
            result.wf10 = item.wf10[0];

            result.wh3AAm = parseInt(item.wh3AAm[0]);
            result.wh3APm = parseInt(item.wh3APm[0]);
            result.wh3BAm = parseInt(item.wh3BAm[0]);
            result.wh3BPm = parseInt(item.wh3BPm[0]);
            result.wh4AAm = parseInt(item.wh3AAm[0]);
            result.wh4APm = parseInt(item.wh3APm[0]);
            result.wh4BAm = parseInt(item.wh3BAm[0]);
            result.wh4BPm = parseInt(item.wh3BPm[0]);
            result.wh5AAm = parseInt(item.wh3AAm[0]);
            result.wh5APm = parseInt(item.wh3APm[0]);
            result.wh5BAm = parseInt(item.wh3BAm[0]);
            result.wh5BPm = parseInt(item.wh3BPm[0]);
            result.wh6AAm = parseInt(item.wh3AAm[0]);
            result.wh6APm = parseInt(item.wh3APm[0]);
            result.wh6BAm = parseInt(item.wh3BAm[0]);
            result.wh6BPm = parseInt(item.wh3BPm[0]);
            result.wh7AAm = parseInt(item.wh3AAm[0]);
            result.wh7APm = parseInt(item.wh3APm[0]);
            result.wh7BAm = parseInt(item.wh3BAm[0]);
            result.wh7BPm = parseInt(item.wh3BPm[0]);
            result.wh8A = parseInt(item.wh8A[0]);
            result.wh8B = parseInt(item.wh8B[0]);
            result.wh9A = parseInt(item.wh9A[0]);
            result.wh9B = parseInt(item.wh9B[0]);
            result.wh10A = parseInt(item.wh10A[0]);
            result.wh10B = parseInt(item.wh10B[0]);

            var insertItem = JSON.parse(JSON.stringify(result));
            listResult.push(insertItem);
        });


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

CollectData.prototype.requestData = function(srcList, dataType, key, date, time, callback){
    var self = this;
    var meta = {};
    var options = {date: date, time: time};


    meta.method = 'requestData';
    meta.dataType = dataType;
    meta.key = key;
    meta.date = date;
    meta.time = time;

    if(srcList){
        self.srcList = srcList;
        self.listCount = srcList.length;
        self.resetResult();
    }
    else{
        log.error('There is no location list');
        log.error('#', meta);
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
                log.error("requestData : ERROR !!! in event dataComplated");
                log.error('#', meta);
            }
        });
    }

    try{
        for(var i in self.srcList){
            var string = self.getUrl(dataType, key, date, time, self.srcList[i]);
            self.resultList[i].url = string.toString();
            self.resultList[i].options.date = date;
            self.resultList[i].options.time = time;
            self.resultList[i].options.dataType = dataType;
            if(srcList[i].code !== undefined){
                self.resultList[i].options.code = srcList[i].code;
            }

            if(self.resultList[i].url !== ''){
                self.getData(parseInt(i), dataType, self.resultList[i].url, self.resultList[i].options);
            }
        }
    }
    catch(e){
        log.error('# ERROR!! ', meta);
    }
};



module.exports = CollectData;

