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
});

currentSchema.statics = {
    getCurrentData : function(first, second, third, cb){
        this.find({"town" : { "first" : first , "second" : second, "third" : third}})
            // limit config �� ����
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
