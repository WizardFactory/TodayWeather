/**
 * Created by aleckim on 15. 11. 4..
 */

'use strict';

var arpltn = require('../models/arpltnTownKeco');
var convertGeocode = require('../utils/convertGeocode');

function arpltnController() {

}

arpltnController._appendFromDb = function(town, current, callback) {
    arpltn.findOne({town:town}, function (err, arpltnData) {
        if (err) {
            log.error(err);
            return callback(err);
        }
        if (!arpltnData) {
            err = new Error('Fail to find arpltn '+town.toString());
            log.error(err);
            return callback(err);
        }

        log.debug(arpltnData.toString());

        current.arpltn = arpltnData;
        return callback(err, arpltnData);
    });
};

arpltnController._appendFromKeco = function(town, current, callback) {

    var keyBox = require('../config/keydata').keyString;
    var keco = new (require('../lib/kecoRequester.js'))();
    keco.setServiceKey(keyBox.pokers);
    keco.setDaumApiKey(keyBox.daum_key);

    var async = require('async');

    async.waterfall([
        function(cb) {
            convertGeocode(town.first, town.second, town.third, function(err, result) {
                if (err) {
                    return callback(err);
                }
                town.mCoord = result;
                return cb(err, result);
            });
        },
        function(geoCode, cb) {
            keco.getTmPointFromWgs84(keco.getDaumApiKey(), geoCode.lat, geoCode.lon,
                function (err, body) {
                    if (err) {
                        return cb(err);}

                    log.debug(body);
                    town.tmCoord = {x:body.x, y:body.y};
                    cb(err, town.tmCoord);
                });
        },
        function(tmCoord, cb) {
            keco.getNearbyMsrstn(keco.getServiceKey(), tmCoord.y, tmCoord.x, function(err, result) {
                if (err) {
                    return cb(err);}
                log.debug(result);
                return cb(err, result);
            });
        },
        function(xmlStationInfoList, cb) {
            keco.parseMsrstn(xmlStationInfoList, function (err, stationName) {
                if (err) {
                    return cb(err);}
                log.debug(stationName);
                town.kecoStationName = stationName;
                cb(err, stationName);
            });
        },
        function(stationName, cb) {
            var sido = keco.convertRegionToSido(town.first);
            keco.getCtprvn(keco.getServiceKey(), sido, function (err, body) {
                if (err) {
                    return cb(err);
                }
                cb(err, body);
            });
        },
        function(xmlCtprvn, cb) {
            keco.parseCtprvn(xmlCtprvn, function (err, parsedDataList) {
                if (err) {
                    return cb(err);
                }
                cb(err, parsedDataList);
            });
        },
        function(parsedDataList, cb) {
            keco.saveCtprvn(parsedDataList, function(err){
                if (err) {
                    log.warn(err);
                }
                log.debug('save ctprvn');
                //update townlist?
                //add arpltTownKeco

                //never mind about save
                //return cb(err);
            });

            parsedDataList.every(function(arpltn) {
                if (arpltn.stationName === town.kecoStationName) {
                    cb(undefined, arpltn);
                    return false;
                }
                return true;
            });
            return cb(new Error("Fail to find station "+town.kecoStationName));
        }
    ], function(err, arpltn) {
        if (arpltn) {
            current.arpltn = arpltn;
        }

        log.debug(arpltn);

        //never mind about save
        var tempTown = { "first" : town.first, "second" : town.second, "third" : town.third};
        var mCoord = {mx: town.mCoord.mx, my:town.mCoord.my};
        keco.saveArpltnTown({town: tempTown, mCoord: mCoord}, arpltn, function (err) {
            if (err) {
                log.warn(err);
            }
            callback(err, arpltn);
        });

        callback(err, arpltn);
    });
};

arpltnController.appendData = function(town, current, callback) {
    var self = this;
    this._appendFromDb(town, current, function(err, arpltn) {
        if (err) {
            return self._appendFromKeco(town, current, callback);
        }
        return callback(err, arpltn);
    });
};

module.exports = arpltnController;

