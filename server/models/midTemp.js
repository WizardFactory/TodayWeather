/**
 * Created by User on 2015-10-23.
 */

var mongoose = require('mongoose');

var midTempSchema = mongoose.Schema({
    town: {
        first: String,
        second: String
    },
    regId : String,
    midTempData :{

    }
});

midTempSchema.statics = {
    getTempData : function(first, second, cb){
        this.find({"town" : { "first" : first, "second" : second }})
            .sort({"midTempData.date" : -1, "midTempData.time" : -1}).limit(1).exec(cb);
    },
    setLandData : function(tempData, regId, cb){
        var self = this;

        var findQuery = self.findOne({"regId": regId}).exec();

        findQuery.then(function(res){
            if(res == null) return ;

            self.update({'regId' : regId, 'midLandData.date' : landData.date, 'midLandData.time' : landData.time},
                {
                    'regId' : regId,
                    'town.third': res.town.third,
                    'town.second': res.town.second,
                    'town.first': res.town.first,
                    'midTempData' : tempData
                },
                {upsert: true}, cb);
        });
    }
};

module.exports = mongoose.model('midTemp', midTempSchema);

