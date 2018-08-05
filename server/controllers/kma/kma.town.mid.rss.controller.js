/**
 * Created by aleckim on 2015. 12. 26..
 */

'use strict';

var MidRssModel = require('../../models/modelMidRss');
var modelKmaTownMidRss = require('../../models/kma/kma.town.mid.rss.model.js');
var config = require('../../config/config');
var kmaTimelib = require('../../lib/kmaTimeLib');

function midRssKmaController() {

}

midRssKmaController.getData = function(regId, callback) {
    log.debug('midRssKmaController getData '+regId);

    if(config.db.version == '2.0'){
        modelKmaTownMidRss.find({regId:regId}, {_id: 0}).limit(1).lean().exec(function(err, midRssList) {
            if (err) {
                return callback(err);
            }
            if (midRssList.length === 0) {
                err = new Error("Fail to find midRss regId="+regId);
                return callback(err);
            }

            callback(err, midRssList[0]);
        });
    }else{
        MidRssModel.find({regId:regId}, {_id: 0}).limit(1).lean().exec(function(err, midRssList) {
            if (err) {
                return callback(err);
            }
            if (midRssList.length === 0) {
                err = new Error("Fail to find midRss regId="+regId);
                return callback(err);
            }

            callback(err, midRssList[0]);
        });
    }

    return this;
};

midRssKmaController.overwriteData = function(reqMidData, regId, callback) {
    log.debug('midRssKmaController overwriteData '+regId);

    if (!reqMidData.hasOwnProperty('dailyData') || !Array.isArray(reqMidData.dailyData)) {
        log.warn('make dailyData array');
        reqMidData.dailyData = [];
    }

    this.getData(regId, function(err, midRssData) {
        if (err) {
            return callback(err);
        }

        reqMidData.rssPubDate = midRssData.pubDate;
        if(config.db.version == '2.0'){
            reqMidData.rssPubDate = kmaTimelib.getKoreaTimeString(midRssData.pubDate);
        }
        reqMidData.province = midRssData.province;
        reqMidData.city = midRssData.city;
        reqMidData.stnId = midRssData.stnId;
        reqMidData.regId = midRssData.regId;

        var dailyData = reqMidData.dailyData;

        var nLandPubDate = 0;
        if (reqMidData.landPubDate) {
            nLandPubDate = +reqMidData.landPubDate;
        }
        var nTempPubDate = 0;
        if (reqMidData.tempPubDate) {
            nTempPubDate = +reqMidData.tempPubDate;
        }
        var nRssPubDate = 0;
        if (reqMidData.rssPubDate) {
            nRssPubDate = +reqMidData.rssPubDate;
        }

        midRssData.midData.forEach(function (midData) {
            if (dailyData.length > 0) {
                if (parseInt(midData.date)  < parseInt(dailyData[0].date) ) {
                    //skip old data
                    return;
                }
            }

            for (var i = 0; i < dailyData.length; i++) {
                if (dailyData[i].date === midData.date) {
                    if (nTempPubDate < nRssPubDate) {
                        dailyData[i].taMin = +(midData.taMin).toFixed(1);
                        dailyData[i].taMax = +(midData.taMax).toFixed(1);
                    }
                    if (nLandPubDate < nRssPubDate) {
                        dailyData[i].wfAm = midData.wfAm;
                        dailyData[i].wfPm = midData.wfPm;
                    }
                    dailyData[i].reliability = midData.reliability;
                    break;
                }
            }

            if (i === dailyData.length) {
                //create object for removing _id of midData
                dailyData.push({date:midData.date, taMin:midData.taMin, taMax:midData.taMax, wfAm:midData.wfAm,
                    wfPm:midData.wfPm, reliability: midData.reliability});
            }
        });
        callback(err, reqMidData);
    });
};

module.exports = midRssKmaController;

