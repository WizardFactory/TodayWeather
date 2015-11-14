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

//var current = require('./current');
//var config = require('../config/config');
//
//var currentList = config.testTownData[0].data.current;
//current.setCurrentData(currentList, {mx : 93, my: 132}, function(err, res){
//    if(err) console.log(err);
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
//
//var first = config.testTownData[0].regionName;
//var second = config.testTownData[0].cityName;
//var third = config.testTownData[0].townName;
//
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
//console.log(t.getCodeWithFirst('강원도', '강릉시'));
//console.log(t.getCodeWithFirst('울산광역시'));

var midLand = require('./midLand');
midLand.getLandData('강원도', '강릉시', function(err, res){
    if(err) return;
    console.log(res);
});

//var current = require('./short');
//
//var town = {first : '강원도', second : '강릉시', third : '강남동'};
//current.getShortDataWithTime(town, '20151101', '', function(err, res){
//    if(err) console.log(err);
//    var list = [];
//    list.push.apply(list, res);
//    list.forEach(function(elem, idx){
//        console.log('idx : ' + idx);
//        console.log(elem);
//    });
//});

//var forecast = ('./forecast');
//current.getOneShortData('강원도', '강릉시', '강남동', function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});

//var short = require('./short');
//
//short.getOneShortDataWithTime('강원도', '강릉시', '강남동', '20151108', '1700', function(err, res){
//    if(err) console.log(err);
//    console.log(res[0].shortData);
//});
