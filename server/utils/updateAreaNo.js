/**
 * Created by Peter on 2017. 5. 17..
 */

"use strict";

var req = require('request');
var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');
var sourceFile = './utils/data/20160704_AreaNo';
var resultFile = './utils/data/20160704_AreaNoResutl';
var Logger = require('../lib/log');
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
var result = [];
lineList.shift();

log.info('Source of Area Number File : ' + sourceFile);

function getGeoCodeFromDaum(address, callback) {
    var url = 'https://apis.daum.net/local/geo/addr2coord'+
        '?apikey=' + config.keyString.daum_key +
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

function createAreaNumberStruct (err) {
    if (err) {
        log.error(err);
        process.exit(1);
    }

    if (lineList.length) {
        var line = lineList.shift();
        var document = new areaDoc();
        var savedData = {}; // for Debugging

        line = line.replace(/\r/g, "");
        //line = line.replace(/' '/g, ',');
        line = line.replace(/\t/g, ' ');

        line.split(' ').forEach(function (entry, i) {
            if(i === 0){
                document.areaNo = parseInt(entry);
                savedData.areaNo = parseInt(entry);
            } else if(i === 1){
                document.town.first = entry;
                savedData.town = {};
                savedData.town.first = entry;
            } else if(i === 2){
                document.town.second = entry;
                savedData.town.second = entry;
            } else if(i === 3) {
                document.town.third = entry;
                savedData.town.third = entry;
            }

        });

        var addr = document.town.first + ',' + document.town.second + ',' + document.town.third;
        getGeoCodeFromDaum(addr, function(err, body){
            if(err){
                log.error('Fail to get geocode : ', addr);
                return;
            }
            try{
                if(body.channel.item.length > 0){
                    document.geocode.lat = body.channel.item[0].lat.toFixed(7);
                    document.geocode.lon = body.channel.item[0].lng.toFixed(7);
                    savedData.geocode = {
                        lat: document.geocode.lat,
                        lon: document.geocode.lon
                    };
                }

                log.info('AreaNo. : ', JSON.stringify(savedData));
                result.push(JSON.stringify(savedData));

                document.save(createAreaNumberStruct);
            }
            catch(e){
                log.error(e);
                document.save(createAreaNumberStruct);
            }
        });
    } else {
        log.info('Finish');
        fs.writeFileSync(resultFile, result.join('\n'), 'utf8');
        areaDoc.find({},function(err,docs){
            if (err) {throw err;}
            log.info('total count : ', docs.length);
            mongoose.disconnect();
            process.exit(0);
        });
    }
}

createAreaNumberStruct(null);

