/**
 * Created by kay on 2015-10-29.
 */

var mongoose = require('mongoose');

var schemaObj = {
    shortest : {
         date: String,
         time: String,
         mx: {type : Number, default : -1},
         my: {type : Number, default : -1},
         pty: {type : Number, default : -1}, /* 강수 형태 : 1%, invalid : -1 */
         rn1: {type : Number, default : -1}, /* 1시간 강수량 : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
         sky: {type : Number, default : -1}, /* 하늘상태 : 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1*/
         lgt: {type : Number, default : -1} /* 낙뢰 : 확률없음(0) 낮음(1) 보통(2) 높음(3), invalid : -1 */
    },
    short : {
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
    },
    current : {
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
};
function ForecastModel(collectionName){
    var baseSchema = {
        town: {
            first: String,
            second: String,
            third: String
        },
        mCoord : {
            mx: Number,
            my : Number
        }
    };

    baseSchema["data"] = schemaObj[collectionName];
    //Object.defineProperties(sObj, baseSchema);
    var schema = mongoose.Schema(baseSchema);
    schema.statics = {
        "getData" : function(first, second, third, cb){
            this.find({"town" : { "first" : first, "second" : second, "third" : third}})
                .sort({"data.date" : -1, "data.time" : -1}).limit(40).exec(cb);
        },
        "setData" : function(dataList, mCoord, cb){
            var self = this;

            var findQuery = self.find({ "mCoord.mx": mCoord.mx, "mCoord.my": mCoord.my}).exec();

            findQuery.then(function(res) {
                if(res === null || res === []) return ;

                res.forEach(function(elem, idx){
                    //if(elem === null) return;

                    dataList.forEach(function(data, i){
                        var isInsertQuery = self.findOne({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                            , 'data.date' : data.date, 'data.time' : data.time}).exec();

                        isInsertQuery.then(function(value){
                            if(value === null) { // insert
                                //console.log('town third : ' + elem.town.third + " town second : " + elem.town.second + " town first : " + elem.town.first);
                                //console.log('shortData date : ' + shortData.date + " shortData time : " + shortData.time);
                                self.update({ 'town.third' : elem.town.third, 'town.second' : elem.town.second, 'town.first' : elem.town.first
                                , 'data.date' : data.date, 'data.time' : data.time}, {
                                    'mCoord.my': mCoord.my,
                                    'mCoord.mx': mCoord.mx,
                                    'town.third': elem.town.third,
                                    'town.second': elem.town.second,
                                    'town.first': elem.town.first,
                                    'data': data
                                }, {upsert: true}, cb);
                            } else { // update
                                self.update({
                                    'town.third': elem.town.third,
                                    'town.second': elem.town.second,
                                    'town.first': elem.town.first,
                                    'data.date': data.date,
                                    'data.time': data.time
                                }, {'data': data}, {upsert: false}, cb);
                            }
                        });
                    });
                });
            });
        }
    };
    return mongoose.model(collectionName, schema);
}

module.exports = ForecastModel;
