/**
 * Created by aleckim on 2015. 12. 22..
 */

var Logger = require('../lib/log');
global.log  = new Logger();

var assert  = require('assert');
var config = require('../config/config');
var controllerManager = require('../controllers/controllerManager');

var controllerShortRss = require('../controllers/kma/kma.town.short.rss.controller');

global.townRss = new controllerShortRss();

var manager = new controllerManager();

describe('unit test - controller manager', function() {
    //var mongoose = require('mongoose');
    //mongoose.connect(config.db.path, function(err) {
    //    if (err) {
    //        log.error('Could not connect to MongoDB!');
    //        console.log(err);
    //        done();
    //    }
    //});
    //
    //mongoose.connection.on('error', function(err) {
    //    log.error('MongoDB connection error: ' + err);
    //    done();
    //});

    //it('test shortest appendData', function(done) {
    //    this.timeout(60*1000*60*100); //100mins
    //    manager.getTownShortestData(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test current appendData', function(done) {
    //    this.timeout(60*1000*60*100); //100mins
    //    manager.getTownCurrentData(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test short appendData', function (done) {
    //    this.timeout(60*1000*60*100); //100mins
    //    manager.getTownShortData(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid forecast', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidForecast(9, config.keyString.test_normal, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid land', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidLand(9, config.keyString.test_normal, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid temp', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidTemp(9, config.keyString.test_normal, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid sea', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidSea(9, config.keyString.test_normal, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    it('test task of controller manager', function (done) {
        manager.task(function (err) {
            if (err){
                log.error(err);
            }
            done();
       });
    });

    //it('test check time and push tasks of controller manager', function () {
    //    manager.checkTimeAndPushTask(true);
    //});

    //it('test start of controller manager', function (done) {
    //    this.timeout(1000*60*60*3); //3hours
    //    manager.startManager();
    //});

    it('test stop manager', function () {
        manager.stopManager();
    });

    it('test get world time', function () {
        var  dateStr = manager.getWorldTime(9);
        log.info(dateStr);
    });

    //it('test recursive request data by base time list', function (done) {
    //    this.timeout(1000*60); //1min
    //    var updateObject = {mCoord:{mx:91, my:131}, baseTimeList:[]};
    //    updateObject.baseTimeList = [{date: '20151231', time: '0500'}, {date: '20151231', time: '0600'}];
    //
    //    manager._recursiveRequestDataByBaseTimList(manager.DATA_TYPE.TOWN_CURRENT, config.keyString.test_cert,
    //        updateObject.mCoord, updateObject.baseTimeList, 10, function(err, results) {
    //            log.info('TOWN_CURRENT '+JSON.stringify(updateObject.mCoord)+' was updated counts='+updateObject.baseTimeList);
    //            if (err) {
    //                log.error(err);
    //            }
    //            log.info(results);
    //            //unless previous item was failed, continues next item
    //            done();
    //        });
    //});

    //it('test requestDataByUpdateList', function (done) {
    //    this.timeout(1000*60); //1min
    //    var updateList = [];
    //
    //    var updateObject = {mCoord:{mx:91, my:131}, baseTimeList:[]};
    //    updateObject.baseTimeList = [{date: '20151231', time: '0500'}, {date: '20151231', time: '0600'}];
    //    updateList.push(updateObject);
    //
    //    var updateObject2 = {mCoord:{mx:62, my:125}, baseTimeList:[]};
    //    updateObject2.baseTimeList = [{date: '20151231', time: '0500'}, {date: '20151231', time: '0600'}];
    //    updateList.push(updateObject2);
    //
    //    manager.requestDataByUpdateList(manager.DATA_TYPE.TOWN_CURRENT, config.keyString.test_cert, updateList, 10, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //
    //});
});


