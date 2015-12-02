/**
 * Created by Peter on 2015. 11. 29..
 */

var mongoose = require('mongoose');

var shortestSchema = new mongoose.Schema({
    mCoord:{
        mx:Number,
        my:Number
    },
    shortestData:[{
        date: String,
        time: String,
        mx: {type:Number, default:-1},
        my: {type:Number, default:-1},
        pty: {type:Number, default:-1},
        rn1: {type:Number, default:-1},
        sky: {type:Number, default:-1},
        lgt: {type:Number, default:-1}
    }]
});

module.exports = mongoose.model('shortest', shortestSchema);