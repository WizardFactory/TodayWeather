/*
 *
 *  how to use ...  
 *
 *  var forecast = require('./forecast');
 *
 *  forecast.getData("서울특별시", "동대문구", "청량리동", function(err, res){
 *     if(err) console.log(err);
 *     console.log(res);
 *     });
 *
 *  var coord = {my : 127, mx : 61 };
 *  var obj = [{date: '20150828', time: '0000', pop: 10, pty: 0, r06: 0, reh: 78, s06: 0, sky: 2, t3h: 20, tmn: 18, tmx: 29, uuu: 0, vvv: 1, wav: -1, vec: 160, wsd: 2},{...}];
 *
 *  forecast.setCurrentData(obj, coord, function(err, res){});
 *
 * */
var mongoose = require('mongoose');

var bSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    coord: {lon: Number, lat: Number},
    mData: {mCoord:{mx: Number, my: Number},
            data : { current : Array, short : Array}
	   }
});

bSchema.statics = {
    getData : function (first, second, third, cb){
	this.find({"town" : { "third" : third, "second" : second, "first" : first }})
	.exec(cb);
    },
    setCurrentData : function (currentObj, mCoord, cb){
	// 삭제 예정
//	this.find({ "mData.mCoord" : mCoord }, function(err, res){
//	    if(err) console.log(err);
//	    console.log(res.mData);
//	});
//	this.update({ "mData.mCoord" : mCoord },
	this.update({ "mData.mCoord.mx" : mCoord.mx, "mData.mCoord.my" : mCoord.my },
	{$push: { "mData.data.current": { $each : currentObj}}}, 
	{safe: true, multi : true, upsert: true}, 
	cb);
    },
    setShortData : function (currentObj, mCoord, cb){
	this.update({ "mData.mCoord.mx" : mCoord.mx, "mData.mCoord.my" : mCoord.my },
	{$push: { "mData.data.short": { $each : currentObj}}}, 
	{safe: true, multi : true, upsert: true}, 
	cb);
    }
}

module.exports = mongoose.model('base', bSchema);
