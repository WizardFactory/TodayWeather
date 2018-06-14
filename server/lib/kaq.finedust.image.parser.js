/**
 * Created by Peter on 2018. 3. 11..
 */
"use strict";

const getPixels = require('get-pixels');
//const fs = require('fs');
/**
 * modelimg_CASE4
 * @type {module.exports.image.kaq_korea_image|{coordi, size, pixel_pos, so2_pixel_pos, region, bucketName}}
 */
const kaqDustImage = require('../config/config').image.kaq_korea_image;
/**
 * modelimg
 * @type {module.exports.image.kaq_korea_modelimg_image|{coordi, size, pixel_pos}}
 */
const kaqModelimg = require('../config/config').image.kaq_korea_modelimg_image;



class KaqImageParser{
    constructor(){
        return this;
    }


    getImagePos(type) {
        var pos = kaqDustImage.pixel_pos;
        if(type === 'modelimg'){
            pos = kaqModelimg.pixel_pos;
        }else if(type === 'CASE4_SO2'){
            pos = kaqDustImage.so2_pixel_pos;
        }
        return {
            left: parseInt(pos.left),
            right: parseInt(pos.right),
            top: parseInt(pos.top),
            bottom: parseInt(pos.bottom)
        }
    }

    getDefaultCoordi(type) {
        var coordi = kaqDustImage.coordi;
        if(type === 'modelimg'){
            coordi = kaqModelimg.coordi;
        }

        return {
            top_left:{
                lat: parseFloat(coordi.top_lat),
                lon: parseFloat(coordi.left_lon)
            },
            top_right:{
                lat: parseFloat(coordi.top_lat),
                lon: parseFloat(coordi.right_lon)
            },
            bottom_left:{
                lat: parseFloat(coordi.bottom_lat),
                lon: parseFloat(coordi.left_lon)
            },
            bottom_right:{
                lat: parseFloat(coordi.bottom_lat),
                lon: parseFloat(coordi.right_lon)
            }
        };
    }


    _isValidImage(type, width, height){
        var size = {
            width : parseInt(kaqDustImage.size.width),
            height: parseInt(kaqDustImage.size.height)
        };

        if(type === 'modelimg'){
            size.width = parseInt(kaqModelimg.size.width);
            size.height = parseInt(kaqModelimg.size.height);
        }

        return (size.width === width && size.height === height);
    }

    getPixelMap(path, type, format, coordnate, callback){
        getPixels(path, format, (err, pixels)=>{
            if(err){
                log.error('KaqImgParser> Fail to get pixels info : ', err);
                return callback(err);
            }

            if(!this._isValidImage(type, pixels.shape[1], pixels.shape[2])){
                log.error('KaqImgParser> Invalid Image size :', pixels.shape[1], pixels.shape[2]);
                return callback('INVALID_IMAGE');
            }

            var map_area = this.getImagePos(type);
            var result = {
                image_count: pixels.shape[0],
                image_width: pixels.shape[1],
                image_height: pixels.shape[2],
                map_width: 0,
                map_height: 0,
                map_pixel_distance_width: 0.0,
                map_pixel_distance_height: 0.0,
                map_area: map_area,
                pixels: pixels
            };

            log.debug('KaqImgParser> image count : ', pixels.shape[0]);

            var default_coordinate = this.getDefaultCoordi(type);
            // map's width&height (count of pixels)
            result.map_width = map_area.right - map_area.left;
            result.map_height = map_area.bottom - map_area.top;
            if(coordnate === null){
                result.map_pixel_distance_width = parseFloat((default_coordinate.top_right.lon - default_coordinate.top_left.lon) / result.map_width);
                result.map_pixel_distance_height = parseFloat((default_coordinate.top_left.lat - default_coordinate.bottom_left.lat) / result.map_height);
            }else{
                result.map_pixel_distance_width = parseFloat((coordnate.top_right.lon - coordnate.top_left.lon) / result.map_width);
                result.map_pixel_distance_height = parseFloat((coordnate.top_left.lat - coordnate.bottom_left.lat) / result.map_height);
            }

            if(callback){
                log.debug('KaqImgParser> Image W: ', result.image_width, 'H: ', result.image_height);
                log.debug('KaqImgParser> Map W: ', result.map_width, 'H: ', result.map_height);
                log.debug('KaqImgParser> One pixel size W: ', result.map_pixel_distance_width, 'H: ', result.map_pixel_distance_height);
                callback(null, result);
            }
        });
    };
}


module.exports = KaqImageParser;
