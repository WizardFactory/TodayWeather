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
const colorDiff = require('../lib/diffcolor.ciede2000');

const ModelimgInfo = require('../config/config.js').image.kaq_korea_modelimg_image;

class KaqDustImageController{
    constructor(){
        this.colorTable = {
            NO2: [],
            O3: [],
            PM10: [],
            PM25: [],
            SO2: []
        };
        this.value_pos = {
            NO2 : [45, 53, 62, 70, 79, 88, 97, 106, 115, 123, 132, 140, 149, 158, 167, 175, 184, 192, 200, 209, 218, 226, 234, 244, 254, 261, 270, 279, 288, 297, 305, 313],
            O3 : [45, 53, 62, 70, 79, 88, 97, 106, 115, 123, 132, 140, 149, 158, 167, 175, 184, 192, 200, 209, 218, 226, 234, 244, 254, 261, 270, 279, 288, 297, 305, 313],
            PM10 : [45, 53, 62, 70, 79, 88, 97, 106, 115, 123, 132, 140, 149, 158, 167, 175, 184, 192, 200, 209, 218, 226, 234, 244, 254, 261, 270, 279, 288, 297, 305, 313],
            PM25 : [45, 60, 72, 85, 98, 110, 125, 135, 149, 160, 172, 184, 198, 210, 225, 235, 249, 262, 274, 288, 298, 310],
            SO2: [48, 55, 64, 73, 82, 90, 98, 107, 115, 124, 130, 140, 149, 156, 165, 173, 182, 191, 199, 201, 210, 215, 223, 231, 241, 250, 258, 266, 274, 284, 292, 300, 309]
        };
        this.value = {
            NO2 : [0.12, 0.1, 0.0965, 0.0932, 0.0899, 0.0866, 0.0833, 0.08, 0.0765, 0.0732, 0.0699, 0.0666, 0.0633, 0.06, 0.0565, 0.0532, 0.0499, 0.0466, 0.0433, 0.04, 0.0365, 0.0332, 0.0299, 0.0266, 0.0233, 0.020, 0.0165, 0.0132, 0.0099, 0.0066, 0.0033,0],
            O3 : [0.2, 0.18, 0.174, 0.168, 0.162, 0.156, 0.15, 0.144, 0.138, 0.132, 0.126, 0.12, 0.114, 0.108, 0.102, 0.096, 0.09, 0.084, 0.078, 0.072, 0.066, 0.06, 0.054, 0.048, 0.042, 0.036, 0.03, 0.024, 0.018, 0.012, 0.006, 0],
            PM10 : [140, 120, 116, 112, 108, 104, 100, 96, 92, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0],
            PM25 : [100, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0],
            SO2: [0.0160, 0.0150, 0.0145, 0.0140, 0.0135, 0.0130, 0.0125, 0.0120, 0.0115, 0.0110, 0.0105, 0.0100, 0.0095, 0.0090, 0.0085, 0.0080, 0.0075, 0.0070, 0.0065, 0.0060, 0.0055, 0.0050, 0.0045, 0.0040, 0.0035, 0.0030, 0.0025, 0.0020, 0.0015, 0.0010, 0.0005, 0]
        };
        this.parser = new libKaqImageParser();
        this.imagePixels = {};
        this.coordinate = this.parser.getDefaultCoordi('modelimg');
        return this;
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
        if(x < ModelimgInfo.pixel_pos.left) return false;
        if(x > ModelimgInfo.pixel_pos.right) return false;
        if(y < ModelimgInfo.pixel_pos.top) return false;
        if(y > ModelimgInfo.pixel_pos.bottom) return false;
        return true;
    }


    /**
     *
     * @param type
     * @returns {*}
     * @private
     */
    _getPixelsInfo(type) {
        return this.imagePixels[type];
    }

    /**
     *
     * @param type
     * @returns {*}
     * @private
     */
    _getColorTable(type){
        return this.colorTable[type];
    }

    /**
     *
     * @param lat
     * @param lon
     * @param type
     * @returns {{x: number, y: number}}
     * @private
     */
    _getXY(lat, lon, type){

        let pixels = this.imagePixels[type].data;
        let rotated_x = parseInt((lon - this.coordinate.top_left.lon) / pixels.map_pixel_distance_width);
        let rotated_y = parseInt((this.coordinate.top_left.lat - lat) / pixels.map_pixel_distance_height);

        let x = rotated_x - (parseInt(ModelimgInfo.size.gap_width) - parseInt((rotated_y / ModelimgInfo.size.gradient_step_width)));
        let y = rotated_y - (parseInt((rotated_x / ModelimgInfo.size.gradient_step_height)));
        x = x + parseInt(ModelimgInfo.pixel_pos.left);
        y = y + parseInt(ModelimgInfo.pixel_pos.top);

        log.debug('KAQ Modelimg > lat: ', lat, 'lon: ', lon);
        log.debug('KAQ Modelimg > ', pixels.map_pixel_distance_width,  pixels.map_pixel_distance_height);
        log.info('KAQ Modelimg > x: ', x, 'y: ',y);

        return {x, y};
    }

    /**
     *
     * @param pos
     * @returns {Array}
     * @private
     */
    _getLocationArray(pos) {
        let res = [];

        // To extend position from x, y.
        for(let i = 0 ; i < 7 ; i++){
            for(let j = 0 ; j < 7 ; j++){
                let w = (i===0)? 0:(parseInt((i+1)/2)) * ((i%2)? -1:1); // -1, 1, -2, 2, -3, 3
                let h = (j===0)? 0:(parseInt((j+1)/2)) * ((j%2)? -1:1);
                res.push({x:pos.x + w, y:pos.y+h});
            }
        }

        log.debug(`KAQ ModelImg > Location Array = ${JSON.stringify(res)}`);
        return res;
    }

    /**
     *
     * @param pixelsInfo
     * @param idx
     * @param locations
     * @returns {Array}
     * @private
     */
    _getRgbArray(pixelsInfo, idx, locations){
        let pixels = pixelsInfo.data.pixels;
        let res = [];
        locations.forEach((v)=>{
            let rgb = {
                r: pixels.get(idx, v.x, v.y, 0),
                g: pixels.get(idx, v.x, v.y, 1),
                b: pixels.get(idx, v.x, v.y, 2)
            };
            res.push(rgb);
        });

        return res;
    }

    /**
     *
     * @param rgbArray
     * @param colorTable
     * @returns {*}
     * @private
     */
    _findMatchedVal(rgbArray, colorTable){
        let closest = {val: 9999.9, rgb: {}, tableIdx: 0};
        let countFnCall = 0;

        let compareRgb = (rgbIdx, tableIdx)=>{
            countFnCall++;  // To check how many recursive function called
            if(rgbIdx === rgbArray.length || tableIdx === colorTable.length){
                return -1;
            }

            let res = 0;
            let check = (a, b)=>{return (a.r === b.r && a.g === b.g && a.b === b.b)};
            if(check(rgbArray[rgbIdx], colorTable[tableIdx])){
                // If it has found exactly same value between one of rgb array and one of colortable, it should return that value immediately.
                log.debug(`KAQ ModelImg > Hit same color = ${JSON.stringify(colorTable[tableIdx])}, rgbIdx=${rgbIdx}, tableIdx=${tableIdx}`);
                return colorTable[tableIdx].val;
            }else{
                // It's not same with colorTable's one, so it would try to compare how difference between rgb array's one and color table's one.
                let diff = (new colorDiff()).setRgbColor(rgbArray[rgbIdx],colorTable[tableIdx]).convertRgbToLab().getDiff();;
                if(diff < closest.val){
                    closest.val = diff;
                    closest.rgb = colorTable[tableIdx];
                    closest.tableIdx = tableIdx;
                }

                // try to compare next colorTable's one if there are data remained to colorTable
                if(tableIdx < colorTable.length){
                    res = compareRgb(rgbIdx, tableIdx+1);
                }
                // try to compare next rgb array's one if there are data remained to rgbArray
                if(res === -1 && tableIdx === 0 && rgbIdx < rgbArray.length){
                    res = compareRgb(rgbIdx+1, tableIdx);
                }

                return res;
            }
        }


        let matchedVal = compareRgb(0, 0);  // worst cast it would run rgbArray * colorTable count. approximately 49 * 679 = 33271
        log.debug(`KAQ ModelImg > call of recursive function count = ${countFnCall}`);
        if(matchedVal === -1){
            log.info(`KAQ ModelImg > There is no matched value to colorTable, closest val=${JSON.stringify(closest)}`);
            return (closest.val < 2.6)? closest.rgb.val:-1; // if color diff is lower than 2.6, it can not be recognized by human.
        }

        return matchedVal;
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
        if(this._getPixelsInfo(type) === undefined){
            return callback(new Error('KAQ Modelimg > 1. There is no image information : ' + type));
        }
        if(!this._isValidGeocode(lat, lon)){
            return callback(new Error('KAQ Modelimg > 2. Invalid geocode :' + lat + ',' + lon));
        }
        if(this._getColorTable(type) === undefined){
            return callback(new Error('KAQ Modelimg > 3. Invalid color grade table :' + lat + ',' + lon));
        }
        let XY = this._getXY(lat, lon, type);
        if(!this._isValidPos(XY.x, XY.y)){
            return callback(new Error('KAQ Modelimg > 4. Invalid X, Y : ' + XY.x + ',' + XY.y + ',' + type));
        }

        let forecast = [];
        let locationArray = this._getLocationArray(XY);
        let forecastDate = new Date(this._getPixelsInfo(type).pubDate);
        forecastDate.setHours(forecastDate.getHours()-21);//이미지의 시작 시간은 발표시간 20시간전부터임. TW-184. 한시간을 더 빼서, 한시간씩 증가시키면서 기록함.

        // Try to search dust value from all image of animation gif. usually it has 137 images.
        for(let idx = 0 ; idx < this._getPixelsInfo(type).data.image_count ; idx++){
            let item = {};

            // To get array of rgb matched with lat, lon from image.
            // usually it'll take 49 rgb datas(7 * 7) which is not exactly same to geocode due to black/gray color on the map.
            let rgbArray = this._getRgbArray(this._getPixelsInfo(type), idx, locationArray);
            // To get value of colorTable matched rgb
            let matchedVal = this._findMatchedVal(rgbArray, this.colorTable[type]);

            forecastDate.setHours(forecastDate.getHours()+1);
            item.date = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(forecastDate);
            if (matchedVal !== -1) {
                item.val = matchedVal;
                item.grade = AqiConverter.value2grade(aqiUnit, type.toLowerCase(), matchedVal);
            }

            forecast.push(item);
        }
        log.debug('KAQ ModelImg > result = ', JSON.stringify(forecast));

        if(callback){
            callback(null, {pubDate: this.imagePixels[type].pubDate, hourly: forecast});
        }

        return forecast;
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
            return callback(new Error('Need to init KaqModelimgController'));
        }

        this.parser.getPixelMap(path, 'modelimg', format, this.coordinate, (err, pixelMap)=>{
            if(err){
                return callback(err);
            }
            log.info('KAQ Modelimg > get Image Pixel map');

            // Re-calculate distance, size because it'll be used for rotated image.
            pixelMap.map_width = ModelimgInfo.size.map_width;
            pixelMap.map_height = ModelimgInfo.size.map_height;
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
     * @param type
     * @param aqiUnit
     * @param callback
     * @returns {*}
     */
    getDustInfo_old(lat, lon, type, aqiUnit, callback){
        if(this.imagePixels[type] === undefined){
            return callback(new Error('KAQ Modelimg > 1. There is no image information : ' + type));
        }

        if(!this._isValidGeocode(lat, lon)){
            return callback(new Error('KAQ Modelimg > 2. Invalid geocode :' + lat + ',' + lon));
        }

        if(this.colorTable[type] === undefined){
            return callback(new Error('KAQ Modelimg > 3. Invalid color grade table :' + lat + ',' + lon));
        }

        let pixels = this.imagePixels[type].data;
        let rotated_x = parseInt((lon - this.coordinate.top_left.lon) / pixels.map_pixel_distance_width);
        let rotated_y = parseInt((this.coordinate.top_left.lat - lat) / pixels.map_pixel_distance_height);

        //log.info('KAQ Modeling Image > Before x: ', rotated_x, 'y: ',rotated_y);
        //log.info('Gap W:', parseInt(ModelingImageInfo.size.gap_width));
        //log.info('step X: ', parseInt((rotated_y / ModelingImageInfo.size.gradient_step_width)));
        //log.info('Gap H:', parseInt(ModelingImageInfo.size.gap_height));
        //log.info('step Y: ', parseInt((rotated_x / ModelingImageInfo.size.gradient_step_height)));

        let x = rotated_x - (parseInt(ModelimgInfo.size.gap_width) - parseInt((rotated_y / ModelimgInfo.size.gradient_step_width)));
        let y = rotated_y - (parseInt((rotated_x / ModelimgInfo.size.gradient_step_height)));
        x = x + parseInt(ModelimgInfo.pixel_pos.left);
        y = y + parseInt(ModelimgInfo.pixel_pos.top);

        log.info('KAQ Modelimg > lat: ', lat, 'lon: ', lon);
        log.info('KAQ Modelimg > ', pixels.map_pixel_distance_width,  pixels.map_pixel_distance_height);
        log.info('KAQ Modelimg > x: ', x, 'y: ',y);

        if(!this._isValidPos(x, y)){
            return callback(new Error('KAQ Modelimg > 4. Invalid X, Y : ' + x + ',' + y));
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
                log.warn('KAQ Modelimg > Fail to find color value : ', i, type);
                log.warn('KAQ Modelimg > Need to Add it to table : ', JSON.stringify(err_rgb));
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

        log.info('KAQ Modeling Image > result = ', JSON.stringify(forecast));

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
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/kma_modelimg_PM10.09KM.Animation.gif'});
        }else if(type === 'PM25') {
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/kma_modelimg_PM2_5.09KM.Animation.gif'});
        }else if(type === 'NO2'){
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/kma_modelimg_NO2.09KM.Animation.fig'});
        }else if(type === 'O3'){
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/kma_modelimg_O3.09KM.Animation.gif'});
        }else{
            return callback(undefined, {pubDate: '2017-11-10 11시 발표', path: './test/testImageParser/kma_modelimg_SO2.09KM.Animation.gif'});
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

        if(type == 'SO2'){
            x = 275;
        }

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
                log.info('KAQ Modelimg> =====> : ', JSON.stringify(this.colorTable[type]));
            }
        }

        log.info('KAQ Modelimg> Color Table count : ', this.colorTable[type].length);
        //log.info('KAQ Model Image> Color Table : ', JSON.stringify(this.colorTable[type]));


        if(callback){
            callback();
        }
    }

    /**
     *
     * @param callback
     */
    taskModelimgMgr(callback){
        log.info('KAQ Modeimg > taskModelimgMgr -----------');
        async.waterfall(
            [
                (cb)=>{
                    this.getImaggPath('PM10', (err, pm10Path)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Modelimg > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Modelimg > Failed to get PM10 image : ', err);
                            return cb(err);
                        }
                        log.info('KAQ Modelimg > PM10 Path : ', pm10Path.path);
                        this.imagePixels.PM10 = undefined;
                        return cb(undefined, pm10Path);
                    });
                },
                (pm10Path, cb)=>{
                    this.parseMapImage(pm10Path.path, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }

                        log.info('KAQ Modelimg > Got pixel info for PM10');
                        this.imagePixels.PM10 = {};
                        this.imagePixels.PM10.pubDate = pm10Path.pubDate;
                        this.imagePixels.PM10.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    this.makeColorTable('PM10', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modelimg > Failed to get Grade Table');
                            return cb(err);
                        }

                        return cb();
                    });
                },
                (cb)=>{
                    this.getImaggPath('PM25', (err, pm25Path)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Modelimg > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Modelimg > Failed to get PM25 image');
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
                        log.info('KAQ Modelimg > Got pixel info for PM25');
                        this.imagePixels.PM25 = {};
                        this.imagePixels.PM25.pubDate = pm25Path.pubDate;
                        this.imagePixels.PM25.data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    this.makeColorTable('PM25', pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modelimg > Failed to get PM25 Grade Table');
                            return cb(err);
                        }

                        return cb();
                    });
                }
            ],
            (err)=>{
                if(err){
                    log.error('KAQ Modelimg > fail to load image : ', err);
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
    startModelimgMgr(callback){
        this.taskModelImgMgr(callback);
        this.task = setInterval(()=>{
            this.taskModelImgMgr(undefined);
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
        log.info('KAQ ModelImg Case > get dust image -----------');

        async.mapSeries(
            ['NO2', 'O3', 'PM10', 'PM25', 'SO2'],
            (imgType, cb)=>{
                if(imgPaths[imgType.toLowerCase()] === undefined){
                    log.info('KAQ ModelImg > No property :', imgType);
                    return cb(null);
                }

                async.waterfall([
                        (cb)=>{
                            this.parseMapImage(imgPaths[imgType.toLowerCase()], 'image/gif', (err, pixelMap)=>{
                                if(err){
                                    return cb(err);
                                }

                                log.info('KAQ Modelimg > Got pixel info for ', imgType);
                                this.imagePixels[imgType] = {};
                                this.imagePixels[imgType].pubDate = imgPaths.pubDate;
                                this.imagePixels[imgType].data = pixelMap;
                                return cb(null, pixelMap);
                            });
                        },
                        (pixelMap, cb)=>{
                            if (pixelMap  == undefined) {
                                log.error('KAQ Modelimg > pixelMap is undefined');
                                return cb(null);
                            }
                            this.makeColorTable(imgType, pixelMap, (err)=>{
                                if(err){
                                    log.error('KAQ Modelimg > Failed to get Grade Table:', imgType);
                                    return cb(err);
                                }

                                return cb(null);
                            });
                        }
                    ],
                    (err)=>{
                        if(err){
                            log.error('KAQ Modelimg > Fail to load image : ', imgType);
                            return cb(null);
                        }
                        cb(null, this.imagePixels[imgType]);
                    }
                );
            },
            (err, results)=>{
                log.info('KAQ ModelImage Count :', results.length);
                return callback(err, this.imagePixels);
            }
        );
    };

    /**
     *
     * @param imgType
     * @param callback
     */
    getImage(imgType, callback) {
        log.info('KAQ Modelimg > get image ----------- : ', imgType);
        async.waterfall(
            [
                (cb)=>{
                    this.getImaggPath(imgType, (err, imgPath)=>{
                        if(err === '_no_image_url_') {
                            log.warn('KAQ Modelimg > There is no image url');
                            return cb(err);
                        }
                        if(err){
                            log.error('KAQ Modelimg > Failed to get', imgType, 'image : ', err);
                            return cb(err);
                        }
                        log.info('KAQ Modelimg > img Path : ', imgPath.path);
                        this.imagePixels[imgType] = undefined;
                        return cb(undefined, imgPath);
                    });
                },
                (imgPath, cb)=>{
                    if (imgPath == undefined) {
                        log.error('KAQ Modelimg > image path is undefined');
                        return cb(null);
                    }

                    this.parseMapImage(imgPath.path, 'image/gif', (err, pixelMap)=>{
                        if(err){
                            return cb(err);
                        }

                        log.info('KAQ Modelimg > Got pixel info for ', imgType);
                        this.imagePixels[imgType] = {};
                        this.imagePixels[imgType].pubDate = imgPath.pubDate;
                        this.imagePixels[imgType].data = pixelMap;
                        return cb(null, pixelMap);
                    });
                },
                (pixelMap, cb)=>{
                    if (pixelMap  == undefined) {
                        log.error('KAQ Modelimg PM10 Image > pixelMap is undefined');
                        return cb(null);
                    }
                    this.makeColorTable(imgType, pixelMap, (err)=>{
                        if(err){
                            log.error('KAQ Modelimg Image > Failed to get Grade Table:', imgType);
                            return cb(err);
                        }

                        return cb(null);
                    });
                }
            ],
            (err)=>{
                if(err){
                    log.error('KAQ Modelimg Image > fail to load image : ', imgType);
                }

                if(callback){
                    callback(err, this.imagePixels[imgType]);
                }
            }
        );
    };

    /**
     *
     * @param callback
     */
    taskModelImgMgr(callback){
        log.info('KAQ ModelImg > taskModelImgMgr -----------');
        async.mapSeries(
            ['NO2', 'O3', 'PM10', 'PM25', 'SO2'],
            (dataType, cb)=>{
                this.getImage(dataType, cb);
            },
            (err, results)=>{
                log.info('KAQ ModelImage Count :', results.length);
                callback(err, this.imagePixels);
            }
        );
    }
}

module.exports = KaqDustImageController;
