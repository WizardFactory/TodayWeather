/**
 * Created by aleckim on 2018. 4. 4..
 */

"use strict";

const request = require('request');
const async = require('async');

const KmaForecastZoneModel = require('../../models/kma/kma.forecast.zone.model');

class KmaForecastZoneController {
    constructor(serviceKey) {
        this.kmaApiUrl = 'http://newsky2.kma.go.kr';
        this.apiPath =  '/service/ForecastZoneInfoService/ForecastZoneCodeDataInfo';
        this.queryParam = 'pageNo=1&numOfRows=999&type=json';
        this.serviceKey = serviceKey;
    }

    _getKmaApiUrl() {
       return this.kmaApiUrl+this.apiPath+'?'+this.queryParam+'&ServiceKey='+this.serviceKey;
    }

    _request(url) {
        log.info({kmaForecastZoneCodeUrl: url});
        return new Promise((resolve, reject) => {
            let options = {json:true, timeout: 3000};
            async.retry(3,
                callback => {
                    request(url, options, (err, response, body)=> {
                        if (err) {
                            return callback(err);
                        }
                        if (response.statusCode >= 400) {
                            err = new Error(`http response status code: ${response.statusCode}`);
                            err.statusCode = response.statusCode;
                            return callback(err);
                        }
                        callback(null, body);
                    });
                },
                (err, result) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(result);
                });
        });
    }

    _update(obj, callback) {
        KmaForecastZoneModel.update({regId: obj.regId}, obj,
            {upsert:true},
            callback);
    }

    _updateList(list) {
        return new Promise((resolve, reject) => {
            async.map(list,
                (obj, callback) => {
                    this._update(obj, callback);
                },
                (err, result)=> {
                    if (err) {
                        return reject(err);
                    }
                    resolve(result);
                });
        });
    }

    _paresKmaForecastZoneCode(rawData) {
        if (rawData.response.header.resultMsg !== 'OK') {
            throw new Error('Fail to get ForecastZoneCodeDataInfo');
        }
        let list = rawData.response.body.items.item;
        if (list.length <= 0)  {
            throw new Error('forecast zone code is zero');
        }
        return list.map(obj => {
            if (obj.lon && obj.lat) {
                obj.geo = [obj.lon, obj.lat];
            }
            return obj;
        });
    }

    getFromKma() {
        let url = this._getKmaApiUrl();
        return this._request(url)
            .then(result=> {
                return this._paresKmaForecastZoneCode(result);
            })
            .then(codeList=> {
                return this._updateList(codeList);
            });
    }

    /**
     *
     * @param {regId:String|regName:String} query
     * @returns {Query|*}
     */
    findForecastZoneCode(query) {
        return KmaForecastZoneModel.find(query, {_id: 0}).lean();
    }

    findForecastZoneByName(regionName, cityName) {
        let regionType = ['특별시', '광역시', '특별자치시'].find((name)=> {
            return regionName.indexOf(name) >= 0;
        });
        let regName;
        if (regionType) {
           regName = regionName.replace(regionType, '') ;
           if (regName === '인천') {
               if (cityName === '강화군') {
                   regName = '강화';
               }
           }
        }
        else if (regionName === '이어도') {
            regName = regionName;
        }
        else {
            if (cityName.lastIndexOf('구') === cityName.length-1) {
                let siIndex = cityName.lastIndexOf('시');
                regName = cityName.slice(0, siIndex);
            }
            else {
                regName = cityName.slice(0, cityName.length-1);
            }
        }

        return this.findForecastZoneCode({regName:regName, regSp:"C"});
    }

    /**
     *
     * @param loc
     */
    findForecastZoneNear(loc) {
        let query = {geo: {"$near": loc}};
        return this.findForecastZoneCode(query);
    }
}

module.exports = KmaForecastZoneController;

