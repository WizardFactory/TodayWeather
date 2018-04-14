/**
 * Created by Peter on 2018. 4. 3..
 */
/**
 * Created by Peter on 2018. 3. 12..
 */

"use strict";
//var fs = require('fs');
var url = require('url');
var async = require('async');
var kmaTimeLib = require('../lib/kmaTimeLib');
var libKaqImageParser = require('../lib/kaq.finedust.image.parser.js');
var AqiConverter = require('../lib/aqi.converter');
const ModelingImageInfo = require('../config/config.js').image.kaq_korea_modeling_image;

class KaqDustImageController{
    constructor(){
        this.colorTable = {
            PM10: [],
            PM25: []
        };
        this.value_pos = {
            PM10 : [45, 53, 62, 70, 79, 88, 97, 106, 115, 123, 132, 140, 149, 158, 157, 175, 184, 192, 200, 209, 218, 226, 234, 244, 254, 261, 270, 279, 288, 297, 305, 313],
            PM25 : [45, 60, 72, 85, 98, 110, 125, 135, 149, 160, 172, 184, 198, 210, 225, 235, 249, 262, 274, 288, 298, 310]
        };
        this.value = {
            PM10 : [140, 120, 116, 112, 108, 104, 100, 96, 92, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0],
            PM25 : [100, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0]
        };
        this.parser = new libKaqImageParser();
        this.imagePixels = {};
        this.coordinate = this.parser.getDefaultCoordi('modeling');
        return this;
    }

    /**
     *
     * @param path
     * @param format
     * @param callback
     * @returns {*}
     */
    parseMapImage(path, format, callback){
        if(this.parser === undefined){
            return callback(new Error('Need to init KaqModelingImageController'));
        }

        this.parser.getPixelMap(path, 'modeling', format, this.coordinate, (err, pixelMap)=>{
            if(err){
                return callback(err);
            }
            log.info('KAQ Modeling Image > get Image Pixel map');

            // Re-calculate distance, size because it'll be used for rotated image.
            pixelMap.map_width = ModelingImageInfo.size.map_width;
            pixelMap.map_height = ModelingImageInfo.size.map_height;
            pixelMap.map_pixel_distance_width = parseFloat((this.coordinate.top_right.lon - this.coordinate.top_left.lon) / pixelMap.map_width);
            pixelMap.map_pixel_distance_height = parseFloat((this.coordinate.top_left.lat - this.coordinate.bottom_left.lat) / pixelMap.map_height);
            log.info('--> Distance W:', pixelMap.map_pixel_distance_width, ' H:', pixelMap.map_pixel_distance_height);
            return callback(null, pixelMap);
        });
    }

    /**
     *
     * @param lat
     * @param lon
     * @returns {boolean}
     * @private
     */
    _isValidGeocode(lat, lon){
        if(lat > this.coordinate.top_left.lat) return false;
        if(lat < this.coordinate.bottom_left.lat) return false;
        if(lon < this.coordinate.top_left.lon) return false;
        if(lon > this.coordinate.top_right.lon) return false;
        return true;
    }

    _isValidPos(x,y){
        if(x < ModelingImageInfo.pixel_pos.left) return false;
        if(x > ModelingImageInfo.pixel_pos.right) return false;
        if(y < ModelingImageInfo.pixel_pos.top) return false;
        if(y > ModelingImageInfo.pixel_pos.bottom) return false;
        return true;
    }

    /**
     *
     * @param lat
     * @param lon
     * @param type
     * @param aqiUnit
     * @param callback
     * @returns {*}
     */
    getDustInfo(lat, lon, type, aqiUnit, callback){
        if(this.imagePixels[type] === undefined){
            return callback(new Error('KAQ Modeling Image > 1. There is no image information : ', type));
        }

        if(!this._isValidGeocode(lat, lon)){
            return callback(new Error('KAQ Modeling Image > 2. Invalid geocode :', lat, lon));
        }

        if(this.colorTable[type] === undefined){
            return callback(new Error('KAQ Modeling Image > 3. Invalid color grade table :', lat, lon));
        }

        let pixels = this.imagePixels[type].data;
        let rotated_x = parseInt((lon - this.coordinate.top_left.lon) / pixels.map_pixel_distance_width);
        let rotated_y = parseInt((this.coordinate.top_left.lat - lat) / pixels.map_pixel_distance_height);

        //log.info('KAQ Modeling Image > Before x: ', rotated_x, 'y: ',rotated_y);
        //log.info('Gap W:', parseInt(ModelingImageInfo.size.gap_width));
        //log.info('step X: ', parseInt((rotated_y / ModelingImageInfo.size.gradient_step_width)));
        //log.info('Gap H:', parseInt(ModelingImageInfo.size.gap_height));
        //log.info('step Y: ', parseInt((rotated_x / ModelingImageInfo.size.gradient_step_height)));

        let x = rotated_x - (parseInt(ModelingImageInfo.size.gap_width) - parseInt((rotated_y / ModelingImageInfo.size.gradient_step_width)));
        let y = rotated_y - (parseInt((rotated_x / ModelingImageInfo.size.gradient_step_height)));
        x = x + parseInt(ModelingImageInfo.pixel_pos.left);
        y = y + parseInt(ModelingImageInfo.pixel_pos.top);

        log.debug('KAQ Modeling Image > lat: ', lat, 'lon: ', lon);
        log.debug('KAQ Modeling Image > ', pixels.map_pixel_distance_width,  pixels.map_pixel_distance_height);
        log.debug('KAQ Modeling Image > x: ', x, 'y: ',y);

        if(!this._isValidPos(x, y)){
            return callback(new Error('KAQ Modeling Image > 4. Invalid X, Y : ', x, y));
        }

        var result = [];
        var colorTable = this.colorTable[type];
        for(var i=0 ; i < pixels.image_count ; i++){
            let err_rgb = [];
            for(var j = 0 ; j<100 ; j++){
                let w = 0;
                let h = 0;

                // TODO :  현재는 x, y좌표의 pixel이 invalid일 경우 해당 pixel을 중심으로 8*8 크기의 pixel들을 순차검색하게 되어 있는데 추후 달팽이배열처리 알고리즘으로 수정해야한다
                if(j !== 0){
                    // 정확한 x,y 좌표가 invalid한 색일 경우 좌표를 보정한다
                    w = parseInt(j/100) - 5;
                    h = parseInt(j%100) - 5;
                }

                var rgb = {
                    r: pixels.pixels.get(i, x+w, y+h, 0),
                    g: pixels.pixels.get(i, x+w, y+h, 1),
                    b: pixels.pixels.get(i, x+w, y+h, 2)
                };
                let k=0;
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
            if(j === 100){
                // 보정된 좌표 64개 모두 invalid한 색이 나올 경우 error 처리 한다
                log.warn('KAQ Modeling Image > Fail to find color value : ', i, type);
                log.warn('KAQ Modeling Image > Need to Add it to table : ', JSON.stringify(err_rgb));
                result.push(-1);
            }
        }

        //이미지의 시작 시간은 발표시간 20시간전부터임. TW-184
        //한시간을 더 빼서, 한시간씩 증가시키면서 기록함.
        var forecastDate = new Date(this.imagePixels[type].pubDate);
        forecastDate.setHours(forecastDate.getHours()-21);

        var forecast = [];
        for(i=0 ; i<137 ; i++){
            var item = {};
            forecastDate.setHours(forecastDate.getHours()+1);
            item.date = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(forecastDate);
            if (result[i] !== -1) {
                item.val = result[i];
                item.grade = AqiConverter.value2grade(aqiUnit, type.toLowerCase(), result[i]);
            }

            forecast.push(item);
        }

        log.debug('KAQ Modeling Image > result = ', JSON.stringify(forecast));

        if(callback){
            callback(null, {pubDate: this.imagePixels[type].pubDate, hourly: forecast});
        }

        return result;
    }

    /**
     *
     * @param type
     * @param callback
     * @returns {*}
     */
    getImaggPath(type, callback){

        // TODO : This is only for Testing, Need to implement!!!!!!
        if(type === 'PM10'){
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/PM10_Animation.gif'});
        }else{
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/PM2_5_Animation.gif'});
        }

    }

    /**
     *
     * @param type
     * @param pixels
     * @param callback
     */
    makeColorTable(type, pixels, callback){
        let x = 285;
        let value = this.value[type];

        this.colorTable[type] = [];
        for(var i=0 ; i < pixels.image_count ; i++){
            this.value_pos[type].forEach((y, j)=>{
                var rgb = {
                    r: pixels.pixels.get(i, x, y, 0),
                    g: pixels.pixels.get(i, x, y, 1),
                    b: pixels.pixels.get(i, x, y, 2),
                    val: value[j]
                };

                let found = this.colorTable[type].find((item)=>{
                    if(item.r == rgb.r && item.g == rgb.g && item.b == rgb.b){
                        //log.info(JSON.stringify(item));
                        //log.info(JSON.stringify(rgb));
                        return true;
                    }
                    return false;
                });

                if(found === undefined){
                    this.colorTable[type].push(rgb);
                    //log.info('Added color item ', i, j, x, y, '->', rgb);
                }
            });
            if(i ==0){
                log.info('KAQ Modeling Image> =====> : ', JSON.stringify(this.colorTable[type]));
            }
        }

        log.info('KAQ Modeling Image> Color Table count : ', this.colorTable[type].length);
        //log.info('KAQ Model Image> Color Table : ', JSON.stringify(this.colorTable[type]));


        if(callback){
            callback();
        }
    }

    /**
     *
     * @param callback
     */
    taskModelingImageMgr(callback){
        log.info('KAQ Modeling Image > taskModelingImageMgr -----------');
        async.waterfall(
            [
                (cb)=>{
                    this.getImaggPath('PM10', (err, pm10Path)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Modeling Image > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Modeling Image > Failed to get PM10 image : ', err);
                            return cb(err);
                        }
                        log.info('KAQ Modeling Image > PM10 Path : ', pm10Path.path);
                        this.imagePixels.PM10 = undefined;
                        return cb(undefined, pm10Path);
                    });
                },
                (pm10Path, cb)=>{
                    this.parseMapImage(pm10Path.path, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }

                        log.info('KAQ Modeling Image > Got pixel info for PM10');
                        this.imagePixels.PM10 = {};
                        this.imagePixels.PM10.pubDate = pm10Path.pubDate;
                        this.imagePixels.PM10.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    this.makeColorTable('PM10', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modeling Image > Failed to get Grade Table');
                            return cb(err);
                        }

                        return cb();
                    });
                },
                (cb)=>{
                    this.getImaggPath('PM25', (err, pm25Path)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Modeling Image > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Modeling Image > Failed to get PM25 image');
                            return cb(err);
                        }
                        log.info('KAQ Modeling Image > PM25 Path : ', pm25Path.path);
                        this.imagePixels.PM25 = undefined;
                        return cb(undefined, pm25Path);
                    });
                },
                (pm25Path, cb)=>{
                    this.parseMapImage(pm25Path.path, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }
                        log.info('KAQ Modeling Image > Got pixel info for PM25');
                        this.imagePixels.PM25 = {};
                        this.imagePixels.PM25.pubDate = pm25Path.pubDate;
                        this.imagePixels.PM25.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    this.makeColorTable('PM25', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modeling Image > Failed to get PM25 Grade Table');
                            return cb(err);
                        }

                        return cb();
                    });
                }
            ],
            (err)=>{
                if(err){
                    log.error('KAQ Modeling Image > fail to load image : ', err);
                }

                if(callback){
                    callback(err, this.imagePixels);
                }
            }
        );
    }

    /**
     *
     * @param callback
     */
    startModelingImageMgr(callback){
        this.taskModelingImageMgr(callback);
        this.task = setInterval(()=>{
            this.taskModelingImageMgr(undefined);
        }, 60 * 60 * 1000);
    };

    /**
     *
     */
    stopDustImageMgr(){
        if(this.task){
            clearInterval(this.task);
            this.task = undefined;
        }
    };

    /**
     *
     * @param imgPaths
     * @param callback
     */
    getDustImage(imgPaths, callback) {
        log.info('KAQ Modeling Image > get modeling image -----------');
        async.waterfall(
            [
                (cb)=>{
                    if (imgPaths.pm10 == undefined) {
                        log.error('KAQ Modeling PM10 Image > image path is undefined');
                        return cb(null);
                    }
                    log.info("KAQ Modeling Image > pm10 path: "+imgPaths.pm10);
                    this.parseMapImage(imgPaths.pm10, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }

                        log.info('KAQ Modeling Image > Got pixel info for PM10');
                        this.imagePixels.PM10 = {};
                        this.imagePixels.PM10.pubDate = imgPaths.pubDate;
                        this.imagePixels.PM10.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    if (pixelMap  == undefined) {
                        log.error('KAQ Modeling PM10 Image > pixelMap is undefined');
                        return cb(null);
                    }
                    this.makeColorTable('PM10', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modeling PM10 Image > Failed to get Grade Table');
                            return cb(err);
                        }

                        return cb(null);
                    });
                },
                (cb)=>{
                    if (imgPaths.pm25 == undefined) {
                        log.error('KAQ Modeling PM25 Image > image path is undefined');
                        return cb(null);
                    }
                    log.info("KAQ Modeling Image > pm25 path: "+imgPaths.pm25);
                    this.parseMapImage(imgPaths.pm25, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }
                        log.info('KAQ Modeling Image > Got pixel info for PM25');
                        this.imagePixels.PM25 = {};
                        this.imagePixels.PM25.pubDate = imgPaths.pubDate;
                        this.imagePixels.PM25.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    if (pixelMap  == undefined) {
                        log.error('KAQ Modeling PM25 Image > pixelMap is undefined');
                        return cb(null);
                    }
                    this.makeColorTable('PM25', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modeling Image > Failed to get PM25 Grade Table');
                            return cb(err);
                        }

                        return cb(null);
                    });
                }
            ],
            (err)=>{
                if(err){
                    log.error('KAQ Modeling Image > fail to load image');
                }

                if(callback){
                    callback(err, this.imagePixels);
                }
            }
        );
    };
}

module.exports = KaqDustImageController;