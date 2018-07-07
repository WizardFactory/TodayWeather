/**
 * Created by Peter on 2016. 8. 13..
 */

var fs = require('fs');
var srcName = './utils/data/cityList.csv';
var req = require('request');
var xml2json  = require('xml2js').parseString;
var async = require('async');

var lineList = fs.readFileSync(srcName).toString().split('\n');

lineList = lineList.slice(0, lineList.length-1);

function convertGeocodeByGoogle(first, second, callback) {
    var encodedUrl;

    var url = 'https://maps.googleapis.com/maps/api/geocode/xml?address=' + first + second + '&language=en';
    encodedUrl = encodeURI(url);

    req.get(encodedUrl, null, function(err, response, body){
        if(err) {
            if(callback){
                callback(err);
            }
            return;
        }
        var statusCode = response.statusCode;

        if(statusCode >= 400){
            err = new Error("StatusCode="+statusCode);

            if(callback){
                callback(err);
            }
            return;
        }

        //console.log(body);
        xml2json(body, function(err, result) {
            var geocode = {
                lat: 0,
                lon: 0
            };

            try {
                if (result.GeocodeResponse.error_message) {
                    err = new Error(result.GeocodeResponse.error_message[0]);
                    console.error('Error : ', result.GeocodeResponse.error_message[0], first, second);
                    return;
                }
                if (result.GeocodeResponse.status[0] == 'ZERO_RESULTS') {
                    err = new Error(result.GeocodeResponse.status[0]);
                    console.error('Error : zeo result', first, second);
                    return;
                }
                geocode.lat = parseFloat(result.GeocodeResponse.result[0].geometry[0].location[0].lat[0]);
                geocode.lon = parseFloat(result.GeocodeResponse.result[0].geometry[0].location[0].lng[0]);
            }
            catch(e){
                e.message += ', first:'+first+', second:'+second;
                log.error(e);
            }
            finally{
                if(callback){
                    callback(err, geocode);
                }
            }
        });
    });
}

function makeGeocodeList(){
    var addrList = '';

    async.mapSeries(lineList,
    function(line, callback){
        var addr = line.split(',');
        convertGeocodeByGoogle(addr[0], addr[1], function(err, result){
            if(err){
                console.error('Fail to get geocode : ', addr);
                addrList += addr[0] + ',' + addr[1] + ',0,0\n';
                callback(null);
                return;
            }

            addrList += addr[0] + ',' + addr[1] + ',' + result.lat + ',' + result.lon + '\n';

            callback(null);
        });
    },
    function(err, result){
        if(err){
            console.error('Fail to make list');
            return;
        }
        console.log('success to make list');

        fs.writeFileSync('./utils/data/cityGeocodeList.csv', addrList,'utf8');
    });
}

makeGeocodeList();