/**
 * Created by aleckim on 2018. 4. 4..
 */

"use strict";

const request = require('request');
const async = require('async');
const fs = require('fs');
const path = require('path');
const keyList = require('../../lib/dataGoKrKeys');
const rejection = require('../../lib/dataGoKrRejection');

const KmaForecastZoneModel = require('../../models/kma/kma.forecast.zone.model');

// data.go.kr FcstZoneInfoService (#2739). totalCount is the item count of the returned page,
// so completeness is checked per page; an 03 page after a full page ends the list.
const ZONE_API_URL = 'https://apis.data.go.kr/1360000/FcstZoneInfoService/getFcstZoneCd';
const ROWS_PER_PAGE = 1000;
const MAX_PAGES = 10;
const LAND_ZONE_FILE = '../../utils/data/kma_forecast_land_zones.csv';
const TEXT_FIELDS = ['regEn', 'regUp', 'stnWn', 'stnF3', 'stnFd', 'stnFw'];
let landZoneIds;

// Provider codes appear in errors and logs only as short digit strings.
function safeCode(value) {
    return /^\d{1,4}$/.test(String(value)) ? String(value) : 'invalid';
}

/**
 * Model document for one provider item, or undefined when a stored field has an unusable type.
 * Unknown provider fields are dropped; every value is checked before any write starts.
 */
function normalizeZone(obj) {
    if (!obj || typeof obj !== 'object' || ['regId', 'regName', 'regSp'].some(field =>
            typeof obj[field] !== 'string' || !obj[field])) {
        return undefined;
    }
    const zone = {regId: obj.regId, regName: obj.regName, regSp: obj.regSp};
    const absent = value => value === undefined || value === null;
    const digits = value => typeof value === 'number' ? Number.isInteger(value) && value >= 0 :
        typeof value === 'string' && /^\d+$/.test(value);
    // Converted values must stay finite: a long digit string becomes Infinity.
    const decimal = value => (typeof value === 'number' ||
        typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) && isFinite(Number(value));
    for (const field of TEXT_FIELDS) {
        if (absent(obj[field])) { continue; }
        if (typeof obj[field] !== 'string' && !(typeof obj[field] === 'number' && isFinite(obj[field]))) {
            return undefined;
        }
        zone[field] = String(obj[field]);
    }
    for (const field of ['tmEd', 'tmSt']) {
        if (absent(obj[field])) { continue; }
        if (!digits(obj[field])) { return undefined; }
        zone[field] = String(obj[field]);
    }
    for (const field of ['seq', 'ht']) {
        if (absent(obj[field])) { continue; }
        if (!decimal(obj[field])) { return undefined; }
        zone[field] = Number(obj[field]);
    }
    for (const field of ['lat', 'lon']) {
        if (!absent(obj[field]) && !decimal(obj[field])) { return undefined; }
    }
    const lon = Number(obj.lon), lat = Number(obj.lat);
    if (!absent(obj.lon) && !absent(obj.lat) && lon !== 0 && lat !== 0) {
        // The 2d index on geo accepts [-180, 180) per axis; latitude must also be a real latitude.
        if (lon < -180 || lon >= 180 || lat < -90 || lat > 90) {
            return undefined;
        }
        zone.geo = [lon, lat];
    }
    return zone;
}

class KmaForecastZoneController {
    constructor(serviceKeys) {
        this.serviceKeys = keyList.parse(serviceKeys);
        this.keyIndex = 0;
    }

    /**
     * Land zones of the KMA guide; getMidTa answers only these city zones.
     * @returns {Set<string>}
     */
    static landZoneIds() {
        if (!landZoneIds) {
            const ids = new Set();
            fs.readFileSync(path.join(__dirname, LAND_ZONE_FILE), 'utf8').split('\n').forEach(line => {
                if (!line || line[0] === '#' || line.indexOf('REG_ID,') === 0) {
                    return;
                }
                const regId = line.split(',')[0];
                if (!/^[0-9A-Z]{8}$/.test(regId) || ids.has(regId)) {
                    throw new Error('Invalid forecast land zone row: ' + line);
                }
                ids.add(regId);
            });
            landZoneIds = ids;
        }
        return landZoneIds;
    }

    _getKmaApiUrl(pageNo) {
        return ZONE_API_URL + '?serviceKey=' + keyList.encode(this.serviceKeys[this.keyIndex] || '') +
            '&numOfRows=' + ROWS_PER_PAGE + '&pageNo=' + (pageNo || 1) + '&dataType=JSON';
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
                const currentUrl = url.replace(/([?&]serviceKey=)[^&]*/, '$1' +
                    keyList.encode(this.serviceKeys[this.keyIndex]));
                log.info('request forecast zone code keyIndex=' + this.keyIndex);
                async.retry({times: 3, errorFilter: err => !err.keyRejected && !err.redirect}, callback => {
                    request(currentUrl, {json: true, timeout: 10000, followRedirect: false}, (err, response, body) => {
                        if (err) { return callback(new Error('forecast zone transport failure')); }
                        const status = response.statusCode;
                        if (status >= 300 && status < 400) {
                            const redirect = new Error('forecast zone status=' + status + ' redirect');
                            redirect.redirect = true;
                            return callback(redirect);
                        }
                        const code = typeof body === 'string' ? rejection.code(body) :
                            body && body.OpenAPI_ServiceResponse && body.OpenAPI_ServiceResponse.cmmMsgHeader ?
                                String(body.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode) :
                            body && body.response && body.response.header ? String(body.response.header.resultCode) : undefined;
                        if (status >= 400 || rejection.isAuth(status, code) || rejection.isQuota(status, code)) {
                            const failure = new Error('forecast zone status=' + status +
                                ' code=' + (code === undefined ? 'none' : safeCode(code)));
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

    /**
     * @param rawData parsed JSON body of one page
     * @param {number} pageNo requested page
     * @returns {Array|null} page items, or null for the 03 page that ends a list of full pages
     */
    _parsePage(rawData, pageNo) {
        const fail = check => new Error('forecast zone page=' + pageNo + ' check=' + check);
        const header = rawData && rawData.response && rawData.response.header;
        if (!header) {
            throw fail('envelope');
        }
        const resultCode = String(header.resultCode);
        if (resultCode === '03' && pageNo > 1) {
            return null;
        }
        if (resultCode !== '00') {
            throw fail('resultCode ' + safeCode(resultCode));
        }
        const body = rawData.response.body;
        const list = body && body.items && body.items.item;
        if (!Array.isArray(list)) {
            throw fail('items');
        }
        const number = value => typeof value === 'number' ? value :
            typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
        if (number(body.totalCount) !== list.length) {
            throw fail('totalCount');
        }
        if (number(body.pageNo) !== pageNo || number(body.numOfRows) !== ROWS_PER_PAGE) {
            throw fail('echo');
        }
        return list.map(obj => {
            const zone = normalizeZone(obj);
            if (!zone) {
                throw fail('item');
            }
            return zone;
        });
    }

    _fetchAll() {
        const zones = [];
        const seen = new Set();
        const fetchPage = pageNo => {
            return this._request(this._getKmaApiUrl(pageNo))
                .then(rawData => {
                    const list = this._parsePage(rawData, pageNo);
                    if (list === null) {
                        return zones;
                    }
                    list.forEach(obj => {
                        if (seen.has(obj.regId)) {
                            throw new Error('forecast zone page=' + pageNo + ' check=duplicate');
                        }
                        seen.add(obj.regId);
                        zones.push(obj);
                    });
                    if (list.length < ROWS_PER_PAGE) {
                        return zones;
                    }
                    if (pageNo >= MAX_PAGES) {
                        throw new Error('forecast zone page=' + pageNo + ' check=page limit');
                    }
                    return fetchPage(pageNo + 1);
                });
        };
        return fetchPage(1);
    }

    _update(zone, callback) {
        const unset = {retired: '', retiredAt: ''};
        if (!zone.geo) {
            unset.geo = '';
        }
        KmaForecastZoneModel.update({regId: zone.regId}, {$set: zone, $unset: unset},
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

    /**
     * Mark stored zones that the latest complete fetch did not return; rows are kept.
     * @param {Array} list complete fetch
     */
    _retireAbsent(list) {
        return new Promise((resolve, reject) => {
            KmaForecastZoneModel.updateMany({regId: {$nin: list.map(obj => obj.regId)}, retired: {$ne: true}},
                {$set: {retired: true, retiredAt: new Date()}},
                (err, result) => err ? reject(err) : resolve(result));
        });
    }

    getFromKma() {
        let stored;
        return this._fetchAll()
            .then(codeList => {
                stored = codeList.length;
                return this._updateList(codeList).then(() => this._retireAbsent(codeList));
            })
            .then(result => {
                const retired = result && (result.nModified !== undefined ? result.nModified : result.n);
                log.info('forecast zone codes stored=' + stored + ' newlyRetired=' + retired);
                return result;
            });
    }

    /**
     * Active city zones for getMidTa: listed land zones only, retired rows excluded.
     * @param callback (err, zones)
     */
    findMidTempZones(callback) {
        let land;
        try {
            land = KmaForecastZoneController.landZoneIds();
        }
        catch (err) {
            return callback(err);
        }
        this.findForecastZoneCode({regSp: 'C'}).exec((err, rows) => {
            if (err) {
                return callback(err);
            }
            const zones = rows.filter(obj => land.has(obj.regId));
            if (zones.length < land.size) {
                const found = new Set(zones.map(obj => obj.regId));
                log.warn('forecast land zones missing from stored zones: ' +
                    Array.from(land).filter(regId => !found.has(regId)).join(','));
            }
            callback(null, zones);
        });
    }

    /**
     *
     * @param {regId:String|regName:String} query
     * @returns {Query|*}
     */
    findForecastZoneCode(query) {
        // Rows without the retired flag predate the first complete refresh and stay visible.
        return KmaForecastZoneModel.find(Object.assign({retired: {$ne: true}}, query), {_id: 0}).lean();
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
           else if (regName === '대구' && cityName === '군위군') {  //2023.7 경상북도에서 편입
               regName = '군위';
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

