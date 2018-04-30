/**
 * Created by aleckim on 2018. 3. 17.
 */

"use strict";

const async = require('async');
const MsrStn = require('../models/modelMsrStnInfo');

class ImgHourlyForecastController {
    constructor(imgPaths, collection) {
        this.imgPaths = imgPaths;
        this.collection = collection
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
        this.collection.update({stationName: obj.stationName, date: obj.date, code: obj.code},
            obj,
            {upsert:true},
            callback);
    }

    _makeHourForecast(stationName, code, pubDate, hourData) {
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
        async.mapSeries(forecastsObj.hourly,
            (hourData, callback) => {
                var hourForecast;
                try {
                    if (hourData.val == undefined) {
                        log.warn("invalid val "+ forecastsObj.stationName+ " "+forecastsObj.code+" "+hourData.date);
                    }
                    else {
                        hourForecast = this._makeHourForecast(
                            forecastsObj.stationName,
                            forecastsObj.code,
                            forecastsObj.pubDate,
                            hourData);
                    }
                }
                catch(err) {
                    log.error(err);
                }
                if (hourForecast) {
                    this._updateDb(hourForecast, function (err) {
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

    _updateDustInfo(stn, code, callback) {
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
        this.collection.remove({"date": {$lt:removeDate}}, function (err) {
            log.info('removed hourly forecast from date : ' + removeDate);
            if(err) {
                log.error(err);
            }
        });
    }

    _checkHourlyForecast(dataTime, callback) {
        let query = {pubDate: dataTime};
        this.collection.find(query).lean().exec((err, list)=>{
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

    do(dataTime) {
    }

    getForecast(stationName, callback) {
        this.collection.find({stationName: stationName}).lean().sort({date:1}).exec(function (err, forecastList) {
            callback(err, forecastList);
        });
    }
}

module.exports = ImgHourlyForecastController;
