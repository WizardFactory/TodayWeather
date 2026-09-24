/**
 * Created by Peter on 2017. 10. 18..
 */
var mongoose = require('mongoose');

var townMidTempSchema = mongoose.Schema({
    regId : String,
    pubDate: Date, //last data.date+data.time
    fcsDate: Date,
    data :{
        date: String,
        time: String,
        regId: String,
        taMin3: Number,
        taMax3: Number,
        taMin4: Number,
        taMax4: Number,
        taMin5: Number,
        taMax5: Number,
        taMin6: Number,
        taMax6: Number,
        taMin7: Number,
        taMax7: Number,
        taMin8: Number,
        taMax8: Number,
        taMin9: Number,
        taMax9: Number,
        taMin10:Number,
        taMax10:Number
    }
});

townMidTempSchema.index({regId: "hashed"});
townMidTempSchema.index({regId: 1, pubDate: 1});
townMidTempSchema.index({regId: 1, fcsDate: 1});

module.exports = mongoose.model('kma.town.mid.temp', townMidTempSchema);
