/**
 * Created by Peter on 2017. 11. 5..
 */
"use strict";
//var fs = require('fs');
var url = require('url');
var imageLayout = require('../lib/airkoreaImageLayout');
var async = require('async');
var kmaTimeLib = require('../lib/kmaTimeLib');
var libAirkoreaImageParser = require('../lib/airkorea.finedust.image.parser.js');
var modelMinuDustFrcst = require('../models/modelMinuDustFrcst');
var AqiConverter = require('../lib/aqi.converter');

function AirkoreaDustImageController(){
    this.parser = new libAirkoreaImageParser();
    this.imagePixels = {};
    this.coordinate = this.parser.getDefaultCoordi();
    return this;
}
/*
 AirkoreaDustImageController.prototype.savePixelMap = function(pubDate, fcsDate, path, pixelMap, callback){
    var self = this;
    var newData = {
        pubDate: pubDate,
        fcsDate: fcsDate,
        url: path,
        pixelMap: pixelMap
    };

    if(typeof pubDate === 'string'){
        newData.pubDate = kmaTimelib.getKoreaDateObj(pubDate);
    }

    if(typeof fcsDate === 'string'){
        newData.fcsDate = kmaTimelib.getKoreaDateObj(fcsDate);
    }

    //log.info(JSON.stringify(pixelMap));
    if(self.storeType === 'file'){
        fs.writeFile('./pixelMap', JSON.stringify(newData), function(err){
            if (err) {
                log.error('Airkorea Image> fail to write pixelMap  : ', err);
                return callback(err);
            }
            return callback(null);
        })
    }else {
        modelAirkoreaDustImage.update({fcsDate: fcsDate}, newData, {upsert: true}, function (err) {
            if (err) {
                log.error('Airkorea Image> fail to update db : ', err);
                return callback(err);
            }

            log.info('Airkorea Image> finished to save');

            modelAirkoreaDustImage.remove({"pubDate": {$lt: newData.pubDate}}).exec();

            return callback(null);
        });
    }
};
*/

AirkoreaDustImageController.prototype.parseMapImage = function(path, type, callback){
    var self = this;

    if(self.parser === undefined){
        return callback(new Error('Need to init airkoreaDustImageController'));
    }

    self.parser.getPixelMap(path, type, self.coordinate, function(err, pixelMap){
        if(err){
            return callback(err);
        }
        log.info('Airkorea Image > get Image Pixel map');
        return callback(null, pixelMap);
    });
};

AirkoreaDustImageController.prototype._isValidGeocode = function(lat, lon){
    if(lat > this.coordinate.top_left.lat) return false;
    if(lat < this.coordinate.bottom_left.lat) return false;
    if(lon < this.coordinate.top_left.lon) return false;
    if(lon > this.coordinate.top_right.lon) return false;
    return true;
};


AirkoreaDustImageController.prototype.getDustInfo = function(lat, lon, type, aqiUnit, callback){
    var info = this.imagePixels[type];
    if (!info) return callback(new Error('MISSING_IMAGE'));
    var hourly;
    try {
        hourly = imageLayout.station(info.data,this.coordinate,lat,lon,type);
        hourly.forEach(function(row) {
            if (row.val !== undefined) row.grade = AqiConverter.value2grade(aqiUnit,type.toLowerCase(),row.val);
        });
    } catch (error) {return callback(error);}
    callback(null,{pubDate:info.pubDate,hourly:hourly});
};

AirkoreaDustImageController.prototype.getImaggPath = function(type, callback){
    /*
    if(type === 'PM10'){
        return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './image_pm10.gif'});
    }else{
        return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './image_pm25.gif'});
    }
    */
    // TODO: getMinuDustFrcstDspth module의 version이 1.1로 업데이트되면 아래 내용 확인 및 테스트 필요.
    var dataDate;
    var now = kmaTimeLib.toTimeZone(9);

    var dataHours;
    var currentHours = now.getHours();
    if (currentHours < 5) {
        //yesterday 23
        now.setDate(now.getDate()-1);
        dataHours = '23시 발표';
    }
    else if (currentHours < 11) {
        dataHours = '05시 발표';
    }
    else if (currentHours < 17) {
        dataHours = '11시 발표';
    }
    else if (currentHours < 23) {
        dataHours = '17시 발표';
    }
    else {
        dataHours = '23시 발표';
    }

    dataDate = kmaTimeLib.convertDateToYYYY_MM_DD(now);

    log.info('Airkorea Image > latest image time = '+dataDate+' '+dataHours);

    modelMinuDustFrcst.find({dataTime: dataDate+' '+dataHours, informCode: type}).lean().exec(function (err, frcstList) {
        if (err)  {
            log.error('Airkorea Image > Can not find latest image url : ', err);
            return callback(err);
        }
        if (frcstList.length === 0) {
            return callback(new Error('Airkorea Image > There is no dust forecast'));
        }
        if(frcstList[0].imageUrl.length < 7){
            return callback('_no_image_url_');
        }

        var imageIndex = 6;
        if(type === 'PM25'){
            imageIndex = 7;
        }

        var urlComponent = url.parse(frcstList[0].imageUrl[imageIndex], true);
        if((urlComponent.protocol === null) || urlComponent.query.atch_id === undefined || isNaN(parseInt(urlComponent.query.atch_id))){
            return callback('_no_image_url_');
        }

        return callback(err, {pubDate: dataDate+' '+dataHours, path: frcstList[0].imageUrl[imageIndex]});
    });

};

AirkoreaDustImageController.prototype.taskDustImageMgr = function(callback){
    var self = this;

    log.info('taskDustImageMgr -----------');
    async.waterfall(
        [
            function(cb){
                self.getImaggPath('PM10', function(err, pm10Path){
                    if(err === '_no_image_url_') {
                        log.warn('Airkorea Image > There is no image url');
                        return cb(err);
                    }
                    if(err){
                        log.error('Airkorea Image > Failed to get PM10 image : ', err);
                        return cb(err);
                    }
                    log.info('Airkorea Image > PM10 Path : ', pm10Path.path);
                    self.imagePixels.PM10 = undefined;
                    return cb(undefined, pm10Path);
                });
            },
            function(pm10Path, cb){
                self.parseMapImage(pm10Path.path, 'image/gif', function(err, pixelMap){
                    if(err){
                        return cb(err);
                    }

                    log.info('Airkorea Image > Got pixel info for PM10');
                    self.imagePixels.PM10 = {};
                    self.imagePixels.PM10.pubDate = pm10Path.pubDate;
                    self.imagePixels.PM10.data = pixelMap;
                    return cb();
                });
            },
            function(cb){
                self.getImaggPath('PM25', function(err, pm25Path){
                    if(err === '_no_image_url_') {
                        log.warn('Airkorea Image > There is no image url');
                        return cb(err);
                    }
                    if(err){
                        log.error('Airkorea Image > Failed to get PM25 image');
                        return cb(err);
                    }
                    log.info('Airkorea Image > PM25 Path : ', pm25Path.path);
                    self.imagePixels.PM25 = undefined;
                    return cb(undefined, pm25Path);
                });
            },
            function(pm25Path, cb){
                self.parseMapImage(pm25Path.path, 'image/gif', function(err, pixelMap){
                    if(err){
                        return cb(err);
                    }
                    log.info('Airkorea Image > Got pixel info for PM25');
                    self.imagePixels.PM25 = {};
                    self.imagePixels.PM25.pubDate = pm25Path.pubDate;
                    self.imagePixels.PM25.data = pixelMap;
                    return cb();
                });
            }
        ],
        function(err){
            if(err){
                log.error('Airkorea Image > fail to load image');
            }

            if(callback){
                callback(err, self.imagePixels);
            }
        }
    );
};

AirkoreaDustImageController.prototype.startDustImageMgr = function(callback){
    var self = this;
    
    self.taskDustImageMgr(callback);
    self.task = setInterval(function(){
        self.taskDustImageMgr(undefined);
    }, 60 * 60 * 1000);
};

AirkoreaDustImageController.prototype.stopDustImageMgr = function(){
    var self = this;
    if(self.task){
        clearInterval(self.task);
        self.task = undefined;
    }
};

AirkoreaDustImageController.prototype.getDustImage = function (imgPaths, callback) {
    var self = this;
    try {
        imageLayout.frameStart(imgPaths.pm10,'PM10');
        imageLayout.frameStart(imgPaths.pm25,'PM25');
    } catch (error) {return callback(error);}


    log.info('get dust image -----------');
    async.applyEach(
        [
            function(cb){
                if (imgPaths.pm10 == undefined) {
                    return cb();
                }
                log.info("pm10 path: "+imgPaths.pm10);
                self.parseMapImage(imgPaths.pm10, 'image/gif', function(err, pixelMap){
                    if(err){
                        return cb(err);
                    }

                    log.info('Airkorea Image > Got pixel info for PM10');
                    self.imagePixels.PM10 = {};
                    self.imagePixels.PM10.pubDate = imgPaths.pubDate;
                    self.imagePixels.PM10.data = pixelMap;
                    return cb();
                });
            },
            function(cb){
                if (imgPaths.pm25 == undefined) {
                    return cb();
                }
                log.info("pm25 path: "+imgPaths.pm25);
                self.parseMapImage(imgPaths.pm25, 'image/gif', function(err, pixelMap){
                    if(err){
                        return cb(err);
                    }
                    log.info('Airkorea Image > Got pixel info for PM25');
                    self.imagePixels.PM25 = {};
                    self.imagePixels.PM25.pubDate = imgPaths.pubDate;
                    self.imagePixels.PM25.data = pixelMap;
                    return cb();
                });
            }
        ],
        function(err){
            if(err){
                log.error('Airkorea Image > fail to load image');
            }

            if(callback){
                callback(err, self.imagePixels);
            }
        }
    );
};

module.exports = AirkoreaDustImageController;
