/**
 * Created by aleckim on 2015. 12. 3..
 */

"use strict";

var fs = require('fs');
var req = require('request');
var async = require('async');
var config = require('../config/config');
var srcName = './utils/data/base.csv';
var dstName = './utils/data/newBase.csv';
const axios = require('axios');

var lineList = fs.readFileSync(srcName).toString().split('\n');
//remove header
lineList.shift();
//remove last blank line
lineList = lineList.slice(0, lineList.length-1);

var baseList = [];

function saveDst() {
  baseList.sort();
  baseList.unshift('대분류,중분류,소분류,위도,경도,지점코드');
  fs.writeFile(dstName, baseList.join('\n'), function (err) {
    if(err) {
      throw err;
    }
    console.log('File write completed');
  });
}

/**
 *
 * @param address
 * @param callback
 */
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
 * DAUM API, it's not useful anymore.
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

    console.log(url);
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

function makeNewBase (list) {

    async.mapSeries(list,
        function(townInfo, callback) {
            var townArray = townInfo.split(',');
            var address = townArray[0]+","+townArray[1]+","+townArray[2];
            console.log(address);

            //if town had geo info, skip getting geo info
            if (townArray[3]) {
                return callback();
            }
            // getGeoCodeFromDaum(address, function (err, body) {
            getGeoCodeFromKakao(address, function (err, body) {
                if (err) {
                    console.log(err);
                    callback(err);
                    return;
                }
                try {
                    console.log(body.documents[0].y);
                    var output = townArray[0]+","+townArray[1]+","+townArray[2]+","+body.documents[0].y.toFixed(7)+","+
                        body.documents[0].x.toFixed(7);
                    //+","+body.channel.item[0].title;

                    /* No more useful
                    console.log(body.channel.item[0].lat);
                    var output = townArray[0]+","+townArray[1]+","+townArray[2]+","+body.channel.item[0].lat.toFixed(7)+","+
                        body.channel.item[0].lng.toFixed(7);
                        //+","+body.channel.item[0].title;

                    */
                    console.log(output);
                    baseList.push(output);
                    callback(null, output);
                }
                catch(e) {
                    console.log(e);
                    console.log(body);
                    callback(e);
                }
            });
        },
        function (err, results) {
            if (err) {
                return console.log(err);
            }
            //if (newList.length != 0) {
            //    console.log("Again for rest of list");
            //    makeNewBase(newList);
            //}
            //else {
                console.log(results.length);
                saveDst();
            //}
        });
}

makeNewBase(lineList);


