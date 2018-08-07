/**
 * Created by neoqmin on 2016. 6. 21..
 *
 * @brief       보건기상지수를 Area Number를 기준으로 가져와서 DB에 저장
 *
 * */

var mongoose = require('mongoose');

/**
 * indexType
 * asthma-lunt: 폐질환가능지수, brain: 뇌졸중가능지수, skin: 피부질환가능지수, flowerWoody: 꽃가루농도위험지수(참나무),
 * flowerPine: 꽃가루농도위험지수(소나무), flowerWeeds: 꽃가루농도위험지수(잡초류), influenza: 감기가능지수
 */
var healthDaySchema = new mongoose.Schema({
    areaNo: Number,             ///< 지역 코드
    date: Date,               ///< 날짜
    indexType: String,          ///< 지수 종류
    index: Number               ///< 지수
});

healthDaySchema.index({areaNo: 1});
healthDaySchema.index({date: 1});
healthDaySchema.index({indexType: 'text'});

module.exports = mongoose.model('healthDayKma', healthDaySchema);
