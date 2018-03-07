/**
 * Created by Peter on 2017. 11. 5..
 */
"use strict";
//var fs = require('fs');
var url = require('url');
var async = require('async');
var kmaTimeLib = require('../lib/kmaTimeLib');
var libAirkoreaImageParser = require('../lib/airkorea.finedust.image.parser.js');
var modelMinuDustFrcst = require('../models/modelMinuDustFrcst');
var AqiConverter = require('../lib/aqi.converter');

function AirkoreaDustImageController(){
    this.colorTable_pm10 = [
        {"r":104,"g":0,"b":0,"val":600},    {"r":142,"g":0,"b":0,"val":320},
        {"r":153,"g":0,"b":0,"val":280},    {"r":179,"g":0,"b":0,"val":260},
        {"r":205,"g":0,"b":0,"val":240},    {"r":242,"g":0,"b":0,"val":220},
        {"r":242,"g":0,"b":0,"val":200},    {"r":255,"g":59,"b":59,"val":190},
        {"r":255,"g":90,"b":90,"val":180},  {"r":255,"g":120,"b":120,"val":170},
        {"r":255,"g":150,"b":150,"val":160},{"r":100,"g":100,"b":0,"val":150},
        {"r":115,"g":115,"b":0,"val":143},  {"r":131,"g":131,"b":0,"val":136},
        {"r":146,"g":146,"b":0,"val":129},  {"r":162,"g":162,"b":0,"val":122},
        {"r":177,"g":177,"b":0,"val":115},  {"r":193,"g":193,"b":0,"val":108},
        {"r":208,"g":208,"b":0,"val":101},  {"r":224,"g":224,"b":0,"val":94},
        {"r":240,"g":240,"b":0,"val":87},   {"r":0,"g":119,"b":0,"val":80},
        {"r":0,"g":138,"b":0,"val":75},     {"r":0,"g":158,"b":0,"val":70},
        {"r":0,"g":177,"b":0,"val":65},     {"r":0,"g":196,"b":0,"val":60},
        {"r":0,"g":216,"b":0,"val":55},     {"r":0,"g":235,"b":0,"val":50},
        {"r":0,"g":255,"b":0,"val":45},     {"r":100,"g":255,"b":100,"val":40},
        {"r":150,"g":255,"b":150,"val":35}, {"r":53,"g":151,"b":250,"val":30},
        {"r":76,"g":163,"b":245,"val":24},  {"r":100,"g":175,"b":240,"val":18},
        {"r":100,"g":175,"b":240,"val":12}, {"r":152,"g":201,"b":228,"val":6},
        {"r":135,"g":192,"b":232,"val":6},  {"r":170,"g":209,"b":224,"val":0},
        {"r":170,"g":210,"b":225,"val":0}
    ];

    this.colorTable_pm25 = [
        {"r":104,"g":0,"b":0,"val":500},
        {"r":142,"g":0,"b":0,"val":200},
        {"r":153,"g":0,"b":0,"val":190},
        {"r":179,"g":0,"b":0,"val":180},
        {"r":205,"g":0,"b":0,"val":170},
        {"r":230,"g":0,"b":0,"val":160},
        {"r":255,"g":0,"b":0,"val":150},
        {"r":255,"g":59,"b":59,"val":140},
        {"r":255,"g":90,"b":90,"val":130},
        {"r":255,"g":120,"b":120,"val":120},
        {"r":255,"g":150,"b":150,"val":110},
        {"r":107,"g":107,"b":0,"val":100},{"r":115,"g":115,"b":0,"val":100},
        {"r":131,"g":131,"b":0,"val":95},
        {"r":140,"g":140,"b":0,"val":95},
        {"r":139,"g":139,"b":0,"val":90},
        {"r":146,"g":146,"b":0,"val":85},
        {"r":170,"g":170,"b":0,"val":80},{"r":171,"g":171,"b":1,"val":80},{"r":162,"g":162,"b":0,"val":80},
        {"r":193,"g":193,"b":0,"val":75},
        {"r":201,"g":201,"b":0,"val":70},
        {"r":207,"g":207,"b":0,"val":65}, {"r":208,"g":208,"b":0,"val":65},{"r":209,"g":209,"b":48,"val":65},
        {"r":211,"g":211,"b":0,"val":60},{"r":211,"g":211,"b":23,"val":60}, {"r":224,"g":224,"b":0,"val":60}, {"r":220,"g":220,"b":1,"val":60},
        {"r":232,"g":232,"b":0,"val":55},{"r":232,"g":232,"b":25,"val":55},{"r":240,"g":240,"b":0,"val":55},
        {"r":0,"g":119,"b":0,"val":50},
        {"r":0,"g":138,"b":0,"val":46},
        {"r":0,"g":158,"b":0,"val":43},
        {"r":0,"g":177,"b":0,"val":39},{"r":0,"g":178,"b":0,"val":39},
        {"r":0,"g":197,"b":0,"val":36},{"r":0,"g":196,"b":0,"val":36},{"r":1,"g":204,"b":1,"val":36},
        {"r":0,"g":216,"b":0,"val":32},{"r":2,"g":202,"b":2,"val":32},
        {"r":0,"g":235,"b":0,"val":29},
        {"r":0,"g":255,"b":0,"val":26},
        {"r":100,"g":255,"b":100,"val":22},
        {"r":150,"g":255,"b":150,"val":19},
        {"r":53,"g":151,"b":250,"val":15},
        {"r":76,"g":163,"b":245,"val":12},
        {"r":100,"g":175,"b":240,"val":9},
        {"r":100,"g":175,"b":240,"val":6},
        {"r":152,"g":201,"b":228,"val":3}, {"r":135,"g":192,"b":232,"val":3},
        {"r":170,"g":209,"b":224,"val":0}, {"r":170,"g":210,"b":225,"val":0}
    ];
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
    var self = this;

    if(self.imagePixels[type] === undefined){
        return callback(new Error('1. There is no image information : ', type));
    }

    if(!self._isValidGeocode(lat, lon)){
        return callback(new Error('2. Invalid geocode :', lat, lon));
    }

    var pixels = self.imagePixels[type].data;
    var x = parseInt((lon - self.coordinate.top_left.lon) / pixels.map_pixel_distance_width) + pixels.map_area.left;
    var y = parseInt((self.coordinate.top_left.lat - lat) / pixels.map_pixel_distance_height) + pixels.map_area.top;

    log.debug('Airkorea Image > lat: ', lat, 'lon: ', lon);
    log.debug('Airkorea Image > ', pixels.map_pixel_distance_width,  pixels.map_pixel_distance_height);
    log.debug('Airkorea Image > x: ', x, 'y: ',y);

    var result = [];
    var colorTable = self.colorTable_pm10;
    if(type === 'PM25'){
        colorTable = self.colorTable_pm25;
    }
    for(var i=0 ; i < pixels.image_count ; i++){
        var err_rgb = [];
        for(var j = 0 ; j<64 ; j++){
            var w = 0;
            var h = 0;

            // TODO :  현재는 x, y좌표의 pixel이 invalid일 경우 해당 pixel을 중심으로 8*8 크기의 pixel들을 순차검색하게 되어 있는데 추후 달팽이배열처리 알고리즘으로 수정해야한다
            if(j !== 0){
                // 정확한 x,y 좌표가 invalid한 색일 경우 좌표를 보정한다
                w = parseInt(j/8) - 4;
                h = parseInt(j%8) - 4;
            }

            var rgb = {
                r: pixels.pixels.get(i, x+w, y+h, 0),
                g: pixels.pixels.get(i, x+w, y+h, 1),
                b: pixels.pixels.get(i, x+w, y+h, 2)
            };
            var k=0;
            for(k=0 ; k<colorTable.length ; k++){
                if(rgb.r === colorTable[k].r &&
                    rgb.g === colorTable[k].g &&
                    rgb.b === colorTable[k].b){
                    break;
                }
            }
            if(k<colorTable.length){
                //log.info('Airkorea Image > Found color value : ', i, j, colorTable[k].val, k);
                result.push(colorTable[k].val);
                break;
            }else {
                err_rgb.push(rgb);
            }
        }
        if(j === 64){
            // 보정된 좌표 64개 모두 invalid한 색이 나올 경우 error 처리 한다
            log.warn('Airkorea Image > Fail to find color value : ', i, type);
            log.warn('Airkorea Image > Need to Add it to table : ', JSON.stringify(err_rgb));
            result.push(-1);
        }
    }

    var pubDateStr = kmaTimeLib.convertYYYY_MM_DD_HHStr2YYYY_MM_DD_HHoZZ(self.imagePixels[type].pubDate);
    var pubDate = new Date(pubDateStr);
    var forecastDate = kmaTimeLib.toTimeZone(9);
    //17시, 23시 데이터는 다음날 부터 시작하고, 그 다음날 5시까지 사용되어야 하므로, 현재 시간도 함께 비교
    if (pubDate.getHours() >= 17 && pubDate.getDate() === forecastDate.getDate()) {
        forecastDate.setDate(forecastDate.getDate()+1);
    }

    var forecast = [];
    for(i=0 ; i<48 ; i++){
        var item = {};
        if(i === 24){
            forecastDate.setDate(forecastDate.getDate()+1);
        }
        forecastDate.setHours(i%24);
        forecastDate.setMinutes(0);
        item.date = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(forecastDate);
        if (result[i] !== -1) {
            item.val = result[i];
            item.grade = AqiConverter.value2grade(aqiUnit, type.toLowerCase(), result[i]);
        }

        forecast.push(item);
    }

    log.debug('Airkorea Image > result = ', JSON.stringify(forecast));

    if(callback){
        callback(null, {pubDate: pubDateStr, hourly: forecast});
    }

    return result;
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