/**
 * Created by Peter on 2016. 6. 1..
 */
"use strict";

var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var controllerCollector = require('../../controllers/worldWeather/controllerCollector');

global.log  = new Logger(__dirname + "/debug.log");

describe('controller unit test - collector', function(){
    var geocodeList = [
        /*
        {
            //'221B Baker Street London NW1 England'
            address:{
                country: 'UK',
                city: 'London'
            },
            geocode:{
                lat: 51.52,
                lon: -0.15
            }
        },
        {
            //'Place du Palais 84000 Avignon France'
            address: {
                country: 'France',
                city: 'Paris'
            },
            geocode:{
                lat: 43.95,
                lon: 4.80
            }
        },
        {
            //'Piazza del colosseo 1 00184 Rom Italy'
            address: {
                country: 'Italy',
                city: 'Rome'
            },
            geodode:{
                lat: 41.89,
                lon: 12.49
            }
        },
        {
             //'Parthenon 10558 Athens Greece'
            address:{
                country: 'Greece',
                city: 'Athens'
            },
            geocode:{
                lat: 37.97,
                lon: 23.72
            }
        },
        {
            //'Akihabara Station 17-6'
            address: {
                country: 'Japan',
                city:'Tokyo'
            },
            geocode: {
                lat: 35.70,
                lon: 139.77
            }
        },
        */
        {
            // 'Fukuoka Station 321'
            address: {
                country: 'Japan',
                city: 'Fukuoka'
            },
            geocode:{
                lat: 33.57,
                lon: 130.42
            }
        },
        {
            //'Beijing West Railway Station Lianhuachi East Road, Feeder Road, Beijing'
            address : {
                country: 'China',
                city: 'Beijing'
            },
            geocode:{
                lat:39.66,
                lon:116.40
            }
        }
    ];

    it('get geocode', function(done){
        var modelGeocode = require('../../models/worldWeather/modelGeocode');
        modelGeocode.getGeocode = function(callback){
            callback(0, geocodeList);
        };

        var collector = new controllerCollector;
        collector.getGeocodeList(modelGeocode, function(err, list){
            assert.equal(list, geocodeList, 'error');
            done();
        });
    });

    it('get wu data', function(done){
        var modelWuForecast = require('../../models/worldWeather/modelWuForecast');
        modelWuForecast.find = function(geocode, callback){

            callback(0, []);
        };

        var collector = new controllerCollector;
        collector.processWuForecast(geocodeList, 2, function(err, failList){
            done();
        });
    })

});
