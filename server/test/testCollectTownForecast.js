/**
 * Created by Peter on 2015. 8. 4..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
var keydata = require('../config/config');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');
var convert = require('../utils/coordinate2xy');
var fs = require('fs');
var convertGeocode = require('../utils/convertGeocode');

global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - get town forecast in lib/collect class', function(){

    var listTown = [];
    var listIndex = 0;

    //it('get xy list', function(){
    //    var lineList = fs.readFileSync('./utils/data/base.csv').toString().split('\n');
    //    lineList.shift(); //  header remove
    //
    //    //for( ; lineList.length ; ){
    //    for(var i = 0 ; i < 500 ; i++){
    //        var item = lineList.shift();
    //        var townname = {a:'', b:'', c:''};
    //        var tempCoord = {lon:0, lat:0};
    //
    //        item.split(',').forEach(function (entry, i) {
    //            if(i == 0) townname.a = entry;
    //            else if(i == 1) townname.b = entry;
    //            else if(i == 2) townname.c = entry;
    //            else if(i == 3) tempCoord.lat = entry;
    //            else if(i == 4) tempCoord.lon = entry;
    //
    //            if (tempCoord.lon != 0 && tempCoord.lat != 0) {
    //                if(townname.a !== '경기도' || townname.b !== '성남시분당구' || (townname.c !== '수내3동' && townname.c !== '야탑3동' && townname.c !== '야탑1동')){
    //                    return;
    //                }
    //                var conv = new convert(tempCoord, {}).toLocation();
    //                listTown[listIndex] = {x: conv.getLocation().x, y: conv.getLocation().y};
    //
    //                listIndex++;
    //                tempCoord.lon = 0;
    //                tempCoord.lat = 0;
    //                townname = {a:'', b:'', c:''};
    //            }
    //        });
    //    }
    //    log.info(listTown);
    //});

    //it('lib/collect : get towns SHORT info by using XY list', function(done){
    //    //var listXY = [{mx:91, my:131}, {mx:91, my:132}, {mx:94, my:131}];
    //    var listXY = [{mx:91, my:131}];
    //    //var listXY = listTown;
    //
    //    var collection = new collect();
    //    assert.doesNotThrow(function(){
    //        //collection.getTownData(listXY, collection.DATA_TYPE.TOWN_SHORT, keyString, '20150815', '0500', function(err, dataList){
    //        collection.requestData(listXY, collection.DATA_TYPE.TOWN_SHORT, keydata.keyString.test_cert, '20151229', '1400', function(err, dataList){
    //            if (err) {
    //                log.error(err);
    //                return;
    //            }
    //            log.info('short data receive completed : %d\n', dataList.length);
    //
    //            for(var i in dataList) {
    //                for (var j in dataList[i].data) {
    //                    log.info(dataList[i].data[j]);
    //                }
    //            }
    //
    //            assert.equal(dataList.length, listXY.length, 'check receive count');
    //
    //            assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
    //            //assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
    //            //assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');
    //
    //            assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
    //            //assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
    //            //assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');
    //
    //            done();
    //        });
    //    });
    //});

    //it('lib/collect : get towns SHORTEST info by using XY list', function(done) {
    //    this.timeout(10*1000);
    //    var listXY = [{mx: 91, my: 131}, {mx: 91, my: 132}, {mx: 94, my: 131}];
    //    //var listXY = listTown;
    //
    //    var collection = new collect();
    //    assert.doesNotThrow(function () {
    //        collection.requestData(listXY, collection.DATA_TYPE.TOWN_SHORTEST, keydata.keyString.normal, '20151222', '1930',
    //                    function (err, dataList)
    //        {
    //                log.info('shortest data receive completed : %d\n', dataList.length);
    //
    //                log.info(dataList);
    //                log.info(dataList[0]);
    //                for (var i in dataList) {
    //                    for (var j in dataList[i].data) {
    //                        log.info(dataList[i].data[j]);
    //                    }
    //                }
    //
    //                assert.equal(dataList.length, listXY.length, 'check receive count');
    //
    //                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
    //                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
    //                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');
    //
    //                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
    //                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
    //                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');
    //
    //                done();
    //        });
    //    });
    //});

    //it('lib/collect : get towns CURRENT info by using XY list', function(done){
    //    var listXY = [{mx:91, my:131}, {mx:91, my:132}, {mx:94, my:131}];
    //    //var listXY = listTown;
    //
    //    var collection = new collect();
    //    assert.doesNotThrow(function(){
    //        collection.requestData(listXY, collection.DATA_TYPE.TOWN_CURRENT, keydata.keyString.test_cert, '20151229', '1600', function(err, dataList){
    //            log.info('current data receive completed : %d\n', dataList.length);
    //
    //            //log.info(dataList);
    //            //log.info(dataList[0]);
    //            for(var i in dataList){
    //                for(var j in dataList[i].data){
    //                    log.info(dataList[i].data[j]);
    //                }
    //            }
    //
    //            assert.equal(dataList.length, listXY.length, 'check receive count');
    //
    //            assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
    //            assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
    //            assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');
    //
    //            assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
    //            assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
    //            assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');
    //
    //            done();
    //        });
    //    });
    //});
});

describe('unit test - get middle range forecast in lib/collect class', function() {

    //it('lib/collect : get Middle range forecast info by using XY list', function(done){
    //    var collection = new collect();
    //    assert.doesNotThrow(function(){
    //        collection.requestData(collection.listPointNumber, collection.DATA_TYPE.MID_FORECAST, keydata.keyString.normal, '20151225', '0600', function(err, dataList){
    //            log.info('current data receive completed : %d\n', dataList.length);
    //
    //            log.info(dataList);
    //            //log.info(dataList[0]);
    //            for(var i in dataList){
    //                for(var j in dataList[i].data){
    //                    log.info(dataList[i].data[j]);
    //                }
    //            }
    //
    //            done();
    //        });
    //    });
    //});

    //it('lib/collect : get Middle range LAND info by using XY list', function(done){
    //    this.timeout(10*1000);
    //    var collection = new collect();
    //    assert.doesNotThrow(function(){
    //        collection.requestData(collection.listAreaCode, collection.DATA_TYPE.MID_LAND, keydata.keyString.test_cert, '20150926', '0600', function(err, dataList){
    //            log.info('current data receive completed : %d\n', dataList.length);
    //
    //            //log.info(dataList);
    //            //log.info(dataList[0]);
    //            for(var i in dataList){
    //                for(var j in dataList[i].data){
    //                    log.info(dataList[i].data[j]);
    //                }
    //            }
    //
    //            done();
    //        });
    //    });
    //});

    //it('lib/collect : get Middle range TEMP info by using XY list', function(done){
    //
    //    var collection = new collect();
    //    assert.doesNotThrow(function(){
    //        collection.requestData(collection.listCityCode, collection.DATA_TYPE.MID_TEMP, keydata.keyString.pokers, '20150926', '0600', function(err, dataList){
    //            log.info('current data receive completed : %d\n', dataList.length);
    //
    //            //log.info(dataList);
    //            //log.info(dataList[0]);
    //            for(var i in dataList){
    //                for(var j in dataList[i].data){
    //                    log.info(dataList[i].data[j]);
    //                }
    //            }
    //
    //            done();
    //        });
    //    });
    //});

    //it('lib/collect : get Middle range SEA info by using XY list', function(done){
    //
    //    var collection = new collect();
    //    assert.doesNotThrow(function(){
    //        collection.requestData(collection.listSeaCode, collection.DATA_TYPE.MID_SEA, keydata.keyString.pokers, '20150926', '0600', function(err, dataList){
    //            log.info('current data receive completed : %d\n', dataList.length);
    //
    //            //log.info(dataList);
    //            //log.info(dataList[0]);
    //            for(var i in dataList){
    //                for(var j in dataList[i].data){
    //                    log.info(dataList[i].data[j]);
    //                }
    //            }
    //
    //            done();
    //        });
    //    });
    //});

});

describe('unit test - test geocode ', function() {
    //it('utils/convertGeocode : test to get gegcode properly', function(done){
    //    var first = '경기도';
    //    var second = '성남시';
    //    var third = '수내3동';
    //
    //    convertGeocode(first, second, third, function(err, result){
    //        if(err) {
    //            log.error('failed to get geocode');
    //            done();
    //            return;
    //        }
    //
    //        log.info(result);
    //
    //        done();
    //    });
    //});
});
