/*
 *
 * 
 * */
var mongoose = require('mongoose');
var config = require('../config/config');

mongoose.connect(config.db.path, config.db.options);
mongoose.set('debug', true);

//var town = require('./town');
//
//var town = mongoose.model('town');
//
//town.getCoord(function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});
//
var base = require('./forecast');

var b = mongoose.model('base');

//b.getData("서울특별시", "동대문구", "청량리동", function(err, res){
//    if(err) console.log(err);
//    console.log(res);
//});
//

b.setCurrentData("1500", [{"test": "Test#1"}], {"mx":132, "my":93}, function(err, res){
    if(err) console.log(err);
    console.log(res);
});
