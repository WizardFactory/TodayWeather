/**
 * Created by Peter on 2016. 3. 12..
 */
var assert  = require('assert');
var convert = require('../utils/convertAddress');
var Logger = require('../lib/log');

//global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - get address from google by geocode', function(){

    it('convertAddress', function(done){
        var list = [
            /*
             {
             address: '221B Baker Street London NW1 England',
             lat: 51.52,
             lon: -0.15
             },
             {
             address: 'Place du Palais 84000 Avignon France',
             lat: 43.95,
             lon: 4.80
             },
             {
             address: 'Piazza del colosseo 1 00184 Rom Italy',
             lat: 41.89,
             lon: 12.49
             },
             {
             address: 'Parthenon 10558 Athens Greece',
             lat: 37.97,
             lon: 23.72
             },
             {
             address: 'Akihabara Station 17-6',
             lat: 35.70,
             lon: 139.77

             },
             {
             address: 'Fukuoka Station 321',
             lat: 33.57,
             lon: 130.42
             },
             */
            {
                address: 'Kita6Jonishi 4-Chome',
                lat: 43.06,
                lon: 141.34
            }

        ];
        convert(list[0].lat, list[0].lon, function (err, result) {
            log.info(result);
            done();
        });
    });
});
