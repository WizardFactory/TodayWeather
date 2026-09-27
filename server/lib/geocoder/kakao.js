/**
 * Kakao Local API adapter for the gateway geocoder (#2606).
 * Output shaping ported unchanged from tw-backend-functions a4c1deb
 * geoinfo/controller.kakao.js (_coord2geoInfo, _addr2geoInfo). Changes: transport
 * (timeouts and key rotation in index.js) and numeric parsing of the address x/y
 * strings, which the Lambda passed on as strings and then failed to normalize.
 */

'use strict';

var DEFAULT_BASE_URL = 'https://dapi.kakao.com';

// Kakao REST error bodies come as {code, msg} or {errorType, message}; a quota error
// can arrive as HTTP 400. Reference: https://developers.kakao.com/docs/latest/en/rest-api/reference
var AUTH_CODES = [-401, -3];
var QUOTA_CODES = [-10];

function coord2geoInfo(result, loc) {
    var lang = 'ko';
    var geoInfo = {};

    geoInfo.loc = loc;
    geoInfo.lang = lang;
    geoInfo.provider = 'kakao';

    if (result.meta.total_count < 2) {
        return geoInfo;
    }

    if (result.documents[0].region_1depth_name === "") {
        return geoInfo;
    }
    var region = result.documents.filter(function (v) {
        return v.region_type === "H"; // H === 행정동, B === 법정동
    });

    if (region.length > 0) {
        geoInfo.country = "KR";
        geoInfo.address = region[0].address_name;
        if (region[0].region_4depth_name !== "") {
            geoInfo.label = region[0].region_4depth_name;
        } else if (region[0].region_3depth_name !== "") {
            geoInfo.label = region[0].region_3depth_name;
        } else if (region[0].region_2depth_name !== "") {
            geoInfo.label = region[0].region_2depth_name;
        } else if (region[0].region_1depth_name !== "") {
            geoInfo.label = region[0].region_1depth_name;
        }
        var name2 = region[0].region_2depth_name;
        if (name2) {
            name2 = name2.replace(/ /g, "");
        }
        geoInfo.kmaAddress = {"name1": region[0].region_1depth_name, "name2": name2, "name3": region[0].region_3depth_name};
    }
    return geoInfo;
}

function addr2geoInfo(result, addr) {
    if (result.meta.total_count < 1) {
        throw new Error("Fail to find query");
    }

    var geoInfo = {};
    geoInfo.loc = [Number(result.documents[0].y), Number(result.documents[0].x)];
    if (!isFinite(geoInfo.loc[0]) || !isFinite(geoInfo.loc[1])) {
        throw new Error("fail to parse location");
    }
    geoInfo.address = addr;
    geoInfo.country = 'KR';

    return geoInfo;
}

function coordUrl(baseUrl, loc) {
    return (baseUrl || DEFAULT_BASE_URL) + '/v2/local/geo/coord2regioncode.json' +
        '?x=' + loc[1] + '&y=' + loc[0] + '&input_coord=WGS84';
}

function addrUrl(baseUrl, addr) {
    return (baseUrl || DEFAULT_BASE_URL) + '/v2/local/search/address.json?query=' + encodeURIComponent(addr);
}

function headers(key) {
    return {Authorization: 'KakaoAK ' + key};
}

/**
 * Classify one Kakao response (spec 3.5).
 * @param {{status:number, json:boolean, body:*}} res
 * @returns {string} success | auth | quota | transient | request
 */
function classify(res) {
    if (res.status >= 200 && res.status < 300) {
        return res.json && res.body && typeof res.body === 'object' ? 'success' : 'transient';
    }
    if (res.status >= 500) {
        return 'transient';
    }
    if (res.status === 401 || res.status === 403) {
        return 'auth';
    }
    if (res.status === 429) {
        return 'quota';
    }
    var body = res.json && res.body && typeof res.body === 'object' ? res.body : {};
    if (QUOTA_CODES.indexOf(body.code) >= 0 || /throttl|limit|quota/i.test(body.errorType || '')) {
        return 'quota';
    }
    if (AUTH_CODES.indexOf(body.code) >= 0 || /accessdenied|unauthori|appkey|permission/i.test(body.errorType || '')) {
        return 'auth';
    }
    return 'request';
}

module.exports = {
    coord2geoInfo: coord2geoInfo,
    addr2geoInfo: addr2geoInfo,
    coordUrl: coordUrl,
    addrUrl: addrUrl,
    headers: headers,
    classify: classify
};
