/**
 * Created by aleckim on 2015. 12. 26..
 */

var mongoose = require('mongoose');

var midRssKmaSchema = mongoose.Schema({
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
    pubDate: String, /* YYYYMMDDHHMM*/
    midData: [
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

module.exports = mongoose.model('midRssKma', midRssKmaSchema);
