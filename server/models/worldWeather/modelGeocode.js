/**
 * Created by Peter on 2016. 4. 24..
 */

"use strict";

var mongoose = require('mongoose');

var tSchema = new mongoose.Schema({
    geocode: {lat: Number, lon: Number},
    address:{country:String, city:String, zipcode:Number, postcode:Number}
});

tSchema.index({"geocode.lat": 1, "geocode.lon": 1});
tSchema.index({"address.country":'text', "address.city":'text', "address.zipcode":1, "address.postcode":1});

var geocode = [];

tSchema.statics = {
    getGeocode : function(cb) {
        if(geocode.length === 0){
            this.distinct("geocode").exec(function(err, result){
                geocode = result;
                cb(err, geocode);
            });
        }
        else{
            //log.info('get geocode : ', mCoord.length);
            cb(0, geocode);
        }
    },
    updateGeocode : function(){
        geocode = [];
    }
};

module.exports = mongoose.model('geocode', tSchema);

