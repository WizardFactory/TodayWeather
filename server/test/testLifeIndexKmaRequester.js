/**
 *
 * Created by aleckim on 2015. 10. 18..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var config = require('../config/config');
var LifeIndexKmaRequester  = require('../lib/lifeIndexKmaRequester');

describe('unit test - requester of kma index service class', function() {
    var reqLifeIndex;

    it('create Controller Kma Index Service', function() {
        reqLifeIndex = new LifeIndexKmaRequester();
        reqLifeIndex._areaList.push({
            town: {first: "서울특별시", second: "", third: ""},
            mCoord: {mx: 0, my: 0},
            gCoord: {lat: 37.5636, lon: 126.98},
            areaNo: "1100000000"
        });
        reqLifeIndex._areaList.push({
            town: {first: "부산광역시", second: "", third: ""},
            mCoord: {mx: 0, my: 0},
            gCoord: {lat: 35.177, lon: 129.077},
            areaNo: "2600000000"
        });
        reqLifeIndex._areaList.push({
            town: {first: "대구광역시", second: "", third: ""},
            mCoord: {mx: 0, my: 0},
            gCoord: {lat: 35.8685, lon: 128.6036},
            areaNo: "2700000000"
        });
        assert.equal(reqLifeIndex.fsn.nextTime, null, 'check object created');
    });

    it('set time to get fsn life list', function() {
        var time = new Date();
        reqLifeIndex.setNextGetTime('fsn', time);
        assert.equal(reqLifeIndex.fsn.nextTime, time, 'check next get fsn list list time');
    });

    it('set next time to get fsn life list', function() {
        var time = new Date(2015, 10, 18, 9);
        reqLifeIndex.setNextGetTime('fsn', time);
        time.setHours(10);
        time.setMinutes(10);
        assert.equal(reqLifeIndex.fsn.nextTime, time, 'check next get fsn list list time');

        time = new Date(2015, 10, 18, 10, 20);
        reqLifeIndex.setNextGetTime('fsn', time);
        time.setHours(22);
        time.setMinutes(10);
        assert.equal(reqLifeIndex.fsn.nextTime, time, 'check next get fsn list list time');

        time = new Date(2015, 10, 18, 22, 20);
        reqLifeIndex.setNextGetTime('fsn', time);
        time.setDate(time.getDate()+1);
        time.setHours(10);
        time.setMinutes(10);
        assert.equal(reqLifeIndex.fsn.nextTime, time, 'check next get fsn list list time');
    });

    it('get url to get fsn life list', function () {
        reqLifeIndex.setServiceKey(config.keyString.test_cert);
        var url = reqLifeIndex.getUrl('fsn', 1111051500);
        assert.equal(url, url, 'check next get fsn list list time');
    });

    var fsn;
    it('parse fsn life data', function() {
        var data1 = {"Response":{"header":{"successYN":"Y","returnCode":"00","errMsg":""},"body":{"@xsi.type":"idxBody",
                    "indexModel":{"code":"A01_2","areaNo":1100000000,"date":2015102018,"today":48,"tomorrow":51,
                        "theDayAfterTomorrow":51}}}};
        var result1 = reqLifeIndex.parseLifeIndex('fsn', data1);

        //console.log(result1.data.fsn);
        assert.equal(result1.data.fsn.data[0].value, data1.Response.body.indexModel.today, 'compare parsed data1 of fsn');

        var data2 = {"Response":{"header":{"successYN":"Y","returnCode":"00","errMsg":""},"body":{"@xsi.type":"idxBody",
                    "indexModel":{"code":"A01_2","areaNo":2700000000,"date":2015102018,"today":"","tomorrow":50,
                        "theDayAfterTomorrow":48}}}};
        var result2 = reqLifeIndex.parseLifeIndex('fsn', data2);
        fsn = result2.data.fsn;
        assert.equal(result2.data.fsn.data[0].value, data2.Response.body.indexModel.tomorrow, 'compare parsed data2 of fsn');
    });

    it('make new life index kma', function () {
        var LifeIndexKma = require('../models/lifeIndexKma');
        var kmaIndex = new LifeIndexKma({town: {first: 'a', second: 'b', third: 'c'}, mCoord: {mx:125, my:77},
                                        areaNo: '2700000000',
                                        fsn: fsn});
        assert.equal(kmaIndex.fsn.lastUpdateDate, fsn.lastUpdateDate, 'compare fsn');
    });

    it('update or add fsn data ', function () {
        var newFsn = fsn;
        newFsn.data[1].value = 51;
        newFsn.data.push({date: '20151023', value: 66});
        reqLifeIndex.updateOrAddLifeIndex(fsn, newFsn);
        //console.log(fsn);
        assert.equal(fsn.data[2].value, newFsn.data[2].value, 'compare new value of data');
    });

    it('set get time at first', function () {
        var date = new Date();
        reqLifeIndex.setNextGetTime('ultrv', date);
        assert.equal(reqLifeIndex['ultrv'].nextTime, date, '');
    });

    it('set next get time', function () {
        reqLifeIndex.setNextGetTime('ultrv');
    });

    it('check time of all', function () {
        var isGo = reqLifeIndex.checkGetTime('ultrv', new Date());
        assert.equal(isGo, false, '');
    });

    it ('get url', function() {
        var url = reqLifeIndex.getUrl('ultrv', '1100000000');
        var result = 'http://203.247.66.146/iros/RetrieveLifeIndexService/getUltrvLifeList?serviceKey='+
            config.keyString.test_cert+'&AreaNo=1100000000&_type=json';
        assert.equal(url, result, '');

        url = reqLifeIndex.getUrl('fsn', '1100000000');
        result = 'http://203.247.66.146/iros/RetrieveLifeIndexService/getFsnLifeList?serviceKey='+
            config.keyString.test_cert+'&AreaNo=1100000000&_type=json';
        assert.equal(url, result, '');
    });

    //it ('get fsn life index', function (done) {
    //    co.getLifeIndex('fsn', '1100000000', function (err, body) {
    //        assert.equal(body.Response.header.successYN, 'Y', '');
    //        done();
    //    });
    //});
    //
    //it ('get ultrv life index', function (done) {
    //    co.getLifeIndex('ultrv', '1100000000', function (err, body) {
    //        assert.equal(body.Response.header.successYN, 'Y', '');
    //        done();
    //    });
    //});

    it ('parse hourly life index', function () {
        var data = {"Response":{"header":{"successYN":"Y","returnCode":"00","errMsg":""},"body":{"@xsi.type":"idxBody",
            "indexModel":{"code":"A02","areaNo":5013062000,"date":2015103018,
            "h3":0,"h6":0,"h9":0,"h12":0,"h15":0,"h18":0,"h21":0,"h24":0,"h27":0,"h30":0,"h33":0,"h36":0,"h39":0,"h42":0,
            "h45":0,"h48":1,"h51":3,"h54":3,"h57":"","h60":"","h63":"","h66":""}}}};

        var result = reqLifeIndex.parseLifeIndex('rot', data);

        assert.equal(result.data.rot.data[0].time, '2100', '');
    });

    it ('parse daily life index', function () {
        var data = {"Response":{"header":{"successYN":"Y","returnCode":"00",
                    "errMsg":""},"body":{"@xsi.type":"idxBody",
                    "indexModel":{"code":"A07","areaNo":1100000000,"date":2015102819,
                        "today":"","tomorrow":2,"theDayAfterTomorrow":3}}}};
        var result = reqLifeIndex.parseLifeIndex('ultrv', data);

        assert.equal(result.data.ultrv.data[0].date, '20151029', '');
    });

    it ('parse daily life index 2', function () {
        var data = {"Response": {
            "header": {"successYN":"Y","returnCode":"00","errMsg":""},
            "body":{
                "indexModels":[
                    {"code":"A01_2","areaNo":"1100000000","date":"2018020106",
                        "today":"56","tomorrow":"53","theDayAfterTomorrow":"55"},
                    {"code":"A01_2","areaNo":"1111000000","date":"2018020106",
                        "today":"56","tomorrow":"53","theDayAfterTomorrow":"55"},
                    {"code":"A01_2","areaNo":"1111051500","date":"2018020106",
                        "today":"56","tomorrow":"53","theDayAfterTomorrow":"55"},
                    {"code":"A01_2","areaNo":"5019099000","date":"2018020106",
                        "today":"58","tomorrow":"57","theDayAfterTomorrow":"55"}]}}};
        var results = reqLifeIndex.parseLifeIndex2('fsn', data);
        console.log(JSON.stringify(results));
    });

    it ('update or add life index', function () {
        var ultraIndex = { lastUpdateDate: '2015102819', data: []};
        var data = { data: [{ date: '20151029', value: 2}, { date: '20151030', value: 3}],
                    lastUpdateDate: '2015102819' };

        var result = reqLifeIndex.updateOrAddLifeIndex(ultraIndex, data);
        ultraIndex.data = data.data;
        assert.equal(result, ultraIndex, '');
    });

    //it('update Life Index Db From Towns', function (done) {
    //    this.timeout(30*1000);
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //            done();
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    reqLifeIndex.updateLifeIndexDbFromTowns(function (err, results) {
    //        if (err) {
    //            log.error(err.toString());
    //            return done();
    //        }
    //        log.info(JSON.stringify(results));
    //        done();
    //    });
    //});

    //it ('get LifeIndex By Town', function (done) {
    //    this.timeout(10*1000);
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //            done();
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var town = {third: '구미동', second: '성남시분당구', first: '경기도'};
    //    reqLifeIndex.getLifeIndexByTown(town, function(err, data) {
    //        if (err) console.log(err);
    //        console.log(data);
    //        //console.log(data.rot.data);
    //        done();
    //    });
    //});

    //it ('save life index', function (done) {
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //            done();
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //        done();
    //    });
    //
    //    var newData = { error: undefined, result: { areaNo: '1100000000',
    //                ultrv: { lastUpdateDate: '2015102819', data: [ { date: '20151029',
    //                    value: 2 }, { date: '20151030', value: 3 } ] } } };
    //    var townObject = co._areaList[0];
    //
    //    co.saveLifeIndex('ultrv', townObject, newData.result, function (err) {
    //        console.log(err);
    //        done();
    //    });
    //});

    //it('test db', function (done) {
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //        process.exit(-1);
    //    });
    //
    //    var Town = require('../models/town');
    //    //Town.find({"mCoord": {"my":119, "mx":95}}, function(err, townList) {
    //    Town.find({"areaNo": "99"}, function(err, townList) {
    //        if (townList.length === 0) {
    //            var town = new Town({town:{first: "a", second:"b", third:"c"}, areaNo: "99"});
    //            town.save(function (err) {
    //              console.log(err);
    //            });
    //            console.log("XXXXX");
    //        }
    //        console.log(townList);
    //    });
    //});

    //it('test update lifeindex db from towns', function (done) {
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //        process.exit(-1);
    //    });
    //
    //    reqLifeIndex = new LifeIndexKmaRequester();
    //    reqLifeIndex.updateLifeIndexDbFromTowns(function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        log.info('Finish updating life index db from towns');
    //        log.info(results);
    //        done();
    //    });
    //});
});

