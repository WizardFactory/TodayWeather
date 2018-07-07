/**
 *
 * Created by aleckim on 2018. 5. 31..
 */

"use strict";


var config = require('../../config/config');
var request = require('request');
var async = require('async');

var router = require('express').Router();

function _request(url, callback) {
    log.info({_request:{url:url}});
    request(url, {json: true, timeout: 3000}, (err, response, body) => {
        if (err) {
            return callback(err);
        }
        if (response.statusCode >= 400) {
            err = new Error("url=" + url + " statusCode=" + response.statusCode);
            return callback(err);
        }
        callback(err, body);
    });
}

function _retryRequest(url, callback) {
    async.retry(3,
        (cb) => {
            _request(url, (err, result) => {
                if (err) {
                    return cb(err);
                }
                cb(null, result);
            });
        },
        (err, result) => {
            if (err) {
                return callback(err);
            }
            callback(null, result);
        });
}

function coord2addr(req, res, next) {
    var loc = req.params.loc;
    if (loc == undefined) {
        throw new Error("Invalid loc");
    }

    var url = config.apiServer.url + '/geocode/coord/'+loc;
    _retryRequest(url, (err, geoInfo)=> {
        if (err) {
            return next(err);
        }
        if (geoInfo.country !== 'KR') {
            return res.redirect('../dsf/coord/'+loc);
        }

        if (!geoInfo.kmaAddress) {
            return next(new Error('Fail to get kma address loc:'+loc));
        }

        var kmaAddress = geoInfo.kmaAddress;
        var redirectUrl = '../kma/addr' + '/' + encodeURIComponent(kmaAddress.name1);
        if (kmaAddress.name2) {
            redirectUrl += '/' + encodeURIComponent(kmaAddress.name2);
        }
        if (kmaAddress.name3) {
            redirectUrl += '/' + encodeURIComponent(kmaAddress.name3);
        }

        return res.redirect(redirectUrl);
    });
}

router.get('/:loc', coord2addr);

module.exports = router;
