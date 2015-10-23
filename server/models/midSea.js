/**
 * Created by kay on 2015-10-23.
 */

var mongoose = require('mongoose');

var midSeaSchema = mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    regId: String,
    midSeaData: {
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
        wf10: String, /* 10일 후 날씨 예보 */
        wh3AAm: {type : Number, default : -100}, /* 3일 후 오전 최저 예상 파고(m) */
        wh3APm: {type : Number, default : -100}, /* 3일 후 오후 최저 예상 파고(m) */
        wh3BAm: {type : Number, default : -100}, /* 3일 후 오전 최고 예상 파고(m) */
        wh3BPm: {type : Number, default : -100}, /* 3일 후 오후 최고 예상 파고(m) */
        wh4AAm: {type : Number, default : -100}, /* 4일 후 오전 최저 예상 파고(m) */
        wh4APm: {type : Number, default : -100}, /* 4일 후 오후 최저 예상 파고(m) */
        wh4BAm: {type : Number, default : -100}, /* 4일 후 오전 최고 예상 파고(m) */
        wh4BPm: {type : Number, default : -100}, /* 4일 후 오후 최고 예상 파고(m) */
        wh5AAm: {type : Number, default : -100}, /* 5일 후 오전 최저 예상 파고(m) */
        wh5APm: {type : Number, default : -100}, /* 5일 후 오후 최저 예상 파고(m) */
        wh5BAm: {type : Number, default : -100}, /* 5일 후 오전 최고 예상 파고(m) */
        wh5BPm: {type : Number, default : -100}, /* 5일 후 오후 최고 예상 파고(m) */
        wh6AAm: {type : Number, default : -100}, /* 6일 후 오전 최저 예상 파고(m) */
        wh6APm: {type : Number, default : -100}, /* 6일 후 오후 최저 예상 파고(m) */
        wh6BAm: {type : Number, default : -100}, /* 6일 후 오전 최고 예상 파고(m) */
        wh6BPm: {type : Number, default : -100}, /* 6일 후 오후 최고 예상 파고(m) */
        wh7AAm: {type : Number, default : -100}, /* 7일 후 오전 최저 예상 파고(m) */
        wh7APm: {type : Number, default : -100}, /* 7일 후 오후 최저 예상 파고(m) */
        wh7BAm: {type : Number, default : -100}, /* 7일 후 오전 최고 예상 파고(m) */
        wh7BPm: {type : Number, default : -100}, /* 7일 후 오후 최고 예상 파고(m) */
        wh8A: {type : Number, default : -100}, /* 8일 후 최저 예상 파고(m) */
        wh8B: {type : Number, default : -100}, /* 8일 후 최고 예상 파고(m) */
        wh9A: {type : Number, default : -100}, /* 9일 후 최저 예상 파고(m) */
        wh9B: {type : Number, default : -100}, /* 9일 후 최고 예상 파고(m) */
        wh10A: {type : Number, default : -100}, /* 10일 후 최저 예상 파고(m) */
        wh10B: {type : Number, default : -100} /* 10일 후 최고 예상 파고(m) */
    }
});

midSeaSchema.statics = {
    getSeaData: function(first, second, third, cb){
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"midLandData.date" : -1, "midLandData.time" : -1}).limit(1).exec(cb);

    },
    setSeaData: function(seaData, regId, cb){
        var self = this;

        var findQuery = self.findOne({"regId": regId}).exec();

        findQuery.then(function(res){
            if(res == null) return;

            self.update({'regId' : regId, 'midSeaData.date' : seaData.date, 'midSeaData.time' : seaData.time},
                {
                    'regId' : regId,
                    'town.third': res.town.third,
                    'town.second': res.town.second,
                    'town.first': res.town.first,
                    'midSeaData' : seaData
                },
                {upsert:true}, cb);
        })
    }
};

module.exports = mongoose.model('midSea', midSeaSchema);
