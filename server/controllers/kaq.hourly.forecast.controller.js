/**
 * Created by aleckim on 2018. 3. 17.
 */

"use strict";

const async = require('async');
const reqeust = require('request');

const kmaTimeLib = require('../lib/kmaTimeLib');
const config = require('../config/config');

const DustImageController = require('./kaq.dust.image.controller');
const ModelHourlyForecast = require('../models/kaq.hourly.forecast.model');
const ModelMapCase = require('../models/kaq.map.case.model');

const S3 = require('../s3/controller.s3');

const ImgHourlyForecastController = require('./img.hourly.forecast.controller');

class KaqHourlyForecastController extends ImgHourlyForecastController {
    constructor(imgPaths) {
        super(imgPaths, ModelHourlyForecast);
        this.dustImageMgr;
        this.region = config.image.kaq_korea_image.region;
        this.bucketName = config.image.kaq_korea_image.bucketName;
        this.s3 = new S3(this.region, this.bucketName);
        this.s3Url = 'https://s3.'+this.region+'.amazonaws.com/'+this.bucketName+'/';
    }

    _updateDustInfo(stn, code, callback) {
        async.waterfall([
                (callback) => {
                    this.dustImageMgr
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

    _getPubdate(folderName) {
       let date = new Date(folderName);
       date.setHours(date.getHours()+20);
       return kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(date);
    }

    _getModelImgList(dataTime, callback) {
        this.s3.ls()
            .then(results => {
                log.debug(JSON.stringify({'s3list':results}));

                let modelImgList = [];
                let folderList = results.CommonPrefixes.map(obj => {
                    return obj.Prefix;
                });

                folderList = folderList.filter(name => {
                    return name.indexOf('dateBackup') < 0;
                });

                let folderName = folderList[folderList.length-1];
                ['modelimg', 'modelimg_CASE2', 'modelimg_CASE4', 'modelimg_CASE5'].forEach(mapCase => {
                    let imgPaths = {};
                    ['pm10', 'pm25'].forEach(value => {
                        let name = value.toUpperCase();
                        name = name === 'PM25'?'PM2_5':name;
                        imgPaths[value] = this.s3Url+folderName+mapCase+'.'+name+'.09KM.animation.gif';
                    });
                    imgPaths.pubDate = this._getPubdate(folderName.slice(0, folderName.length-6));
                    modelImgList.push({mapCase: mapCase, imgPaths: imgPaths});
                });

                callback(null, modelImgList);
            })
            .catch(err => {
                log.error(err);
                callback(err);
            });
    }

    _requestMapCase() {
        let url = 'http://www.kaq.or.kr/map_case.asp';

        return new Promise((resolve, reject) => {
            async.retry(3,
                (callback) => {
                    reqeust(url, {timeout: 3*1000}, (err, response, body)=> {
                        if (err) {
                            return callback(err);
                        }
                        callback(null, body);
                    });
                },
                (err, result) => {
                    if (err) {
                        return reject(err);
                    }
                    log.info({kaq_map_case: result});
                    return resolve(result);
                });
        });
    }

    _findLatestMapCase() {
        return new Promise((resolve, reject)=> {
            ModelMapCase.find().sort({date:-1}).limit(1).exec((err, list)=> {
                if (err) {
                    return reject(err);
                }
                if (list.length < 1) {
                    return reject(new Error("Fail to get map case"));
                }
                resolve(list[0].mapCase);
            });
        });
    }

    _removeOldMapCase() {
        var removeDate = new Date();
        removeDate.setDate(removeDate.getDate()-1);
        ModelMapCase.remove({"date": {$lt:removeDate}}, function (err) {
            log.info('removed kaq map case from date : ' + removeDate);
            if(err) {
                log.error(err);
            }
        });
    }

    _updateMapCase(dataTime, mapCase) {
        return new Promise((resolve, reject)=> {
            ModelMapCase.update({date: dataTime},
                {date: dataTime, mapCase: mapCase},
                {upsert:true},
                (err, result)=> {
                    if (err) {
                        return reject(err);
                    }
                    resolve(result);
                });

        });
    }

    _getMapCase(dataTime, callback) {
        this._requestMapCase()
            .then(result => {
                return this._updateMapCase(dataTime, result);
            })
            .then(()=> {
                callback();
            })
            .catch(err => {
                log.error(err);
                callback();
            });
    }

    /**
     * 특정 한 모델이 실패해도, 다음 모델은 계속 진행
     * @param modelImg
     * @param callback
     * @private
     */
    _updateModelImg(modelImg, callback) {
        async.waterfall([
                (callback) => {
                    log.info('Start '+JSON.stringify(modelImg));
                    this.dustImageMgr = new DustImageController();
                    this.dustImageMgr.getDustImage(modelImg.imgPaths, callback);
                },
                (result, callback) => {
                    this._getMsrStn(callback);
                },
                (stnList, callback) => {
                    this._updateHourlyForecast(stnList, callback);
                }
            ],
            (err, result)=> {
                log.info('End '+JSON.stringify(modelImg));
                if (err) {
                    log.error(err);
                }
                callback(null, result);
            });
    }

    /**
     * modelName 변수가 있으므로 병렬처리하면 안됨
     * @param modelImgList
     * @param callback
     * @private
     */
    _updateModelImgList(modelImgList, callback) {
        async.mapSeries(modelImgList,
            (modelImg, callback)=> {
                this.mapCase = modelImg.mapCase;
                this._updateModelImg(modelImg, callback);
            },
            (err, result)=> {
                callback(err, result);
            });
    }

    /**
     * modelName은 _updateModelImgList()에서 설정됨
     * @param obj
     * @param callback
     * @private
     */
    _updateDb(obj, callback) {
        obj.mapCase = this.mapCase;
        this.collection.update({stationName: obj.stationName, date: obj.date, code: obj.code, mapCase: obj.mapCase},
            obj,
            {upsert:true},
            callback);
    }

    /**
     *
     * @param {Date} dataTime
     * @param callback
     */
    do(dataTime, callback) {
        async.waterfall(
            [
                callback => {
                    this._getMapCase(dataTime, callback);
                },
                callback => {
                    this._getModelImgList(dataTime, callback);
                },
                (modelImgList, callback) => {
                    this._updateModelImgList(modelImgList, callback);
                }
            ],
            err => {
                log.info("Finish update kaq hourly forecast");
                delete this.dustImageMgr;
                this._removeOldData();
                this._removeOldMapCase();
                if (callback) {
                    return callback(err);
                }
                else if (err && err !== 'skip') {
                    log.error(err);
                }
            }
        );
    }

    /**
     * map case list 중에 데이터가 있는 경우 전달
     * @param stationName
     * @param mapCaseList
     * @returns {Promise<any>}
     * @private
     */
    _getForecastByModelList(stationName, mapCaseList) {
        let forecastList;
        return new Promise((resolve, reject) => {
            async.someSeries(mapCaseList,
                (mapCase, callback) => {
                    let query = {stationName: stationName, mapCase: mapCase, date: {$gt: new Date()}};
                    // let query = {stationName: stationName, mapCase: mapCase};
                    this.collection.find(query)
                        .lean()
                        .sort({date:1})
                        .exec(function (err, results) {
                            if (err) {
                                log.warn(err);
                                return callback(null, !err);
                            }
                            if (results.length === 0) {
                                err = new Error(`Fail to find forecast data stationName:${stationName}, mapCase:${mapCase}`);
                                log.warn(err);
                            }
                            else {
                                forecastList = results;
                            }
                            callback(null, !err);
                        });
                },
                (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(forecastList);
                });
        });
    }

    /**
     * kaqMapCaseModel에 저장되어 있는 model과 modelimg_CASE4 중에 데이터가 있는 경우 전달한다.
     * @param stationName
     * @param callback
     */
    getForecast(stationName, callback) {
        this._findLatestMapCase()
            .then(mapCase => {
                let mapCaseName = 'modelimg'+mapCase;
                return this._getForecastByModelList(stationName, [mapCaseName, 'modelimg_CASE4']);
            })
            .then(forecastList => {
                callback(null, forecastList);
            })
            .catch(err=>{
                callback(err);
            });
    }
}

module.exports = KaqHourlyForecastController;
