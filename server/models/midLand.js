/**
 * Created by kay on 2015-10-21
 */

var mongoose = require('mongoose');

var midLandSchema = mongoose.Schema({
    town: {
        first: String
    },
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

var config = require('../config/config');
midLandSchema.statics = {
    getLandData : function(first, cb){
        //var currentList = current.getCurrentDataForCal(169, first, second, cb); // 168 + 1
        var currentList = config.testTownData[0].data.current
        var pastObj = {};
        var nowDate = currentList[0].date;
        var tempAmSky = 0;
        var tempPmSky = 0;
        var midObj = currentList.shift();


        currentList.forEach(function(elem, idx){
            if(nowDate != elem.date){
                pastObj['wp'+ (idx + 1) / 3 +'Am'] = tempAmSky;
                pastObj['wp'+ (idx + 1) / 3 +'Pm'] = tempPmSky;
                tempAmSky = 0;
                tempPmSky = 0;
                return;
            }
            if(elem.time <= 0600){
                tempAmSky = tempAmSky + elem.sky;
            }else{
                tempPmSky = tempPmSky + elem.sky
            }
        });

        return Object.defineProperties(midObj, pastObj);
    },
    setLandData : function(landData, regId, cb){
        var self = this;

        var findQuery = self.findOne({"regId": regId}).exec();

        findQuery.then(function(res){
            if(res == null) return;

            self.update({'regId' : regId, 'midLandData.date' : landData.date, 'midLandData.time' : landData.time},
                {
                    'regId' : regId,
                    'town.first': res.town.first,
                    'midLandData' : landData
                },
                {upsert : true}, cb);
        });
    }
}

module.exports = mongoose.model('midLand', midLandSchema);