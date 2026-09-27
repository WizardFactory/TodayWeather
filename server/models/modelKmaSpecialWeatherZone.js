/**
 * Active KMA warning state per warning zone and type, rebuilt from WthrWrnInfoService getPwnCd events (#2609).
 * warnVar 0 marks the latest all-clear (allEndTime) of a zone; areaCode '_sync' holds the last sync.
 * Event order is (eventTmFc, eventTmSeq, eventRank); see lib/kmaWarningZones.js.
 */

"use strict";

var mongoose = require("mongoose");

var kmaSpecialWeatherZoneSchema = new mongoose.Schema({
    areaCode: String,       //특보구역코드, e.g. L1091430
    areaName: String,       //구역명, e.g. 서귀포시동부
    warnVar: Number,        //1 강풍, 2 호우, 3 한파, 4 건조, 5 폭풍해일, 6 풍랑, 7 태풍, 8 대설, 9 황사, 12 폭염, 13 열대야
    warnStress: Number,     //0 주의보, 1 경보, 2 중대경보
    active: Boolean,
    command: String,        //1 발표, 2 해제, 3 연장, 6 정정, 7 변경발표, 8 변경해제
    eventTmFc: Number,      //YYYYMMDDHHmm KST of the applied event
    eventTmSeq: Number,
    eventRank: Number,      //0 release, 1 issue within one announcement
    lastSyncAt: Date,       //'_sync' only
    lastFromTmFc: String,   //'_sync' only, YYYYMMDD
    lastToTmFc: String,     //'_sync' only, YYYYMMDD
    updatedAt: Date
});

kmaSpecialWeatherZoneSchema.index({areaCode: 1, warnVar: 1}, {unique: true});
kmaSpecialWeatherZoneSchema.index({active: 1});

module.exports = mongoose.model('KmaSpecialWeatherZone', kmaSpecialWeatherZoneSchema);
