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
var midPolicy = require('./midForecastPolicy');
var precipitation = require('./kmaPrecipitation');
var req = require('request');
var xml2json  = require('xml2js').parseString;

var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

/*
* constructor
* - Parameter
*        list : coordinate list - ex. list = [{x:1, y:2},{x:1, y:2},{x:1, y:2},{x:1, y:2}];
 *       options : there are some options. timeout, retryCount
 *       callback : It will get the result notify.
*/
function CollectData(options, callback){
    var self = this;

    var KMA_API_DOMAIN = "apis.data.go.kr";

    self.listPointNumber = Object.freeze(
        [
            {name: '강원도', code: '105'},
            {name: '전국', code: '108'},
            {name: '서울,인천,경기도', code: '109'},
            {name: '충청북도', code: '131'},
            {name: '대전,세종,충청남도', code: '133'},
            {name: '전라북도', code: '146'},
            {name: '광주,전라남도', code: '156'},
            {name: '대구,경상북도', code: '143'},
            {name: '부산,울산,경상남도', code: '159'},
            {name: '제주도', code: '184'}
        ]
    );

    self.listAreaCode = Object.freeze(
        [
            {name: '경기도', code: '11B00000'},
            {name: '강원도 영서', code: '11D10000'}, //춘천
            {name: '강원도 영동', code: '11D20000'}, //강릉
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
            {name: '파주', code: '11B20305'}, // 경기 북부

            {name: '춘천', code: '11D10301'}, // 강원 서부
            {name: '원주', code: '11D10401'}, // 강원 남서
            {name: '강릉', code: '11D20501'}, // 강원 동부

            {name: '대전', code: '11C20401'}, // 충남
            {name: '세종', code: '11C20404'}, // 충남
            {name: '서산', code: '11C20101'}, // 충남 서부
            {name: '홍성', code: '11C20104'}, // 충남북부서해안

            {name: '청주', code: '11C10301'}, // 충북

            {name: '광주', code: '11F20501'}, // 전남 북부
            {name: '목포', code: '21F20801'}, // 전남 서부
            {name: '여수', code: '11F20401'}, // 전남 남부

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
            {name: '동해북부 ', code: '12C30000'},
            {name: '대화퇴', code: '12D00000'},
            {name: '동중국해', code: '12E00000'},
            {name: '규슈', code: '12F00000'},
            {name: '연해주', code: '12G00000'},
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
        TOWN_CURRENT: 'http://'+KMA_API_DOMAIN+'/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst',
        TOWN_SHORTEST: 'http://'+KMA_API_DOMAIN+'/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst',
        TOWN_SHORT: 'http://'+KMA_API_DOMAIN+'/1360000/VilageFcstInfoService_2.0/getVilageFcst',
        MID_FORECAST: 'http://'+KMA_API_DOMAIN+'/1360000/MidFcstInfoService/getMidFcst',
        MID_LAND: 'http://'+KMA_API_DOMAIN+'/1360000/MidFcstInfoService/getMidLandFcst',
        MID_TEMP: 'http://'+KMA_API_DOMAIN+'/1360000/MidFcstInfoService/getMidTa',
        MID_SEA: 'http://'+KMA_API_DOMAIN+'/1360000/MidFcstInfoService/getMidSeaFcst'
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
        self.timeout = 0;
        self.retryCount = 0;
    }

    //it seems to be unused
    if(callback){
        self.callback = callback;
    }

    /*
    * If it fails to get data from server,
    * we can get the notify by request event and will decide whether to retry or ignore this item
    */
    self.on('recvFail', function(listIndex){
        log.debug('Fail index[%d], totalCount[%d], receivedCount[%d]', listIndex, self.listCount, self.receivedCount);
        if(self.resultList[listIndex].retryCount > 0){
            //log.error('try again:', listIndex);
            //log.error('URL : ', self.resultList[listIndex].url);
            //log.error(self.resultList[listIndex].options);

            setTimeout(function(){
                self.resultList[listIndex].retryCount--;
                self.getData(listIndex, self.resultList[listIndex].options.dataType, self.resultList[listIndex].url,
                    self.resultList[listIndex].options);
            }, self.timeout);

            //self.resultList[listIndex].retryCount--;
            //self.getData(listIndex, self.resultList[listIndex].options.dataType, self.resultList[listIndex].url, self.resultList[listIndex].options);
        }
        else
        {
            self.recvFailed = true;
            self.receivedCount++;

            log.debug('Collection failed at index', listIndex);

            if(self.receivedCount === self.listCount){
                self.emit('dataCompleted');
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

        log.debug('Recv index[%d], totalCount[%d], receivedCount[%d]', listIndex, self.listCount, self.receivedCount);
        if(self.receivedCount === self.listCount){
            self.emit('dataCompleted');
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

    // Accept a raw key or exactly one layer of URI percent encoding.
    // Decode once (never form-decode '+'), then encode the query component.
    // Literal percent characters must be supplied as %25.
    try {
        if (typeof key !== 'string' || !key.trim()) {
            throw new Error('Missing service key');
        }
        url += '?serviceKey=' + encodeURIComponent(decodeURIComponent(key));
    }
    catch (err) {
        log.warn('KMA invalid service key representation');
        return '';
    }

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
            },
            mCoord: {}
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
CollectData.prototype.getData = function(index, dataType, url, options, callback){
    var self = this;
    // Only locally constructed metadata may enter diagnostics. Transport/parser
    // errors and provider messages can echo the service-key-bearing request URL.
    var meta = {method: 'getData', index: index, dataType: dataType};
    function fail(reason) {
        var error = new Error(reason);
        log.warn(reason, meta);
        self.emit('recvFail', index);
        if (callback) {
            callback(error, index);
        }
    }

    req.get(url, {timeout: 1000*10}, function(err, response, body){
        if (err) {
            return fail('KMA transport failure');
        }
        if (!response || !(response.statusCode >= 200 && response.statusCode < 300)) {
            return fail('KMA HTTP failure');
        }
        xml2json(body, function(err, result){
            var envelope = result && result.response;
            var header = envelope && envelope.header && envelope.header[0];
            var payload = envelope && envelope.body && envelope.body[0];
            var count = payload && payload.totalCount && payload.totalCount[0];
            var items = payload && payload.items && payload.items[0] && payload.items[0].item;
            if (err || !header || !header.resultCode || header.resultCode[0] !== '00' ||
                !/^[0-9]+$/.test(count) || !isFinite(Number(count)) || Number(count) <= 0 ||
                !Array.isArray(items) || items.length === 0 || items.some(function (item) {
                    return !item || typeof item !== 'object' || Array.isArray(item);
                })) {
                return fail('KMA invalid or empty response');
            }
            // This requester intentionally fetches one page only. Never mark
            // a truncated prefix complete, even if its last group is valid.
            if (Number(count) !== items.length) {
                return fail('KMA incomplete or inconsistent response');
            }
            var organized;
            try {
                switch(dataType) {
                    case self.DATA_TYPE.TOWN_CURRENT:
                        organized = self.organizeCurrentData(index, result);
                        break;
                    case self.DATA_TYPE.TOWN_SHORTEST:
                        organized = self.organizeShortestData(index, result);
                        break;
                    case self.DATA_TYPE.TOWN_SHORT:
                        organized = self.organizeShortData(index, result);
                        break;
                    case self.DATA_TYPE.MID_FORECAST:
                        organized = self.organizeForecastData(index, result, options);
                        break;
                    case self.DATA_TYPE.MID_LAND:
                        organized = self.organizeLandData(index, result, options);
                        break;
                    case self.DATA_TYPE.MID_TEMP:
                        organized = self.organizeTempData(index, result, options);
                        break;
                    case self.DATA_TYPE.MID_SEA:
                        organized = self.organizeSeaData(index, result, options);
                        break;
                    default:
                        return fail('KMA unknown data type');
                }
            }
            catch(e) {
                return fail('KMA response organization failed');
            }
            if (callback) {
                callback(organized === true ? null : new Error('KMA response organization failed'), index,
                    organized === true ? result : undefined);
            }
        });
    });
};

// Hourly precipitation: a category keeps a representative amount plus its text,
// which carries the bounds (#2583). Unparseable values stay missing and are counted
// so that a new KMA notation is noticed (see warnUnparsed).
function setPrecipitation(result, field, value, unit, noValue, unparsed) {
    var parsed = precipitation.parse(value, unit, noValue);
    if (!parsed && unparsed) {
        unparsed.count += 1;
        if (unparsed.example === undefined) {
            unparsed.example = field + '=' + String(value).trim().slice(0, 16);
        }
    }
    result[field] = parsed ? parsed.amount : -1;
    if (parsed && parsed.approx) {
        result[field + 'Text'] = value.trim();
    }
    else {
        delete result[field + 'Text'];
    }
}

// One warning per batch: the count and a short example, never the raw response.
function warnUnparsed(index, unparsed) {
    if (unparsed.count) {
        log.warn('KMA unparsed precipitation values', {index: index, count: unparsed.count, example: unparsed.example});
    }
}

// Complete decimal values only: ranges/thresholds must not become exact amounts.
function parseMeasurement(value, missing, unit, noValue) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return missing;
    }
    var text = String(value).trim();
    if (noValue && text === noValue) {
        return 0;
    }
    if (unit && text.slice(-unit.length) === unit) {
        text = text.slice(0, -unit.length).trim();
    }
    if (!/^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(text)) {
        return missing;
    }
    var number = Number(text);
    return isFinite(number) && (!unit || number >= 0) ? number : missing;
}

// An empty batch or non-finite measurement must never mark collection complete.
CollectData.prototype._emitOrganizedData = function (index, records, required) {
    var invalid = !records.length || records.some(function (record) {
        for (var key in record) {
            if (key.slice(0, 2) === 'wf' &&
                (typeof record[key] !== 'string' || !record[key].trim())) {
                return true;
            }
            if (typeof record[key] === 'number' && !isFinite(record[key])) {
                return true;
            }
        }
        return required && required.some(function (field) {
            return typeof record[field.name] !== 'number' ||
                record[field.name] === field.missing || record[field.name] < field.min;
        });
    });
    if (invalid) {
        log.warn('KMA empty or invalid organized data', {index: index});
        this.emit('recvFail', index);
        return false;
    }
    this.emit('recvData', index, records);
    return true;
};

CollectData.prototype._createOrFindResult = function(list, template, date, time) {
    for (var i=0; i<list.length; i+=1) {
        if (list[i].date === date && list[i].time === time) {
            return list[i];
        }
    }
    list.push(Object.create(template));
    return list[list.length-1];
};

CollectData.prototype._sortByDateTime = function (a, b) {
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
};

CollectData.prototype.organizeShortData = function(index, listData){
    var self = this;
    var i = 0;
    var listResult = [];

    try{
        if (listData.response.body[0].totalCount[0] === '0') {
            log.error('There are no data', {index: index});
            self.emit('recvFail', index);
            return;
        }

        var listItem = listData.response.body[0].items[0].item;
        //log.info('shortData count : ' + listItem.length);
        var template = {
            pubDate: '', /*baseDate+baseTime*/
            date: '',   /* fcstDate */
            time: '',   /* fcstTime */
            mx: -1,
            my: -1,
            pop: -1,    /* 강수 확률 : 1% 단위, invalid : -1 */
            pty: -1,    /* 강수 형태 : 없음(0) 비(1) 비/눈(2) 눈(3) , invalid : -1 */
            r06: -1,    /* 1시간 강수량 PCP (legacy name) : mm, category → representative amount + r06Text, invalid : -1 */
            reh: -1,    /* 습도 : 1% , invalid : -1 */
            s06: -1,    /* 1시간 신적설 SNO (legacy name) : cm, category → representative amount + s06Text, invalid : -1 */
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

        var unparsed = {count: 0};
        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if((item.fcstDate === undefined)
                && (item.fcstTime === undefined)
                && (item.fcstValue === undefined)){
                log.error(new Error('There is not forecast date'));
                continue;
            }

            if((item.fcstDate[0].length > 1) && (item.fcstTime[0].length > 1)){
                //log.info(i, item);
                var result = self._createOrFindResult(listResult, template, item.fcstDate[0], item.fcstTime[0]);

                result.pubDate = item.baseDate[0] + item.baseTime[0];
                result.date = item.fcstDate[0];
                result.time = item.fcstTime[0];
                result.mx = parseInt(item.nx[0]);
                result.my = parseInt(item.ny[0]);

                if(item.category[0] === 'POP') {result.pop = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'PTY') {result.pty = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'R06') {result.r06 = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'REH') {result.reh = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'S06') {result.s06 = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'SKY') {result.sky = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'T3H') {result.t3h = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'TMN') {result.tmn = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'TMX') {result.tmx = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'UUU') {result.uuu = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'VVV') {result.vvv = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'WAV') {result.wav = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'VEC') {result.vec = parseFloat(item.fcstValue[0]);}
                else if(item.category[0] === 'WSD') {result.wsd = parseFloat(item.fcstValue[0]);}
                // PCP/SNO are hourly amounts kept under the legacy r06/s06 names; the
                // service sums them per slot (#2583). TMP is not proof of the legacy
                // three-hour temperature cadence.
                else if(item.category[0] === 'PCP') {
                    setPrecipitation(result, 'r06', item.fcstValue[0], 'mm', '강수없음', unparsed);
                }
                else if(item.category[0] === 'SNO') {
                    setPrecipitation(result, 's06', item.fcstValue[0], 'cm', '적설없음', unparsed);
                }
                else if(item.category[0] === 'TMP') {
                    result.t3h = parseMeasurement(item.fcstValue[0], -50);
                }
                else{
                    log.error(new Error('Known property', item.category[0]));
                }
            }
        }

        warnUnparsed(index, unparsed);

        var data = listResult[0];
        if (data.sky === template.sky || data.reh === template.reh || data.pty === template.pty ||
            data.t3h === template.t3h) {
            log.error('Fail get full short data -', {index: index});
            self.emit('recvFail', index);
            return;
        }
        //TW-401
        if (data.pty < 0 || data.sky < 0 || data.t3h < -100 || data.reh < 0) {
            log.error('Fail get full short data -', {index: index});
            self.emit('recvFail', index);
            return;
        }
        if (data.uuu === template.uuu || data.vvv === template.vvv || data.vec === template.vec ||
            data.wsd === template.wsd) {
            log.warn('Fail get full short data -', {index: index});
        }

        listResult.sort(self._sortByDateTime);

        //log.info('result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        return self._emitOrganizedData(index, listResult, [
            {name: 'sky', missing: -1, min: 0}, {name: 'reh', missing: -1, min: 0},
            {name: 'pty', missing: -1, min: 0}, {name: 't3h', missing: -50, min: -100}
        ]);
    }
    catch(e){
        log.error('Error!! organizeShortData : failed data organized');
        self.emit('recvFail', index);
    }
};

CollectData.prototype.organizeShortestData = function(index, listData) {
    var self = this;
    var listResult = [];
    var template = {
        pubDate: '', /*baseDate+baseTime*/
        date: '',
        time: '',
        mx: -1,
        my: -1,
        pty: -1, /* 강수 형태 : 1%, invalid : -1 */
        rn1: -1, /* 1시간 강수량 : mm, category → representative amount + rn1Text, invalid : -1 */
        sky: -1, /* 하늘상태 : 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1*/
        lgt: -1, /* 낙뢰 : 확률없음(0) 낮음(1) 보통(2) 높음(3), invalid : -1 */
        t1h: -50,
        reh: -1,
        uuu: -100,
        vvv: -100,
        vec: -1,
        wsd: -1
    };

    //log.info('shortestData count : ' + listItem.length);

    try{
        if (listData.response.body[0].totalCount[0] === '0') {
            log.error('There are no data', {index: index});
            self.emit('recvFail', index);
            return;
        }

        var listItem = listData.response.body[0].items[0].item;

        var unparsed = {count: 0};
        for(var i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            if((item.fcstDate === undefined)
                && (item.fcstTime === undefined)
                && (item.fcstValue === undefined)){
                log.error(new Error('There is not shortest forecast date'));
                continue;
            }

            if((item.fcstDate[0].length > 1) && (item.fcstTime[0].length > 1)){
                var result = self._createOrFindResult(listResult, template, item.fcstDate[0], item.fcstTime[0]);

                result.pubDate = item.baseDate[0] + item.baseTime[0];
                result.date = item.fcstDate[0];
                result.time = item.fcstTime[0];
                result.mx = parseInt(item.nx[0]);
                result.my = parseInt(item.ny[0]);

                var value = item.fcstValue && item.fcstValue[0];
                var val = parseFloat(value);
                //if (val < 0) {
                //    log.error('organize Shortest Get invalid data '+ item.category[0]+ ' result'+ JSON.stringify(result));
                //}

                if(item.category[0] === 'PTY') {result.pty = val;}
                else if(item.category[0] === 'RN1') {
                    setPrecipitation(result, 'rn1', value, 'mm', '강수없음', unparsed);
                }
                else if(item.category[0] === 'SKY') {result.sky = val;}
                else if(item.category[0] === 'LGT') {result.lgt = val;}
                else if(item.category[0] === 'T1H') {result.t1h = val;}
                else if(item.category[0] === 'REH') {result.reh = val;}
                else if(item.category[0] === 'UUU') {result.uuu = val;}
                else if(item.category[0] === 'VVV') {result.vvv = val;}
                else if(item.category[0] === 'VEC') {result.vec = val;}
                else if(item.category[0] === 'WSD') {result.wsd = val;}
                else{
                    log.error('Unknown shortest category');
                }
            }
        }

        warnUnparsed(index, unparsed);

        var data = listResult[0];
        if (data.sky === template.sky || data.reh === template.reh || data.pty === template.pty ||
            data.t1h === template.t1h) {
            log.error('Fail get full shortest data -', {index: index});
            self.emit('recvFail', index);
            return;
        }
        //TW-401
        if (data.pty < 0 || data.sky < 0 || data.t1h < -100 || data.reh < 0) {
            log.error('Fail get full shortest data -', {index: index});
            self.emit('recvFail', index);
            return;
        }
        if (data.uuu === template.uuu || data.vvv === template.vvv || data.lgt === template.lgt ||
            data.vec === template.vec || data.wsd === template.wsd) {
            log.warn('Fail get full shortest data -', {index: index});
        }

        listResult.sort(self._sortByDateTime);

        //log.silly('organizeShortestData result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.silly(listResult[i]);
        //}

        return self._emitOrganizedData(index, listResult, [
            {name: 'sky', missing: -1, min: 0}, {name: 'reh', missing: -1, min: 0},
            {name: 'pty', missing: -1, min: 0}, {name: 't1h', missing: -50, min: -100}
        ]);
    }
    catch(e){
        log.error('KMA collection operation failed');
        self.emit('recvFail', index);
    }
};

CollectData.prototype.organizeCurrentData = function(index, listData) {
    var self = this;
    var i = 0;
    var listResult = [];

    try{
        var listItem;
        var result;
        //log.info('currentData count : ' + listItem.length);
        //log.info(listItem);
        var template = {
            pubDate: '', /*baseDate+baseTime*/
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

        listItem = listData.response.body[0].items[0].item;

        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if((item.baseDate === undefined) &&
                        (item.baseTime === undefined) &&
                        (item.obsrValue === undefined))
            {
                log.error('organizeCurrentData : There is not forecast date');
                continue;
            }

            if((item.baseDate[0].length > 1) && (item.baseTime[0].length > 1)) {

                result = self._createOrFindResult(listResult, template, item.baseDate[0], item.baseTime[0]);
                result.pubDate = item.baseDate[0] + item.baseTime[0];
                result.date = item.baseDate[0];
                result.time = item.baseTime[0];
                result.mx = parseInt(item.nx[0]);
                result.my = parseInt(item.ny[0]);

                if(item.category[0] === 'T1H') {result.t1h = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'RN1') {result.rn1 = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'SKY') {result.sky = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'UUU') {result.uuu = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'VVV') {result.vvv = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'REH') {result.reh = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'PTY') {result.pty = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'LGT') {result.lgt = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'VEC') {result.vec = parseFloat(item.obsrValue[0]);}
                else if(item.category[0] === 'WSD') {result.wsd = parseFloat(item.obsrValue[0]);}
                else{
                    log.error('Unknown current category');
                }
            }
        }

        //check data complete
        result = listResult[0];
        if (result.rn1 === template.rn1 || result.pty === template.pty || result.t1h === template.t1h) {
            log.error('Fail get full current data -', {index: index});
            self.emit('recvFail', index);
            return;
        }

        //TW-401
        if (result.t1h < -100) {
            log.error('Fail get full current data -', {index: index});
            self.emit('recvFail', index);
            return;
        }

        if (result.pty < 0) {
            log.warn('Fail get pty of current data -', {index: index});
            delete result.pty;
        }

        if (result.rn1 < 0) {
            log.warn('Fail get rn1 of current data -', {index: index});
            delete result.rn1;
        }

        if (result.reh < 0) {
            log.warn('Fail get reh of current data -', {index: index});
            delete result.reh;
        }

        if (result.uuu === template.uuu || result.vvv === template.vvv ||
            result.vec === template.vec || result.wsd === template.wsd)
        {
            log.warn('Fail get full current data -', {index: index});
        }

        //log.info('result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        return self._emitOrganizedData(index, listResult);
    }
    catch(e){
        log.error('Error!! organizeCurrentData : failed data organized');
        log.error('KMA collection operation failed');
        self.emit('recvFail', index);
    }
};

CollectData.prototype.organizeForecastData = function(index, listData, options){
    var self = this;
    var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('organizeForecastData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            pubDate: options.date + options.time,
            date: options.date,
            time: options.time,
            pointNumber: options.code,
            cnt: 0,
            wfsv: ''
        };

        for(i=0 ; i < listItem.length ; i++){
            var item = listItem[i];
            //log.info(item);
            if (!item.wfSv || typeof item.wfSv[0] !== 'string' || !item.wfSv[0].trim()) {
                throw new Error('Missing mid forecast text');
            }
            result = Object.assign({}, template);
            result.wfsv = item.wfSv[0];
            listResult.push(result);
        }

        //log.info('result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        return self._emitOrganizedData(index, listResult);
    }
    catch(e){
        log.error('Error!! organizeForecastData : failed data organized');
        self.emit('recvFail', index);
    }
};

// Missing horizons stay absent; downstream consumers require a complete daily row.
['Land', 'Temp'].forEach(function (dataset) {
    CollectData.prototype['organize' + dataset + 'Data'] = function (index, response, options) {
        try {
            var records = midPolicy.parse(dataset.toLowerCase(), response, options);
            return this._emitOrganizedData(index, records);
        } catch (e) {
            log.warn('KMA mid forecast invalid', {dataset: dataset, index: index,
                publication: options && options.date + options.time});
            this.emit('recvFail', index);
            return false;
        }
    };
});

CollectData.prototype.organizeSeaData = function(index, listData, options){
    var self = this;
    //var i = 0;
    var listItem = listData.response.body[0].items[0].item;
    var listResult = [];

    //log.info('currentData count : ' + listItem.length);
    //log.info(listItem);

    try{
        var result = {};
        var template = {
            pubDate: options.date + options.time,
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

        listItem.forEach(function(item){
            if (!item.regId || typeof item.regId[0] !== 'string' || !item.regId[0].trim()) {
                throw new Error('Missing mid region');
            }

            result = Object.assign({}, template);
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

            result.wh3AAm = parseFloat(item.wh3AAm[0]);
            result.wh3APm = parseFloat(item.wh3APm[0]);
            result.wh3BAm = parseFloat(item.wh3BAm[0]);
            result.wh3BPm = parseFloat(item.wh3BPm[0]);
            result.wh4AAm = parseFloat(item.wh4AAm[0]);
            result.wh4APm = parseFloat(item.wh4APm[0]);
            result.wh4BAm = parseFloat(item.wh4BAm[0]);
            result.wh4BPm = parseFloat(item.wh4BPm[0]);
            result.wh5AAm = parseFloat(item.wh5AAm[0]);
            result.wh5APm = parseFloat(item.wh5APm[0]);
            result.wh5BAm = parseFloat(item.wh5BAm[0]);
            result.wh5BPm = parseFloat(item.wh5BPm[0]);
            result.wh6AAm = parseFloat(item.wh6AAm[0]);
            result.wh6APm = parseFloat(item.wh6APm[0]);
            result.wh6BAm = parseFloat(item.wh6BAm[0]);
            result.wh6BPm = parseFloat(item.wh6BPm[0]);
            result.wh7AAm = parseFloat(item.wh7AAm[0]);
            result.wh7APm = parseFloat(item.wh7APm[0]);
            result.wh7BAm = parseFloat(item.wh7BAm[0]);
            result.wh7BPm = parseFloat(item.wh7BPm[0]);
            result.wh8A = parseFloat(item.wh8A[0]);
            result.wh8B = parseFloat(item.wh8B[0]);
            result.wh9A = parseFloat(item.wh9A[0]);
            result.wh9B = parseFloat(item.wh9B[0]);
            result.wh10A = parseFloat(item.wh10A[0]);
            result.wh10B = parseFloat(item.wh10B[0]);

            listResult.push(result);
        });

        //log.info('result count : ', listResult.length);
        //for(i=0 ; i<listResult.length ; i++){
        //    log.info(listResult[i]);
        //}

        return self._emitOrganizedData(index, listResult);
    }
    catch(e){
        log.error('Error!! organizeSeaData : failed data organized');
        self.emit('recvFail', index);
    }
};

CollectData.prototype.requestDataByBaseTimeList = function (src, dataType, key, baseTimeList, callback) {
    var self = this;
    if (!baseTimeList || !baseTimeList.length) {
        var err = new Error('There is no baseTime list');
        if (callback) {
            callback(err);
        }
        else {
            log.error(err);
        }
        return this;
    }
    self.srcList = baseTimeList;
    self.listCount = baseTimeList.length;
    self.resetResult();

    if (!callback) {
        callback = self.callback;
    }

    if (callback) {
        self.on('dataCompleted', function () {
            if (callback) {
                callback(self.recvFailed, self.resultList);
            }
        });
    }
    try {
        self.srcList.forEach(function (baseTime, i) {
            var string = self.getUrl(dataType, key, baseTime.date, baseTime.time, src);
            self.resultList[i].mCoord = src;
            self.resultList[i].url = string.toString();
            self.resultList[i].options.date = baseTime.date;
            self.resultList[i].options.time = baseTime.time;
            self.resultList[i].options.dataType = dataType;
            if(src.code !== undefined){
                self.resultList[i].options.code = src.code;
            }

            //200 connections per 1 term
            if (i >= 200) {
                self.receivedCount++;
                return;
            }

            if(self.resultList[i].url !== ''){
                self.getData(parseInt(i), dataType, self.resultList[i].url, self.resultList[i].options);
            }
        });
    }
    catch(e) {
        if (callback) {
            callback(e);
        }
        else if (e) {
            log.error('KMA collection operation failed');
        }
    }
    return this;
};

CollectData.prototype.requestData = function(srcList, dataType, key, date, time, callback){
    var self = this;
    var meta = {};

    meta.method = 'requestData';
    meta.dataType = dataType;
    meta.date = date;
    meta.time = time;

    if(!srcList || !srcList.length){
        var err = new Error('There is no location list');
        if (callback) {
            callback(err);
        }
        else {
            err.message += ' ' + JSON.stringify(meta);
            log.error(err);
        }
        return this;
    }

    self.srcList = srcList;
    self.listCount = srcList.length;
    self.resetResult();

    if(callback || self.callback){
        self.on('dataCompleted', function() {
            try{
                log.debug("request dataCompleted");
                if (self.callback) {
                    self.callback(self.recvFailed, self.resultList);
                }
                if (callback) {
                    callback(self.recvFailed, self.resultList);
                }
            }
            catch (e) {
                //callback 안에서 error가 발생하면 이쪽으로 타기 때문에 여기서 error를 callback으로 넘지면 안됨
                log.error("requestData : ERROR !!! in event dataCompleted");
                log.error('Collection callback failed', meta);
            }
        });
    }

    try{
        for(var i in self.srcList) {
            var string = self.getUrl(dataType, key, date, time, self.srcList[i]);
            self.resultList[i].mCoord = self.srcList[i];
            self.resultList[i].url = string.toString();
            self.resultList[i].options.date = date;
            self.resultList[i].options.time = time;
            self.resultList[i].options.dataType = dataType;
            if(srcList[i].code !== undefined){
                self.resultList[i].options.code = srcList[i].code;
            }

            if(self.resultList[i].url !== ''){
                if(parseInt(i) > 100){
                    self.emit('recvFail', parseInt(i));
                    continue;
                }
                self.getData(parseInt(i), dataType, self.resultList[i].url, self.resultList[i].options);
            }
        }
    }
    catch(e){
        if (callback) {
            callback(e);
        }
        else {
            log.error('Collection request failed', meta);
        }
    }

    return this;
};

module.exports = CollectData;

