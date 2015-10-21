/**
 * Created by kay
 * */

var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');

mongoose.connect(config.db.path, config.db.options);

var fs = require('fs');
var lineList = fs.readFileSync('./utils/data/test.csv').toString().split('\n');
lineList.shift(); // header remove

var tSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    mCoord: {mx: Number, my: Number}
});


var tDoc = mongoose.model('town', tSchema);

function createDocRecurse (err) {
    if (err) {
        console.log(err);
        process.exit(1);
    }
    if (lineList.length) {
        var line = lineList.shift();
        var doc = new tDoc();
	var tempCoord = {lon:0, lat:0};
        line.split(',').forEach(function (entry, i) {
             if(i == 0) doc.town.first = entry;
             else if(i == 1) doc.town.second = entry;
             else if(i == 2) doc.town.third = entry;
             else if(i == 3) tempCoord.lat = entry;
             else if(i == 4) tempCoord.lon = entry;

             //first mx, my data is lon, lat then changed 
             if(tempCoord.lon != null && tempCoord.lat != null){
                 var conv = new convert(tempCoord, {}).toLocation();
                 doc.mCoord.mx = conv.getLocation().x;
                 doc.mCoord.my = conv.getLocation().y;
             }
        });
        doc.save(createDocRecurse);
    } else {
        process.exit(0);
    }
}

createDocRecurse(null);
