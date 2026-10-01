/**
 * Created by aleckim on 2018. 2. 1..
 */

var mongoose = require('mongoose');

var lifeIndexSchema = new mongoose.Schema({
    areaNo: Number,             ///< 지역 코드
    date: Date,               ///< 날짜
    indexType: String,          ///< ultrv, flowerWoody, flowerPine, flowerWeeds; fsn is historical only
    index: Number,               ///< 지수
    lastUpdateDate: String
});

lifeIndexSchema.index({areaNo: 1});
lifeIndexSchema.index({date: 1});
lifeIndexSchema.index({indexType: 'text'});

module.exports = mongoose.model('lifeIndexKma2', lifeIndexSchema);
