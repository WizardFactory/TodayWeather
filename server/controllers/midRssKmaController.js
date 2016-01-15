/**
 * Created by aleckim on 2015. 12. 26..
 */

'use strict';

var MidRssModel = require('../models/modelMidRss');

function midRssKmaController() {

}

midRssKmaController.getData = function(regId, callback) {
    log.input('midRssKmaController getData '+regId);

    MidRssModel.find({regId:regId}, {_id: 0}).limit(1).lean().exec(function(err, midRssList) {
        if (err) {
            return callback(err);
        }
        if (midRssList.length === 0) {
            err = new Error("Fail to find midRss regId="+code.cityCode);
            return callback(err);
        }

        callback(err, midRssList[0]);
    });

    return this;
};

midRssKmaController.overwriteData = function(reqMidData, regId, callback) {
    log.input('midRssKmaController overwriteData '+regId);

    if (!reqMidData.hasOwnProperty('dailyData') || !Array.isArray(reqMidData.dailyData)) {
        log.warn('make dailyData array');
        reqMidData.dailyData = [];
    }

    this.getData(regId, function(err, midRssData) {
        if (err) {
            return callback(err);
        }

        reqMidData.pubDate = midRssData.pubDate;
        reqMidData.province = midRssData.province;
        reqMidData.city = midRssData.city;
        reqMidData.stnId = midRssData.stnId;
        reqMidData.regId = midRssData.regId;

        var dailyData = reqMidData.dailyData;
        midRssData.midData.forEach(function (midData) {
            for (var i = 0; i < dailyData.length; i++) {
                if (dailyData[i].date === midData.date) {
                    dailyData[i].tmn = midData.tmn;
                    dailyData[i].tmx = midData.tmx;
                    dailyData[i].wfAm = midData.wfAm;
                    dailyData[i].wfPm = midData.wfPm;
                    dailyData[i].reliability = midData.reliability;
                    break;
                }
            }
            if (i === dailyData.length) {
                //create object for removing _id of midData
                dailyData.push({date:midData.date, tmn:midData.tmn, tmx:midData.tmx, wfAm:midData.wfAm,
                    wfPm:midData.wfPm, reliability: midData.reliability});
            }
        });
        callback(err, reqMidData);
    });
};

module.exports = midRssKmaController;

