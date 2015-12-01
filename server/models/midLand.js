/**
 * Created by kay on 2015-10-21
 */
/*
var mongoose = require('mongoose');
var config = require('../config/config');
var current = require('./current');
var ModelUtil = require('./modelUtil');

var midLandSchema = mongoose.Schema({
    regId : String,
    midLandData : {
        date: String,
        time: String,
        regId: String,
        wf3Am: String,
        wf3Pm: String,
        wf4Am: String,
        wf4Pm: String,
        wf5Am: String,
        wf5Pm: String,
        wf6Am: String,
        wf6Pm: String,
        wf7Am: String,
        wf7Pm: String,
        wf8: String,
        wf9: String,
        wf10: String
    }
});

var noWfList = ['date', 'time', 'regId'];
var wfList = ['wf3Am', 'wf3Pm', 'wf4Am', 'wf4Pm', 'wf5Am', 'wf5Pm', 'wf6Am', 'wf6Pm',
    'wf7Am', 'wf7Pm', 'wf8', 'wf9', 'wf10'];

midLandSchema.statics = {
    getOneLandData : function(first, second, nowDate, cb){
        var self = this;
        var modelUtil = new ModelUtil();
        var regId = modelUtil.getCodeWithFirst(first, second);
        self.find({"regId" : regId, "midLandData.date" : nowDate})
            .sort({"midTempData.date" : -1, "midTempData.time" : -1}).limit(1).exec(cb);
    },
    getLandData : function(first, second, cb){
        //var tempList = config.testTownData[0].data.current
        //var currentList = [];
        //tempList.forEach(function(elem, idx){
        //    var t = {};
        //    t.currentData = elem;
        //    currentList.push(t);
        //});
        var self = this;
        var util = new ModelUtil();
        var regId = util.getCode(first, second);
        current.getCurrentDataForCal(169, regId, function (err, currentList) { // 168 + 1
            var pastObj = {};
            var tempAmSky = 0, tempPmSky = 0;
            var tempAmRain = false, tempPmRain = false;
            var tempDate = currentList[0].currentData.date;
            var dateCnt = 1;
            var timeCnt = 1;

            function averageValueToSky (average, rain){
                var resultSky = '';
                if(average <= 1) resultSky = '맑음';
                else if(average <= 2) resultSky = '구름조금';
                else if(average <= 3) resultSky = '구름많음';
                else resultSky = '흐림';

                if(rain){
                    if(average <= 2) resultSky = '구름많음';
                    resultSky += ' 비';
                }
                return resultSky;
            }

            currentList.shift();
            currentList.forEach(function(elem, idx) {
                // idx + 1 == currentList.length
                if ((idx + 1) != currentList.length) {
                    if (currentList[(idx + 1)].currentData.date !== tempDate) {
                        pastObj['wp'+dateCnt+'Am'] = averageValueToSky(Math.round(tempAmRain % timeCnt), tempAmRain); // weather past ...
                        pastObj['wp'+dateCnt+'Pm'] = averageValueToSky(Math.round(tempPmRain % timeCnt), tempPmRain);
                        tempAmSky = tempPmSky = 0;
                        tempAmRain = tempPmRain = false;
                        timeCnt = 1;
                        tempDate = currentList[(idx + 1)].currentData.date;
                        dateCnt++;
                        return;
                    }
                } else {
                    pastObj['wp'+dateCnt+'Am'] = averageValueToSky(Math.round(tempAmRain % timeCnt), tempAmRain); // weather past ...
                    pastObj['wp'+dateCnt+'Pm'] = averageValueToSky(Math.round(tempPmRain % timeCnt), tempPmRain);
                }

                if(elem.currentData.time <= '1200') {
                    tempAmSky = tempAmSky + elem.currentData.sky;
                    tempAmRain = tempAmRain || !!parseInt(elem.currentData.pty) || !!parseInt(elem.currentData.lgt);
                } else {
                    tempPmSky = tempPmSky + elem.currentData.sky;
                    tempPmRain = tempPmRain || !!parseInt(elem.currentData.pty) || !!parseInt(elem.currentData.lgt);
                }
                timeCnt++;
            });

            var regId = util.getCodeWithFirst(first, second);
            var midQuery = self.find({"regId" : regId })
                .sort({"midLandData.date" : -1, "midLandData.time" : -1}).limit(1).exec();

            midQuery.then(function(res){
                if(res == null || res == []) return;
                var resObj = {};
                Object.defineProperty(resObj, 'town', { value : {
                    value : { first : first, second : second }
                }, enumerable: true });
                Object.defineProperty(resObj, 'regId', { value : regId, enumerable: true });
                var tempObj = { midLandData : {} };
                noWfList.forEach(function(elem, idx){
                    tempObj.midLandData[elem] = res[0].midLandData[elem];
                });
                for(var prop in pastObj){
                    tempObj.midLandData[prop] = pastObj[prop];
                }
                wfList.forEach(function(elem, idx){
                    tempObj.midLandData[elem] = res[0].midLandData[elem];
                });
                Object.defineProperty(resObj, 'midLandData', {value : tempObj.midLandData, enumerable: true});
                cb(null, resObj);
            });
        });
    },
    setLandData : function(landData, regId, cb){
        var self = this;

        var findQuery = self.findOne({"regId": regId}).exec();

        findQuery.then(function(res){
            self.update({'regId' : regId, 'midLandData.date' : landData.date, 'midLandData.time' : landData.time},
                {
                    'regId' : regId,
                    'midLandData' : landData
                },
                {upsert : true}, cb);
        });
    }
}

module.exports = mongoose.model('midLand', midLandSchema);
 */