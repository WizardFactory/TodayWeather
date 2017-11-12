/**
 *
 * Created by aleckim on 2017. 11. 9..
 */

"use strict";

var GeoCtrl = require('../controllers/geo.controller');

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - geo controller class', function() {
    it('get address from daum', function(done) {
       var geoCtrl = new GeoCtrl(37.507, 127.045);
        geoCtrl._request = function (url, callback) {
           console.log(url);
            var result = '{"type":"H","code":"1123064","name":"역삼1동","fullName":"서울특별시 강남구 역삼1동","regionId":"I10000901","name0":"대한민국","code1":"11","name1":"서울특별시","code2":"11230","name2":"강남구","code3":"1123064","name3":"역삼1동","x":127.03306535867272,"y":37.495359482762545}';
            callback(null, JSON.parse(result));
        };

        geoCtrl._getAddressFromDaum(function (err) {
            if (err) {
                console.error(err);
            }
            else {
                console.info(geoCtrl);
            }
            done();
        });
    });

    it('get address from google', function (done) {
        var geoCtrl = new GeoCtrl(34.350, 131.295) ;

        geoCtrl._request = function (url, callback) {
            console.log(url);
            var result = '{"results":[{"address_components":[{"long_name":"Kitaura Highway","short_name":"国道191号線","types":["route"]},{"long_name":"Nagato-shi","short_name":"Nagato-shi","types":["locality","political"]},{"long_name":"Yamaguchi-ken","short_name":"Yamaguchi-ken","types":["administrative_area_level_1","political"]},{"long_name":"Japan","short_name":"JP","types":["country","political"]},{"long_name":"759-3801","short_name":"759-3801","types":["postal_code"]}],"formatted_address":"Kitaura Highway, Nagato-shi, Yamaguchi-ken 759-3801, Japan","geometry":{"bounds":{"northeast":{"lat":34.3520329,"lng":131.2980671},"southwest":{"lat":34.3511533,"lng":131.2959762}},"location":{"lat":34.3515907,"lng":131.2970204},"location_type":"GEOMETRIC_CENTER","viewport":{"northeast":{"lat":34.3529420802915,"lng":131.2983706302915},"southwest":{"lat":34.3502441197085,"lng":131.2956726697085}}},"place_id":"ChIJVV9-yJWgRDURd28zpqNg488","types":["route"]},{"address_components":[{"long_name":"Misumikami","short_name":"Misumikami","types":["political","sublocality","sublocality_level_1"]},{"long_name":"Nagato","short_name":"Nagato","types":["locality","political"]},{"long_name":"Yamaguchi Prefecture","short_name":"Yamaguchi Prefecture","types":["administrative_area_level_1","political"]},{"long_name":"Japan","short_name":"JP","types":["country","political"]},{"long_name":"759-3801","short_name":"759-3801","types":["postal_code"]}],"formatted_address":"Misumikami, Nagato, Yamaguchi Prefecture 759-3801, Japan","geometry":{"bounds":{"northeast":{"lat":34.3702904,"lng":131.349357},"southwest":{"lat":34.3104089,"lng":131.2627181}},"location":{"lat":34.351022,"lng":131.2993422},"location_type":"APPROXIMATE","viewport":{"northeast":{"lat":34.3702904,"lng":131.349357},"southwest":{"lat":34.3104089,"lng":131.2627181}}},"place_id":"ChIJ9YG___GgRDURDDEHXfhx3ok","types":["political","sublocality","sublocality_level_1"]},{"address_components":[{"long_name":"Nagato","short_name":"Nagato","types":["locality","political"]},{"long_name":"Yamaguchi Prefecture","short_name":"Yamaguchi Prefecture","types":["administrative_area_level_1","political"]},{"long_name":"Japan","short_name":"JP","types":["country","political"]}],"formatted_address":"Nagato, Yamaguchi Prefecture, Japan","geometry":{"bounds":{"northeast":{"lat":34.4424146,"lng":131.349357},"southwest":{"lat":34.2617872,"lng":130.9321847}},"location":{"lat":34.3709562,"lng":131.1821947},"location_type":"APPROXIMATE","viewport":{"northeast":{"lat":34.4424146,"lng":131.349357},"southwest":{"lat":34.2617872,"lng":130.9321847}}},"place_id":"ChIJbcaHpZJnQzURubGPFww5jm0","types":["locality","political"]},{"address_components":[{"long_name":"759-3801","short_name":"759-3801","types":["postal_code"]},{"long_name":"Misumikami","short_name":"Misumikami","types":["political","sublocality","sublocality_level_1"]},{"long_name":"Nagato","short_name":"Nagato","types":["locality","political"]},{"long_name":"Yamaguchi Prefecture","short_name":"Yamaguchi Prefecture","types":["administrative_area_level_1","political"]},{"long_name":"Japan","short_name":"JP","types":["country","political"]}],"formatted_address":"759-3801, Japan","geometry":{"bounds":{"northeast":{"lat":34.3702904,"lng":131.349357},"southwest":{"lat":34.3104089,"lng":131.2627181}},"location":{"lat":34.3486297,"lng":131.3310303},"location_type":"APPROXIMATE","viewport":{"northeast":{"lat":34.3702904,"lng":131.349357},"southwest":{"lat":34.3104089,"lng":131.2627181}}},"place_id":"ChIJb9oaEpWgRDUR0olmLbHw5ew","types":["postal_code"]},{"address_components":[{"long_name":"Yamaguchi Prefecture","short_name":"Yamaguchi Prefecture","types":["administrative_area_level_1","political"]},{"long_name":"Japan","short_name":"JP","types":["country","political"]}],"formatted_address":"Yamaguchi Prefecture, Japan","geometry":{"bounds":{"northeast":{"lat":34.7982772,"lng":132.4917877},"southwest":{"lat":33.7129895,"lng":130.7751059}},"location":{"lat":34.1859563,"lng":131.4706493},"location_type":"APPROXIMATE","viewport":{"northeast":{"lat":34.7982772,"lng":132.4917877},"southwest":{"lat":33.7129895,"lng":130.7751059}}},"place_id":"ChIJ_Y9adhnHRDURcOJUU8K8DEk","types":["administrative_area_level_1","political"]},{"address_components":[{"long_name":"Japan","short_name":"JP","types":["country","political"]}],"formatted_address":"Japan","geometry":{"bounds":{"northeast":{"lat":45.6412626,"lng":154.0031455},"southwest":{"lat":20.3585295,"lng":122.8554688}},"location":{"lat":36.204824,"lng":138.252924},"location_type":"APPROXIMATE","viewport":{"northeast":{"lat":45.6412626,"lng":154.0031455},"southwest":{"lat":20.3585295,"lng":122.8554688}}},"place_id":"ChIJLxl_1w9OZzQRRFJmfNR1QvU","types":["country","political"]}],"status":"OK"}';
            callback(null, JSON.parse(result));
        };

        geoCtrl.googleApiKey = null;

        geoCtrl._getAddressFromGoogle(function (err) {
            if (err) {
                console.error(err);
            }
            else {
                console.info(geoCtrl);
            }
            done();
        });
    });
});

