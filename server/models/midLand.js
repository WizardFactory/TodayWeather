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
        regId: String, /* ���� ���� �ڵ� */
        wf3Am: String, /* 3�� �� ���� ���� ���� */
        wf3Pm: String, /* 3�� �� ���� ���� ���� */
        wf4Am: String, /* 4�� �� �������� ���� */
        wf4Pm: String, /* 4�� �� ���� ���� ���� */
        wf5Am: String, /* 5�� �� ���� ���� ���� */
        wf5Pm: String, /* 5�� �� ���� ���� ���� */
        wf6Am: String, /* 6�� �� ���� ���� ���� */
        wf6Pm: String, /* 6�� �� ���� ���� ���� */
        wf7Am: String, /* 7�� �� ���� ���� ���� */
        wf7Pm: String, /* 7�� �� ���� ���� ���� */
        wf8: String, /* 8�� �� ���� ���� */
        wf9: String, /* 9�� �� ���� ���� */
        wf10: String /* 10�� �� ���� ���� */
    }
});

midLandSchema.statics = {
    getLandData : function(first, cb){
        this.find({"town" : { "first" : first }})
            .sort({"midLandData.date" : -1, "midLandData.time" : -1}).limit(25).exec(cb);
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