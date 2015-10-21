/**
 * Created by kay on 2015-10-08.
 */


var mongoose = require('mongoose');

var currentSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    mCoord: {
        mx : Number,
        my : Number
    },
    currentData : {
        date: String, // get시 sort용
        time: String,
        mx: {type : Number, default : -1},
        my: {type : Number, default : -1},
        t1h: {type : Number, default : -50}, /* 기온 : 0.1'c , invalid : -50 */
        rn1: {type : Number, default : -1}, /* 1시간 강수량 : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
        sky: {type : Number, default : -1}, /* 하늘상태: 맑음(1) 구름조금(2) 구름많음(3) 흐림(4), invalid : -1 */
        uuu: {type : Number, default : -100}, /* 동서바람성분 : 0.1m/s, invalid : -100 */
        vvv: {type : Number, default : -100}, /* 남북바람성분 : 0.1m/s, invalid : -100 */
        reh: {type : Number, default : -1}, /* 습도: 1%, invalid : -1 */
        pty: {type : Number, default : -1}, /* 강수형태 : 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1 */
        lgt: {type : Number, default : -1}, /* 낙뢰 : 없음(0) 있음(1), invalid : -1 */
        vec: {type : Number, default : -1}, /* 풍향 : 0, invalid : -1 */
        wsd: {type : Number, default : -1} /* 풍속 : 4미만(약하다) 4~9(약간강함) 9~14(강함) 14이상(매우강함), invalid : -1 */
    }
});

currentSchema.statics = {
    getCurrentData : function(first, second, third, cb){
        this.find({"town" : { "first" : first , "second" : second, "third" : third}})
            // limit config 로 빼기
            .sort({"currentData.date" : -1, "currentData.time" : -1}).limit(40).exec(cb);
    },
    setCurrentData : function(currentList, mCoord, cb){
        var self = this;

        var findQuery = self.findOne({ "currentData.mx": mCoord.mx, "currentData.my": mCoord.my}).exec();

        findQuery.then(function(findRes){
            if(findRes === null) return ;

            findRes.forEach(function(elem, idx){
                if(elem === null) return ;

                currentList.forEach(function(currentData, i){
                    var isInsertQuery = self.findOne({"town.third" : elem.town.third, "town.second" : elem.town.second, "town.first" : elem.town.first
                        , 'currentData.date' : currentData.date, 'currentData.time': currentData.time}).exec();

                    isInsertQuery.then(function(value){
                        if(value === null){
                            self.update({"town.third" : elem.town.third, "town.second" : elem.town.second, "town.first" : elem.town.first
                            , 'currentData.date' : currentData.date, 'currentData.time': currentData.time},{
                                'mCoord.my': mCoord.my,
                                'mCoord.mx': mCoord.mx,
                                'town.third': elem.town.third,
                                'town.second': elem.town.second,
                                'town.first': elem.town.first,
                                'currentData': currentData
                            }, {upsert : true}, cb);
                        } else {
                            self.update({
                                "town.third": elem.town.third,
                                "town.second": elem.town.second,
                                "town.first": elem.town.first,
                                'currentData.date': currentData.date,
                                'currentData.time': currentData.time
                            }, {'currentData': currentData}, {upsert: false}, cb);
                        }

                    });
                });
            });
        });
    }
};

module.exports = mongoose.model('current', currentSchema);
