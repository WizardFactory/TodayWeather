/**
 * Created by aleckim on 2016. 10. 16..
 */

var fs = require('fs');
var GeocodeList = fs.readFileSync('./utils/data/cityGeocodeList.csv').toString().split('\n');
var req = require('request');

var geolocationNormalize = function (coords) {
    var baseLength = 0.25;
    var lat = coords.lat;
    var lon = coords.long;
    //console.log (lat + " " + lon);

    var normal_lat = lat - (lat%baseLength) + baseLength/2;
    var normal_lon = lon - (lon%baseLength) + baseLength/2;
    return {lat: normal_lat, long: normal_lon};
};

function getGeoCodeFromGoogle(address, callback) {
    var url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + address;

    req(url, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }

        console.log(body);
        return callback(err, body);
    });
}

function normalizeGeoCode() {
    GeocodeList.forEach(function (localInfoStr) {
        localInfoStr = String(localInfoStr).replace('\t','');
        localInfoStr = String(localInfoStr).replace('\t','');
        var localInfoArray = localInfoStr.split(',');
        if (localInfoArray[1] == undefined) {
            return;
        }
        var geoNormalize = geolocationNormalize({lat: localInfoArray[2], long: localInfoArray[3]});
        //console.log('lat='+localInfoArray[2]+" lng="+localInfoArray[3]+' nlat='+geoNormalize.lat+' nLng='+geoNormalize.long);
        console.log(localInfoArray[0]+","+localInfoArray[1]+","+ geoNormalize.lat+","+ geoNormalize.long);
    });
}

normalizeGeoCode();

