/**
 * Created by Peter on 2017. 5. 17..
 */

"use strict";

var req = require('request');
var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');
var sourceFile = './utils/data/20160704_AreaNo';
var resultFile = './utils/data/20160704_AreaNoResult';
var updatedFile = './utils/data/20160704_AreaNoResult_updated';
var Logger = require('../lib/log');
const axios = require('axios');

global.log  = new Logger(__dirname + "/debug.log");

mongoose.connect(config.db.path, config.db.options, function(err){
    if(err){
        log.error('could net connect to MongoDB');
        log.error(err);
    }
});

var fs = require('fs');
var areaDoc = require('../models/modelAreaNo');
var lineList = fs.readFileSync(sourceFile).toString().split('\n');
var confirmResult = [];
var updatedResult = [];
lineList.shift();

log.info('Source of Area Number File : ' + sourceFile);

function getGeoCodeFromKakao(address, callback) {
    var keyList = JSON.parse(config.keyString.daum_keys);
    var daum_key = keyList[Math.floor(Math.random() * keyList.length)];
    let url = 'https://dapi.kakao.com/v2/local/search/address.json'+
        '?query='+ encodeURIComponent(address);
    let header = {
        Authorization: 'KakaoAK ' + daum_key
    };

    log.info(url);
    axios.get(url, {headers:header})
    .then(response=>{
        return callback(undefined, response.data);
    })
    .catch(e=>{
        callback(e);
    });
}

/**
 * DAUM API, it's not available anymore
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

    log.info(url);

    req(url, {json:true}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }
        return callback(err, body);
    });
}
*/

function createAreaNumberStruct (err) {
    if (err) {
        log.error(err);
        process.exit(1);
    }

    if (lineList.length) {
        var line = lineList.shift();
        var savedData = {
            areaNo: 1,
            town:{
                first: '',
                second: '',
                third: ''
            },
            geo: {
                type: [],
                index: '2d'
            }
        }; // for Debugging

        line = line.replace(/\r/g, "");
        //line = line.replace(/' '/g, ',');
        line = line.replace(/\t/g, ' ');

        line.split(' ').forEach(function (entry, i) {
            if(i === 0){
                savedData.areaNo = parseInt(entry);
            } else if(i === 1){
                savedData.town.first = entry;
            } else if(i === 2){
                savedData.town.second = entry;
            } else if(i === 3) {
                savedData.town.third = entry;
            }

        });

        areaDoc.find({town: savedData.town}, function(err, result){
            if(err){
                log.error('Fail to find town list from DB :', err);
                return;
            }

            if(result.length === 0){
                var addr = savedData.town.first + ',' + savedData.town.second + ',' + savedData.town.third;
                // getGeoCodeFromDaum(addr, function(err, body){
                getGeoCodeFromKakao(addr, function(err, body){
                    if(err){
                        log.error('Fail to get geocode : ', addr);
                        return;
                    }
                    try{
                        if(body.meta.total_count > 0){
                            savedData.geo = [parseFloat(body.documents[0].x.toFixed(7)), parseFloat(body.documents[0].y.toFixed(7))];
                        }else{
                            savedData.geo = [1,1];
                        }

                        /* It's for DAUM API and no more useful.
                        if(body.channel.item.length > 0){
                            savedData.geo = [parseFloat(body.channel.item[0].lng.toFixed(7)), parseFloat(body.channel.item[0].lat.toFixed(7))];
                        }else{
                            savedData.geo = [1,1];
                        }
                        */

                        log.info('AreaNo. : ', JSON.stringify(savedData));
                        confirmResult.push(JSON.stringify(savedData));

                        areaDoc.update({town:savedData.town}, savedData, {upsert:true}, createAreaNumberStruct);
                    }
                    catch(e){
                        log.error(e);
                        areaDoc.update({town:savedData.town}, savedData, {upsert:true}, createAreaNumberStruct);
                    }
                });
            }else{
                var item = result[0];

                savedData.geo = item.geo;

                confirmResult.push(JSON.stringify(savedData));
                if(savedData.areaNo != item.areaNo){
                    log.info('updated areaNo : ', savedData.areaNo, item.areaNo);
                    log.info('updated data : ', savedData);
                    updatedResult.push(JSON.stringify(savedData));
                }
                areaDoc.update({town:savedData.town}, savedData, {upsert:true}, createAreaNumberStruct);
            }
        });

    } else {
        log.info('Finish');
        fs.writeFileSync(resultFile, confirmResult.join('\n'), 'utf8');
        fs.writeFileSync(updatedFile, updatedResult.join('\n'), 'utf8');
        areaDoc.find({},function(err,docs){
            if (err) {throw err;}
            log.info('total count : ', docs.length);
            mongoose.disconnect();
            process.exit(0);
        });
    }
}

createAreaNumberStruct(null);

