/**
 * Created by aleckim on 2016. 3. 28..
 * db에 life index 관련 데이터를 갱신함. areaNoKma 한 후에 최신인 KMA_INDEX_AREA_NO를 함.
 *
 */

var fs = require('fs');
var mongoose = require('mongoose');

var config = require('../config/config.js');
var LifeIndexKma = require('../models/lifeIndexKma');

//var indexList = fs.readFileSync('./utils/data/areaNoKma.csv').toString().split('\n');
var indexList = fs.readFileSync('./utils/data/KMA_INDEX_AREA_NO.csv').toString().split('\n');

var baseList = fs.readFileSync('./utils/data/base.csv').toString().split('\n');

function findGeoInfo(f, s, t) {
    for (var i=0; i<baseList.length; i++) {
        var base = baseList[i].split(',');
        if (f === base[0] && s === base[1] && t === base[2]) {
            return base;
        }
    }
    console.log('Fail to find geoinfo ='+f+s+t);
    return undefined;
}

mongoose.connect(config.db.path, function(err) {
    if (err) {
        console.error('Could not connect to MongoDB!');
        console.log(err);
        done();
    }
});

console.log("connect = "+config.db.path);

mongoose.connection.on('error', function(err) {
    console.error('MongoDB connection error: ' + err);
});

function updateLifeIndexDb() {
    indexList.shift();
    indexList.shift();
    indexList = indexList.slice(0, indexList.length - 1);

    LifeIndexKma.find({}).exec(function (err, lifeIndexKmaList) {
        if (err) {
            console.log(err);
        }
        console.log(lifeIndexKmaList.length);

        indexList.forEach(function(areaInfo) {
            var area = areaInfo.split(',');
            var areaNo;
            if (area.length <=4) {
                areaNo = parseInt(area[3]).toString();
            }
            else {
                areaNo = parseInt(area[5]).toString();
            }

            for(var i=0; i<lifeIndexKmaList.length; i++) {
                var base = lifeIndexKmaList[i];
                //console.log("["+area[0]+']['+area[1]+"]["+area[2]+"]");
                //console.log("["+base.town.first+']['+base.town.second+"]["+base.town.third+"]");
                if (base.areaNo === areaNo) {
                    //console.log("Found it area=", areaInfo);
                    if (base.town.first === area[0] && base.town.second === area[1] &&
                        base.town.third === area[2]) {
                    }
                    else {
                        console.log("same area no but different town name");
                        console.log(area.toString());
                        console.log(base.toString());
                        lifeIndexKmaList[i].town.first = area[0];
                        lifeIndexKmaList[i].town.second = area[1];
                        lifeIndexKmaList[i].town.third = area[2];

                        var geoInfo=[];
                        if (area.length <=4) {
                            //get geo info
                            var baseGeo = findGeoInfo(area[0], area[1], area[2]);
                            if (base) {
                                geoInfo.push(parseFloat(baseGeo[4]));
                                geoInfo.push(parseFloat(baseGeo[3]));
                            }
                            areaNo = parseInt(area[3]).toString();

                        }
                        else {
                            areaNo = parseInt(area[5]).toString();
                            geoInfo.push(parseFloat(area[4]));
                            geoInfo.push(parseFloat(area[3]));
                        }
                        lifeIndexKmaList[i].geo = geoInfo;
                        lifeIndexKmaList[i].save(function (err) {
                            if (err) {
                                console.log(err);
                            }

                            console.log('update areaNo='+areaNo);
                        });
                    }
                    break;
                }
            }
            if (i>=lifeIndexKmaList.length) {
                console.log('add new area=', areaInfo);
                var town = {};
                var areaNo;
                var geoInfo=[];

                town.first = area[0];
                town.second = area[1];
                town.third = area[2];

                if (area.length <=4) {
                    //get geo info
                    var base = findGeoInfo(area[0], area[1], area[2]);
                    if (base) {
                        geoInfo.push(parseFloat(base[4]));
                        geoInfo.push(parseFloat(base[3]));
                    }
                    areaNo = parseInt(area[3]).toString();

                }
                else {
                    areaNo = parseInt(area[5]).toString();
                    geoInfo.push(parseFloat(area[4]));
                    geoInfo.push(parseFloat(area[3]));
                }
                //console.log(JSON.stringify(town)+' '+areaNo+' '+geoInfo.toString());
                var lifeIndex =  new LifeIndexKma({town: town, areaNo: areaNo, geo:geoInfo});
                lifeIndex.save(function(err) {
                  if (err) {
                      console.log(err);
                  }
                    console.log('saved town'+JSON.stringify(town));
                });
            }
        });

        //mongoose.disconnect();
    });
}

updateLifeIndexDb();

