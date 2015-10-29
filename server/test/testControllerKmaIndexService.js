/**
 *
 * Created by aleckim on 2015. 10. 18..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var ControllerKmaIndexService  = require('../controllers/controllerKmaIndexService');

describe('unit test - controller kma index service class', function() {
    var co;

    it('create Controller Kma Index Service', function() {
        co = new ControllerKmaIndexService();
        co._areaList.push({
            town: {first: "서울특별시", second: "", third: ""},
            mCoord: {mx: 0, my: 0},
            gCoord: {lat: 37.5636, lon: 126.98},
            areaNo: "1100000000"
        });
        co._areaList.push({
            town: {first: "부산광역시", second: "", third: ""},
            mCoord: {mx: 0, my: 0},
            gCoord: {lat: 35.177, lon: 129.077},
            areaNo: "2600000000"
        });
        co._areaList.push({
            town: {first: "대구광역시", second: "", third: ""},
            mCoord: {mx: 0, my: 0},
            gCoord: {lat: 35.8685, lon: 128.6036},
            areaNo: "2700000000"
        });
        assert.equal(co.fsn.nextTime, null, 'check object created');
    });

    it('set time to get fsn life list', function() {
        var time = new Date();
        co.setNextGetTime('fsn', time);
        assert.equal(co.fsn.nextTime, time, 'check next get fsn list list time');
    });

    it('set next time to get fsn life list', function() {
        var time = new Date(2015, 10, 18, 9);
        co.setNextGetTime('fsn', time);
        time.setHours(10);
        time.setMinutes(10);
        assert.equal(co.fsn.nextTime, time, 'check next get fsn list list time');

        time = new Date(2015, 10, 18, 10, 20);
        co.setNextGetTime('fsn', time);
        time.setHours(22);
        time.setMinutes(10);
        assert.equal(co.fsn.nextTime, time, 'check next get fsn list list time');

        time = new Date(2015, 10, 18, 22, 20);
        co.setNextGetTime('fsn', time);
        time.setDate(time.getDate()+1);
        time.setHours(10);
        time.setMinutes(10);
        assert.equal(co.fsn.nextTime, time, 'check next get fsn list list time');
    });

    it('get url to get fsn life list', function () {
        co.setServiceKey('pJgU9WpeXT9jnlUhdZftdPk53BA68c4inIUi4ycJe4iNHH9F%2FPS1pchRtnCa%2BSBLwlVt%2FrHwb44YC4ksQWcdEg%3D%3D');
        var url = co.getUrl('fsn', 1111051500);
        assert.equal(url, url, 'check next get fsn list list time');
    });

    var fsn;
    it('parse fsn life data', function() {
        var data1 = {"Response":{"Header":{"SuccessYN":"Y","ReturnCode":"00","ErrMsg":""},"Body":{"@xsi.type":"idxBody",
                    "IndexModel":{"code":"A01_2","areaNo":1100000000,"date":2015102018,"today":48,"tomorrow":51,
                        "theDayAfterTomorrow":51}}}};
        var result1 = co.parseLifeIndex('fsn', data1);

        //console.log(result1.data.fsn);
        assert.equal(result1.data.fsn.data[0].value, data1.Response.Body.IndexModel.today, 'compare parsed data1 of fsn');

        var data2 = {"Response":{"Header":{"SuccessYN":"Y","ReturnCode":"00","ErrMsg":""},"Body":{"@xsi.type":"idxBody",
                    "IndexModel":{"code":"A01_2","areaNo":2700000000,"date":2015102018,"today":"","tomorrow":50,
                        "theDayAfterTomorrow":48}}}};
        var result2 = co.parseLifeIndex('fsn', data2);
        fsn = result2.data.fsn;
        assert.equal(result2.data.fsn.data[0].value, data2.Response.Body.IndexModel.tomorrow, 'compare parsed data2 of fsn');
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
        co.updateOrAddLifeIndex(fsn, newFsn);
        //console.log(fsn);
        assert.equal(fsn.data[2].value, newFsn.data[2].value, 'compare new value of data');
    });

    it('set get time at first', function () {
        var date = new Date();
        co.setNextGetTime('ultrv', date);
        assert.equal(co['ultrv'].nextTime, date, '');
    });

    it('set next get time', function () {
        co.setNextGetTime('ultrv');
    });

    it('check time of all', function () {
        var isGo = co.checkGetTime('ultrv', new Date());
        assert.equal(isGo, false, '');
    });

    it ('get url', function() {
        var url = co.getUrl('ultrv', '1100000000');
        var result = 'http://203.247.66.146/iros/RetrieveLifeIndexService/getUltrvLifeList?serviceKey=pJgU9WpeXT9jnlUhdZftdPk53BA68c4inIUi4ycJe4iNHH9F%2FPS1pchRtnCa%2BSBLwlVt%2FrHwb44YC4ksQWcdEg%3D%3D&AreaNo=1100000000&_type=json';
        assert.equal(url, result, '');

        url = co.getUrl('fsn', '1100000000');
        result = 'http://203.247.66.146/iros/RetrieveLifeIndexService/getFsnLifeList?serviceKey=pJgU9WpeXT9jnlUhdZftdPk53BA68c4inIUi4ycJe4iNHH9F%2FPS1pchRtnCa%2BSBLwlVt%2FrHwb44YC4ksQWcdEg%3D%3D&AreaNo=1100000000&_type=json';
        assert.equal(url, result, '');
    });

    //it ('get fsn life index', function (done) {
    //    co.getLifeIndex('fsn', '1100000000', function (err, body) {
    //        assert.equal(body.Response.Header.SuccessYN, 'Y', '');
    //        done();
    //    });
    //});
    //
    //it ('get ultrv life index', function (done) {
    //    co.getLifeIndex('ultrv', '1100000000', function (err, body) {
    //        assert.equal(body.Response.Header.SuccessYN, 'Y', '');
    //        done();
    //    });
    //});

    it ('parse life index', function () {
        var data = {"Response":{"Header":{"SuccessYN":"Y","ReturnCode":"00",
                    "ErrMsg":""},"Body":{"@xsi.type":"idxBody",
                    "IndexModel":{"code":"A07","areaNo":1100000000,"date":2015102819,
                        "today":"","tomorrow":2,"theDayAfterTomorrow":3}}}};
        var result = co.parseLifeIndex('ultrv', data);

        assert.equal(result.data.ultrv.data[0].date, '20151029', '');
    });

    it ('update or add life index', function () {
        var ultraIndex = { lastUpdateDate: '2015102819', data: []};
        var data = { data: [{ date: '20151029', value: 2}, { date: '20151030', value: 3}],
                    lastUpdateDate: '2015102819' };

        var result = co.updateOrAddLifeIndex(ultraIndex, data);
        ultraIndex.data = data.data;
        assert.equal(result, ultraIndex, '');
    });

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

    //it('get data from provider', function (done) {
    //    co._areaIndexGetFsn = co._areaList.length - 2;
    //    co.recursiveGetFsnLifeList(co._areaList, co._areaIndexGetFsn, function (err, index, body) {
    //        var  data = JSON.parse(body);
    //        assert.equal(data.Response.Header.SuccessYN, "Y", 'compare data of fsn life');
    //        if (index === co._areaList.length-1) {
    //           done();
    //        }
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
});

