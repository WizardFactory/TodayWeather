/**
 * Created by aleckim on 2018. 3. 17.
 */

"use strict";

const async = require('async');

const kmaTimeLib = require('../lib/kmaTimeLib');
const config = require('../config/config');

const DustImageController = require('./kaq.dust.image.controller');
const ModelHourlyForecast = require('../models/kaq.hourly.forecast.model');
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

    _getImgPaths(dataTime, callback) {
        this.s3.ls()
            .then(results => {
                log.debug(JSON.stringify({'s3list':results}));

                let imgPaths = {};
                let folderList = results.CommonPrefixes.map(obj => {
                    return obj.Prefix;
                });
                let folderName = folderList[folderList.length-1];
                ['pm10', 'pm25'].forEach(value => {
                    let name = value.toUpperCase();
                    name = name === 'PM25'?'PM2_5':name;
                    imgPaths[value] = this.s3Url+folderName+name+'.09km.animation.gif';
                });

                imgPaths.pubDate = this._getPubdate(folderName.slice(0, folderName.length-6));

                callback(null, imgPaths);
            })
            .catch(err => {
                log.error(err);
                callback(err);
            });
    }

    do(dataTime, callback) {
        async.waterfall(
            [
                callback => {
                    this._getImgPaths(dataTime, callback);
                },
                (imgPaths, callback) => {
                    log.info(JSON.stringify({imagePaths: imgPaths}));
                    this.dustImageMgr = new DustImageController();
                    this.dustImageMgr.getDustImage(imgPaths, callback);
                },
                (result, callback) => {
                    this._getMsrStn(callback);
                },
                (stnList, callback) => {
                    this._updateHourlyForecast(stnList, callback);
                }
            ],
            err => {
                log.info("Finish update kaq hourly forecast");
                delete this.dustImageMgr;
                this._removeOldData();
                if (callback) {
                    return callback(err);
                }
                else if (err && err !== 'skip') {
                    log.error(err);
                }
            }
        );
    }
}

module.exports = KaqHourlyForecastController;
