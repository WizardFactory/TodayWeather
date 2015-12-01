/**
 * Created by User on 2015-11-11.
 */
/*
var mongoose = require('mongoose');

var shortestSchema = new mongoose.Schema({
    town: {
        first:String,
        second:String,
        third:String
    },
    mCoord:{
        mx:Number,
        my:Number
    },
    shortestData:{
        date: String,
        time: String,
        mx: {type:Number, default:-1},
        my: {type:Number, default:-1},
        pty: {type:Number, default:-1},
        rn1: {type:Number, default:-1},
        sky: {type:Number, default:-1},
        lgt: {type:Number, default:-1}
    }
});

shortestSchema.statics = {
    getShortestData: function(first, second, third, cb){
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"shortestData.date" : -1, "shortestData.time" : -1}).limit(40).exec(cb);
    },
    getOneShortestData: function(first, second, third, cb){
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"shortestData.date" : -1, "shortestData.time" : -1}).limit(1).exec(cb);
    },
    setShortestData: function(shortestList, mCoord, cb){
        var self = this;

        var findQuery = self.find({ "mCoord.mx": mCoord.mx, "mCoord.my": mCoord.my}).exec();

        findQuery.then(function(res){
            if(res === null || res === []) return;

            res.forEach(function(elem, idx){
                if(elem === null) return ;

                shortestList.forEach(function(shortestData, i){
                    var isInsertQuery = self.findOne({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                        , 'shortestData.date' : shortestData.date, 'shortestData.time' : shortestData.time}).exec();

                    isInsertQuery.then(function(value){
                        if(value === null){
                            self.update({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                                , 'shortestData.date' : shortestData.date, 'shortestData.time' : shortestData.time}, {
                                'mCoord.my': mCoord.my,
                                'mCoord.mx': mCoord.mx,
                                'town.third': elem.town.third,
                                'town.second': elem.town.second,
                                'town.first': elem.town.first,
                                'shortestData': shortestData
                            }, {upsert: true}, cb);
                        }else{
                            self.update({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                                , 'shortestData.date' : shortestData.date, 'shortestData.time' : shortestData.time},
                                {'shortestData': shortestData},
                                {upsert: true}, cb);
                        }
                    });
                });
            });
        });
    }
}

module.exports = mongoose.model('shortest', shortestSchema);
*/