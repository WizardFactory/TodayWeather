/**
 * Created by Peter on 2017. 11. 3..
 */
"use strict";

var getPixels = require('get-pixels');
var fs = require('fs');


var airkoreaImageParser = function airkoreaImageParser(){
    this.top_left = {lat: 39.3769, lon: 123.9523};
    this.top_right = {lat: 39.3769, lon: 130.6741};
    this.bottom_left = {lat: 32.6942, lon: 123.9523};
    this.bottom_right = {lat: 32.6942, lon: 130.6741};
    this.map_area = {left:12, right:597, top: 72, bottom:790}
};

airkoreaImageParser.prototype.getMapPixels = function(path, type, cb){
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
            image_width: pixels.shape[0],
            image_height: pixels.shape[1],
            imagePixels: [],
            map_width: 0,
            map_height: 0,
            mapPixels: []
        };

        // set total image pixel
        for(var y = 0 ; y < result.image_height ; y++){
            var vertical = [];
            for(var x = 0 ; x < result.image_width ; x++){
                var rgba = [];
                for(var z = 0 ; z < 4 ; z++){
                    rgba.push(pixels.get(x, y, z));
                }
                vertical.push(rgba);
            }
            result.imagePixels.push(vertical);
        }

        // extract map pixels from image pixels
        // width : 12 ~ 597, Height : 72 ~ 790
        for(var y = self.map_area.top ; y < self.map_area.bottom ; y++){
            var vertical = [];
            for(var x = self.map_area.left ; x < self.map_area.right ; x++){
                vertical.push(result.imagePixels[y][x]);
            }
            result. mapPixels.push(vertical);
        }

        // map's width&height (count of pixels)
        result.map_width = result.mapPixels[0].length;
        result.map_height = result.mapPixels.length;

        if(cb){
            log.info('Image W: ', result.image_width, 'H: ', result.image_height);
            log.info('Map W: ', result.map_width, 'H: ', result.map_height);
            cb(null, result);
        }
    });
};

airkoreaImageParser.prototype.setBaseGeocode = function(type, geocode){
    if(geocode === undefined || geocode.lat === undefined || geocode.lon === undefined){
        log.error(new Error('ImgParser > There is no Geocode'));
        return;
    }

    switch(type){
        case 'TL':
            this.top_left = geocode;
            break;
        case 'TR':
            this.top_right = geocode;
            break;
        case 'BL':
            this.bottom_left = geocode;
            break;
        case 'BR':
            this.bottom_right = geocode;
            break;
    }

    return;
};

airkoreaImageParser.instance = null;

airkoreaImageParser.getInstance = function(){
    if(this.instance === null){
        this.instance = new airkoreaImageParser();
    }
    return this.instance;
};

module.exports = airkoreaImageParser.getInstance();
