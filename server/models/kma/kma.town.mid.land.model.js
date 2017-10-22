/**
 * Created by Peter on 2017. 10. 18..
 */
var mongoose = require('mongoose');

var townMidLandSchema = mongoose.Schema({
    id: Number,
    regId : String,
    pubDate: Date, //last data.date+data.time
    fcsDate: Date,
    data : {
        date: String,
        time: String,
        regId: String,
        wf3Am: String,
        wf3Pm: String,
        wf4Am: String,
        wf4Pm: String,
        wf5Am: String,
        wf5Pm: String,
        wf6Am: String,
        wf6Pm: String,
        wf7Am: String,
        wf7Pm: String,
        wf8: String,
        wf9: String,
        wf10: String
    }
});

townMidLandSchema.index({id: 1});

module.exports = mongoose.model('kma.town.mid.land', townMidLandSchema);
