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

    it('test convertMidKorStrToSkyInfo', function (done) {
        var req = {};
        req.params = {};
        req.params.region = "seoul";
        req.params.city = "kangnam";
        req.midData = {};
        req.midData.dailyData = [];
        req.midData.dailyData.push({wfAm: "구름많음", wfPm: "흐리고 비"});
        req.midData.dailyData.push({wfAm: "흐리고 비", wfPm: "맑음"});
        req.midData.dailyData.push({wfAm: "구름조금", wfPm: "맑음"});
        req.midData.dailyData.push({wfAm: "흐리고 비", wfPm: "구름적고 눈"});
        req.midData.dailyData.push({wfPm: "흐리고 비", wfAm: "구름적고 눈"});
        req.midData.dailyData.push({wfAm: "흐리고 비/눈", wfPm: "구름적고 눈"});
        req.midData.dailyData.push({wfAm: "흐리고 비/눈", wfPm: "구름적고 눈/비"});
        req.midData.dailyData.push({wfAm: "흐리고 비", wfPm: "구름적고 눈/비"});
        req.midData.dailyData.push({wfAm: "흐리고 눈", wfPm: "맑음"});
        req.midData.dailyData.push({wfAm: "흐리고 눈/비", wfPm: "맑음"});
        req.midData.dailyData.push({wfPm: "흐리고 눈/비", wfAm: "맑음"});

        var next = function () {
            console.log(req.midData.dailyData);
            done();
        };
        cTown.convertMidKorStrToSkyInfo(req, {}, next);
    });

    var current = {
        date : '20171119',
        time : '0500',
        liveTime : '0500',
        t1h: 22.5,
        rn1: 1,
        sky: 1,
        uuu: 1,
        vvv: 1,
        reh: 30,
        pty: 2,
        lgt: 1,
        vec: 0,
        wsd: 0
    };

    it('test update current from stn weather', function() {
        var current1 = {
            date : '20171119',
            time : '0500',
            t1h: 10,
            rn1: 1,
            sky: 1,
            uuu: 1,
            vvv: 1,
            reh: 30,
            pty: 2,
            lgt: 1,
            vec: 0,
            wsd: 0
        };

        var currentList = [];
        currentList.push(current1);
        cTown._updateCurrentFromMinWeather(currentList, current);
        assert.equal(currentList[0].t1h, current.t1h);
        console.log(currentList);
    });

    it('test add current from stn weather', function() {
        var current1 = {
            date : '20171119',
            time : '0400',
            t1h: 10,
            rn1: 1,
            sky: 1,
            uuu: 1,
            vvv: 1,
            reh: 30,
            pty: 2,
            lgt: 1,
            vec: 0,
            wsd: 0
        };

        var currentList = [];
        currentList.push(current1);
        cTown._updateCurrentFromMinWeather(currentList, current);
        assert.equal(currentList[0].t1h, current1.t1h);
        assert.equal(currentList[1].t1h, current.t1h);
        console.log(currentList);
    });
});

