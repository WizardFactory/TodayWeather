/**
 * Created by Peter on 2017. 11. 3..
 */
"use strict";

var getPixels = require('get-pixels');
//var fs = require('fs');


function AirkoreaImageParser(){
    this.default_coordinate = {
        top_left: {lat: 39.3769, lon: 123.9523},
        top_right: {lat: 39.3769, lon: 130.6741},
        bottom_left: {lat: 32.6942, lon: 123.9523},
        bottom_right: {lat: 32.6942, lon: 130.6741}
    };
    //self.map_area = {left:12, right:597, top: 72, bottom:790}
    this.map_area = {left:78, right:663, top: 80, bottom:798};

}

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

        var result = {
            image_count: pixels.shape[0],
            image_width: pixels.shape[1],
            image_height: pixels.shape[2],
            map_width: 0,
            map_height: 0,
            map_pixel_distance_width: 0.0,
            map_pixel_distance_height: 0.0,
            map_area: self.map_area,
            pixels: pixels
        };

        log.info('image count : ', pixels.shape[0]);

        /*
        // set total image pixel
        for(var i = 0 ; i < result.image_count ; i++){
            var images = [];
            for(var y = 0 ; y < result.image_height ; y++){
                var vertical = [];
                for(var x = 0 ; x < result.image_width ; x++){
                    var rgba = [];
                    for(var z = 0 ; z < 3 ; z++){
                        rgba.push(pixels.get(i, x, y, z));
                    }
                    var val = (rgba[0] << 16) & 0xFF0000 | (rgba[1] << 8) & 0xFF00 |rgba[2] & 0xFF;
                    //log.info(val.toString(16), JSON.stringify(rgba));
                    vertical.push(val);
                }
                images.push(vertical);
            }
            //log.info('push image #', i);
            imagePixels.push(images);
        }
        log.info('got image pixels');

        // extract map pixels from image pixels
        // width : 78 ~ 663, Height : 80 ~ 798
        for(i=0 ; i < result.image_count ; i++) {
            var map = [];
            for(var y = self.map_area.top ; y < self.map_area.bottom ; y++){
                var vertical = [];
                for(var x = self.map_area.left ; x < self.map_area.right ; x++){
                    vertical.push(imagePixels[i][y][x]);
                }
                map.push(vertical);
            }
            result.mapPixels.push(map);
        }
        */

        // map's width&height (count of pixels)
        result.map_width = self.map_area.right - self.map_area.left;
        result.map_height = self.map_area.bottom - self.map_area.top;
        if(coordnate === null){
            result.map_pixel_distance_width = parseFloat((self.default_coordinate.top_right.lon - self.default_coordinate.top_left.lon) / result.map_width);
            result.map_pixel_distance_height = parseFloat((self.default_coordinate.top_left.lat - self.default_coordinate.bottom_left.lat) / result.map_height);
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
