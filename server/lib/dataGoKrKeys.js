'use strict';

// The sole key source for the forecast, life-index, warning, KASI and zone clients.
// Keep the serialized config field so existing operator environments remain compatible.
function parse(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (err) { return []; }
    }
    if (!Array.isArray(value)) { return []; }
    return value.filter(function (key, index, list) {
        return typeof key === 'string' && key.trim().length >= 20 &&
            key.indexOf('You have to set') !== 0 && list.indexOf(key) === index;
    });
}
function fromConfig(keyBox) {
    return parse(keyBox && keyBox.dongnae_forecast_keys);
}
function encode(key) {
    try { return encodeURIComponent(decodeURIComponent(key)); }
    catch (err) { return encodeURIComponent(key); }
}
module.exports = {parse: parse, fromConfig: fromConfig, encode: encode};
