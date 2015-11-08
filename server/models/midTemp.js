/**
 * Created by User on 2015-10-23.
 */

'use strict';

var mongoose = require('mongoose');
var current = require('./current');
var modelUtil = require('./modelUtil');

var midTempSchema = mongoose.Schema({
    regId : String,
    midTempData :{
        date: String,
        time: String,
        regId: String,
        taMin3: {type : Number, default : -100},
        taMax3: {type : Number, default : -100},
        taMin4: {type : Number, default : -100},
        taMax4: {type : Number, default : -100},
        taMin5: {type : Number, default : -100},
        taMax5: {type : Number, default : -100},
        taMin6: {type : Number, default : -100},
        taMax6: {type : Number, default : -100},
        taMin7: {type : Number, default : -100},
        taMax7: {type : Number, default : -100},
        taMin8: {type : Number, default : -100},
        taMax8: {type : Number, default : -100},
        taMin9: {type : Number, default : -100},
        taMax9: {type : Number, default : -100},
        taMin10:{type : Number, default : -100},
        taMax10:{type : Number, default : -100}
    }
});

var noTaList = ['date', 'time', 'regId'];
var taList = ['taMin3', 'taMax3', 'taMin4', 'taMax4', 'taMin5', 'taMax5', 'taMin6', 'taMax6',
    'taMin7', 'taMax7', 'taMin8', 'taMax8', 'taMin9', 'taMax9', 'taMin10', 'taMax10'];

midTempSchema.statics = {
    getTempData : function(first, second, cb){
        //var config = require('../config/config');
        //var tempList = config.testTownData[0].data.current
        //var currentList = [];
        //tempList.forEach(function(elem, idx){
        //    var t = {};
        //    t.currentData = elem;
        //    currentList.push(t);
        //});
        var self = this;
        var util = new modelUtil();
        var regId = util.getCode(first, second);
        current.getCurrentDataForCal(169, regId, function (err, currentList) { // 168 + 1
            var beforeObj = {};
            var tempMax = Number.MIN_VALUE;
            var tempMin = Number.MAX_VALUE;
            var tempDate = currentList[0].currentData.date;
            var dateCnt = 1;

            currentList.shift();
            currentList.forEach(function(elem, idx){
                if((idx + 1) != currentList.length){
                    if(currentList[(idx + 1)].currentData.date !== tempDate){
                        beforeObj['tbMin'+ dateCnt] = tempMin; // tb == temperature before..
                        beforeObj['tbMax'+ dateCnt] = tempMax;
                        tempMax = Number.MIN_VALUE;
                        tempMin = Number.MAX_VALUE;
                        tempDate = currentList[(idx + 1)].currentData.date;
                        dateCnt ++;
                        return;
                    }
                }else{
                    beforeObj['tbMin'+ dateCnt] = tempMin; // tb == temperature before..
                    beforeObj['tbMax'+ dateCnt] = tempMax;
                }

                if(tempMax < elem.currentData.t1h) tempMax = elem.currentData.t1h;
                if(tempMin > elem.currentData.t1h) tempMin = elem.currentData.t1h;
            });
            var midList = self.find({"regId" : regId})
                .sort({"midTempData.date" : -1, "midTempData.time" : -1}).limit(1).exec();

            midList.then(function(res){
                if(res == null || res == []) return;
                //var resObj = res[0];
                var resObj = {};
                Object.defineProperty(resObj, 'town', { value : res[0].town, enumerable: true });
                Object.defineProperty(resObj, 'regId', { value : res[0].midTempData.regId, enumerable: true });
                var tempObj = { midTempData : {} };
                noTaList.forEach(function(elem, idx){
                    tempObj.midTempData[elem] = res[0].midTempData[elem];
                });
                for(var prop in beforeObj){
                    tempObj.midTempData[prop] = beforeObj[prop];
                }
                taList.forEach(function(elem, idx){
                    tempObj.midTempData[elem] = res[0].midTempData[elem];
                });
                Object.defineProperty(resObj, 'midTempData', {value : tempObj.midTempData, enumerable: true});
                cb(null, resObj);
            });
        });

    },
    setTempData : function(tempData, regId, cb){
        var self = this;

        var findQuery = self.findOne({"regId": regId}).exec();

        findQuery.then(function(res){
            //log.debug('res length : ' + res.length);
            self.update({'regId' : regId, 'midTempData.date' : tempData.date, 'midTempData.time': tempData.time},
                {
                'regId' : regId,
                'midTempData' : tempData
                },
                {upsert : true}, cb);
        });
    }
};

module.exports = mongoose.model('midTemp', midTempSchema);

