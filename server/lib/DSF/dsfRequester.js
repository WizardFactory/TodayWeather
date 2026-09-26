/**
 * Created by Peter on 2016. 8. 18..
 * Dark Sky was shut down in March 2023. Overseas weather now comes from Visual Crossing
 * (lib/VC, #2585). This legacy requester, still referenced by the v000803 collector paths,
 * fails immediately instead of calling the retired API.
 */

"use strict";

function dsfRequester(){
    return this;
}

function retired() {
    return new Error('DSF> Dark Sky API retired; overseas weather uses Visual Crossing (#2585)');
}

dsfRequester.prototype.getForecast = function(geocode, date, key, callback){
    callback(retired(), {isSuccess: false});
};

dsfRequester.prototype.collect = function(list, date, key, callback){
    callback(retired(), []);
    return this;
};

dsfRequester.prototype.getData = function(url, retryCount, callback){
    callback(retired());
};

module.exports = dsfRequester;
