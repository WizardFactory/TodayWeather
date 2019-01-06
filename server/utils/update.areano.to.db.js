/**
 * Created by Alec Kim on 2018. 6. 15..
 * areano csv 정보를 town과 areanolist에 업데이트함.
 */

"use strict";

const mongoose = require('mongoose');
const async = require('async');
const fs = require('fs');
const request = require('request');
const axios = require('axios');

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

function getGeoCodeFromKakao(address, callback) {
    var keyList = JSON.parse(config.keyString.daum_keys);
    var daum_key = keyList[Math.floor(Math.random() * keyList.length)];
    let url = 'https://dapi.kakao.com/v2/local/search/address.json'+
        '?query='+ encodeURIComponent(address);
    let header = {
        Authorization: 'KakaoAK ' + daum_key
    };


    axios.get(url, {headers:header})
    .then(response=>{

        if(response.data.meta.total_count < 0){
            return callback(new Error('There is no coord data'));
        }

        let geo = [parseFloat(response.data.documents[0].x.toFixed(7)),
            parseFloat(response.data.documents[0].y.toFixed(7))];
        return callback(undefined, geo);
    })
    .catch(e=>{
        callback(e);
    });
}

/**
 * DAUM API, it's not available
 * @param address
 * @param callback
 *
function getGeoCodeFromDaum(address, callback) {
    var keyList = JSON.parse(config.keyString.daum_keys);
    var daum_key = keyList[Math.floor(Math.random() * keyList.length)];

    var url = 'https://apis.daum.net/local/geo/addr2coord'+
        '?apikey=' + daum_key +
        '&q='+ encodeURIComponent(address) +
        '&output=json';

    // console.log(url);

    request(url, {json:true}, (err, response, body) => {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }

        let geo;
        try {
            geo = [parseFloat(body.channel.item[0].lng.toFixed(7)),
                parseFloat(body.channel.item[0].lat.toFixed(7))];
        }
        catch (e) {
           return callback(e);
        }

        return callback(err, geo);
    });
}
*/

function updateAreaNoDb(areaInfo, callback) {
    // console.info('model.areano',JSON.stringify(areaInfo));
    let query = _query(areaInfo);
    ModelAreaNo.find(query).lean().exec((err, result)=> {
        if (err) {
            return callback(err);
        }
        if (result.length === 0) {
            // err = new Error('Not found '+JSON.stringify(areaInfo.town));
            // return callback(err);
            var objAreaNo = {town: areaInfo.town, areaNo: areaInfo.areaNo, updatedAt: "20180119"};
            var addr = areaInfo.town.first + ',' + areaInfo.town.second + ',' + areaInfo.town.third;
            // getGeoCodeFromDaum(addr, (err, geo)=> {
            getGeoCodeFromKakao(addr, (err, geo)=> {
                if (err) {
                    return callback(err);
                }
                objAreaNo.geo = geo;
                console.info('New AreaNo',JSON.stringify(objAreaNo));
                ModelAreaNo.update(query, objAreaNo, {upsert:true}, callback);
            });
        }
        else {
            ModelAreaNo.update(query,
                { $set: {areaNo: parseInt(areaInfo.areaNo), updatedAt: "20180119"}},
                callback);
        }
    });
}

function updateTownDb(areaInfo, callback) {
    let query = _query(areaInfo);
    ModelTown.update(query,
        { $set: {areaNo: areaInfo.areaNo}},
        callback);
}

function updateDb(areaInfo, callback) {

    updateAreaNoDb(areaInfo, (err, result)=> {
        if (err) {
            console.error(err.message);
        }
        else {
            console.info('updateAreaNoDb', areaInfo, result)
        }
    });

    updateTownDb(areaInfo, (err, result)=> {
        if (err) {
            console.error(err);
        }
        console.info('updateTownDb', areaInfo, result);
        callback();
    });

    if (areaInfo.town.third.indexOf('제') > 0) {
        let areaInfo2 = JSON.parse(JSON.stringify(areaInfo));
        areaInfo2.town.third = areaInfo2.town.third.replace('제','');

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
            (err, results)=> {
                console.info('finish');
            });
    }
    else {
        console.error(`line list length=${lineList.length}`);
    }
}

updateAreaNo();
