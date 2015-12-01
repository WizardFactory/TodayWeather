/*
 *
 *  how to use ...
 *
 *  var town = require('./town');
 *
 *  town.getCoord(function(err, res){
 *      if(err) console.log(err);
 *      console.log(res);
 *      });
 * */

"use strict";

var mongoose = require('mongoose');

var tSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    mCoord: {mx: Number, my: Number},
    gCoord: {lat: Number, lon: Number},
    areaNo: String,
    tmCoord:{x: Number, y: Number},
    kecoStationName: String
});

var mCoord = [];
var areaCode = [];

tSchema.statics = {
    getCoord : function(cb) {
        if(mCoord.length === 0){
            this.distinct("mCoord").exec(function(err, result){
                mCoord = result;
                cb(err, mCoord);
            });
        }
        else{
            //log.info('get mx,my : ', mCoord.length);
            cb(0, mCoord);
        }
    },
    getCode : function(cb) {
        if(areaCode.length === 0){
            this.distinct('areaCode').exec(function(err, result){
                areaCode = result;
                cb(err, areaCode);
            });
        }else{
            //log.info('get areacode : ', areaCode.length)
            cb(0, areaCode);
        }

    }
};

module.exports = mongoose.model('town', tSchema);

