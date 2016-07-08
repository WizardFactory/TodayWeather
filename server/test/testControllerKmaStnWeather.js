/**
 * Created by aleckim on 2016. 4. 4..
 */

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var controllerKmaStnWeather = require('../controllers/controllerKmaStnWeather');
var kmaTimeLib = require('../lib/kmaTimeLib');


describe('unit test - controller kma stn weather', function() {
    //it('test get hourly stn weather', function(done) {
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var townInfo={first:'서울특별시',second:'송파구', third:'잠실본동', gCoord:{'lat':37.5033556,'lon':127.0864194}};
    //
    //    var date = kmaTimeLib.convertDateToYYYYMMDD(new Date());
    //    var time = kmaTimeLib.convertDateToHHZZ(new Date());
    //    console.log('pubDate='+date+time);
    //    controllerKmaStnWeather.getStnHourly(townInfo, date+time, function (err, result) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        else {
    //            log.info(JSON.stringify(result));
    //        }
    //        done();
    //    });
    //});

    //it('test get minute stn weather', function(done) {
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var townInfo={first:'서울특별시',second:'송파구', third:'잠실본동', gCoord:{'lat':37.5033556,'lon':127.0864194}};
    //
    //    var date = kmaTimeLib.convertDateToYYYYMMDD(new Date());
    //    var time = kmaTimeLib.convertDateToHHMM(new Date());
    //    console.log('pubDate='+date+time);
    //    controllerKmaStnWeather.getStnMinute(townInfo, date+time, undefined, function (err, result) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        else {
    //            log.info(JSON.stringify(result));
    //        }
    //        done();
    //    });
    //});

    //it('test get all hourly stn weather', function(done) {
    //    this.timeout(1000*1000);
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var fs = require('fs');
    //    var targetName = './utils/data/base.csv';
    //    var lineList = fs.readFileSync(targetName).toString().split('\n');
    //    // header remove
    //    lineList.shift();
    //    //remove last blank line
    //    lineList = lineList.slice(0, lineList.length-1);
    //
    //    var date = kmaTimeLib.convertDateToYYYYMMDD(new Date());
    //    var time = kmaTimeLib.convertDateToHHZZ(new Date());
    //    log.info('pubDate='+date+time);
    //
    //    var callCount = 0;
    //    lineList.forEach(function (line) {
    //        var tia = line.split(",");
    //        var townInfo={first:tia[0],second:tia[1], third:tia[2], gCoord:{'lat':tia[3],'lon':tia[4]}};
    //        //log.info(JSON.stringify(townInfo));
    //        callCount++;
    //        controllerKmaStnWeather.getStnHourly(townInfo, date+time, function (err, result) {
    //            if (err) {
    //                log.error(err);
    //            }
    //            else {
    //                if (result.visibility == undefined || result.t1h == undefined) {
    //                    log.error(JSON.stringify(townInfo)+'--'+JSON.stringify(result));
    //                }
    //                else {
    //                    log.info(JSON.stringify(townInfo)+'--'+JSON.stringify(result));
    //                }
    //            }
    //            callCount--;
    //            if (callCount == 0) {
    //                done();
    //            }
    //        });
    //    });
    //});

    //it('test get all hourly stn weather', function(done) {
    //    this.timeout(1000*1000);
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var fs = require('fs');
    //    var targetName = './utils/data/base.csv';
    //    var lineList = fs.readFileSync(targetName).toString().split('\n');
    //    // header remove
    //    lineList.shift();
    //    //remove last blank line
    //    lineList = lineList.slice(0, lineList.length-1);
    //
    //    var date = kmaTimeLib.convertDateToYYYYMMDD(new Date());
    //    var time = kmaTimeLib.convertDateToHHMM(new Date());
    //    log.info('pubDate='+date+time);
    //
    //    var callCount = 0;
    //    lineList.forEach(function (line) {
    //        var tia = line.split(",");
    //        var townInfo={first:tia[0],second:tia[1], third:tia[2], gCoord:{'lat':tia[3],'lon':tia[4]}};
    //        //log.info(JSON.stringify(townInfo));
    //        callCount++;
    //        controllerKmaStnWeather.getStnMinute(townInfo, date+time, undefined, function (err, result) {
    //            if (err) {
    //                log.error(err);
    //            }
    //            else {
    //                if (result.t1h === 0 && result.vec === 0 && result.wsd === 0) {
    //                    log.error('result is invalid!');
    //                    next();
    //                    return;
    //                }
    //
    //                if (result.rns) {
    //                    log.info(JSON.stringify(townInfo)+'--'+JSON.stringify(result));
    //                }
    //
    //                //if (result.t1h == undefined) {
    //                //    log.error(JSON.stringify(townInfo)+'--'+JSON.stringify(result));
    //                //}
    //                //else {
    //                //    log.info(JSON.stringify(townInfo)+'--'+JSON.stringify(result));
    //                //}
    //            }
    //            callCount--;
    //            if (callCount == 0) {
    //                done();
    //            }
    //        });
    //    });
    //});
});

