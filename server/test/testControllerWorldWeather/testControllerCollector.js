/**
 * Created by aleckim on 2017. 1. 25..
 */

var conCollector = require('../../controllers/worldWeather/controllerCollector');

var assert  = require('assert');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");
var collector = new conCollector;

describe ('unit test - controller collector ', function() {
    it ('test get local last 0h', function() {
        var offSetList = [];
        var maxOffset = 14*60;
        var minOffset = -11*60;
        for (var i = maxOffset; i >= minOffset; i -= 30) {
            offSetList.push(i);
        }

        offSetList.forEach(function (offset) {
            var lastLocal0H = collector._getLocalLast0H(offset);
            log.info(lastLocal0H.toISOString() + " offset=" + offset/60);
        });
    });
});

