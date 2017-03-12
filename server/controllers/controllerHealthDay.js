/**
 * Created by neoqmin on 2016. 6. 21..
 * @brief       보건기상지수 데이터를 처리하는 곳
 */

var healthDayKmaDB = require('../models/modelHealthDay');               // 보건지수를 저장할 db
var config = require('../config/config');                               // 보건지수를 얻어올 때 사용할 API 키가 저장되어 있음
var req = require('request');                                           // 요청을 위한 request 모듈
var parseString  = require('xml2js').parseString;                       // 보건지수 결과를 json으로 변경
var hostURL = 'http://203.247.66.146/iros/RetrieveWhoIndexService/';    // 보건지수를 얻어올 기본 URL

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
    returnURL += 'numOfRows=10&pageNo=1&serviceKey=' + config.keyString.test_normal;

    return returnURL;
};

/**
 * @brief               코드에 대한 보건지수명
 * @param code          기상청에서 전달 받는 보건 코드
 * @returns {string}    보건지수명
 */
var getCodeString = function(code) {
    var retStr = "";

    switch (code) {
        case '1':
            retStr = 'asthma-lunt';
            break;
        case '2':
            retStr = 'brain';
            break;
        case '4':
            retStr = 'skin';
            break;
        case '5':
            retStr = 'flowerWoody';
            break;
        case '6':
            retStr = 'flowerPine';
            break;
        case '7':
            retStr = 'flowerWeeds';
            break;
        case '8':
            retStr = 'influenza';
            break;
        default:
            break;
    }

    return retStr;
};

/**
 * @brief               날짜를 주어진 값으로 변경하는 루틴
 * @param today         기준 날짜
 * @param days          증감할 일수
 * @returns {string}    변경된 날짜
 */
var getNextDay = function(today, days) {
    var stringDate = today.substr(0,4) + '-' + today.substr(4,2) + '-' + today.substr(6,2);
    var day = new Date(stringDate);

    day.setDate(day.getDate()+days);

    stringDate = ""+day.getFullYear();
    var temp = day.getMonth()+1;
    if(temp < 10) {
        stringDate += '0';
    }
    stringDate += temp;

    temp = day.getDate();
    if(temp < 10) {
        stringDate += '0';
    }
    stringDate += temp;

    return stringDate;
};

/**
 * @brief       전송받은 데이터를 DB로 저장한다.
 * @param       result 전달받은 데이터
 */
var insertDB = function(result, callback)  {
    // 날짜 확인
    // result[0].date[0];       // 년월일시
    // 지수코드를 확인
    // result[0].code[0][2];    // D01, D02, D04, D05, D06, D07, D08
    var indexType = getCodeString(result[0].code[0][2]);
    var healthData = {};

    console.log("This is result of " + indexType + " length is " + result.length);

    // 10일 이전 데이터 삭제
    var removeDate = getNextDay(result[0].date[0].slice(0,8), -10);
    healthDayKmaDB.remove({"indexType":indexType, "date": {$lt:removeDate} });

    result.forEach(function(data) {
        healthData['areaNo'] = data.areaNo[0];
        healthData['indexType'] = indexType;

        if(data.today[0] !== "") {
            healthData['index'] = data.today[0];
            healthData['date'] = data.date[0].slice(0, 8);

            // insert data
            healthDayKmaDB.update({areaNo: healthData['areaNo'], date: healthData['date'], indexType: indexType }, healthData, {upsert:true},
                function (err, raw) {
                    if(err) {
                        console.error(err.message + "in insertDB(healthData), today");
                        
                        callback(err);
                    }
                }
            );
        }

        if((data.tomorrow[0] !== "")
            && (data.tomorrow[0] !== '*'))
        {
            healthData['index'] = data.tomorrow[0];
            healthData['date'] = getNextDay(data.date[0].slice(0,8), 1);
            healthDayKmaDB.update({
                areaNo:data.areaNo[0],
                date : healthData['date'],
                indexType: indexType},
                healthData, {upsert:true},
                function(err, raw) {
                    if(err) {
                        console.error(err.message + "in insertDB(healthData), tomorrow");
                        console.log(raw);

                        callback(err);
                    }
                }
            );
        }

        if((data.theDayAfterTomorrow[0] !== "")
            && (data.theDayAfterTomorrow[0] !== '*'))
        {
            healthData['index'] = data.theDayAfterTomorrow[0];
            healthData['date'] = getNextDay(data.date[0].slice(0, 8), 2);
            healthDayKmaDB.update({
                    areaNo: data.areaNo[0],
                    date: healthData['date'],
                    indexType: indexType
                }, healthData, {upsert: true},
                function (err, raw) {
                    if(err) {
                        console.error(err.message + "in insertDB(healthData), theDayAfterTomorrow");
                        console.log(raw);
                        
                        callback(err);
                    }
                }
            );
        }
    });
    
    callback();
};

/**
 * @brief       주어진 url 주소로 데이터를 요청한다
 * @param       url
 */
HealthDayController.getData = function(url, callback) {
    var timeout = 1000*10*60;//1000*60*60*24;

    req(url, {timeout: timeout}, function(err, response, body) {
        if (err) {
            callback(err);
        } else if ( response.statusCode >= 400) {
            var err1 = new Error('response.statusCode(' + url + ')='+response.statusCode);
            
            callback(err1);
        } else {
            parseString(body, function(err, result) {
                if(err) {
                    callback(err);
                } else {
                    if (result.Response.Header[0].SuccessYN[0] === 'Y') {
                        // Succeeded
                        console.log('Succeeded to request.');
                        insertDB(result.Response.Body[0].IndexModel, callback);
                    } else {
                        var err1;
                        
                        // Failed
                        if (result.Response.Header[0].ReturnCode[0] == 99) {
                            console.log('This function is not supported in this season. url=' + url);
                        } else {
                            err1 = new Error('Failed to request, url=' + url + ', errcode=' + result.Response.Header[0].ReturnCode[0]);
                        }
                        
                        callback(err1);
                    }
                }
            });
        }
    });
};

module.exports = HealthDayController;

