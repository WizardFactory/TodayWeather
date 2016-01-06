/**
 * Created by aleckim on 2015. 12. 31..
 */

var Logger = require('../lib/log');
global.log  = new Logger();

var assert  = require('assert');
var config = require('../config/config');
var controllerManager = require('../controllers/controllerManager');
var PastConditionGather = require('../lib/PastConditionGather');

global.manager = new controllerManager();

describe('unit test - past condition gather', function() {
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

    //it('test make pub date list', function() {
    //    var pastGather = new PastConditionGather();
    //    var pubDateList = pastGather.makePubDateList(7);
    //    pubDateList.forEach(function (pubDate) {
    //        log.info(JSON.stringify(pubDate));
    //    });
    //    log.info('pubDateCounts='+pubDateList.length);
    //});

    //it('test start past condition gather', function(done) {
    //    this.timeout(1000*60*60*3);
    //    var pastGather = new PastConditionGather();
    //    pastGather.start(7, config.keyString.test_cert, function (err) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        else {
    //            log.info('mCoords='+pastGather.updateList.length);
    //            pastGather.updateList.forEach(function (updateObject) {
    //                log.info('mCoord:'+JSON.stringify(updateObject.mCoord)+' baseTimes='+updateObject.baseTimeList.length);
    //            });
    //        }
    //        done();
    //    });
    //});

    //it('test get length currentData', function (done) {
    //    this.timeout(1000*60*60*3);
    //
    //    var modelCurrent = require('../models/modelCurrent');
    //    modelCurrent.find(null, {_id: 0}).lean().exec(function(err, modelList) {
    //        if (err) {
    //            log.error(err);
    //            done();
    //            return;
    //        }
    //        modelList.forEach(function (model) {
    //            log.info('mCoord='+JSON.stringify(model.mCoord)+' currentData.lenghth='+model.currentData.length);
    //        });
    //        done();
    //    });
    //});
});


