/**
 * Created by Peter on 2015. 11. 30..
 */
var mongoose = require('mongoose');

var midForecastSchema = mongoose.Schema({
    regId : String,
    data : [{
        date: String,
        time: String,
        pointNumber: String,
        cnt: Number,
        wfsv: String
    }]
});

module.exports = mongoose.model('midForecast', midForecastSchema);
