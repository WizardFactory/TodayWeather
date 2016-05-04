/**
 * Created by aleckim on 2016. 5. 3..
 */

var assert  = require('assert');
var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var ControllerPush = require('../controllers/controllerPush');

describe('unit test - controller push', function() {
    //it('test start push', function(done) {
    //    var count = 0;
    //    var co = new ControllerPush();
    //    co.timeInterval = 1000;
    //    co.sendPush = function () {
    //        assert(true);
    //        return done();
    //    };
    //    co.start();
    //});

    var pushInfo = {
        registrationId: 'asdf',
        pushTime: 6900,
        cityIndex: 0,
        type: 'ios',
        town: {first: 'A', second: 'B', third: 'C'},
        geo: [36, 102]
    };

    it('test update push info', function(done) {
        var PushInfo = require('../models/modelPush');

        PushInfo.update = function(condition, push, options, callback) {
            console.log('update');
            assert.equal(push.registrationId, pushInfo.registrationId, 'error');
            return callback();
        };

        var co = new ControllerPush();
        co.updatePushInfo(pushInfo, function () {
            done();
        });
    });

    it('test remove push info', function(done) {
        var PushInfo = require('../models/modelPush');
        PushInfo.remove = function(push, callback) {
            console.log('remove');
            assert.equal(push.registrationId, pushInfo.registrationId, 'error');
            return callback();
        };

        var co = new ControllerPush();
        co.removePushInfo(pushInfo, function () {
          done();
        });
    });

    it('test get push info by time', function(done) {
        var PushInfo = require('../models/modelPush');
        PushInfo.find = function(getInfo) {
            assert.equal(getInfo.pushTime, pushInfo.pushTime, 'error');
            return {lean: function() { return {exec: function(callback) {return callback(undefined, [pushInfo]);}}}};
        };

        var co = new ControllerPush();
        co.getPushByTime(pushInfo.pushTime, function () {
            done();
        });
    });

    //it('test request daily summary', function(done) {
    //    this.timeout(20*1000);
    //    var co = new ControllerPush();
    //    co.requestDailySummary({first:'대구광역시', second:'', third: ''}, function (err, result) {
    //        if (err) {
    //            console.log(err);
    //        }
    //        else {
    //            console.log(result);
    //        }
    //       done();
    //    });
    //});

});



