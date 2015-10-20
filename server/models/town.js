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
    areaCode: String
});

tSchema.statics = {
    getCoord : function(cb){
        this.distinct("mCoord")
	.exec(cb);
    }
};

module.exports = mongoose.model('town', tSchema);

