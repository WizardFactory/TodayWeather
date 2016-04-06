/**
 * Created by aleckim on 2016. 3. 29..
 * base.csv를 가지고, 기존 데이터를 갱신하고 없는 경우는 추가함.
 * towns.js를 cache적인 의미로 변경될 예정이므로 없어진 도시 정보도 유지할 예정임.
 */

"use strict";

var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');
var targetName = './utils/data/base.csv';

console.log('db connect '+config.db.path);
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

var tDoc = require('../models/town');

function updateTowns() {

    var saveCount = 0;
    var wantToUpdate = false;

    tDoc.find({}).exec(function (err, townList) {
        if (err) {
            console.log(err);
        }

        lineList.forEach(function (newTownInfoStr) {
            var newTownInfo = newTownInfoStr.split(",");
            var dbTown;
            var conv;

            for (var i=0; i<townList.length; i++) {
                dbTown = townList[i];

                if (dbTown.town.first === newTownInfo[0] &&
                    dbTown.town.second === newTownInfo[1] &&
                    dbTown.town.third === newTownInfo[2]) {

                    if (wantToUpdate) {
                        dbTown.gCoord.lat = parseFloat(newTownInfo[3]);
                        dbTown.gCoord.lon = parseFloat(newTownInfo[4]);
                        if (newTownInfo[5]) {
                            dbTown.areaNo = parseInt(newTownInfo[5]).toString();
                        }
                        else {
                            dbTown.areaNo = undefined;
                        }

                        conv = new convert(dbTown.gCoord, {}).toLocation();
                        dbTown.mCoord.mx = conv.getLocation().x;
                        dbTown.mCoord.my = conv.getLocation().y;
                        saveCount++;

                        console.log('update town info='+dbTown.toString());
                        dbTown.save(function(err) {
                            if (err) {
                                console.log(err);
                            }
                            saveCount--;
                            if (saveCount === 0) {
                                mongoose.disconnect();
                            }
                        });
                    }
                    else {
                        //console.log('skip town info='+dbTown.town.toString());
                    }
                    break;
                }
            }
            if (i >= townList.length) {
                var newTown = {};
                newTown.town = {first:newTownInfo[0], second:newTownInfo[1], third:newTownInfo[2]};
                newTown.gCoord = {lat:parseFloat(newTownInfo[3]), lon:parseFloat(newTownInfo[4])};
                if (newTownInfo[5]) {
                    newTown.areaNo = parseInt(newTownInfo[5]).toString();
                }
                else {
                    newTown.areaNo = undefined
                }

                conv = new convert(newTown.gCoord, {}).toLocation();
                newTown.mCoord = {mx: conv.getLocation().x, my: conv.getLocation().y};

                dbTown = new tDoc(newTown);
                saveCount++;
                console.log('save new town info='+JSON.stringify(newTown));
                dbTown.save(function (err) {
                    if (err) {
                        console.log(err);
                    }
                    saveCount--;
                    if (saveCount === 0) {
                        mongoose.disconnect();
                    }
                });
            }
        });
        console.log('finish loop, waiting for saving');
    });
}

updateTowns();
