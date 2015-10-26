/**
 * Created by kay on 2015-10-08.
 */

var mongoose = require("mongoose");

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
        pop: {type : Number, default : -1},    /* 강수 확률 : 1% 단위, invalid : -1 */
        pty: {type : Number, default : -1},    /* 강수 형태 : 없음(0) 비(1) 비/눈(2) 눈(3) , invalid : -1 */
        r06: {type : Number, default : -1},    /* 6시간 강수량 : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
        reh: {type : Number, default : -1},    /* 습도 : 1% , invalid : -1 */
        s06: {type : Number, default : -1},    /* 6시간 신적설 : 0미만(0) ~1cm(1) 1~4cm(5) 5~9cm(10) 10~19cm(20) 20cm~(100), invalid : -1 */
        sky: {type : Number, default : -1},    /* 하늘 상태 : 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1 */
        t3h: {type : Number, default : -50},   /* 3시간 기온 : 0.1'c , invalid : -50 */
        tmn: {type : Number, default : -50},   /* 일 최저 기온 : 0.1'c , invalid : -50 */
        tmx: {type : Number, default : -50},   /* 일 최고 기온 : 0.1'c , invalid : -50 */
        uuu: {type : Number, default : -100},  /* 풍속(동서성분) : 0.1m/s 동풍(+표기) 서풍(-표기), invalid : -100 */
        vvv: {type : Number, default : -100},  /* 풍속(남북성분) : 0.1m/s 북풍(+표기) 남풍(-표기), invalid : -100 */
        wav: {type : Number, default : -1},    /* 파고 : 0.1m , invalid : -1 */
        vec: {type : Number, default : -1},    /* 풍향 : 0 , invalid : -1 */
        wsd: {type : Number, default : -1}     /* 풍속 : 1 , invalid : -1 */
    }
});

shortSchema.statics = {
    getShortData : function (first, second, third, cb) {
        this.find({"town" : { "first" : first, "second" : second, "third" : third}})
            .sort({"shortData.date" : -1, "shortData.time" : -1}).limit(40).exec(cb);
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

