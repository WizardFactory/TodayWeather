/**
 * Created by Peter on 2015. 7. 27..
 */

/*
* Collect weather data by using coordinate list.
* Usage :
*       var callectData = require('../lib/collect.js');
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
var xml2json  = require('./xml2json.js');

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
CollectData.prototype.getDataFromList = function(dataType, key, date, time, callback){
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
            self.getData(parseInt(i), self.resultList[i].url);
        }
    }
    catch(e){
        log.err('ERROR !!!', meta);
    }
};

/*
* Description : It request the weather data from server lead to url.
*               If it successes to get data, it would send 'recvData' event to this.
*               If it fail to get data, it would send 'recvFail' event to this.
* */
CollectData.prototype.getData = function(index, url,callback){
    var self = this;
    var meta = {};

    meta.method = 'getData';
    meta.index = index;
    meta.url = url;

    //log.info(meta);
    //log.info('url[', index, ']: ', self.resultList[index].url);

    req.get(url, null, function(err, response, body){
        var resultJson = '';
        if(err) {
            log.error(err);
            self.emit('recvFail', index);
            if(callback){
                callback(err, index);
            }
            return;
        }
        //log.info(body);

        try{
            var parser = new xml2json(body);
            parser.toJson();
            //log.info('index['+ index +'] : ' + JSON.stringify(parser.getJson()));

            resultJson = JSON.stringify(parser.getJson());
        }
        catch(e){
            log.error('Error!!!', meta);
        }
        finally{
            self.emit('recvData', index, resultJson);

            if(callback){
                callback(err, index, resultJson);
            }
        }
    });
};

module.exports = CollectData;

