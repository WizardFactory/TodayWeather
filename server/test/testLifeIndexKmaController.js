/**
 * Created by aleckim on 2015. 10. 30..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var LifeIndexController = require('../controllers/lifeIndexKmaController');

describe('unit test - requester of kma index service class', function() {

    it ('test _addIndexDataToMid', function () {
        var fsn = {
            "lastUpdateDate": "2015103006",
            "data": [
                {"date": "20151030", "value": 34},
                {"date": "20151031", "value": 33},
                {"date": "20151101", "value": 34}
            ]};

        var midList = [{"date":"20151023","wfAm":"구름조금","wfPm":"구름조금","taMin":12,"taMax":23},
            {"date":"20151024","wfAm":"구름많고 비","wfPm":"구름많음","taMin":13,"taMax":22},
            {"date":"20151025","wfAm":"구름조금","wfPm":"구름조금","taMin":11,"taMax":21},
            {"date":"20151026","wfAm":"구름많음","wfPm":"구름많음","taMin":11,"taMax":19},
            {"date":"20151027","wfAm":"구름많고 비","wfPm":"구름조금","taMin":12,"taMax":17},
            {"date":"20151028","wfAm":"구름조금","wfPm":"구름많음","taMin":7,"taMax":15},
            {"date":"20151029","wfAm":"구름많음","wfPm":"구름많고 비","taMin":6,"taMax":13},
            {"date":"20151030","wfAm":"구름많음","wfPm":"구름조금","taMin":4,"taMax":11},
            {"date":"20151031","wfAm":"구름조금","wfPm":"구름조금","taMin":2,"taMax":12},
            {"date":"20151101","wfAm":"구름많음","wfPm":"구름많음","taMin":3,"taMax":14},
            {"date":"20151102","wfAm":"구름많음","wfPm":"구름많음","taMin":7,"taMax":16},
            {"date":"20151103","wfAm":"맑음","wfPm":"맑음","taMin":7,"taMax":18},
            {"date":"20151104","wfAm":"구름조금","wfPm":"구름많음","taMin":8,"taMax":18},
            {"date":"20151105","wfAm":"구름많음","wfPm":"구름많음","taMin":9,"taMax":18},
            {"date":"20151106","wfAm":"구름많음","wfPm":"구름많고 비","taMin":10,"taMax":17},
            {"date":"20151107","wfAm":"흐리고 비","wfPm":"흐리고 비","taMin":11,"taMax":16},
            {"date":"20151108","wfAm":"구름많음","wfPm":"구름많음","taMin":11,"taMax":15},
            {"date":"20151109","wfAm":"구름많음","wfPm":"구름많음","taMin":11,"taMax":15}];

        var ret = LifeIndexController._addIndexDataToList(midList, fsn.data, 'fsn');

        assert.equal(ret, true, '');

    });

    it ('test _addIndexDataToShort', function () {
        var rot = {
            "lastUpdateDate": "2015103018",
                "data": [{
                "date": "20151030",
                "time": "2100",
                "value": 0,
            }, {
                "date": "20151030",
                "time": "2400",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "0300",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "0600",
                "value": 1,
            }, {
                "date": "20151031",
                "time": "0900",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "1200",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "1500",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "1800",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "2100",
                "value": 0,
            }, {
                "date": "20151031",
                "time": "2400",
                "value": 1,
            }, {
                "date": "20151101",
                "time": "0300",
                "value": 1,
            }, {
                "date": "20151101",
                "time": "0600",
                "value": 1,
            }, {
                "date": "20151101",
                "time": "0900",
                "value": 0,
            }, {
                "date": "20151101",
                "time": "1200",
                "value": 0,
            }, {
                "date": "20151101",
                "time": "1500",
                "value": 0,
            }, {
                "date": "20151101",
                "time": "1800",
                "value": 0,
            }, {
                "date": "20151101",
                "time": "2100",
                "value": 1,
            }, {
                "date": "20151101",
                "time": "2400",
                "value": 1,
            }]
        };

        var shortList = [
            {"date":"20151029","time":"2100", "pop":60,"pty":1,"r06":0,"reh":64,"s06":0,"sky":3,"t3h":8,"tmn":0,"tmx":0},
            {"date":"20151030","time":"0000", "pop":20,"pty":0,"r06":0,"reh":58,"s06":0,"sky":1,"t3h":5,"tmn":0,"tmx":0},
            {"date":"20151030","time":"0300", "pop":10,"pty":0,"r06":0,"reh":72,"s06":0,"sky":1,"t3h":3,"tmn":0,"tmx":0},
            {"date":"20151030","time":"0600", "pop":0,"pty":0,"r06":0,"reh":65,"s06":0,"sky":1,"t3h":3,"tmn":1,"tmx":0},
            {"date":"20151030","time":"0900", "pop":0,"pty":0,"r06":0,"reh":43,"s06":0,"sky":1,"t3h":6,"tmn":0,"tmx":0},
            {"date":"20151030","time":"1200", "pop":0,"pty":0,"r06":0,"reh":30,"s06":0,"sky":2,"t3h":8,"tmn":0,"tmx":0},
            {"date":"20151030","time":"1500","pop":0,"pty":0,"r06":0,"reh":31,"s06":0,"sky":1,"t3h":9,"tmn":0,"tmx":10},
            {"date":"20151030","time":"1800","pop":0,"pty":0,"r06":0,"reh":36,"s06":0,"sky":1,"t3h":7,"tmn":0,"tmx":0},
            {"date":"20151030","time":"2100","pop":0,"pty":0,"r06":0,"reh":47,"s06":0,"sky":1,"t3h":4,"tmn":0,"tmx":0},
            {"date":"20151031","time":"0000","pop":0,"pty":0,"r06":0,"reh":58,"s06":0,"sky":1,"t3h":2,"tmn":0,"tmx":0}
        ];

        var ret = LifeIndexController._addIndexDataToList(shortList, rot.data, 'rot');
        assert.equal(ret, true, '');
    });

    it('test appendData', function(done) {
        var mongoose = require('mongoose');
        mongoose.connect('localhost/todayweather', function(err) {
            if (err) {
                console.error('Could not connect to MongoDB!');
                console.log(err);
                done();
            }
        });
        mongoose.connection.on('error', function(err) {
            console.error('MongoDB connection error: ' + err);
            done();
        });

        var town = {third: '구미동', second: '성남시분당구', first: '경기도'};
        //var town = { "first" : "경기도", "second" : "안성시", "third" : "안성3동"};
        var fsn = {
            "lastUpdateDate": "2015103006",
            "data": [
                {"date": "20151030", "value": 34},
                {"date": "20151031", "value": 33},
                {"date": "20151101", "value": 34}
            ]};

        var shortList;
        var midList;
        //var shortList = [
        //    {"date":"20151029","time":"2100", "pop":60,"pty":1,"r06":0,"reh":64,"s06":0,"sky":3,"t3h":8,"tmn":0,"tmx":0},
        //    {"date":"20151030","time":"0000", "pop":20,"pty":0,"r06":0,"reh":58,"s06":0,"sky":1,"t3h":5,"tmn":0,"tmx":0},
        //    {"date":"20151030","time":"0300", "pop":10,"pty":0,"r06":0,"reh":72,"s06":0,"sky":1,"t3h":3,"tmn":0,"tmx":0},
        //    {"date":"20151030","time":"0600", "pop":0,"pty":0,"r06":0,"reh":65,"s06":0,"sky":1,"t3h":3,"tmn":1,"tmx":0},
        //    {"date":"20151030","time":"0900", "pop":0,"pty":0,"r06":0,"reh":43,"s06":0,"sky":1,"t3h":6,"tmn":0,"tmx":0},
        //    {"date":"20151030","time":"1200", "pop":0,"pty":0,"r06":0,"reh":30,"s06":0,"sky":2,"t3h":8,"tmn":0,"tmx":0},
        //    {"date":"20151030","time":"1500","pop":0,"pty":0,"r06":0,"reh":31,"s06":0,"sky":1,"t3h":9,"tmn":0,"tmx":10},
        //    {"date":"20151030","time":"1800","pop":0,"pty":0,"r06":0,"reh":36,"s06":0,"sky":1,"t3h":7,"tmn":0,"tmx":0},
        //    {"date":"20151030","time":"2100","pop":0,"pty":0,"r06":0,"reh":47,"s06":0,"sky":1,"t3h":4,"tmn":0,"tmx":0},
        //    {"date":"20151031","time":"0000","pop":0,"pty":0,"r06":0,"reh":58,"s06":0,"sky":1,"t3h":2,"tmn":0,"tmx":0}
        //];
        //
        //var midList = [{"date":"20151023","wfAm":"구름조금","wfPm":"구름조금","taMin":12,"taMax":23},
        //            {"date":"20151024","wfAm":"구름많고 비","wfPm":"구름많음","taMin":13,"taMax":22},
        //            {"date":"20151025","wfAm":"구름조금","wfPm":"구름조금","taMin":11,"taMax":21},
        //            {"date":"20151026","wfAm":"구름많음","wfPm":"구름많음","taMin":11,"taMax":19},
        //            {"date":"20151027","wfAm":"구름많고 비","wfPm":"구름조금","taMin":12,"taMax":17},
        //            {"date":"20151028","wfAm":"구름조금","wfPm":"구름많음","taMin":7,"taMax":15},
        //            {"date":"20151029","wfAm":"구름많음","wfPm":"구름많고 비","taMin":6,"taMax":13},
        //            {"date":"20151030","wfAm":"구름많음","wfPm":"구름조금","taMin":4,"taMax":11},
        //            {"date":"20151031","wfAm":"구름조금","wfPm":"구름조금","taMin":2,"taMax":12},
        //            {"date":"20151101","wfAm":"구름많음","wfPm":"구름많음","taMin":3,"taMax":14},
        //            {"date":"20151102","wfAm":"구름많음","wfPm":"구름많음","taMin":7,"taMax":16},
        //            {"date":"20151103","wfAm":"맑음","wfPm":"맑음","taMin":7,"taMax":18},
        //            {"date":"20151104","wfAm":"구름조금","wfPm":"구름많음","taMin":8,"taMax":18},
        //            {"date":"20151105","wfAm":"구름많음","wfPm":"구름많음","taMin":9,"taMax":18},
        //            {"date":"20151106","wfAm":"구름많음","wfPm":"구름많고 비","taMin":10,"taMax":17},
        //            {"date":"20151107","wfAm":"흐리고 비","wfPm":"흐리고 비","taMin":11,"taMax":16},
        //            {"date":"20151108","wfAm":"구름많음","wfPm":"구름많음","taMin":11,"taMax":15},
        //            {"date":"20151109","wfAm":"구름많음","wfPm":"구름많음","taMin":11,"taMax":15}];

        LifeIndexController.appendData(town, shortList, midList, function (err, data) {
            console.log(err + ' ' + data);
            console.log(shortList);
            done();
        });
    });
});


