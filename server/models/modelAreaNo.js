/**
 * Created by Peter on 2017. 5. 17..
 */
var mongoose = require('mongoose');

var areaNoSchema = new mongoose.Schema({
    areaNo: Number,             ///< 지역 코드
    town: {
        first: String,
        second: String,
        third: String
    },
    geocode: {
        lat: Number,
        lon: Number
    }
});

areaNoSchema.index({areaNo: 1});
areaNoSchema.index({'town.first': '', 'town.second': '', 'town.third': ''});
areaNoSchema.index({'geocode.lat': 1, 'geocode.lon': 1});


module.exports = mongoose.model('areaNoList', areaNoSchema);
