/**
 * Output shaping shared by the gateway routes (#2606).
 * Ported from tw-backend-functions a4c1deb:
 *   geoinfo/function.geoinfo.js (_geoCodeNormalize, _getLanguage, importGeoInfo, byCoord)
 *   geoinfo/controller.geoapi.js (_isKoreaArea)
 */

'use strict';

var MAX_LANGUAGE_LENGTH = 64;

function normalizeLoc(loc) {
    return [parseFloat(loc[0].toFixed(3)), parseFloat(loc[1].toFixed(3))];
}

/**
 * it has partial area of japan
 * 130.6741 -> 131.88 for dokdo
 */
function isKoreaArea(loc) {
    var lat = loc[0];
    var lng = loc[1];
    return 39.3769 >= lat && lat >= 32.6942 &&
        131.88 >= lng && lng >= 123.9523;
}

/**
 * The Lambda's language: the raw Accept-Language header up to its first '-', or 'en'
 * when the header is absent. Values longer than 64 characters become 'en' (spec 2.3).
 * @param {string|undefined} header
 * @returns {string}
 */
function languageFromHeader(header) {
    if (header === undefined || header === null) {
        return 'en';
    }
    var lang = String(header).split('-')[0];
    if (lang.length > MAX_LANGUAGE_LENGTH) {
        return 'en';
    }
    return lang;
}

function importGeoInfo(dest, source) {
    if (dest == undefined) {
        throw new Error("dest is undefined");
    }

    ['label', 'country', 'address', 'loc'].forEach(function (propertyName) {
        if (source.hasOwnProperty(propertyName)) {
            if (propertyName === 'label') {
                dest.name = source.label;
            }
            else if (propertyName === 'loc') {
                dest.location = {lat: source.loc[0], long: source.loc[1]};
            }
            else {
                dest[propertyName] = source[propertyName];
            }
        }
    });
}

/**
 * Client shape of a coordinate geoinfo (Lambda byCoord).
 */
function toClientCoord(geoInfo) {
    var geoInfoForClient = {};
    importGeoInfo(geoInfoForClient, geoInfo);
    if (geoInfo.kmaAddress) {
        geoInfoForClient.kmaAddress = geoInfo.kmaAddress;
    }
    return geoInfoForClient;
}

/**
 * Client shape of an address geoinfo (Lambda byAddr).
 */
function toClientAddr(geoInfo) {
    var geoInfoForClient = {};
    importGeoInfo(geoInfoForClient, geoInfo);
    return geoInfoForClient;
}

/**
 * Merge the geo fields into a backend weather body, as the Lambda's
 * importGeoInfo(result, geoInfo) did: existing keys are overwritten in place,
 * new keys are appended in the order name, country, address, location.
 */
function mergeIntoWeather(body, client) {
    ['name', 'country', 'address', 'location'].forEach(function (key) {
        if (client.hasOwnProperty(key)) {
            body[key] = client[key];
        }
    });
    return body;
}

module.exports = {
    normalizeLoc: normalizeLoc,
    isKoreaArea: isKoreaArea,
    languageFromHeader: languageFromHeader,
    importGeoInfo: importGeoInfo,
    toClientCoord: toClientCoord,
    toClientAddr: toClientAddr,
    mergeIntoWeather: mergeIntoWeather
};
