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
        wf10: String
    }]
});

module.exports = mongoose.model('midLand', midLandSchema);
