/**
 * Created by aleckim on 2018. 7. 13..
 */

"use strict";

const async = require('async');
const KmaSpecialWeatherSituation = require('../models/modelKmaSpecialWeatherSituation');
const KmaSpecialWeatherZone = require('../models/modelKmaSpecialWeatherZone');
const kmaWarningZones = require('../lib/kmaWarningZones');

class KmaSpecialWeatherController {
    constructor() {
    }

    /**
     * <, o, *, -, ※ 앞 \n\n, [ 앞 \n, 특보명 앞에 \n
     * @param strSituationList
     * @param string
     * @returns {string}
     * @private
     */
    _insertLineChange(strSituationList, string) {
        let result = '';
        for (let i=0;i<string.length;i++) {
            let findIt = ['<', '*', 'o', '-','※'].find(char => {
               return string[i] === char;
            });
            if (findIt && i !== 0) {
                result+='\n\n';
            }
            findIt = ['['].find(function(char) {
                return string[i] === char;
            });
            if (findIt) {
                result+='\n';
            }

            findIt = strSituationList.find(function (str) {
                let sub = string.substring(i, i+str.length);
                return str === sub;
            });
            if (findIt) {
                result+='\n';
            }
            result+=string[i];
        }
        return result;
    }

    _parseSpecialWeatherSituation(specialWeatherSituation, trans) {
        if (specialWeatherSituation.type == 1) {
            specialWeatherSituation.name = trans.__('LOC_TYPE_SPECIAL_WEATHER');
        }
        else if (specialWeatherSituation.type == 2) {
            specialWeatherSituation.name = trans.__('LOC_TYPE_PRELIMINARY_SPECIAL');
        }
        else if (specialWeatherSituation.type == 3) {
            specialWeatherSituation.name = trans.__('LOC_TYPE_WEATHER_INFORMATION');
        }
        else if (specialWeatherSituation.type == 4) {
            specialWeatherSituation.name = trans.__('LOC_TYPE_WEATHER_FLASH');
        }

        // announcement holds KST wall-clock time as UTC (lib/kmaWarningCollector.js).
        const stored = new Date(specialWeatherSituation.announcement).getTime();
        if (specialWeatherSituation.type === KmaSpecialWeatherSituation.TYPE_WEATHER_FLASH) {
            if (stored + 10*3600*1000 < Date.now()) { //조정 필요
                log.info('skip weather flash date='+ specialWeatherSituation.announcement);
                return null;
            }
        }

        //convert time to korea
        specialWeatherSituation.announcement = new Date(stored - 9*3600*1000);
        let strSituationList = [];
        if (Array.isArray(specialWeatherSituation.situationList)) {
            specialWeatherSituation.situationList.forEach(situation => {
                delete situation._id;
                if (Array.isArray(situation.info)) {
                    situation.info.forEach(info=> {
                        delete info._id;
                    });
                }
                if (situation.weatherStr != '없음') {
                    strSituationList.push(situation.weatherStr+situation.levelStr);
                }
            });
        }

        specialWeatherSituation.comment =
            this._insertLineChange(strSituationList, specialWeatherSituation.comment || '');
        return specialWeatherSituation;
    }

    getCurrent(trans, callback) {
        let queryList = [4,1,2,3];
        async.map(queryList,
            (type, callback) => {
                KmaSpecialWeatherSituation
                    .find({type:type}, {_id:0, __v:0})
                    .sort({announcement: -1})
                    .limit(1)
                    .lean()
                    .exec((err, list)=> {
                        if (err) {
                            return callback(err);
                        }
                        if (list.length < 1) {
                            err = new Error('data is empty');
                            return callback(err);
                        }
                        let specialWeatherSituation;
                        try {
                            specialWeatherSituation = this._parseSpecialWeatherSituation(list[0], trans);
                        }
                        catch (e) {
                            return callback(e);
                        }
                        callback(null, specialWeatherSituation);
                    });
            },
            (err, results)=> {
                if (err) {
                    return callback(err);
                }
                results = results.filter(obj => {
                    return obj != null;
                });
                callback(null, results);
            });
    }

    /**
     *
     * @param {Object[]} specialList
     * @returns {*}
     * @private
     */
    _sort(specialList) {
        // Full comparator: Node 10's sort is not stable, so a hazard-only key could put a 주의보 before a 경보.
        return specialList.sort((a, b)=> {
            if (a.weather !== b.weather) {
                return b.weather - a.weather;
            }
            if (a.level !== b.level) {
                return b.level - a.level;
            }
            return a.locationName < b.locationName ? -1 : (a.locationName > b.locationName ? 1 : 0);
        });
    }

    /**
     * Active warnings of the town's warning zones (#2609). Zones come from the KMA zone table at
     * city/county level, so a town inside a split city or metropolitan area receives every sub-zone
     * warning of that parent.
     * @param {{first:string, second:string, third:string}} town
     * @param {string} stnName - unused since zone codes replaced the station-based text matching
     * @param callback (err, [{weather, weatherStr, level, levelStr, locationName}])
     */
    getSpecialInfo(town, stnName, callback) {
        if (town == undefined) {
            return callback(new Error('invalid town info'));
        }
        let areaCodes;
        try {
            areaCodes = kmaWarningZones.zonesForTown(town);
        }
        catch (err) {
            return callback(err);
        }
        if (areaCodes.length === 0) {
            return callback(null, []);
        }
        KmaSpecialWeatherZone
            .find({active: true, warnVar: {$gt: 0}, areaCode: {$in: areaCodes}}, {_id: 0, __v: 0})
            .lean()
            .exec((err, list) => {
                if (err) {
                    return callback(err);
                }
                callback(null, this._sort(kmaWarningZones.specialInfoFor(list, areaCodes)));
            });
    }
}

module.exports = KmaSpecialWeatherController;
