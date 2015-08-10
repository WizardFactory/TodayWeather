var mongoose = require('mongoose');
var config = require('../config/config');

mongoose.connect(config.db.path, config.db.options);

var fs = require('fs');
var lineList = fs.readFileSync('./utils/data/test.csv').toString().split('\n');
lineList.shift(); //  header remove

var schemaKeyList = ['first', 'second', 'third', 'long', 'latt'];

var bSchema = new mongoose.Schema({
    town: {first: String, second: String, third: String},
    coord: {lon: Number, lat: Number},
    mData: {mCoord:{mx: Number, my: Number}},
});

var bDoc = mongoose.model('base', bSchema);

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
             else if(i == 3) doc.coord.lon = entry;
             else if(i == 4) doc.coord.lat = entry;
//             console.log(doc);
        });
        doc.save(createDocRecurse);
    } else {
        queryAllEntries();
    }
}

createDocRecurse(null);
