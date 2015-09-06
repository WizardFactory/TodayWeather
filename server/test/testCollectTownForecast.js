/**
 * Created by Peter on 2015. 8. 4..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
var keydata = require('../config/keydata');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');
var convert = require('../utils/coordinate2xy');
var fs = require('fs');


global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - get town forecast in lib/collect class', function() {
    var ramMode = require('../controllers/controllerManagerRAM');
    it('test ram mode for DB', function(done){
        var mainLoop = new ramMode();

        done();
    })

});

describe('unit test - get town forecast in lib/collect class', function(){

    var listTown = [];
    var listIndex = 0;

/*
    it('get xy list', function(){
        var lineList = fs.readFileSync('./utils/data/base.csv').toString().split('\n');
        lineList.shift(); //  header remove

        //for( ; lineList.length ; ){
        for(var i = 0 ; i < 500 ; i++){
            var item = lineList.shift();
            var townname = {a:'', b:'', c:''};
            var tempCoord = {lon:0, lat:0};

            item.split(',').forEach(function (entry, i) {
                if(i == 0) townname.a = entry;
                else if(i == 1) townname.b = entry;
                else if(i == 2) townname.c = entry;
                else if(i == 3) tempCoord.lat = entry;
                else if(i == 4) tempCoord.lon = entry;

                if (tempCoord.lon != 0 && tempCoord.lat != 0) {
                    if(townname.a !== '경기도' || townname.b !== '성남시분당구' || (townname.c !== '수내3동' && townname.c !== '야탑3동' && townname.c !== '야탑1동')){
                        return;
                    }
                    var conv = new convert(tempCoord, {}).toLocation();
                    listTown[listIndex] = {x: conv.getLocation().x, y: conv.getLocation().y};

                    listIndex++;
                    tempCoord.lon = 0;
                    tempCoord.lat = 0;
                    townname = {a:'', b:'', c:''};
                }
            });
        }
        log.info(listTown);
    });
*/
    /*
    it('lib/collect : get towns SHORT info by using XY list', function(done){
        //var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];
        var listXY = listTown;

        var collection = new collect();
        assert.doesNotThrow(function(){
            //collection.getTownData(listXY, collection.DATA_TYPE.TOWN_SHORT, keyString, '20150815', '0500', function(err, dataList){
            collection.requestData(listXY, collection.DATA_TYPE.TOWN_SHORT, keydata.keyString.aleckim, '20150828', '0200', function(err, dataList){
                log.info('short data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                for(var i in dataList){
                    for(var j in dataList[i].data){
                        log.info(dataList[i].data[j]);
                    }
                }


                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');

                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');

                done();
            });
        });
    });
*/
/*
    it('lib/collect : get towns SHORTEST info by using XY list', function(done){
        //var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];
        var listXY = listTown;

        var collection = new collect();
        assert.doesNotThrow(function(){
            collection.requestData(listXY, collection.DATA_TYPE.TOWN_SHORTEST, keydata.keyString.sooyeon, '20150830', '1430', function(err, dataList){
                log.info('shortest data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                for(var i in dataList){
                    for(var j in dataList[i].data){
                        log.info(dataList[i].data[j]);
                    }
                }

                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');

                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');

                done();
            });
        });
    });
*/
/*
    it('lib/collect : get towns CURRENT info by using XY list', function(done){
        //var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];
        var listXY = listTown;

        var collection = new collect();
        assert.doesNotThrow(function(){
            collection.requestData(listXY, collection.DATA_TYPE.TOWN_CURRENT, keydata.keyString.hyunsoo, '20150831', '0300', function(err, dataList){
                log.info('current data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                for(var i in dataList){
                    for(var j in dataList[i].data){
                        log.info(dataList[i].data[j]);
                    }
                }

                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');

                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');

                done();
            });
        });
    });
*/
});

describe('unit test - get middle range forecast in lib/collect class', function() {
/*
    it('lib/collect : get Middle range forecast info by using XY list', function(done){
        var collection = new collect();
        assert.doesNotThrow(function(){
            collection.requestData(collection.listPointNumber, collection.DATA_TYPE.MID_FORECAST, keydata.keyString.pokers11, '20150823', '0600', function(err, dataList){
                log.info('current data receive completed : %d\n', dataList.length);

                log.info(dataList);
                //log.info(dataList[0]);
                for(var i in dataList){
                    for(var j in dataList[i].data){
                        log.info(dataList[i].data[j]);
                    }
                }

                done();
            });
        });
    });
*/
/*
    it('lib/collect : get Middle range LAND info by using XY list', function(done){

        var collection = new collect();
        assert.doesNotThrow(function(){
            collection.requestData(collection.listAreaCode, collection.DATA_TYPE.MID_LAND, keydata.keyString.pokers11, '20150822', '0600', function(err, dataList){
                log.info('current data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i in dataList){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                done();
            });
        });
    });
*/
/*
    it('lib/collect : get Middle range TEMP info by using XY list', function(done){

        var collection = new collect();
        assert.doesNotThrow(function(){
            collection.requestData(collection.listCityCode, collection.DATA_TYPE.MID_TEMP, keydata.keyString.pokers11, '20150822', '0600', function(err, dataList){
                log.info('current data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i in dataList){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                done();
            });
        });
    });
*/
/*
    it('lib/collect : get Middle range SEA info by using XY list', function(done){

        var collection = new collect();
        assert.doesNotThrow(function(){
            collection.requestData(collection.listSeaCode, collection.DATA_TYPE.MID_SEA, keydata.keyString.pokers11, '20150822', '0600', function(err, dataList){
                log.info('current data receive completed : %d\n', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i in dataList){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                done();
            });
        });
    });
*/
});