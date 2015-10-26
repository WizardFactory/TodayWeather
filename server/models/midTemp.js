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
        date: String,
        time: String,
        regId: String, /* ���� ���� �ڵ� */
        taMin3: {type : Number, default : -100}, /* 3�� �� ���� ���� ��� */
        taMax3: {type : Number, default : -100}, /* 3�� �� ���� �ְ� ��� */
        taMin4: {type : Number, default : -100}, /* 4�� �� ���� ���� ��� */
        taMax4: {type : Number, default : -100}, /* 4�� �� ���� �ְ� ��� */
        taMin5: {type : Number, default : -100}, /* 5�� �� ���� ���� ��� */
        taMax5: {type : Number, default : -100}, /* 5�� �� ���� �ְ� ��� */
        taMin6: {type : Number, default : -100}, /* 6�� �� ���� ���� ��� */
        taMax6: {type : Number, default : -100}, /* 6�� �� ���� �ְ� ��� */
        taMin7: {type : Number, default : -100}, /* 7�� �� ���� ���� ��� */
        taMax7: {type : Number, default : -100}, /* 7�� �� ���� �ְ� ��� */
        taMin8: {type : Number, default : -100}, /* 8�� �� ���� ���� ��� */
        taMax8: {type : Number, default : -100}, /* 8�� �� ���� �ְ� ��� */
        taMin9: {type : Number, default : -100}, /* 9�� �� ���� ���� ��� */
        taMax9: {type : Number, default : -100}, /* 9�� �� ���� �ְ� ��� */
        taMin10:{type : Number, default : -100}, /* 10�� �� ���� ���� ��� */
        taMax10:{type : Number, default : -100} /* 10�� �� ���� �ְ� ��� */
    }
});

midTempSchema.statics = {
    getTempData : function(first, second, cb){
        this.find({"town" : { "first" : first, "second" : second }})
            .sort({"midTempData.date" : -1, "midTempData.time" : -1}).limit(25).exec(cb);
    },
    setTempData : function(tempData, regId, cb){
        var self = this;

        var findQuery = self.find({"regId": regId}).exec();

        findQuery.then(function(res){
            if(res == null) return ;

            console.log('res length : ' + res.length);
            res.forEach(function(elem, idx){
                if(elem == null) return ;

                var isInsertQuery = self.findOne({ 'regId' : regId, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                    , 'midTempData.date' : tempData.date, 'midTempData.time' : tempData.time}).exec();

                isInsertQuery.then(function(value){
                    if(value == null){
                        self.update({ 'regId' : regId, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                    , 'midTempData.date' : tempData.date, 'midTempData.time' : tempData.time},
                            {
                                'regId' : regId,
                                'town.second': elem.town.second,
                                'town.first': elem.town.first,
                                'midTempData' : tempData
                            },
                            {upsert: true}, cb);
                    } else {
                        self.update({ 'regId' : regId, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                    , 'midTempData.date' : tempData.date, 'midTempData.time' : tempData.time},
                            {'midTempData' : tempData},
                            {upsert: false}, cb);
                    }
                });
            });
        });
    }
};

module.exports = mongoose.model('midTemp', midTempSchema);

