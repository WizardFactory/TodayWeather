/**
 * Created by kay on 2015-10-08.
 */

var mongoose = require("mongoose");
var current = require('./current');

var shortSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    mCoord :{
        mx : Number,
        my : Number
    },
    shortData : {
        date : String,
        time : String,
        mx : {type : Number, default : -1},
        my : {type : Number, default : -1},
        pop: {type : Number, default : -1},
        pty: {type : Number, default : -1},
        r06: {type : Number, default : -1},
        reh: {type : Number, default : -1},
        s06: {type : Number, default : -1},
        sky: {type : Number, default : -1},
        t3h: {type : Number, default : -50},
        tmn: {type : Number, default : -50},
        tmx: {type : Number, default : -50},
        uuu: {type : Number, default : -100},
        vvv: {type : Number, default : -100},
        wav: {type : Number, default : -1},
        vec: {type : Number, default : -1},
        wsd: {type : Number, default : -1}
    }
});

shortSchema.statics = {
    getShortData : function (first, second, third, cb) {
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"shortData.date" : 1, "shortData.time" : 1}).limit(40).exec(cb);
    },
    getOneShortDataWithDate : function(first, second, third, date, time, cb){
        this.find({"town" : { "first" : first, "second" : second, "third" : third}, 'shortData.date' : date })
            .sort({"shortData.date" : 1, "shortData.time" : 1}).limit(1).exec(cb);
    },
    getOneShortDataWithDateAndTime : function(first, second, third, date, time, cb){
        this.find({"town" : { "first" : first, "second" : second, "third" : third},
            'shortData.date' : date, 'shortData.time' : {$lte : time} })
            .sort({"shortData.date" : 1, "shortData.time" : 1}).limit(1).exec(cb);
    },
    getShortDataWithSpecificDate : function(town, startDate, endDate, cb){
        this.find({"town" : { "first" : town.first, "second" : town.second, "third" : town.third},
            'shortData.date' : {$gte : startDate, $lte: endDate}})
            .sort({"shortData.date" : 1, "shortData.time" : 1}).exec(cb);
    },
    setShortData : function (shortList, mCoord, cb){
        var self = this;

        var findQuery = self.find({ "mCoord.mx": mCoord.mx, "mCoord.my": mCoord.my}).exec();

        findQuery.then(function(res) {
            if(res === null) return ;

            res.forEach(function(elem, idx){
                if(elem === null) return;

                shortList.forEach(function(shortData, i){
                    var isInsertQuery = self.findOne({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                        , 'shortData.date' : shortData.date, 'shortData.time' : shortData.time}).exec();

                    isInsertQuery.then(function(value){
                        if(value === null) { // insert
                            //console.log('town third : ' + elem.town.third + " town second : " + elem.town.second + " town first : " + elem.town.first);
                            //console.log('shortData date : ' + shortData.date + " shortData time : " + shortData.time);
                            self.update({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                            , 'shortData.date' : shortData.date, 'shortData.time' : shortData.time}, {
                                'mCoord.my': mCoord.my,
                                'mCoord.mx': mCoord.mx,
                                'town.third': elem.town.third,
                                'town.second': elem.town.second,
                                'town.first': elem.town.first,
                                'shortData': shortData
                            }, {upsert: true}, cb);
                        } else { // update
                            self.update({
                                'town.third': elem.town.third,
                                'town.second': elem.town.second,
                                'town.first': elem.town.first,
                                'shortData.date': shortData.date,
                                'shortData.time': shortData.time
                            }, {'shortData': shortData}, {upsert: false}, cb);
                        }
                    });
                });
            });
        });
    }
};

module.exports = mongoose.model('short', shortSchema);

