/**
 * Created by Peter on 2017. 11. 5..
 */
"use strict";
var fs = require('fs');

var libAirkoreaImageParser = require('../lib/airkorea.finedust.image.parser.js');

function airkoreaDustImageController(){
    // image default geocode
    this.coordinate = {
        top_left: {lat: 39.3769, lon: 123.9523},
        top_right: {lat: 39.3769, lon: 130.6741},
        bottom_left: {lat: 32.6942, lon: 123.9523},
        bottom_right: {lat: 32.6942, lon: 130.6741}
    };
    this.colorTable = [
        {"r":104,"g":0,"b":0,"val":999},    {"r":142,"g":0,"b":0,"val":320},
        {"r":179,"g":0,"b":0,"val":280},    {"r":179,"g":0,"b":0,"val":260},
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
        {"r":135,"g":192,"b":232,"val":6}, {"r":170,"g":210,"b":225,"val":0}
    ];
    this.parser = new libAirkoreaImageParser();
}
/*
airkoreaDustImageController.prototype.savePixelMap = function(pubDate, fcsDate, path, pixelMap, callback){
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

airkoreaDustImageController.prototype.parseMapImage = function(path, type, callback){
    var self = this;

    self.parser.getPixelMap(path, type, self.coordinate, function(err, pixelMap){
        if(err){
            return callback(err);
        }
        log.info('Airkorea Image > get Image Pixel map');
        return callback(null, pixelMap);
    });
};


airkoreaDustImageController.prototype.getDustInfo = function(lat, lon, callback){
    var self = this;

    if(self.imagePixels === undefined){
        return callback(new Error('1. There is no image information'));
    }

    var pixels = self.imagePixels;
    var x = parseInt((lon - self.coordinate.top_left.lon) / pixels.map_pixel_distance_width) + pixels.map_area.left;
    var y = parseInt((self.coordinate.top_left.lat - lat) / pixels.map_pixel_distance_height) + pixels.map_area.top;

    log.info('Airkorea Image > ', pixels.map_pixel_distance_width,  pixels.map_pixel_distance_height);
    log.info('Airkorea Image > x: ', x, 'y: ',y);

    var result = [];
    for(var i=0 ; i < pixels.image_count ; i++){
        for(var j = 0 ; j<64 ; j++){
            var w = 0;
            var h = 0;

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
            for(k=0 ; k<self.colorTable.length ; k++){
                if(rgb.r === self.colorTable[k].r &&
                    rgb.g === self.colorTable[k].g &&
                    rgb.b === self.colorTable[k].b){
                    break;
                }
            }
            if(k<self.colorTable.length){
                //log.info('Airkorea Image > Found color value : ', i, j, self.colorTable[k].val, k);
                result.push(self.colorTable[k].val);
                break;
            }
        }
        if(j === 64){
            // 보정된 좌표 64개 모두 invalid한 색이 나올 경우 error 처리 한다
            log.error('Airkorea Image > Fail to find color value : ', i);
            result.push(6);
        }
    }

    //log.info('Airkorea Image > result = ', JSON.stringify(result));

    if(callback){
        callback(null, result);
    }

    return result;
};


airkoreaDustImageController.prototype.startDustImageMgr = function(path, type, callback){
    var self = this;

    self.parseMapImage(path, type, function(err, pixelMap){
        if(err){
            return callback(err);
        }

        self.imagePixels = pixelMap;
        if(callback){
            callback(null, pixelMap);
        }
        return ;
    });
};

module.exports = airkoreaDustImageController;