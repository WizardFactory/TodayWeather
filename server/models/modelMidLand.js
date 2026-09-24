/**
 * Created by Peter on 2015. 11. 30..
 */
var mongoose = require('mongoose');

var midLandSchema = mongoose.Schema({
    regId : String,
    pubDate: String, //last data.date+data.time
    data : [{
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
    }]
});

midLandSchema.index({regId: 'text'});

module.exports = mongoose.model('midLand', midLandSchema);
