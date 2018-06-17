/**
 * Created by Alec Kim on 2018. 6. 15..
 * areano csv 정보를 town과 areanolist에 업데이트함.
 */

"use strict";

const mongoose = require('mongoose');
const async = require('async');
const fs = require('fs');

const ModelAreaNo = require('../models/modelAreaNo');
const ModelTown = require('../models/town');

const config = require('../config/config');
const Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

const fileKmaAreaNo = './utils/data/20180119_kma_lifeindex_areano.csv';

console.info('Source of Area Number File : ' + fileKmaAreaNo);

let lineList = fs.readFileSync(fileKmaAreaNo).toString().split('\n');
lineList.shift();

mongoose.connect(config.db.path, (err)=> {
    if(err){
        console.error('could net connect to MongoDB');
        console.error(err);
    }
});

function _query(areaInfo) {
    return {
        "town.first":areaInfo.town.first,
        "town.second":areaInfo.town.second,
        "town.third":areaInfo.town.third };
}

function updateAreaNoDb(areaInfo, callback) {
    console.info('model.areano',JSON.stringify(areaInfo));
    let query = _query(areaInfo);
    ModelAreaNo.update(query,
        { $set: {areaNo: parseInt(areaInfo.areaNo)}},
        callback);
}

function updateTownDb(areaInfo, callback) {
    console.info('model.town',JSON.stringify(areaInfo));
    let query = _query(areaInfo);
    ModelTown.update(query,
        { $set: {areaNo: areaInfo.areaNo}},
        callback);
}

function updateDb(areaInfo, callback) {

    updateAreaNoDb(areaInfo, (err)=> {
        if (err) {
            console.error(err);
        }
    });
    updateTownDb(areaInfo, (err)=> {
        if (err) {
            console.error(err);
        }
        callback();
    });

    if (areaInfo.town.third.indexOf('제') > 0) {
        let areaInfo2 = JSON.parse(JSON.stringify(areaInfo));
        areaInfo2.town.third = areaInfo2.town.third.replace('제','');
        updateAreaNoDb(areaInfo2, (err)=> {
            if (err) {
                console.error(err);
            }
        });
        updateTownDb(areaInfo2, (err)=> {
            if (err) {
                console.error(err);
            }
        });
    }
}

function updateAreaNo() {
    if (lineList.length > 0) {
        async.mapSeries(lineList,
            (line, callback)=> {
                let arrayAreaInfo = line.split(',');
                let objAreaInfo = {
                    areaNo:arrayAreaInfo[0],
                    town:{
                        first: arrayAreaInfo[1],
                        second: arrayAreaInfo[2],
                        third: arrayAreaInfo[3],
                    }};
                if (objAreaInfo.town.first == undefined) {
                    return callback(null);
                }
                updateDb(objAreaInfo, callback);
            },
            (err, result)=> {
                console.info('finish');
            });
    }
    else {
        console.error(`line list length=${lineList.length}`);
    }
}

updateAreaNo();
