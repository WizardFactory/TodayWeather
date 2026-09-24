/**
 * Created by Peter on 2015. 11. 30..
 */
'use strict';

var mongoose = require('mongoose');

var midTempSchema = mongoose.Schema({
    regId : String,
    pubDate: String, //last data.date+data.time
    data :[{
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
    }]
});

midTempSchema.index({regId: 'text'});

module.exports = mongoose.model('midTemp', midTempSchema);
