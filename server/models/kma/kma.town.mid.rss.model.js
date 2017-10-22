/**
 * Created by Peter on 2017. 10. 18..
 */
var mongoose = require('mongoose');

var townMidRssSchema = mongoose.Schema({
    id: Number,
    stnId: String,
    regId: String,
    province: String,
    city: String,
    mCoord :{
        mx : Number, /* NNN */
        my : Number /* NNN */
    },
    gCoord: {
        lat: Number, /* NNN.NN */
        lon: Number /* NNN.NN */
    },
    pubDate: Date, /* YYYYMMDDHHMM*/
    midData:[
        {
            date: String, /* YYYYMMDD */
            taMin: Number,
            taMax: Number,
            wfAm: String,
            wfPm: String,
            reliability: String /* 높음, 보통, 낮음 */
        }
    ]
});

townMidRssSchema.index({id: 1});

module.exports = mongoose.model('kma.town.mid.rss', townMidRssSchema);
