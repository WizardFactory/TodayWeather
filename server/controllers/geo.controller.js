/**
 *
 * Created by aleckim on 2017. 11. 8..
 */

"use strict";

var async = require('async');
var request = require('request');
var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

var config = require('../config/config');

var daumKeys = JSON.parse(config.keyString.daum_keys);
var googleApiKey = config.keyString.google_key;

function GeoController(lat, lon, lang, country) {
    var API_DAUM_DOMAIN = 'apis.daum.net';
    var MAPS_GOOGLEAPIS_DOMAIN = 'maps.googleapis.com';

    this.lat = lat;
    this.lon = lon;
    this.lang = lang;
    this.country = country;
    this.kmaAddress = null;
    this.address = "";
    this.name = "";
    this.daumUrl = 'https://'+API_DAUM_DOMAIN;
    this.googleUrl = 'https://'+MAPS_GOOGLEAPIS_DOMAIN;
}

GeoController.prototype.setGoogleApiKey = function (key) {
   googleApiKey = key;
};

GeoController.prototype._request = function(url, callback) {
    request(url, {json: true, timeout: 5000}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if (response.statusCode >= 400) {
            err = new Error("url="+url+" statusCode="+response.statusCode);
            return callback(err);
        }
        callback(err, body);
    });
};

/**
 *
 * @param lat
 * @param lng
 * @returns {boolean}
 * @private
 */
GeoController.prototype._isKoreaArea = function (lat, lon) {
    return 39.3769 >= lat && lat >=32.6942 &&
        131.88 >= lon && lon >= 123.9523;
};

GeoController.prototype._parseAddressFromDaum = function (result) {
    var geoInfo = {};

    if (result.name0 === "대한민국") {
        geoInfo.country = "KR";
        geoInfo.address = result.fullName;
        if (result.name3 && result.name3 != "") {
            geoInfo.name = result.name3;
        }
        else if (result.name2 && result.name2 != "") {
            geoInfo.name = result.name2;
        }
        else if (result.name1 && result.name1 != "") {
            geoInfo.name = result.name1;
        }
        else if (result.name0 && result.name0 != "") {
            geoInfo.name = result.name0;
        }
        //remove space in "성남시 분당구"
        var name2 = result.name2;
        if (name2) {
            name2 = name2.replace(/ /g,"");
        }
        geoInfo.kmaAddress = {"region": result.name1, "city": name2, "town": result.name3};
    }
    else if (result.name0 === "일본") {
        geoInfo.country = "JP";
    }
    else {
        log.debug("It is not korea");
    }

    return geoInfo;
};

/**
 * {"type":"H","code":"1123064","name":"역삼1동","fullName":"서울특별시 강남구 역삼1동","regionId":"I10000901",
 * "name0":"대한민국","code1":"11","name1":"서울특별시","code2":"11230","name2":"강남구","code3":"1123064",
 * "name3":"역삼1동","x":127.03306535867272,"y":37.495359482762545}
 * {"type":"H","code":"90003","name":"일본","fullName":"일본","name0":"일본",
 * "x":135.2266257553163,"y":33.63189788608174}
 * {"error":{"code":"RESULT_NOT_FOUND","message":"Results do not exist"}}
 * @param callback
 * @private
 */
GeoController.prototype._getAddressFromDaum = function (callback) {
    var that = this;
    var index = 0;

    async.retry(daumKeys.length,
        function (cb) {
            var url = that.daumUrl+'/local/geo/coord2addr'+
                '?apikey=' + daumKeys[index] +
                '&longitude='+ that.lon +
                '&latitude='+that.lat+
                '&inputCoordSystem=WGS84'+
                '&output=json';
            index++;

            log.info(url);
            that._request(url, function (err, result) {
                if(err) {
                    return cb(err);
                }
                cb(null, result);
            });
        },
        function (err, result) {
            if (err) {
                return callback(err);
            }
            callback(null, result);
        });

    return this;
};

/**
 *
 * @param result
 * @returns {{}}
 * @private
 */
function _getAddressInfoFromGoogleResult(result) {
    var sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
    var sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
    var local_types = [ "locality", "political" ];
    var info = {};
    info.address = result.formatted_address;

    for (var j=0; j < result.address_components.length; j++) {
        var address_component = result.address_components[j];
        if ( address_component.types[0] == sub_level2_types[0]
            && address_component.types[1] == sub_level2_types[1]
            && address_component.types[2] == sub_level2_types[2] ) {
            info.sub_level2_name = address_component.short_name;
        }

        if ( address_component.types[0] == sub_level1_types[0]
            && address_component.types[1] == sub_level1_types[1]
            && address_component.types[2] == sub_level1_types[2] ) {
            info.sub_level1_name = address_component.short_name;
        }

        if ( address_component.types[0] == local_types[0]
            && address_component.types[1] == local_types[1] ) {
            info.local_name = address_component.short_name;
        }
    }
    return info;
}

/**
 *
 * @param results
 * @param countryShortName
 * @returns {{name: *, address: string}}
 * @private
 */
function _getAddressInfoFromAddressComponents(results, countryShortName) {

    var sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
    var sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
    var local_types = [ "locality", "political" ];
    var country_types = ["country"];
    var sub_level2_name;
    var sub_level1_name;
    var local_name;
    var country_name;

    for (var i=0; i < results.length; i++) {
        var result = results[i];
        for (var j=0; j < result.address_components.length; j++) {
            var address_component = result.address_components[j];
            if ( address_component.types[0] == sub_level2_types[0]
                && address_component.types[1] == sub_level2_types[1]
                && address_component.types[2] == sub_level2_types[2] ) {
                sub_level2_name = address_component.short_name;
            }

            if ( address_component.types[0] == sub_level1_types[0]
                && address_component.types[1] == sub_level1_types[1]
                && address_component.types[2] == sub_level1_types[2] ) {
                sub_level1_name = address_component.short_name;
            }

            if ( address_component.types[0] == local_types[0]
                && address_component.types[1] == local_types[1] ) {
                local_name = address_component.short_name;
            }

            if ( address_component.types[0] == country_types[0] ) {
                country_name = address_component.long_name;
            }

            if (sub_level2_name && sub_level1_name && local_name && country_name) {
                break;
            }
        }

        if (sub_level2_name && sub_level1_name && local_name && country_name) {
            break;
        }
    }

    var name;
    var address = "";
    //국내는 동단위까지 표기해야 함.
    if (countryShortName === "KR") {
        if (sub_level2_name) {
            address += sub_level2_name;
            name = sub_level2_name;
        }
    }
    if (sub_level1_name) {
        address += " " + sub_level1_name;
        if (name == undefined) {
            name = sub_level1_name;
        }
    }
    if (local_name) {
        address += " " + local_name;
        if (name == undefined) {
            name = local_name;
        }
    }
    if (country_name) {
        address += " " + country_name;
        if (name == undefined) {
            name = country_name;
        }
    }

    return {name: name, address:address};
}

GeoController.prototype._parseGoogleResult = function (data) {
    if (data.status !== "OK") {
        //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
        throw new Error(data.status);
    }

    var sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
    var sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
    var local_types = [ "locality", "political" ];
    var country_types = ["country"];
    var address_sublocality_level_2;
    var address_sublocality_level_1;
    var address_locality;
    var countryName;

    for (var i=0; i < data.results.length; i++) {
        var result = data.results[i];

        //get country_name
        for (var j=0; j < result.address_components.length; j++) {
            if (countryName) {
                break;
            }
            var address_component = result.address_components[j];
            if ( address_component.types[0] == country_types[0] ) {
                if (address_component.short_name.length <= 2) {
                    countryName = address_component.short_name;
                }
            }
        }

        //postal_code
        switch (result.types.toString()) {
            case sub_level2_types.toString():
                if (!address_sublocality_level_2) {
                    address_sublocality_level_2 = _getAddressInfoFromGoogleResult(result);
                }
                break;
            case sub_level1_types.toString():
                if (!address_sublocality_level_1) {
                    address_sublocality_level_1 = _getAddressInfoFromGoogleResult(result);
                }
                break;
            case local_types.toString():
                if (!address_locality) {
                    address_locality = _getAddressInfoFromGoogleResult(result);
                }
                break;
            default:
                break;
        }
    }

    if (countryName == undefined) {
        throw new Error('country_name null');
    }

    var geoInfo = {country: countryName};
    if (address_sublocality_level_2 && countryName == "KR") {
        geoInfo.address = address_sublocality_level_2.address;
        geoInfo.name = address_sublocality_level_2.sub_level2_name;
    }
    else if (address_sublocality_level_1) {
        geoInfo.address = address_sublocality_level_1.address;
        geoInfo.name = address_sublocality_level_1.sub_level1_name;
    }
    else if (address_locality) {
        geoInfo.address = address_locality.address;
        geoInfo.name = address_locality.local_name;
    }
    else {
        geoInfo = _getAddressInfoFromAddressComponents(data.results, countryName);
        geoInfo.country = countryName;
    }

    if (geoInfo.name == undefined || geoInfo.address == undefined) {
        throw new Error('failToFindLocation');
    }

    return geoInfo;
};

GeoController.prototype._getAddressFromGoogle = function (callback) {
    var that = this;
    //retry with key
    var url = that.googleUrl+"/maps/api/geocode/json?latlng=" + that.lat + "," + that.lon;
    if (that.lang) {
        url += "&language="+that.lang;
    }
    if (googleApiKey) {
        url += "&key="+googleApiKey;
    }
    else {
        log.warn("google api key is not valid");
    }
    log.info(url);
    async.retry(3,
        function (cb) {
            that._request(url, function (err, result) {
                if (err) {
                    return cb(err);
                }
                cb(null, result);
            });
        },
        function (err, result) {
            if (err) {
                return callback(err);
            }
            callback(null, result);
        });

    return this;
};

GeoController.prototype.setInfoFromReq = function (req) {
    this.lat = req.params.lat;
    this.lon = req.params.lon;
    if (req.query) {
        this.country = req.query.country;
        this.address = req.query.address;
        this.name = req.query.name;
        this.lang = req.query.lang;
        if (req.query.kma_region) {
            this.kmaAddress = {
                "region" : req.query.kma_region,
                "city" : req.query.kma_city,
                "town" : req.query.kma_town
            };
        }
    }

    if (!this.lang && req.headers) {
        var al = req.headers['accept-language'];
        if (al) {
            this.lang = al.split('-')[0];
        }
    }
    if (this.country) {
        this.country = this.country.toUpperCase();
    }
};

/**
 * e2e test ./test/e2e/test.e2e.geo.controller.js
 * @param req
 * @param res
 * @param next
 * @returns {GeoController}
 */
GeoController.prototype.location2address = function(req, res, next) {
    var that = this;

    async.waterfall([
            function (callback) {
                if (that.country) {
                    return callback();
                }
                if (that._isKoreaArea(that.lat, that.lon)) {
                    that._getAddressFromDaum(function (err, result) {
                        try {
                            var geoInfo = that._parseAddressFromDaum(result);
                            that.country = that.country || geoInfo.country;
                            that.kmaAddress = that.kmaAddress || geoInfo.kmaAddress;
                            if (that.lang === 'ko') {
                                that.address = that.address || geoInfo.address;
                                that.name = that.name || geoInfo.name;
                            }
                        }
                        catch (e) {
                            return callback(e);
                        }
                        callback(err);
                    });
                }
                else {
                    that._getAddressFromGoogle(function (err, result) {
                        try {
                            var geoInfo = that._parseGoogleResult(result);
                            that.country = that.country || geoInfo.country;
                            that.address = that.address || geoInfo.address;
                            that.name = that.name || geoInfo.name;
                        }
                        catch(e) {
                            return callback(e);
                        }
                        callback(err);
                    });
                }
            },
            function (callback) {
                if (that.country !== 'KR') {
                    return callback();
                }
                if (that.kmaAddress) {
                    return callback();
                }

                that._getAddressFromDaum(function (err, result) {
                    try {
                        var geoInfo = that._parseAddressFromDaum(result);
                        that.country = that.country || geoInfo.country;
                        that.kmaAddress = that.kmaAddress || geoInfo.kmaAddress;
                        if (that.lang === 'ko') {
                            that.address = that.address || geoInfo.address;
                            that.name = that.name || geoInfo.name;
                        }
                    }
                    catch (e) {
                        return callback(e);
                    }
                    callback(err);
                });
            },
            function (callback) {
                if (that.address) {
                    return callback();
                }
                that._getAddressFromGoogle(function (err, result) {
                    try {
                        var geoInfo = that._parseGoogleResult(result);
                        that.country = that.country || geoInfo.country;
                        that.address = that.address || geoInfo.address;
                        that.name = that.name || geoInfo.name;
                    }
                    catch(e) {
                        return callback(e);
                    }
                    callback(err);
                });
            },
            function (callback) {
                if (that.name) {
                   return callback();
                }
                that._getAddressFromGoogle(function (err, result) {
                    try {
                        var geoInfo = that._parseGoogleResult(result);
                        that.country = that.country || geoInfo.country;
                        that.address = that.address || geoInfo.address;
                        that.name = that.name || geoInfo.name;
                    }
                    catch(e) {
                        return callback(e);
                    }
                    callback(err);
                });
            }
        ],
        function (err) {
            if (err) {
                return next(err);
            }
            if (that.country === 'KR' && that.lang === 'ko') {
                if (!that.kmaAddress) {
                    return next(new Error("Fail to get kma address in ko-KR"));
                }
            }

            req.country = that.country;
            if (that.kmaAddress) {
                req.params.region = that.kmaAddress.region;
                req.params.city = that.kmaAddress.city;
                req.params.town = that.kmaAddress.town;
            }
            else {
                req.params.category = 'current';
                req.params.version = '010000';
                req.query.gcode = req.params.lat + ',' + req.params.lon;
            }

            req.result = req.result?req.result:{};
            req.result.location = {lat:req.params.lat, lon:req.params.lon};
            req.result.country = that.country;
            req.result.address = that.address;
            req.result.name = that.name;

            log.info(that);
            next();
        });

    return this;
};


GeoController.prototype.name2address = function(req, callback) {
    var that = this;
    //retry with key
    var address = req.params.region + req.params.city;
    var url = that.googleUrl+"/maps/api/geocode/json?address=" + encodeURIComponent(address);

    if (that.lang) {
        url += "&language="+that.lang;
    }
    if (googleApiKey) {
        url += "&key="+googleApiKey;
    }
    else {
        log.warn("google api key is not valid");
    }

    log.info(url);
    async.retry(3,
        function (cb) {
            that._request(url, function (err, result) {
                if (err) {
                    return cb(err);
                }
                cb(null, result);
            });
        },
        function (err, result) {
            if (err) {
                return callback(err);
            }
            try {
                var geoInfo = that._parseGoogleResult(result);
                log.info(geoInfo);
                var addressArray = geoInfo.address.split(" ");
                req.params.region = addressArray[1];
                if (addressArray.length == 3) {
                    req.params.city = addressArray[2];
                }
                else if (addressArray.length == 4) {
                    var lastWord = addressArray[3].substr(-1, 1);
                    if (lastWord === '읍' || lastWord === '면' || lastWord === '동') {
                        req.params.city = addressArray[2];
                        req.params.town =  addressArray[3];
                    }
                    else if (lastWord === '시' || lastWord === '군' || lastWord === '구') {
                        req.params.city = addressArray[2] + addressArray[3];
                    }
                    else {
                        log.error('Unknown structure address='+geoInfo.address);
                        req.params.city = addressArray[2];
                        req.params.town =  addressArray[3];
                    }
                }
                else if (addressArray.length == 5) {
                    req.params.city = addressArray[2] + addressArray[3];
                    req.params.town = addressArray[4];
                }
            }
            catch(e) {
                return callback(e);
            }
            callback();
        });
};

module.exports = GeoController;
