
"use strict";

var events = require('events');
var req = require('request');
var xml2json  = require('xml2js').parseString;
var convert = require('./coordinate2xy');

function convertGeocode(first, second, third, callback){
    var self = this;
    var url = 'https://maps.googleapis.com/maps/api/geocode/xml';
    var encodedUrl = '';

    var meta = {};
    meta.method = 'convertGeocode';
    meta.first = first;
    meta.second = second;
    meta.third = third;

    url += '?address=' + first + second + third + '&language=ko';
    encodedUrl = encodeURI(url);
    meta.url = url;

    log.info(meta.method + ' : ', url);
    req.get(encodedUrl, null, function(err, response, body){
        var statusCode = response.statusCode;
        if(err) {
            //log.error(err);
            //log.error('#', meta);

            if(callback){
                callback(err);
            }
            return;
        }

        if(statusCode === 404 || statusCode === 403 || statusCode === 400){
            //log.error('ERROR!!! StatusCode : ', statusCode);
            //log.error('#', meta);

            if(callback){
                callback(err);
            }
            return;
        }

        //log.info(body);
        xml2json(body, function(err, result){
            var geocode = {
                lat: 0,
                lon: 0
            };
            var resultXY = {
                mx: 0,
                my: 0
            };
            try {
                //log.info(result);
                //log.info(result.GeocodeResponse.result[0].geometry[0].location[0]);
                //log.info('lat : ' + result.GeocodeResponse.result[0].geometry[0].location[0].lat[0]);
                //log.info('lng : ' + result.GeocodeResponse.result[0].geometry[0].location[0].lng[0]);

                geocode.lat = parseFloat(result.GeocodeResponse.result[0].geometry[0].location[0].lat[0]);
                geocode.lon = parseFloat(result.GeocodeResponse.result[0].geometry[0].location[0].lng[0]);

                log.info('lat:', geocode.lat, 'lon:', geocode.lon);

                var conv = new convert(geocode, {}).toLocation();
                resultXY.mx = conv.getLocation().x;
                resultXY.my = conv.getLocation().y;

                log.info('mx:', resultXY.mx, 'my :', resultXY.my);
            }
            catch(e){
                log.error('## Error!!!', meta);
            }
            finally{
                if(callback){
                    callback(err, resultXY);
                }
            }
        });
    });
}

module.exports = convertGeocode;

