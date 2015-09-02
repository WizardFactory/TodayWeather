/*
 *
 * 
 * */
var mongoose = require('mongoose');

var bSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    coord: {lon: Number, lat: Number},
    mData: {mCoord:{mx: Number, my: Number}}
});

bSchema.statics = {
    getData : function (first, second, third, cb){
	this.find({"town" : { "third" : third, "second" : second, "first" : first }})
	.exec(cb);
    },
    setCurrentData : function (time, currentObj, mCoord, cb){
        this.update({"mData.mCoord": mCoord},
	{'$push': { "mData.data.current": currentObj}},
	{multi : true, upsert: true})
	.exec(cb);
    },
    setShortData : function (time, currentObj, mCoord, cb){
    }
}

mongoose.model('base', bSchema);
