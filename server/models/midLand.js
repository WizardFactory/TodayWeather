/**
 * Created by kay on 2015-10-21
 */

var mongoose = require('mongoose');

var midLandSchema = mongoose.Schema({
    town: {
        first: String,
        second: String
    },
    regId : String,
    midLandData : {
        date: String,
        time: String,
        regId: String, /* 예보 구역 코드 */
        wf3Am: String, /* 3일 후 오전 날씨 예보 */
        wf3Pm: String, /* 3일 후 오후 날씨 예보 */
        wf4Am: String, /* 4일 후 오전날씨 예보 */
        wf4Pm: String, /* 4일 후 오후 날씨 예보 */
        wf5Am: String, /* 5일 후 오전 날씨 예보 */
        wf5Pm: String, /* 5일 후 오후 날씨 예보 */
        wf6Am: String, /* 6일 후 오전 날씨 예보 */
        wf6Pm: String, /* 6일 후 오후 날씨 예보 */
        wf7Am: String, /* 7일 후 오전 날씨 예보 */
        wf7Pm: String, /* 7일 후 오후 날씨 예보 */
        wf8: String, /* 8일 후 날씨 예보 */
        wf9: String, /* 9일 후 날씨 예보 */
        wf10: String /* 10일 후 날씨 예보 */
    }
});

midLandSchema.statics = {
    getLandData : function(first, second, cb){
        this.find({"town" : { "first" : first, "second" : second }})
            .sort({"midLandData.date" : -1, "midLandData.time" : -1}).limit(1).exec(cb);
    },
    setLandData : function(landData, regId, cb){
        var self = this;

        var findQuery = self.findOne({"regId": regId}).exec();

        findQuery.then(function(res){
            if(res == null) return;

            self.update({'regId' : regId, 'midLandData.date' : landData.date, 'midLandData.time' : landData.time},
                {
                    'regId' : regId,
                    'town.third': res.town.third,
                    'town.second': res.town.second,
                    'town.first': res.town.first,
                    'midLandData' : landData
                },
                {upsert : true}, cb);
        });
    }
}

module.exports = mongoose.model('midLand', midLandSchema);