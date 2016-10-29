/**
 * Created by neoqmin on 2016. 6. 21..
 *
 * @brief       보건기상지수를 Area Number를 기준으로 가져와서 DB에 저장
 *
 * */

var mongoose = require('mongoose');

var healthDaySchema = new mongoose.Schema({
    areaNo: String,             ///< 지역 코드
    date: String,               ///< 날짜
    indexType: String,          ///< 지수 종류
    index: Number               ///< 지수
});

healthDaySchema.index({areaNo: 'text'});

module.exports = mongoose.model('healthDayKma', healthDaySchema);