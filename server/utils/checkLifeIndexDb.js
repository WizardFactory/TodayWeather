/**
 * Created by aleckim on 2016. 3. 27..
 * lifeIndexKma에 들어 있는 데이터 확인하기 위해서 만들었음.
 */

var fs = require('fs');
var mongoose = require('mongoose');

var config = require('../config/config.js');
var LifeIndexKma = require('../models/lifeIndexKma');

var indexList = fs.readFileSync('./utils/data/KMA_INDEX_AREA_NO.csv').toString().split('\n');

mongoose.connect(config.db.path, function(err) {
    if (err) {
        console.error('Could not connect to MongoDB!');
        console.log(err);
        done();
    }
});

mongoose.connection.on('error', function(err) {
    console.error('MongoDB connection error: ' + err);
});


function checkLifeIndexDb() {
    indexList.shift();
    indexList.shift();
    indexList = indexList.slice(0, indexList.length-1);

    //indexList.forEach(function(indexArea) {
    //    var area = indexArea.split(',');
    //    console.log(area[1], area[2], area[3], area[4]);
    //});

    var i=0;

    LifeIndexKma.find({}).lean().exec(function (err, lifeIndexKmaList) {
        if (err) {
            console.log(err);
        }
        console.log(lifeIndexKmaList.length);

        console.log('it is only in CSV');
        indexList.forEach(function(indexArea) {
            var findIt = false;
            var area = indexArea.split(',');
            //console.log(area[1], area[2], area[3], area[4]);
            for (i=0; i<lifeIndexKmaList.length; i++) {
                if (area[0] === lifeIndexKmaList[i].areaNo) {
                    findIt = true;
                    lifeIndexKmaList[i].findIt = findIt;
                    break;
                }
                if (area[1] === lifeIndexKmaList[i].town.first &&
                    area[2] === lifeIndexKmaList[i].town.second &&
                    area[3] === lifeIndexKmaList[i].town.third) {
                    //console.log(JSON.stringify(lifeIndexKmaList[i].town));
                    findIt = true;
                    lifeIndexKmaList[i].findIt = findIt;
                    break;
                }
            }
            if (!findIt) {
                console.log(area[0], area[1], area[2], area[3]);
            }
        });

        console.log('it is only in DB');
        lifeIndexKmaList.forEach(function (lifeIndexKma) {
           if (!lifeIndexKma.findIt) {
              console.log('areaNo='+lifeIndexKma.areaNo+' lifeIndex.town='+JSON.stringify(lifeIndexKma.town));
           }
        });
    });
}

checkLifeIndexDb();
