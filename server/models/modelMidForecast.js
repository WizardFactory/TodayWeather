/**
 * Created by Peter on 2015. 11. 30..
 */
var mongoose = require('mongoose');

var midForecastSchema = mongoose.Schema({
    regId : String,
    pubDate: String, //last data.date+data.time
    data : [{
        date: String,
        time: String,
        pointNumber: String,
        cnt: Number,
        wfsv: String
    }]
});

midForecastSchema.index({regId: 'text'});

module.exports = mongoose.model('midForecast', midForecastSchema);
