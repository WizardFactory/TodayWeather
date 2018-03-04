/**
 * Created by aleckim on 2018. 1. 25..
 * kecoRequester로부터 새로운 imgPath를 받아, airkorea.dust.image.controller로
 * 제공해서 hourly forecast를 받아와서 저장
 * route(controllerTown)에서 데이터를 가져가는 interface제공
 */

'use strict';

const async = require('async');
const ControllerAirkoreaDustImage = require('./airkorea.dust.image.controller');
const MsrStn = require('../models/modelMsrStnInfo');
const Frcst = require('../models/modelMinuDustFrcst');
const ArpltnHourlyForecast = require('../models/arpltn.hourly.forecast');
const kmaTimeLib = require('../lib/kmaTimeLib');

class AirkoreaHourlyForecastController {
    constructor(imgPaths) {
        this.imgPaths = imgPaths;
        this.airkoreaDustImageMgr;
    }

    _getMsrStn(callback) {
        MsrStn.find().lean().exec(function (err, stnList) {
            if (err) {
                return callback(err);
            }
            if (stnList.length === 0) {
                return callback(new Error("airkroea msr stn list length is 0"));
            }
            callback(null, stnList);
        });
    }

    _updateDb(obj, callback) {
        ArpltnHourlyForecast.update({stationName: obj.stationName, date: obj.date, code: obj.code},
            obj,
            {upsert:true},
            callback);
    }

    _makeArpltnHourForecast(stationName, code, pubDate, hourData) {
        return {
            stationName: stationName,
            date: new Date(hourData.date),
            code: code,
            val: hourData.val,
            dataTime: hourData.date,
            pubDate: pubDate
        };
    }

    _updateForecastList(forecastsObj, callback) {
        async.map(forecastsObj.hourly,
            (hourData, callback) => {
                var arpltnHourForecast;
                try {
                    if (hourData.val == undefined) {
                       log.warn("invalid val "+ forecastsObj.stationName+ " "+forecastsObj.code+" "+hourData.date);
                    }
                    else {
                        arpltnHourForecast = this._makeArpltnHourForecast(
                            forecastsObj.stationName,
                            forecastsObj.code,
                            forecastsObj.pubDate,
                            hourData);
                    }
                }
                catch(err) {
                    log.error(err);
                }
                if (arpltnHourForecast) {
                    this._updateDb(arpltnHourForecast, function (err) {
                        if (err)  {
                            log.error(err);
                        }
                        callback();
                    });
                }
                else {
                    callback();
                }
            }, callback);
    }

    /**
     * 특정 Stn의 예보를 가지고 와서 디비에 저장한다.
     * @param stn
     * @param code
     * @param callback
     * @private
     */
    _updateDustInfo(stn, code, callback) {
        async.waterfall([
                (callback) => {
                    this.airkoreaDustImageMgr
                        .getDustInfo(stn.geo[1],
                            stn.geo[0],
                            code.toUpperCase(),
                            'airkorea',
                            function (err, hourlyForecastObj) {
                                if(err){
                                    return callback(err);
                                }
                                hourlyForecastObj.stationName = stn.stationName;
                                hourlyForecastObj.code = code;
                                callback(err, hourlyForecastObj);
                            });
                },
                (hourlyForecasts, callback) => {
                    if (hourlyForecasts == undefined) {
                        log.error('pass update forecast list hourlyForecasts is undefined');
                        return callback();
                    }
                    log.debug(JSON.stringify(hourlyForecasts));
                    this._updateForecastList(hourlyForecasts, callback);
                }
            ],
            (err)=>{
                if(err) {
                    log.warn('Invalid geocode for dust forecast:', stn.geo[1], stn.geo[0]);
                }
                callback();
            });
    }

    /**
     * code(pm10, pm25, o3) 별로 모든 stn의 예보를 업데이트 요청한다.
     * @param stnList
     * @param code
     * @param callback
     * @private
     */
    _updateHourlyForecastEach(stnList, code, callback) {
        log.info('update hourly forecast code:'+code);

        async.mapSeries(stnList,
            (stn, callback) => {
                this._updateDustInfo(stn, code, callback);
            },
            callback);
    }

    _updateHourlyForecast(stnList, callback) {
        log.info('update hourly forecast stnList:'+stnList.length);

        async.mapSeries(['pm10', 'pm25'],
            (code, callback) => {
                this._updateHourlyForecastEach(stnList, code, callback);
            },
            callback);
    }

    _removeOldData() {
        var removeDate = new Date();
        removeDate.setDate(removeDate.getDate()-1);
        ArpltnHourlyForecast.remove({"date": {$lt:removeDate}}, function (err) {
            log.info('removed airpltn hourly forecast from date : ' + removeDate);
            if(err) {
                log.error(err);
            }
        });
    }

    _checkHourlyForecast(dataTime, callback) {
        let query = {pubDate: dataTime};
        ArpltnHourlyForecast.find(query).lean().exec((err, list)=>{
            if (err) {
                return callback(err);
            }
            let pm10List = list.filter((obj)=> {
                return obj.code === 'pm10';
            });
            let pm25List = list.filter((obj)=> {
                return obj.code === 'pm25';
            });
            if (pm10List.length > 0 && pm25List.length > 0) {
                err = 'skip';
            }
            return callback(err, list);
        });
    }

    _getImgPaths(dataTime, callback) {
        Frcst.find({dataTime: dataTime}).lean().exec(function (err, frcstList) {
            if (err)  {
                return callback(err);
            }
            if (frcstList.length == 0) {
                err = new Error("Fail to find dataTime:"+dataTime);
                return callback(err);
            }

            let imagePaths = {pubDate: kmaTimeLib.convertYYYY_MM_DD_HHStr2YYYY_MM_DD_HHoZZ(frcstList[0].dataTime)};
            let findCount = 0;

            for (var i=0; i<frcstList.length && findCount<2; i++) {
                var obj = frcstList[i];
                if (!imagePaths.hasOwnProperty('pm10') && obj.informCode === 'PM10')  {
                    imagePaths.pm10 = obj.imageUrl[6];
                    findCount++;
                }
                else if (!imagePaths.hasOwnProperty('pm25') && obj.informCode === 'PM25') {
                    imagePaths.pm25 = obj.imageUrl[7];
                    findCount++;
                }
            }
            return callback(err, imagePaths);
        });
    }

    do(dataTime) {

        async.waterfall(
            [
                (callback) => {
                    let hourlyForecastDataTime = kmaTimeLib.convertYYYY_MM_DD_HHStr2YYYY_MM_DD_HHoZZ(dataTime);
                    this._checkHourlyForecast(hourlyForecastDataTime, (err)=> {
                        callback(err);
                    });
                },
                (callback) => {
                    this._getImgPaths(dataTime, callback);
                },
                (imgPaths, callback) => {
                    this.airkoreaDustImageMgr = new ControllerAirkoreaDustImage();
                    this.airkoreaDustImageMgr.getDustImage(imgPaths, callback);
                },
                (result, callback) => {
                    this._getMsrStn(callback);
                },
                (stnList, callback) => {
                    this._updateHourlyForecast(stnList, callback);
                }
            ],
            (err) => {
                if (err && err !== 'skip') {
                    log.error(err);
                }
                log.info("Finish update hourly forecast");
                delete this.airkoreaDustImageMgr;
                this._removeOldData();
            });
    }

    getForecast(stationName, callback) {
       ArpltnHourlyForecast.find({stationName: stationName}).lean().sort({date:1}).exec(function (err, forecastList) {
           callback(err, forecastList);
       });
    }
}

module.exports = AirkoreaHourlyForecastController;
