/**
 * Created by Peter on 2017. 10. 18..
 */
var mongoose = require('mongoose');

var townMidLandSchema = mongoose.Schema({
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
        wf10: String,
        rnSt3Am: Number,
        rnSt3Pm: Number,
        rnSt4Am: Number,
        rnSt4Pm: Number,
        rnSt5Am: Number,
        rnSt5Pm: Number,
        rnSt6Am: Number,
        rnSt6Pm: Number,
        rnSt7Am: Number,
        rnSt7Pm: Number,
        rnSt8: Number,
        rnSt9: Number,
        rnSt10: Number
    }
});

townMidLandSchema.index({regId: "hashed"});
townMidLandSchema.index({regId: 1, pubDate: 1});
townMidLandSchema.index({regId: 1, fcsDate: 1});

module.exports = mongoose.model('kma.town.mid.land', townMidLandSchema);
