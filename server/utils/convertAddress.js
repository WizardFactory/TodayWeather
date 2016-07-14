/**
 * Created by Peter on 2016. 3. 12..
 */

"use strict";

var req = require('request');
var xml2json  = require('xml2js').parseString;
var keyBox = require('../config/config').keyString;

function getAddressByGeocode(lat, lon, callback, language) {
    var encodedUrl;

    var meta = {};
    meta.method = 'getCountryNameByGeocode';
    meta.lat = lat;
    meta.lon = lon;

    var url = 'https://maps.googleapis.com/maps/api/geocode/json';
    if(language) {
        url += '?latlng='+ lat + ',' + lon + '&language=' + language;
    }
    else{
        url += '?latlng='+ lat + ',' + lon + '&language=en';
    }
    encodedUrl = encodeURI(url);

    log.info(url);
    req.get(encodedUrl, null, function(err, response, body){
        if(err) {
            if(callback){
                callback(err);
            }
            return;
        }
        var statusCode = response.statusCode;

        if(statusCode === 404 || statusCode === 403 || statusCode === 400){
            err = new Error("StatusCode="+statusCode);

            if(callback){
                callback(err);
            }
            return;
        }

        var result = JSON.parse(body);
        var address = {};

        //log.info(result);
        if(result.hasOwnProperty('results')){
            if(Array.isArray(result.results)
                && result.results[0].hasOwnProperty('address_components')){
                result.results[0].address_components.forEach(function(type){
                    if(type.hasOwnProperty('types')){
                        type.types.forEach(function(item){
                            if(item === 'country'){
                                address = {long_name:type.long_name, short_name:type.short_name};
                            }
                        });
                    }
                });
            }
        }

        if(callback){
            callback(err, address);
        }
    });
}

function convertAddress(lat, lon, callback, language){
    getAddressByGeocode(lat, lon, function(err, result){
        if(err){
            if(callback){
                callback(err);
            }
            return;
        }

        if(callback){
            callback(err, result);
        }
    }, language);
}

module.exports = convertAddress;

