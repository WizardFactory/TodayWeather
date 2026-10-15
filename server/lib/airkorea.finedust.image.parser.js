/**
 * Created by Peter on 2017. 11. 3..
 */
"use strict";

var getPixels = require('get-pixels');
var layout = require('./airkoreaImageLayout');
//var fs = require('fs');
var airkoreaDustImage = require('../config/config').image.airkorea_korea_image;



function AirkoreaImageParser(){
    return this;
}

AirkoreaImageParser.prototype.getImagePos = function(){
    var pos = airkoreaDustImage.pixel_pos;
    return{
        left: parseInt(pos.left),
        right: parseInt(pos.right),
        top: parseInt(pos.top),
        bottom: parseInt(pos.bottom)
    }
};

AirkoreaImageParser.prototype.getDefaultCoordi = function(){
    var coordi = airkoreaDustImage.coordi;
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
};

AirkoreaImageParser.prototype.isValidImage = function(width, height){
    var size = {
        width : parseInt(airkoreaDustImage.size.width),
        height: parseInt(airkoreaDustImage.size.height)
    };

    return (width === 820 && height === 820 && size.width === width && size.height === height);
};

AirkoreaImageParser.prototype.getPixelMap = function(path, type, coordnate, cb){
    var self = this;

    getPixels(path, type, function(err, pixels){
        if(err){
            log.error('ImgParser> Fail to get pixels info : ', err);
            if(cb){
                cb(err);
            }
            return;
        }

        var legends;
        try {legends = layout.validate(pixels,airkoreaDustImage);}
        catch (error) {
            log.error('ImgParser> Unsupported AirKorea image layout');
            return cb(error);
        }

        var map_area = self.getImagePos();
        var result = {
            image_count: pixels.shape[0],
            image_width: pixels.shape[1],
            image_height: pixels.shape[2],
            map_width: 0,
            map_height: 0,
            map_pixel_distance_width: 0.0,
            map_pixel_distance_height: 0.0,
            map_area: map_area,
            pixels: pixels,
            legends: legends,
            sourcePath: path
        };

        log.info('image count : ', pixels.shape[0]);

        var default_coordinate = self.getDefaultCoordi();
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

        if(cb){
            log.info('Image W: ', result.image_width, 'H: ', result.image_height);
            log.info('Map W: ', result.map_width, 'H: ', result.map_height);
            log.info('One pixel size W: ', result.map_pixel_distance_width, 'H: ', result.map_pixel_distance_height);
            cb(null, result);
        }
    });
};

module.exports = AirkoreaImageParser;
