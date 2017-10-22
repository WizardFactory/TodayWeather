/**
 * Created by Peter on 2017. 10. 15..
 */
var mongoose = require('mongoose');

var townMidForecastSchema = mongoose.Schema({
    id: Number,
    regId : String,
    pubDate: Date, //last data.date+data.time
    fcsDate: Date,
    data : {
        date: String,
        time: String,
        pointNumber: String,
        cnt: Number,
        wfsv: String
    }
});

townMidForecastSchema.index({id: 1});

module.exports = mongoose.model('kma.town.mid.forecast', townMidForecastSchema);
