/*
 *
 * 
 * */
var mongoose = require('mongoose');
var config = require('../config/config');

mongoose.connect(config.db.path, config.db.options);
//mongoose.set('debug', true);

//var town = require('./town');
//
//var town = mongoose.model('town');
//
//town.getCoord(function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});
//
//var base = require('./forecast');
//var short = require('./short');
//var midLand = require('./midLand');

//b.getData("서울특별시", "동대문구", "청량리동", function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});
//

//var shortList = config.testTownData[0].data.short;
//
////var shortSlice = shortList.slice(0, 20);
//var shortSlice = shortList.slice(5, 25);
//short.setShortData(shortSlice,{"mx":57, "my":128}, function(err, res){
//    if(err) console.log(err)
//    console.log(res);
//});

//short.getShortData("경기도", "고양시덕양구", "성사2동", function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});

//midLand.setLandData({'date' : '20151010101010'}, '11D10000', function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});
var midTemp = require('./midTemp');
//var midLand = require('./midLand');

var first = config.testTownData[0].regionName;
var second = config.testTownData[0].cityName;
var third = config.testTownData[0].townName;

midTemp.getTempData('강원도', '강릉시', function(err, res){
    if(err) return;
    console.log(res);
});

//var current = require('./current');
//current.getCurrentDataForCal(1, '11D20501', function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});

//var midUtil = require('./modelUtil');
//var t = new midUtil();
//console.log(t.getCode('강원도', '강릉시'));

//console.log(t);
//midLand.getLandData(first, second, function(err, res){
//    if(err) return;
//    console.log(res);
//});
