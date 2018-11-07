/**
 * Created by aleckim on 2018. 7. 13..
 */

"use strict";

const async = require('async');
const KmaSpecialWeatherSituation = require('../models/modelKmaSpecialWeatherSituation');

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

        let pubDate = new Date(specialWeatherSituation.announcement);
        if (specialWeatherSituation.type === KmaSpecialWeatherSituation.TYPE_WEATHER_FLASH) {
            let flashDate = new Date(specialWeatherSituation.announcement);;
            let current = new Date();
            flashDate.setHours(flashDate.getHours()+10); //조정 필요
            if (flashDate.getTime() < current.getTime()) {
                log.info('skip weather flash date='+ specialWeatherSituation.announcement);
                return null;
            }
        }

        //convert time to korea
        pubDate.setHours(pubDate.getHours()-9);
        specialWeatherSituation.announcement = pubDate;
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
            this._insertLineChange(strSituationList, specialWeatherSituation.comment);
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
     * @param {string} second - ex 수원시장안구, 의정부시, 연천군, 창원시마산합포구
     * @private
     */
    _getCityName(cityName) {
        if (cityName == undefined || cityName.length == 0) {
            return null;
        }

        let regName;
        if (cityName.lastIndexOf('구') === cityName.length-1) {
            let siIndex = cityName.lastIndexOf('시');
            regName = cityName.slice(0, siIndex);
        }
        else {
            regName = cityName.slice(0, cityName.length-1);
        }
        return regName;
    }

    /**
     * 특보구역 구분안되는 지역에 대하여 측정소 기반으로 검색
     * 서해5도, 강원북부산지, 강원중부산지, 강원남부산지, 흑산도.홍도, 거문도.초도, 울릉도.독도, 경북북동산지
     * 제주도산지, 제주도서부, 제주도북부, 제주도동부, 제주도남부, 추자도
     * @param stnName
     * @private
     */
    _getAreaName(stnName) {
        if (stnName == undefined) {
            return null;
        }
        stnName = stnName.replace('*','');

        const specialAreaCode = [
            {name:"서해5도", list: ['백령도', '백령(레)', '소청도', '대연평']},
            {name:"강원북부산지", list: ['설악동', '설악산']},
            {name:"강원중부산지", list: ['대관령', '진부', '용평', '스키점프']},
            {name:"강원남부산지", list: ['태백']},
            {name:"흑산도.홍도", list: ['흑산도', '홍도', '하태도', '가거도']},
            {name:"거문도.초도", list: []},
            {name:"울릉도.독도", list: ['울릉도', '독도', '태하', '천부']},
            {name:"경북북동산지", list: ['수비', '석포', '금강송']},
            {name:"제주도산지", list: ['삼각봉', '한라생태숲', '어리목', '사제비', '윗세오름', '성판악', '영실', '진달래밭']},
            {name:"제주도서부", list: ['고산', '금악', '한림', '대정', '가파도', '마라도']},
            {name:"제주도북부", list: ['제주', '제주(공)', '산천단', '외도', '오등', '새별오름', '유수암', '대흘', '선흘']},
            {name:"제주도동부", list: ['성산', '월정', '구좌', '김녕', '우도', '표선']},
            {name:"제주도남부", list: ['서귀포', '기상(과)', '강정', '색달', '중문', '제주남원', '태풍센터', '신례', '서광']},
            {name:"추자도", list: ['추자도']},
        ];
        for (let i=0;i<specialAreaCode.length;i++) {
            let list = specialAreaCode[i].list;
            for (let j=0;j<list.length;j++) {
                if (list[j] === stnName) {
                    return specialAreaCode[i].name;
                }
            }
        }
        return null;
    }

    _findIndex(strLocation, startIndex, char) {
        for (let i=startIndex; i<strLocation.length; i++) {
            if (strLocation[i] === char)  {
                return i;
            }
        }
        return strLocation.length;
    }

    _findLocationByTown(town, stnName, strLocation) {
        //remove 특별시,광역시,
        let regionType = ['특별시', '광역시', '특별자치시'].find((name)=> {
            return town.first.indexOf(name) >= 0;
        });

        let targetName;
        let locationName;
        if (regionType) {
            targetName = town.first.replace(regionType, '');
            if (targetName != '인천') {
                if (strLocation.indexOf(targetName) >= 0) {
                    locationName = targetName;
                }
                return locationName;
            }
        }

        if (town.second.indexOf('울릉') >= 0) {
            if (strLocation.indexOf('울릉도') >= 0) {
                locationName = '울릉도.독도';
                return locationName;
            }
        }

        if (town.third.length > 0) {
            if (town.third.indexOf('흑산') >= 0) {
                if (strLocation.indexOf('흑산도') >= 0) {
                    locationName = '흑산도.홍도';
                    return locationName;
                }
            }
            if (town.third.indexOf('추자') >= 0) {
                if (strLocation.indexOf('추자도') >=0) {
                    locationName = '추자도';
                    return locationName;
                }
            }
            if (town.third.indexOf('삼산') >= 0) {
                if (strLocation.indexOf('거문도') >= 0) {
                    locationName = '거문도.초도';
                    return locationName;
                }
            }
            if (town.third.indexOf('백령') >= 0 ||
                town.third.indexOf('대청') >= 0 ||
                town.third.indexOf('연평') >= 0 )
            {
                if (strLocation.indexOf('서해5도') >= 0) {
                    locationName = '서해5도';
                    return locationName;
                }
            }
        }

        if (town.first.indexOf('제주') >= 0) {
            targetName = '제주도';
        }
        else if (regionType) {
            //인천광역시
            targetName = town.first.replace(regionType, '');
        }
        else {
            //제주도, 경상남도, 경상북도, 전라남도, 강원도
            targetName = town.first;
        }

        let startSubIndex = strLocation.indexOf(targetName);
        if (startSubIndex < 0) {
            return null;
        }

        let endSubIndex;
        //경상북도, - first만 존재하는 경우
        if (strLocation[startSubIndex+targetName.length] === ',') {
            endSubIndex = this._findIndex(strLocation, startSubIndex, ',');
            return strLocation.slice(startSubIndex, endSubIndex);
        }

        //first 아래 추가로 (..)가 있는 케이스

        //전라남도(무안, 진도, 신안(흑산면제외)) - 이중괄호는 신안 케이스 있기 때문에 '(흑산면제외)'를 삭제
        strLocation = strLocation.replace('(흑산면제외)', '');

        targetName = this._getAreaName(stnName);
        if (targetName == null) {
            targetName = this._getCityName(town.second);
        }

        //인천광역시 만 있는 경우이거나, 찾아야 하는 대상이 없는 경우
        if (targetName == null) {
            endSubIndex =  this._findIndex(strLocation, startSubIndex, '(');
            locationName = strLocation.slice(startSubIndex, endSubIndex);
            return locationName;
        }

        endSubIndex = this._findIndex(strLocation, startSubIndex, ')');

        //강원도(삼척평지, 동해평지, 홍천평지, 강릉평지, 양양평지, 고성평지, 속초평지, 횡성, 춘천, 화천, 원주)
        //경상남도(고성, 통영 제외)
        //강원도(강원북부산지)
        let strSubLocation = strLocation.slice(startSubIndex, endSubIndex);

        if (strSubLocation.indexOf('제외')>=0) {
            startSubIndex = strSubLocation.indexOf(targetName);
            if (startSubIndex >= 0) {
                return null;
            }

            startSubIndex = 0;
            endSubIndex = this._findIndex(strSubLocation, startSubIndex, '(');
            locationName = strSubLocation.slice(startSubIndex, endSubIndex);
        }
        else {
            startSubIndex = strSubLocation.indexOf(targetName);
            if (startSubIndex >= 0) {
                endSubIndex = this._findIndex(strSubLocation, startSubIndex, ',');
                locationName = strSubLocation.slice(startSubIndex, endSubIndex);
            }
        }

        if (locationName && locationName.indexOf('신안') >= 0) {
            return '신안(흑산면제외)';
        }

        return locationName;
    }

    _getSpecialInfo(town, stnName, specialWeatherSituation) {
        if (!Array.isArray(specialWeatherSituation.situationList)) {
            throw new Error('It does not have situation list');
        }

        let situationList = [];
        specialWeatherSituation.situationList.forEach(situation => {
            if (!Array.isArray(situation.info)) {
                log.warn(`${situation.weatherStr}${situation.levelStr} does not have info objects`);
                return;
            }
            situation.info.forEach(info=> {
                let locationName = this._findLocationByTown(town, stnName, info.location);
                if (locationName) {
                    let situationObj =
                        { weather: situation.weather,
                            weatherStr: situation.weatherStr,
                            level: situation.level,
                            levelStr: situation.levelStr,
                            locationName: locationName};
                    situationList.push(situationObj);
                }
            });
        });
        return situationList;
    }

    /**
     *
     * @param {Object[]} specialList
     * @returns {*}
     * @private
     */
    _sort(specialList) {
        return specialList.sort((a, b)=> {
            return b.weather - a.weather;
        });
    }

    /**
     * region()에서 제외문구가 들어가면 ()안 모든 지역이 제외임
     * ex 폭염경보 : 경기도(여주, 안성, 평택), 폭염주의보: 경기도(여주, 안성, 평택 제외)
     * 한 지역에 두가지 이상의 특보가 발행 될 수 있음.
     * @param {{first:string, second:string, third:string}} town
     * @param {string} stnName
     * @param callback
     * @returns {*}
     */
    getSpecialInfo(town, stnName, callback) {
        if (town == undefined) {
            return callback(new Error('invalid town info'));
        }
        KmaSpecialWeatherSituation
            .find({type:1}, {_id:0, __v:0})
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
                let specialWeatherInfo;
                try {
                   specialWeatherInfo = this._getSpecialInfo(town, stnName, list[0]);
                   specialWeatherInfo = this._sort(specialWeatherInfo);
                }
                catch (err) {
                   return callback(err) ;
                }
                callback(null, specialWeatherInfo);
            });
    }
}

module.exports = KmaSpecialWeatherController;
