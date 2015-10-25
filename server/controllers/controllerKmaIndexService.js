/**
 * Created by aleckim on 2015. 10. 14..
 *
 * 자외선 uv 지수(3월~11월), 7시 19시 발표 오늘,내일, 모레까지 위험(11이상), 매우높음(8이상), 높음(6이상), 보통(3이상), 낮음(0)
 * 미세먼지
 * 강수량  - 동네예보 실황, 강수형태, 1시간 강수량
 * 체감온도(11월~3월), 6시 발표 3시간~66시간까지 -45(위험), -25~45(경고), -10~-25(주의), 관심(~10)
 * 바람강도 동네예보, 실황, 풍속, 강수형태,
 *
 * 감기 (9월~4월) 6시, 18시에 오늘, 내일, 모레까지 발표됨, 매우높음(3), 높음(2), 보통(1), 낮음(0)
 * 식중독 fsn (3월~11월) 6시, 18시에 오늘, 내일, 모레까지 발표됨., 위험(95), 경고(70), 주의(35), 관심(35)
 * 오존
 * 불쾌지수(6월~9월), 3시 발표 3시간~66시간까지 80이상(매우높음), 75이상(높음), 68이상(보통), 60미만(낮음)
 * 나들이
 * 빨래
 * 세차
 *
 * 오존지수
 * http://openapi.airkorea.or.kr/openapi/services/rest/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty
 * ?sidoName=서울&pageNo=1&numOfRows=10&ServiceKey=서비스키
 * 시도별 측정소목록에 대한 일반 항목과 CAI 최종 실시간 측정값과 지수 정보 조회 기능을 제공한다..
 * sidoName = 시도 이름 (서울, 부산, 대구, 인천, 광주, 대전, 울산, 경기, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주)
 *
 * response message
 * 측정소 측정일시
 * pm10Value - 미세 농도
 * o3Grade - 오존 지
 *
 * 미세먼지 예보통보 조회
 * http://openapi.airkorea.or.kr/openapi/services/rest/ArpltnInforInqireSvc/getMinuDustFrcstDspth
 * ?searchDate=2013-12-18&ServiceKey=서비스키
 *
 */

"use strict";
var req = require('request');
var Town = require('../models/town');
var LifeIndexKma = require('../models/lifeIndexKma');

//var config = require('../config/config');

//var DOMAIN_KMA_INDEX_SERVICE = "http://openapi.kma.go.kr";
var DOMAIN_KMA_INDEX_SERVICE = "http://203.247.66.146";
var PATH_RETRIEVE_LIFE_INDEX_SERVICE = "iros/RetrieveLifeIndexService";

/**
 *
 * @constructor
 */
function KmaIndexService() {
    this._nextGetFsnLifeListTime = null;
    this._currentAreaIndex = 0;
    this._areaList = [];
    this._providerKey = "";
    this._lastFsnUpdateDate = 0;
}

/**
 *  식중독 지수 시간 체크 (March~November, 6 hours, 18 hours
 * @param currentTime
 * @returns {boolean}
 */
KmaIndexService.prototype.checkTimeGetFsnLifeList = function(currentTime) {
    return currentTime >= this._nextGetFsnLifeListTime;
};

/**
 *
 * @param time
 * @returns {*}
 */
KmaIndexService.prototype.setTimeGetFsnLifeList = function(time) {
    var err;

    if (!time && !this._nextGetFsnLifeListTime) {
        err = new Error("currentTime is undefined");
        log.error(err);
        return err;
    }

    if (time) {
        this._nextGetFsnLifeListTime = time;
    }
    else {
        if (this._nextGetFsnLifeListTime.getUTCHours() < 10) {
            //set 6 PM
            this._nextGetFsnLifeListTime.setHours(9);
        }
        else if (this._nextGetFsnLifeListTime.getUTCHours() >= 10) {
            //set 6 AM
            this._nextGetFsnLifeListTime.setHours(21);
        }
        else if (this._nextGetFsnLifeListTime.getUTCHours() >= 22) {
            //set 6 PM
            this._nextGetFsnLifeListTime.setDate(this._nextGetFsnLifeListTime.getUTCDate()+1);
            this._nextGetFsnLifeListTime.setHours(9);
        }
        else {
            err = new Error("_nextGetFsnLifeListTime is incorrect "+this._nextGetFsnLifeListTime);
            log.error(err);
            return err;
        }

        this._nextGetFsnLifeListTime.setMinutes(10);
        this._nextGetFsnLifeListTime.setSeconds(0);
    }

    log.info("SET next get fsn life list time=", this._nextGetFsnLifeListTime.toString());

    return this;
};

/**
 *
 * @param areaNo
 * @param key
 * @returns {string}
 */
KmaIndexService.prototype.getUrlGetFsnLifeList = function(areaNo, key) {
    if (!key) {
        key = this._providerKey;
    }

    var url = DOMAIN_KMA_INDEX_SERVICE + "/" + PATH_RETRIEVE_LIFE_INDEX_SERVICE + "/" + "getFsnLifeList";
    url += "?serviceKey="+key;
    url += "&AreaNo="+areaNo;
    url += "&_type=json";
    return url;
};

/**
 *
 * @param str
 * @returns {*}
 */
function convertStringToDate(str) {
    var y = str.substr(0,4),
        m = str.substr(4,2) - 1,
        d = str.substr(6,2),
        h = str.substr(8,2);
    if (h!== '') {
        h = str.substr(8,2)-1;
    }
    else {
        h = '0';
    }
    var D = new Date(y,m,d, h);
    return (D.getFullYear() == y && D.getMonth() == m && D.getDate() == d) ? D : undefined;
}

/**
 *
 * @param date
 * @returns {string}
 */
function convertDateToYYYMMDD(date) {

    //I don't know why one more create Date object by aleckim
    var d = new Date(date);
    var month = '' + (d.getMonth() + 1);
    var day = '' + d.getDate();
    var year = d.getFullYear();

    if (month.length < 2) { month = '0' + month; }
    if (day.length < 2) { day = '0' + day; }

    return year+month+day;
}

/* jshint ignore:start */
/**
 *
    "Response": {
        "Header": {
            "SuccessYN": "Y", "ReturnCode": "00","ErrMsg": "" },
        "Body": {
            "@xsi.type": "idxBody",
            "IndexModel": {
                "code": "A01_2", "areaNo": 5013062000, "date": 2015101818, "today": "", "tomorrow": 55,
                "theDayAfterTomorrow": 55}}}
 * @param data
 * @return {*}
 */
/* jshint ignore:end */
KmaIndexService.prototype.parseFsnLifeList = function(data) {
    var err;
    if (!data.Response || !data.Response.Header || !data.Response.Header.SuccessYN) {
        err = new Error("Fail to parse FsnLifeList");
        log.error(err);
        return {error: err};
    }

    if (data.Response.Header.SuccessYN === 'N') {
        if (data.Response.Header.ReturnCode === 99) {
            log.warn("Search result is nothing but continue getting data");
            return {};
        }
        else {
            err = new Error("ReturnCode="+data.Response.Header.ReturnCode+ " ErrMsg="+data.Response.Header.ErrMsg);
            log.error(err);
            return {error: err};
        }
    }

    if (!data.Response.Body || !data.Response.Body.IndexModel) {
        err = new Error("We get success but, Fail to parse FsnLifeList");
        log.error(err);
        return {error: err};
    }

    if (this._lastFsnUpdateDate === data.Response.Body.IndexModel.date) {
        var msg = "fsn life index data has not updated yet";
        log.info(msg);
        return {wait: msg};
    }

    var indexModel = data.Response.Body.IndexModel;
    var areaNo = ''+indexModel.areaNo;
    var lastUpdateDate = ''+indexModel.date;
    var parsedData = {lastUpdateDate: lastUpdateDate, data: []};

    var today = convertStringToDate(lastUpdateDate);
    var tomorrowStr = convertDateToYYYMMDD(today.setDate(today.getDate()+1));
    var tdatStr = convertDateToYYYMMDD(today.setDate(today.getDate()+1));

    if (indexModel.today !== "") {
        parsedData.data.push({date: lastUpdateDate.substr(0,8), value: indexModel.today});
    }
    parsedData.data.push({date: tomorrowStr, value: indexModel.tomorrow});
    parsedData.data.push({date: tdatStr, value: indexModel.theDayAfterTomorrow});

    return {error: undefined, data: {areaNo: areaNo, fsn: parsedData}};
};

/**
 *
 * @param key
 * @returns {KmaIndexService}
 */
KmaIndexService.prototype.setProviderKey = function(key) {
    this._providerKey = key;
    log.info('Set KEY!!');
    return this;
};

/**
 *
 * @param list
 * @param index
 * @param {cbRcvFsnIndexList} callback
 */
KmaIndexService.prototype.recursiveGetFsnLifeList = function(list, index, callback) {
    var self = this;

    if (index >= list.length) {
        //finish get all data
        self._currentAreaIndex = 0;
        self.setTimeGetFsnLifeList();
        log.info('Finish get fsn life index');
        return;
    }

    if (!list[index].areaNo) {
        log.debug('Skip this area, areaNo is nothing index='+index);
        self._currentAreaIndex++;
        self.recursiveGetFsnLifeList.call(self, list, self._currentAreaIndex, callback);
        return;
    }

    var url = this.getUrlGetFsnLifeList(list[index].areaNo, this._providerKey);

    req(url, {json:true}, function(err, response, body) {
        if (err)  {
            callback(err, index);
            return;
        }

        try {
            err = callback(undefined, index, body);
            if (err) {
                log.warn("Rcv error from callback, stop getting fsn life list");
                return;
            }
        }
        catch(err) {
            log.error(err);
            return;
        }

        self._currentAreaIndex++;
        self.recursiveGetFsnLifeList.call(self, list, self._currentAreaIndex, callback);
    });
};
/**
 * It's anonymous function in taskFsnLife
 * @callback cbRcvFsnIndexList
 * @param {Error} error
 * @param {Number} index
 * @param {Object} data
 */

/**
 *
 */
KmaIndexService.prototype.loadAreaList = function() {
    log.info("LOAD AREA LIST");

    var self = this;
    Town.find({}, function(err, townList) {
        if (err)  {
            log.error("Fail to load townlist");
            return err;
        }
        self._areaList = townList;
        log.info("areaList="+self._areaList.length);
    });
};

/**
 *
 * @param fsn
 * @param newFsn
 */
KmaIndexService.prototype.updateOrAddFsnLifeData = function(fsn, newFsn) {
   fsn.lastUpdateDate = newFsn.lastUpdateDate;

   var newFsnDataList = newFsn.data;
   newFsnDataList.forEach(function (newData) {
       for (var i=0; i<fsn.data.length; i++) {
           if (fsn.data[i].date === newData.date) {
               fsn.data[i].value = newData.value;
               break;
           }
       }
       if (i >= fsn.data.length) {
           fsn.data.push(newData);
       }
   });
};

/**
 *
 * @param townObject
 * @param data
 */
KmaIndexService.prototype.saveLifeIndex = function(townObject, data) {
    var self = this;

    LifeIndexKma.find({areaNo: data.areaNo}, function(err, fsnList) {
        if (fsnList.length === 0) {
            var kmaIndex = new LifeIndexKma({town: townObject.town, mCoord: townObject.mCoord, areaNo: data.areaNo,
                        fsn: data.fsn});

            kmaIndex.save(function (err) {
                if (err) {
                    log.error(err);
                }
            });
            //create new fsn life
            return;
        }

        fsnList.forEach(function (fsn) {
            self.updateOrAddFsnLifeData(fsn, data.fsn);
        });

        fsnList.save(function (err) {
           if (err)  {
               log.error(err);
           }
        });
    });
};

/**
 *
 */
KmaIndexService.prototype.taskFsnLife = function() {
    var self = this;
    var time = new Date();

    if(!this.checkTimeGetFsnLifeList(time)) {
       return;
    }

    log.info('start to get fsn life list ' + time);

    this.recursiveGetFsnLifeList(this._areaList, this._currentAreaIndex, function (err, index, data) {
        if (err) {
            log.error(err);
            return err;
        }
        log.verbose(data);

        var result = self.parseFsnLifeList(data);
        if (result.error) {
            log.error(result.error);
            return result.error;
        }
        if (result.wait) {
            log.info(result.wait);
            return result.wait;
        }

        log.debug(self._currentAreaIndex);
        log.debug(result.data);
        if (result.data) {
            self.saveLifeIndex(self._areaList[index], result.data);
        }
    });
};

/**
 *
 * @param self
 * @returns {*}
 */
KmaIndexService.prototype.cbMainProcess = function(self) {
    log.info("Called KMA Index service Main process");
    if (!self._providerKey) {
        return log.error("You have to set KEY first!");
    }

    //for WINTER
    //SensorytemLife
    //FrostbiteLife
    //WinterLife

    //for SUMMER
    //DsplsLife
    self.taskFsnLife();
    //RotLife
    //HeatLife

    //UltrvLife
    //AirpollutionLife
};

/**
 *
 */
KmaIndexService.prototype.start = function() {
    log.info('start KMA INDEX SERVICE');
    this.loadAreaList();
    this.setTimeGetFsnLifeList(new Date());
    setInterval(this.cbMainProcess, 60*1000*10, this);
};

module.exports = KmaIndexService;

