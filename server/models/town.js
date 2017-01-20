/**
 *
 *  how to use ...
 *
 *  var town = require('./town');
 *
 *  town.getCoord(function(err, res){
 *      if(err) console.log(err);
 *      console.log(res);
 *      });
 *  town.js는 데이터 참조용으로 사용해야함. town name외에 모두 중복 될수 있음.
 *  mCoord, gCoord, areaNo, tmCoord, kecoStationName
 *  동일한 동이 다른 이름으로 들어 갈 수 있음. 예)창신제1동,창신1동
 */

"use strict";

var mongoose = require('mongoose');

var tSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    mCoord: {mx: Number, my: Number},
    gCoord: {lat: Number, lon: Number},
    areaNo: String,
    tmCoord:{x: Number, y: Number},
    kecoStationName: String //unused it;
});

tSchema.index({mCoord:1});
tSchema.index({"mCoord.mx" : 1, "mCoord.my" : 1});
tSchema.index({town:1});
tSchema.index({"town.first": 'text', "town.second": 'text', "town.third": 'text'}, {default_language: 'none'});

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

