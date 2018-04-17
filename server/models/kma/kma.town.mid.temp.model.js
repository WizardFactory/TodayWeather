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
        taMin3: {type : Number, default : -100},
        taMax3: {type : Number, default : -100},
        taMin4: {type : Number, default : -100},
        taMax4: {type : Number, default : -100},
        taMin5: {type : Number, default : -100},
        taMax5: {type : Number, default : -100},
        taMin6: {type : Number, default : -100},
        taMax6: {type : Number, default : -100},
        taMin7: {type : Number, default : -100},
        taMax7: {type : Number, default : -100},
        taMin8: {type : Number, default : -100},
        taMax8: {type : Number, default : -100},
        taMin9: {type : Number, default : -100},
        taMax9: {type : Number, default : -100},
        taMin10:{type : Number, default : -100},
        taMax10:{type : Number, default : -100}
    }
});

townMidTempSchema.index({regId: "hashed"});
townMidTempSchema.index({pubDate: 1});
townMidTempSchema.index({fcsDate: 1});

module.exports = mongoose.model('kma.town.mid.temp', townMidTempSchema);
