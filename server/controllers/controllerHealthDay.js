/**
 * Created by neoqmin on 2016. 6. 21..
 * @brief       보건기상지수 데이터를 처리하는 곳
 */

'use strict';

var async = require('async');

var healthDayKmaDB = require('../models/modelHealthDay');               // 보건지수를 저장할 db
var config = require('../config/config');                               // 보건지수를 얻어올 때 사용할 API 키가 저장되어 있음
var req = require('request');                                           // 요청을 위한 request 모듈
var hostURL = 'http://203.247.66.146/iros/RetrieveWhoIndexService/';    // 보건지수를 얻어올 기본 URL
var kmaTimeLib = require('../lib/kmaTimeLib');

function HealthDayController() {

}

/**
 * @brief                   보건지수를 얻어올 수 있는 URL을 만드는 루틴
 * @param operationNumber   얻어올 보건지수 순번
 * @param areaNumber        지역 코드(0일 경우 지역을 지정하지 않는다)
 * @returns {string}        보건지수를 얻어올 수 있는 URL
 */
HealthDayController.makeRequestString = function (operationNumber, areaNumber) {
    var returnURL = hostURL;
    var operationString = "getAsthmaWhoList";   // 천식, 폐질환가능지수

    switch(operationNumber) {
    case 1: // 폐질환가능지수
        operationString = "getAsthmaWhoList";
        break;
    case 2: // 뇌졸중가능지수
        operationString = "getBrainWhoList";
        break;
    case 3: // 피부질환가능지수
        operationString = "getSkinWhoList";
        break;
    case 4: // 꽃가루농도위험지수(참나무)
        operationString = "getFlowerWoodyWhoList";
        break;
    case 5: // 꽃가루농도위험지수(소나무)
        operationString = "getFlowerPineWhoList";
        break;
    case 6: // 꽃가루농도위험지수(잡초류)
        operationString = "getFlowerWeedsWhoList";
        break;
    case 7: // 감기가능지
        operationString = "getInflWhoList";
        break;
    }

    // getLuntWhoList?AreoNo=1100000000&numOfRows=999&pageNo=1&serviceKey=
    returnURL = returnURL + operationString + '?';
    if(areaNumber !== 0) {
        returnURL += 'AreaNo=' + areaNumber + '&';
    }
    returnURL += 'numOfRows=10&pageNo=1&serviceKey=' + config.keyString.test_normal + '&_type=json';

    return returnURL;
};

/**
 * indexModes.result[0].code가 맞지 않음
 * @param url
 * @returns {string}
 * @private
 */
function _getCodeStrFromUrl(url) {

    if (typeof url !== 'string') {
        log.error("Invalid url=", url);
        return;
    }

    if (url.indexOf('getAsthmaWhoList') >= 0) {
        return 'asthma-lunt';
    }
    else if (url.indexOf('getBrainWhoList') >= 0) {
        return 'brain';
    }
    else if (url.indexOf('getSkinWhoList') >= 0) {
        return 'skin';
    }
    else if (url.indexOf('getFlowerWoodyWhoList') >= 0) {
        return 'flowerWoody';
    }
    else if (url.indexOf('getFlowerPineWhoList') >= 0) {
        return 'flowerPine';
    }
    else if (url.indexOf('getFlowerWeedsWhoList') >= 0) {
        return 'flowerWeeds';
    }
    else if (url.indexOf('getInflWhoList') >= 0) {
        return 'influenza';
    }
    else {
        log.error("Fail to find index model of url=", url);
    }
}

/**
 * @brief       전송받은 데이터를 DB로 저장한다.
 * @param       result 전달받은 데이터
 * @param       indexType result의 있는 code는 변경되어서 type 구분에 사용할 수 없음.
 */
var insertDB = function(result, indexType, callback)  {
    // 날짜 확인
    // result[0].date[0];       // 년월일시

    log.info("This is result of " + indexType + " length is " + result.length);

    // 10일 이전 데이터 삭제
    var removeDate = kmaTimeLib.convertStringToDate(result[0].date.slice(0,8));
    removeDate.setDate(removeDate.getDate()-10);

    healthDayKmaDB.remove({"indexType":indexType, "date": {$lt:removeDate} });

    var healthDataList = [];
    result.forEach(function(data) {

        var today = kmaTimeLib.convertStringToDate(data.date.slice(0, 8));
        if( (data.today !== "") &&
            (data.today !== '*') ) {
            var healthData = {};
            healthData['areaNo'] = parseInt(data.areaNo);
            healthData['indexType'] = indexType;
            healthData['index'] = data.today;
            healthData['date'] = today;

            healthDataList.push(healthData);
        }

        if((data.tomorrow !== "")
            && (data.tomorrow !== '*'))
        {
            var tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate()+1);
            var healthData1 = {};
            healthData1['areaNo'] = parseInt(data.areaNo);
            healthData1['indexType'] = indexType;
            healthData1['index'] = data.tomorrow;
            healthData1['date'] = tomorrow;
            healthDataList.push(healthData1);
        }

        if((data.theDayAfterTomorrow !== "")
            && (data.theDayAfterTomorrow !== '*'))
        {
            var theDayAfterTomorrow = new Date(today);
            theDayAfterTomorrow.setDate(theDayAfterTomorrow.getDate()+2);
            var healthData2 = {};
            healthData2['areaNo'] = parseInt(data.areaNo);
            healthData2['indexType'] = indexType;
            healthData2['index'] = data.theDayAfterTomorrow;
            healthData2['date'] = theDayAfterTomorrow;
            healthDataList.push(healthData2);
        }
    });

    async.mapSeries(healthDataList,
        function (healthData, mCallback) {
            healthDayKmaDB.update({areaNo: healthData['areaNo'], date: healthData['date'], indexType: healthData['indexType']}, healthData, {upsert:true},
                function (err) {
                    if(err) {
                        log.error(err.message + "in insert DB(healthData)");
                        log.info(JSON.stringify(healthData));
                        return mCallback(err);
                    }
                    mCallback();
                }
            );
        }, function (err) {
            log.info('indexType='+indexType+' saved');
            callback(err);
        });
};

/**
 * 연속 요청시에 error 응답이 많음 #1982
 * @brief       주어진 url 주소로 데이터를 요청한다
 * @param       url
 */
HealthDayController.getData = function(urlList, callback) {

    async.mapSeries(urlList, function (url, mCallback) {
        var timeout = 1000*60;//1000*60*60*24;
        log.info('[healthday] get :' + url);
        req(url, {timeout: timeout, json: true}, function(err, response, body) {
            if (err) {
                return mCallback(err);
            } else if ( response.statusCode >= 400) {
                err = new Error('response.statusCode(' + url + ')='+response.statusCode);

                return mCallback(err);
            } else {
                var result = body;
                var successYN;
                var indexModels;
                var indexType;
                var returnCode;
                try {
                   successYN = result.Response.header.successYN;
                   if (successYN === 'Y') {
                       indexModels = result.Response.body.indexModels;
                       indexType = _getCodeStrFromUrl(url);
                   }
                   else {
                       returnCode = result.Response.header.returnCode;
                       if (returnCode == 99) {
                           log.info('This function is not supported in this season. url=' + url);
                       } else {
                           err = new Error('Failed to request, url=' + url + ', errcode=' + returnCode);
                       }
                   }
                }
                catch(err) {
                    console.warn('[healthday] fail to get : '+url);
                    return mCallback(err);
                }
                if (successYN === 'Y') {
                    insertDB(indexModels, indexType, mCallback);
                }
                else {
                    mCallback(err);
                }
            }
        });
    }, function (err) {
        if (err)  {
            return callback(err);
        }
        callback();
    });
};

module.exports = HealthDayController;

