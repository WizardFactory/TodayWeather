/**
 * Created by aleckim on 2016. 3. 30..
 * lifeIndexKma DB에 있는 데이터를 토대로 base.csv를 업데이트함.
 */

var mongoose = require('mongoose');
var config = require('../config/config');
var targetName = './utils/data/base.csv';

mongoose.connect(config.db.path, config.db.options, function(err){
    if(err){
        console.error('could net connect to MongoDB');
        console.error(err);
    }
});

var fs = require('fs');
console.log('load '+targetName);

var lineList = fs.readFileSync(targetName).toString().split('\n');
// header remove
lineList.shift();

//remove last blank line
lineList = lineList.slice(0, lineList.length-1);

var LifeIndexKma = require('../models/lifeIndexKma');

function getAreaNo(town, gCoord, callback) {
    var coords = [gCoord.lon, gCoord.lat];


    LifeIndexKma.find({'town.first':town.first, 'town.second':town.second, 'town.third':town.third}).lean().exec(function (err, indexDataList) {
        if (err || indexDataList.length == 0)  {
            console.log('Fail to find town='+JSON.stringify(town));
            LifeIndexKma.find({geo: {$near:coords, $maxDistance: 0.1}}).limit(3).lean().exec(function (err, indexDataList) {
                if (err) {
                    console.log(err);
                    return callback(err);
                }
                if (indexDataList.length === 0) {
                    err = new Error("Fail to get index data list");
                    console.log(err);
                    return callback(err);
                }
                callback(err, indexDataList[0].areaNo);
            });
            return;
        }
        callback(err, indexDataList[0].areaNo);
    });
}

function updateAreaNoByDb() {
    var callCount = 0;
   lineList.forEach(function (town, index) {
       var townInfo = town.split(",");
       var townName = {first:townInfo[0], second:townInfo[1], third:townInfo[2]};
       var gCoord = {lon: townInfo[4], lat: townInfo[3]};

       callCount++;

       getAreaNo(townName, gCoord, function (err, areaNo) {
           if (err) {
               return;
           }
           townInfo[3] = parseFloat(townInfo[3]).toFixed(7).toString();
           townInfo[4] = parseFloat(townInfo[4]).toFixed(7).toString();
           townInfo[5] = areaNo;
           lineList[index] = townInfo.toString();
           //console.log(townInfo.toString());
           callCount--;
           if (callCount == 0) {
               lineList.forEach(function (town) {
                   console.log(town);
               });
               mongoose.disconnect();
           }
       });
   });
}

updateAreaNoByDb();
