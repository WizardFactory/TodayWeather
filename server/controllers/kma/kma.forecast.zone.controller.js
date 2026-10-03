/**
 * Created by aleckim on 2018. 4. 4..
 */

"use strict";

const request = require('request');
const async = require('async');
const keyList = require('../../lib/dataGoKrKeys');
const rejection = require('../../lib/dataGoKrRejection');

const KmaForecastZoneModel = require('../../models/kma/kma.forecast.zone.model');

class KmaForecastZoneController {
    constructor(serviceKeys) {
        this.kmaApiUrl = 'http://newsky2.kma.go.kr';
        this.apiPath =  '/service/ForecastZoneInfoService/ForecastZoneCodeDataInfo';
        this.queryParam = 'pageNo=1&numOfRows=999&type=json';
        this.serviceKeys = keyList.parse(serviceKeys);
        this.keyIndex = 0;
    }

    _getKmaApiUrl() {
       return this.kmaApiUrl+this.apiPath+'?'+this.queryParam+'&ServiceKey='+keyList.encode(this.serviceKeys[this.keyIndex] || '');
    }

    _request(url) {
        if (!this.serviceKeys.length) {
            return Promise.reject(new Error('No configured data.go.kr keys'));
        }
        const start = this.keyIndex;
        let tried = 0;
        // Retry transport/server failures without repeating rejected credentials.
        return new Promise((resolve, reject) => {
            const attempt = () => {
                const currentUrl = url.replace(/([?&]ServiceKey=)[^&]*/, '$1' +
                    keyList.encode(this.serviceKeys[this.keyIndex]));
                log.info('request forecast zone code keyIndex=' + this.keyIndex);
                async.retry({times: 3, errorFilter: err => !err.keyRejected}, callback => {
                    request(currentUrl, {json: true, timeout: 3000}, (err, response, body) => {
                        if (err) { return callback(new Error('forecast zone transport failure')); }
                        const status = response.statusCode;
                        const code = typeof body === 'string' ? rejection.code(body) :
                            body && body.OpenAPI_ServiceResponse && body.OpenAPI_ServiceResponse.cmmMsgHeader ?
                                String(body.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode) :
                            body && body.response && body.response.header ? String(body.response.header.resultCode) : undefined;
                        if (status >= 400 || rejection.isAuth(status, code) || rejection.isQuota(status, code)) {
                            const failure = new Error('forecast zone status=' + status + ' code=' + code);
                            failure.statusCode = status;
                            failure.keyRejected = rejection.isAuth(status, code) || rejection.isQuota(status, code);
                            return callback(failure);
                        }
                        callback(null, body);
                    });
                }, (err, result) => {
                    if (err && err.keyRejected && ++tried < this.serviceKeys.length) {
                        this.keyIndex = (start + tried) % this.serviceKeys.length;
                        return attempt();
                    }
                    if (err) { this.keyIndex = start; return reject(err); }
                    resolve(result);
                });
            };
            attempt();
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
        let query = {regSp:"C"};
        if (regionType) {
           regName = regionName.replace(regionType, '') ;
           if (regName === '인천') {
               if (cityName === '강화군') {
                   regName = '강화';
               }
           }
           else if (regName === '광주') {  //광주광역시
              query.regId = "11F20501";
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

            if (regName === '광주') {
                query.regId = '11B20702';
            }
            else if (regName === '울릉') {
                regName = '울릉도';
            }
            else if (regName === '고성') {
               if (regionName.indexOf('강원') >= 0) {
                   query.regId = '11D20402';
               }
               else if (regionName.indexOf('경상남') >= 0) {
                   query.regId = '11H20404';
               }
            }
        }

        query.regName = regName;

        return this.findForecastZoneCode(query);
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

