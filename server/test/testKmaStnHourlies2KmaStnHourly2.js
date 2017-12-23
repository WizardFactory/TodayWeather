/**
 * Created by aleckim on 2017. 6. 11..
 */
var assert  = require('assert');
var convert = require('../utils/kmaStnHourlies2kmaStnHourly2');
var Logger = require('../lib/log');
global.log  = new Logger();

describe('unit test - convert modelKmaStnHourlies to modelKmaStnHourly2', function(){

    //it('convert', function(done) {
    //    this.timeout(30*1000);
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //            return done();
    //        }
    //    });
    //
    //    convert(function (err) {
    //        console.log('finish');
    //        if (err) {
    //            console.log(err);
    //        }
    //        done();
    //    });
    //});
});

