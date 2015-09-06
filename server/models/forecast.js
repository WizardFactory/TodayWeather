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
	town: {
		first: String,
		second: String,
		third: String
	},
	coord: {
		lon: Number,
		lat: Number
	},
	mData: {
		mCoord:{
			mx: Number,
			my: Number
		},
		data: {
			current: Array,
			short: Array,
			shortest: Array,
			midForecast: Array,
			midLand: Array,
			midTemp: Array,
			midSea: Array
		},
		cCurr: {
			time: String,
			date: String
		}
	}
});

bSchema.statics = {
	getData : function (first, second, third, cb){
		this.findOne({"town" : { "third" : third, "second" : second, "first" : first }}).exec(cb);
	},
	setShortData : function (currentObj, mCoord, cb){
		var self = this;

		self.findOne({ "mData.mCoord.mx": mCoord.mx, "mData.mCoord.my": mCoord.my })
			.exec(function(err, res){
				if(err || res.mData === undefined || !Array.isArray(currentObj)){
					log.error('[DB] setShortData : ', err);
					return;
				}
				var popCount = 0;
				var dateString = '';
				var timeString = '';

				//log.info('$$ err : ', err);
				//log.info('$$ short : ', res.mData.data.short);

				for(var i = 0 in currentObj){
					if((currentObj[i].date !== undefined) &&
						(currentObj[i].time !== undefined) &&
						(currentObj[i].date !== '') &&
						(currentObj[i].time !== '')){
						dateString = currentObj[i].date;
						timeString = currentObj[i].time;
						break;
					}
				}

				//log.info('dateString : ', parseInt(dateString));
				//log.info('timeString : ', parseInt(timeString));
				log.info('len : ', res.mData.data.short.length);


				// db의 제일 마지막 데이터의 날짜/시간 이현재 받은 데이터의 처음 데이터의 날짜/시가 보다 같거나 클때 삭제 해야 하는 데이터가 있다.
				// 요약 :
				//  1. db의 제일 마지막 데이터의 날짜가 현재 받은 데이터 리스트의 처음 데이터 날짜 보다 큰 경우,
				//  2. db의 제일 마지막 데이터 날짜가 현재 받음 데이터의 처음 데이터 날짜와 같고, 현재 받은 데이터의 시간이 같거나 작은 경우
				if(res.mData.data.short.length > 0 ) {
					//log.info('last date : ', parseInt(res.mData.data.short[res.mData.data.short.length - 1].date));
					//log.info('last time : ', parseInt(res.mData.data.short[res.mData.data.short.length - 1].time));

					if(parseInt(res.mData.data.short[res.mData.data.short.length - 1].date) > parseInt(dateString) ||
						((parseInt(res.mData.data.short[res.mData.data.short.length - 1].date) === parseInt(dateString)) &&
						(parseInt(res.mData.data.short[res.mData.data.short.length - 1].time) >= parseInt(timeString)))) {
						for (var i = res.mData.data.short.length - 1; i >= 0; i--) {
							popCount++;
							if (res.mData.data.short[i].date === dateString &&
								res.mData.data.short[i].time === timeString) {
								break;
							}
							//log.info(res.mData.data.short[i].date, ' : ', dateString, ' | ', res.mData.data.short[i].time, ' : ', timeString)
						}
					}
				}

				if(popCount > 0){
					for(var i=0 ; i< popCount ; i++){
						self.update({"mData.mCoord.mx": mCoord.mx, "mData.mCoord.my": mCoord.my},
							{$pop : {'mData.data.short' : popCount}},
							{safe: true, multi : true, upsert: true},
							cb);
					}

					log.info('$$ setShortData : pop remove from last ', popCount);
				}

				self.update({"mData.mCoord.mx": mCoord.mx, "mData.mCoord.my": mCoord.my},
					{$push : {'mData.data.short' : {$each : currentObj}}},
					{safe: true, multi : true, upsert: true},
					cb);
				log.info('+ : ', currentObj.length);

				// 40 is default array list length
				if(res.mData.data.short.length > 40 ) {
					popCount = 40 - res.mData.data.short.length;
					for(var i=0 ; i< popCount ; i++){
						self.update({"mData.mCoord.mx": mCoord.mx, "mData.mCoord.my": mCoord.my},
							{$pop : {'mData.data.short' : -popCount}},
							{safe: true, multi : true, upsert: true},
							cb);
					}
					log.info('$$ setShortData : pop remove from first ', popCount);
				}

			});
	},
	setCurrentData : function (currentObj, mCoord, cb){
		this.update({ "mData.mCoord.mx" : mCoord.mx, "mData.mCoord.my" : mCoord.my },
			{$push: { "mData.data.current": { $each : currentObj, $slice : -60}}},
			{safe: true, multi : true, upsert: true},
			cb);
	}
};

module.exports = mongoose.model('base', bSchema);
