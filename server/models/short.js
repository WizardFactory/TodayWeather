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

Date.prototype.format = (function(f){
    if(!this.valueOf()) return " ";

    var d = this;
    var reg = /(yyyy|MM|dd|HH|mm|ss)/gi;
    return f.replace(reg, function($1){
        switch($1){
            case "yyyy":return d.getFullYear();
            case "MM":return (d.getMonth()+1).zf(2);
            case "dd": return d.getDate().zf(2);
            case "HH": return d.getHours().zf(2);
            case "mm": return d.getMinutes().zf(2);
            case "ss": return d.getSeconds().zf(2);
            default : return $1;
        }
    });
});

String.prototype.string = function(len){var s = '', i = 0; while (i++ < len) { s += this; } return s;};
String.prototype.zf = function(len){return "0".string(len - this.length) + this;};
Number.prototype.zf = function(len){return this.toString().zf(len);};

function getNextTime(date, time, next){
    var d = new Date();
    var temp = '';
    var result = { date: '', time: '' };
    d.setFullYear(date.slice(0, 4));
    d.setMonth(date.slice(4, 6) - 1);
    d.setDate(date.slice(6, 8));
    d.setHours(time.slice(0, 2));
    d.setMinutes(time.slice(2, 4));
    d.setHours(d.getHours() + next);
    temp = d.format('yyyyMMddHHmm');
    result.date = temp.slice(0, 8);
    result.time = temp.slice(8, 12);
    return result;
}

shortSchema.statics = {
    getShortData : function (first, second, third, cb) {
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"shortData.date" : -1, "shortData.time" : -1}).limit(40).exec(cb);
    },
    getOneShortData : function(first, second, third, cb){
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"shortData.date" : -1, "shortData.time" : -1}).limit(1).exec(cb);
    },
    getShortDataWithTime : function(town, date, time, cb){
        var self = this;
        var mixList = [];

        //var query = self.find({"town" : { "first" : town.first, "second" : town.second, "third" : town.third},
        //    "shortData.date" : {$lt : date}/*, "shortData.time" : {$lt : time}*/})
        //    .sort({"shortData.date" : -1, "shortData.time" : -1}).limit(40).exec(cb);
        var timeList = [];
        current.getCurrentDataWithTime(town, date, function(err, res){
            var query = self.find({"town" : { "first" : town.first, "second" : town.second, "third" : town.third},
                "shortData.date" : {$gte : date}/*, "shortData.time" : {$lt : time}*/})
                .sort({"shortData.date" : -1, "shortData.time" : -1}).limit(40).exec();

            query.then(function(result){ // date >= now
                if(result == null) return ;

                var tempList = [];
                for(var i = 0 ; i < result.length ; i ++){
                    if(i == (result.length - 1)) {
                        tempList.push(result[i]);
                        break;
                    }
                    var delta = Math.round((result[i + 1].shortData.t3h - result[i].shortData.t3h) / 3);
                    var afterObj = JSON.parse(JSON.stringify(result[i]));
                    var time = afterObj.shortData.time;
                    var nextTime = getNextTime(date, time, 1);
                    afterObj.shortData.date = nextTime.date;
                    afterObj.shortData.time = nextTime.time;
                    afterObj.shortData.t1h = result[i].shortData.t3h + delta;
                    var afterAfterObj = JSON.parse(JSON.stringify(result[i]));
                    nextTime = getNextTime(date, time, 2);
                    afterAfterObj.shortData.date = nextTime.date;
                    afterAfterObj.shortData.time = nextTime.time;
                    afterAfterObj.shortData.t1h = result[i].shortData.t3h + delta + delta;
                    tempList.push(result[i]);
                    tempList.push(afterObj);
                    tempList.push(afterAfterObj);
                }

                //time....
                mixList.push.apply(mixList, tempList);
                var j = 0;
                for(var i = (mixList.length-1) ; i < 0 ; i ++){
                    console.log(mixList.shortData.t1h);
                    if(mixList[i].shortData.date == res[j].currentData.date){
                        if(mixList[i].shortData.time > res[j].currentData.time){
                            //pop
                        }
                    }
                }
                mixList.push.apply(mixList, res); // date <= now
            });
        });
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

