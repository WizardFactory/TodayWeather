/**
 * Created by aleckim on 2018. 1. 25..
 * kecoRequester로부터 새로운 imgPath를 받아, airkorea.dust.image.controller로
 * 제공해서 hourly forecast를 받아와서 저장
 * route(controllerTown)에서 데이터를 가져가는 interface제공
 */

'use strict';

const async = require('async');
const ControllerAirkoreaDustImage = require('./airkorea.dust.image.controller');
const Frcst = require('../models/modelMinuDustFrcst');
const ArpltnHourlyForecast = require('../models/arpltn.hourly.forecast');
const kmaTimeLib = require('../lib/kmaTimeLib');

const ImgHourlyForecastController = require('./img.hourly.forecast.controller');

class AirkoreaHourlyForecastController extends ImgHourlyForecastController {
    constructor(imgPaths) {
        // noinspection JSAnnotator
        super(imgPaths, ArpltnHourlyForecast);
        this.airkoreaDustImageMgr;
        this.pollutants = ['pm10', 'pm25'];
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
                    this._updateHourlyForecast(this.pollutants, stnList, callback);
                }
            ],
            (err) => {
                if (err && err !== 'skip') {
                    log.error(err);
                }
                log.info("Finish update airkorea hourly forecast");
                delete this.airkoreaDustImageMgr;
                this._removeOldData();
            });
    }
}

module.exports = AirkoreaHourlyForecastController;
