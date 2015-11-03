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
         pty: {type : Number, default : -1}, /* ���� ���� : 1%, invalid : -1 */
         rn1: {type : Number, default : -1}, /* 1�ð� ������ : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
         sky: {type : Number, default : -1}, /* �ϴû��� : ����(1) ��������(2) ��������(3) �帲(4) , invalid : -1*/
         lgt: {type : Number, default : -1} /* ���� : Ȯ������(0) ����(1) ����(2) ����(3), invalid : -1 */
    },
    short : {
        date : String,
        time : String,
        mx : {type : Number, default : -1},
        my : {type : Number, default : -1},
        pop: {type : Number, default : -1},    /* ���� Ȯ�� : 1% ����, invalid : -1 */
        pty: {type : Number, default : -1},    /* ���� ���� : ����(0) ��(1) ��/��(2) ��(3) , invalid : -1 */
        r06: {type : Number, default : -1},    /* 6�ð� ������ : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
        reh: {type : Number, default : -1},    /* ���� : 1% , invalid : -1 */
        s06: {type : Number, default : -1},    /* 6�ð� ������ : 0�̸�(0) ~1cm(1) 1~4cm(5) 5~9cm(10) 10~19cm(20) 20cm~(100), invalid : -1 */
        sky: {type : Number, default : -1},    /* �ϴ� ���� : ����(1) ��������(2) ��������(3) �帲(4) , invalid : -1 */
        t3h: {type : Number, default : -50},   /* 3�ð� ��� : 0.1'c , invalid : -50 */
        tmn: {type : Number, default : -50},   /* �� ���� ��� : 0.1'c , invalid : -50 */
        tmx: {type : Number, default : -50},   /* �� �ְ� ��� : 0.1'c , invalid : -50 */
        uuu: {type : Number, default : -100},  /* ǳ��(��������) : 0.1m/s ��ǳ(+ǥ��) ��ǳ(-ǥ��), invalid : -100 */
        vvv: {type : Number, default : -100},  /* ǳ��(���ϼ���) : 0.1m/s ��ǳ(+ǥ��) ��ǳ(-ǥ��), invalid : -100 */
        wav: {type : Number, default : -1},    /* �İ� : 0.1m , invalid : -1 */
        vec: {type : Number, default : -1},    /* ǳ�� : 0 , invalid : -1 */
        wsd: {type : Number, default : -1}     /* ǳ�� : 1 , invalid : -1 */
    },
    current : {
        date: String, // get�� sort��
        time: String,
        mx: {type : Number, default : -1},
        my: {type : Number, default : -1},
        t1h: {type : Number, default : -50}, /* ��� : 0.1'c , invalid : -50 */
        rn1: {type : Number, default : -1}, /* 1�ð� ������ : ~1mm(1) 1~4(5) 5~9(10) 10~19(20) 20~39(40) 40~69(70) 70~(100), invalid : -1 */
        sky: {type : Number, default : -1}, /* �ϴû���: ����(1) ��������(2) ��������(3) �帲(4), invalid : -1 */
        uuu: {type : Number, default : -100}, /* �����ٶ����� : 0.1m/s, invalid : -100 */
        vvv: {type : Number, default : -100}, /* ���Ϲٶ����� : 0.1m/s, invalid : -100 */
        reh: {type : Number, default : -1}, /* ����: 1%, invalid : -1 */
        pty: {type : Number, default : -1}, /* �������� : ����(0) ��(1) ��/��(2) ��(3), invalid : -1 */
        lgt: {type : Number, default : -1}, /* ���� : ����(0) ����(1), invalid : -1 */
        vec: {type : Number, default : -1}, /* ǳ�� : 0, invalid : -1 */
        wsd: {type : Number, default : -1} /* ǳ�� : 4�̸�(���ϴ�) 4~9(�ణ����) 9~14(����) 14�̻�(�ſ찭��), invalid : -1 */
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
