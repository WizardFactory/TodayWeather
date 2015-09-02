/*
 *
 * 
 * */
var mongoose = require('mongoose');

var tSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    mCoord: {mx: Number, my: Number}
});

tSchema.statics = {
    getCoord : function(cb){
        this.distinct("mCoord")
	.exec(cb);
    }
}

mongoose.model('town', tSchema);

