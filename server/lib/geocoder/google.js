/**
 * Google Geocoding API adapter for the gateway geocoder (#2606).
 * The output-shaping functions below are copied unchanged from tw-backend-functions
 * a4c1deb geoinfo/controller.google.js (_getAddressInfoFromGoogleResult,
 * _getAddressInfoFromAddressComponents, _coord2geoInfo, _addr2geoInfo), converted
 * from class methods to functions. Transport (timeouts, key rotation) is in index.js.
 */

'use strict';

var DEFAULT_BASE_URL = 'https://maps.googleapis.com';

function _getAddressInfoFromGoogleResult(result) {
    let sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
    let sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
    let local_types = [ "locality", "political" ];
    let info = {};
    info.address = result.formatted_address;

    for (let j=0; j < result.address_components.length; j++) {
        let address_component = result.address_components[j];
        if ( address_component.types[0] == sub_level2_types[0]
            && address_component.types[1] == sub_level2_types[1]
            && address_component.types[2] == sub_level2_types[2] ) {
            info.sub_level2_name = address_component.short_name;
        }

        if ( address_component.types[0] == sub_level1_types[0]
            && address_component.types[1] == sub_level1_types[1]
            && address_component.types[2] == sub_level1_types[2] ) {
            info.sub_level1_name = address_component.short_name;
        }

        if ( address_component.types[0] == local_types[0]
            && address_component.types[1] == local_types[1] ) {
            info.local_name = address_component.short_name;
        }
    }
    return info;
}

function _getAddressInfoFromAddressComponents(results, countryShortName) {
    let sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
    let sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
    let local_types = [ "locality", "political" ];
    let country_types = ["country"];
    let sub_level2_name;
    let sub_level1_name;
    let local_name;
    let country_name;

    for (let i=0; i < results.length; i++) {
        let result = results[i];
        for (let j=0; j < result.address_components.length; j++) {
            let address_component = result.address_components[j];
            if ( address_component.types[0] == sub_level2_types[0]
                && address_component.types[1] == sub_level2_types[1]
                && address_component.types[2] == sub_level2_types[2] ) {
                sub_level2_name = address_component.short_name;
            }

            if ( address_component.types[0] == sub_level1_types[0]
                && address_component.types[1] == sub_level1_types[1]
                && address_component.types[2] == sub_level1_types[2] ) {
                sub_level1_name = address_component.short_name;
            }

            if ( address_component.types[0] == local_types[0]
                && address_component.types[1] == local_types[1] ) {
                local_name = address_component.short_name;
            }

            if ( address_component.types[0] == country_types[0] ) {
                country_name = address_component.long_name;
            }

            if (sub_level2_name && sub_level1_name && local_name && country_name) {
                break;
            }
        }

        if (sub_level2_name && sub_level1_name && local_name && country_name) {
            break;
        }
    }

    let label;
    let address = "";
    //국내는 동단위까지 표기해야 함.
    if (countryShortName === "KR") {
        if (sub_level2_name) {
            address += sub_level2_name;
            label = sub_level2_name;
        }
    }
    if (sub_level1_name) {
        address += " " + sub_level1_name;
        if (label == undefined) {
            label = sub_level1_name;
        }
    }
    if (local_name) {
        address += " " + local_name;
        if (label == undefined) {
            label = local_name;
        }
    }
    if (country_name) {
        address += " " + country_name;
        if (label == undefined) {
            label = country_name;
        }
    }

    return {label: label, address:address};
}

function _coord2geoInfo(data, loc, lang) {

    if (data.status !== "OK") {
        //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
        throw new Error(data.status);
    }

    let sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
    let sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
    let local_types = [ "locality", "political" ];
    let country_types = ["country"];
    let address_sublocality_level_2;
    let address_sublocality_level_1;
    let address_locality;
    let countryName;

    for (let i=0; i < data.results.length; i++) {
        let result = data.results[i];

        //get country_name
        for (let j=0; j < result.address_components.length; j++) {
            if (countryName) {
                break;
            }
            let address_component = result.address_components[j];
            if ( address_component.types[0] == country_types[0] ) {
                if (address_component.short_name.length <= 2) {
                    countryName = address_component.short_name;
                }
            }
        }

        //postal_code
        switch (result.types.toString()) {
            case sub_level2_types.toString():
                if (!address_sublocality_level_2) {
                    address_sublocality_level_2 = _getAddressInfoFromGoogleResult(result);
                }
                break;
            case sub_level1_types.toString():
                if (!address_sublocality_level_1) {
                    address_sublocality_level_1 = _getAddressInfoFromGoogleResult(result);
                }
                break;
            case local_types.toString():
                if (!address_locality) {
                    address_locality = _getAddressInfoFromGoogleResult(result);
                }
                break;
            default:
                break;
        }
    }

    if (countryName == undefined) {
        throw new Error('country_name null');
    }

    let geoInfo = {country: countryName};
    if (address_sublocality_level_2 && countryName == "KR") {
        geoInfo.address = address_sublocality_level_2.address;
        geoInfo.label = address_sublocality_level_2.sub_level2_name;
    }
    else if (address_sublocality_level_1) {
        geoInfo.address = address_sublocality_level_1.address;
        geoInfo.label = address_sublocality_level_1.sub_level1_name;
    }
    else if (address_locality) {
        geoInfo.address = address_locality.address;
        geoInfo.label = address_locality.local_name;
    }
    else {
        geoInfo = _getAddressInfoFromAddressComponents(data.results, countryName);
        geoInfo.country = countryName;
    }

    if (geoInfo.label == undefined || geoInfo.address == undefined) {
        throw new Error('failToFindLocation');
    }

    geoInfo.loc = loc;
    geoInfo.lang = lang;
    geoInfo.provider = 'google';

    return geoInfo;
}

function _addr2geoInfo(data, addr) {
    if (data.status !== "OK") {
        //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
        throw new Error(data.status);
    }

    let results = data.results;
    let location;
    let country;


    if (results.length == 0) {
        throw new Error("result.length = 0");
    }

    if (results[0].geometry && results[0].geometry.location) {
        location = [results[0].geometry.location.lat, results[0].geometry.location.lng];
    }
    else {
        throw new Error("fail to parsing results");
    }

    for (let i=0; i < results[0].address_components.length; i++) {
        if (results[0].address_components[i].types[0] == "country") {
            country =  results[0].address_components[i].short_name;
            break;
        }
    }

    return {loc: location, country: country, address: addr};
}

function coordUrl(baseUrl, loc, lang, key) {
    var url = (baseUrl || DEFAULT_BASE_URL) + '/maps/api/geocode/json' + '?latlng=' + loc[0] + ',' + loc[1];
    if (lang) {
        url += '&language=' + encodeURIComponent(lang);
    }
    return url + '&key=' + encodeURIComponent(key);
}

function addrUrl(baseUrl, addr, key) {
    return (baseUrl || DEFAULT_BASE_URL) + '/maps/api/geocode/json' + '?address=' + encodeURIComponent(addr) +
        '&key=' + encodeURIComponent(key);
}

/**
 * Classify one Google response (spec 3.5).
 * @param {{status:number, json:boolean, body:*}} res
 * @returns {string} success | empty | auth | quota | transient | request
 */
function classify(res) {
    if (res.status >= 500) {
        return 'transient';
    }
    if (res.status === 401 || res.status === 403) {
        return 'auth';
    }
    if (res.status === 429) {
        return 'quota';
    }
    if (res.status < 200 || res.status >= 300) {
        return 'request';
    }
    if (!res.json || !res.body || typeof res.body !== 'object') {
        return 'transient';
    }
    switch (res.body.status) {
        case 'OK': return 'success';
        case 'ZERO_RESULTS': return 'empty';
        case 'REQUEST_DENIED': return 'auth';
        case 'OVER_QUERY_LIMIT':
        case 'OVER_DAILY_LIMIT': return 'quota';
        case 'UNKNOWN_ERROR': return 'transient';
        default: return 'request';
    }
}

/** Mask the key parameter for logs. */
function redact(url) {
    return url.replace(/([?&]key=)[^&]*/g, '$1***');
}

module.exports = {
    coord2geoInfo: _coord2geoInfo,
    addr2geoInfo: _addr2geoInfo,
    coordUrl: coordUrl,
    addrUrl: addrUrl,
    classify: classify,
    redact: redact
};
