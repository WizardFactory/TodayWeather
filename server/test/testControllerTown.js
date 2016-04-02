/**
 * Created by aleckim on 2016. 3. 16..
 */

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var ControllerTown = require('../controllers/controllerTown');
var cTown = new ControllerTown();

var ControllerTown24h = require('../controllers/controllerTown24h');
var cTown24h = new ControllerTown24h();

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

var kmaTimeLib = require('../lib/kmaTimeLib');

describe('unit test - controller town', function() {

    it('test _getShortestTimeValue ', function() {
        var date = new Date();
        var ret = cTown._getShortestTimeValue(date.getTimezoneOffset()/60*-1);
        var today = kmaTimeLib.convertDateToYYYYMMDD(date);
        assert.equal(ret.date, today, 'Fail get time value');
    });

    it('test _getCurrentTimeValue', function () {
        var date = new Date();
        var ret = cTown._getCurrentTimeValue(date.getTimezoneOffset()/60*-1);
        var today = kmaTimeLib.convertDateToYYYYMMDD(date);
        assert.equal(ret.date, today, 'Fail get time value');
    });

    it('test _min', function () {
        var min = cTown._min([3,4,6,7], 3);
        assert.equal(min, 4, 'Fail to get min') ;
    });

    it('test _max', function () {
        var min = cTown._max([3,4,6,7], 7);
        assert.equal(min, 6, 'Fail to get max') ;
    });

    it('test _sum', function () {
        var sum = cTown._sum([3,7,10], 10);
        assert.equal(sum, 10, 'Fail to sum');
    });

    it('test _average', function () {
        var avg = cTown._average([10,10, 5], 5);
        assert.equal(avg, 10, 'Fail to average');
    });

    it('test _mergeList', function () {
        var list = [{date:'20160322', a:1, b:2}, {date:'20160808', c:3, d:4}];
        cTown._mergeList(list, [{date:'20160808', e:5}, {date:'20160909', f:7}]);
        assert(list, [ { date: '20160322', a: 1, b: 2 },
                        { date: '20160808', c: 3, d: 4, e: 5 },
                        { date: '20160909', f: 7 } ], 'Fail to merge list');
    });
});

