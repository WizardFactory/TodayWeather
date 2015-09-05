/*
 * 
 *
 * */

var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');

mongoose.connect(config.db.path, config.db.options);

var fs = require('fs');
var lineList = fs.readFileSync('./utils/data/base.csv').toString().split('\n');
lineList.shift(); //  header remove

var schemaKeyList = ['first', 'second', 'third', 'long', 'latt'];

//var bSchema = new mongoose.Schema({
//    town: {first: String, second: String, third: String},
//    coord: {lon: Number, lat: Number},
//    mData: {mCoord:{mx: Number, my: Number}},
//});

var bSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    coord: {lon: Number, lat: Number},
    mData: {mCoord:{mx: Number, my: Number},
            data: {current: Array, short: Array},
	    cIdx: {type: Number, default: 0}
	   }
});


var bDoc = mongoose.model('base', bSchema);

//삭제 예정 
function queryAllEntries () {
    bDoc.aggregate(
        {$group: {oppArray: {$push: {
            first:'$first',
            }}
        }}, function(err, qDocList) {
            process.exit(0);
        });
}

function createDocRecurse (err) {
    if (err) {
        console.log(err);
        process.exit(1);
    }
    if (lineList.length) {
        var line = lineList.shift();
        var doc = new bDoc();
        line.split(',').forEach(function (entry, i) {
             if(i == 0) doc.town.first = entry;
             else if(i == 1) doc.town.second = entry;
             else if(i == 2) doc.town.third = entry;
             else if(i == 3) doc.coord.lat = entry;
             else if(i == 4) doc.coord.lon = entry;

	     if(doc.coord.lon != null && doc.coord.lat != null){
		 var tempCoord = {lon: doc.coord.lon, lat: doc.coord.lat};

		 var conv = new convert(tempCoord, {}).toLocation();
		 doc.mData.mCoord.mx = conv.getLocation().x;
		 doc.mData.mCoord.my = conv.getLocation().y;
	     }
//             console.log(doc);
        });
        doc.save(createDocRecurse);
    } else {
        queryAllEntries();
    }
}

createDocRecurse(null);
