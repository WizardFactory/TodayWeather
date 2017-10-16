/**
 * Created by aleckim on 2017. 10. 17..
 */

var should = require('should');
var assert = require('assert');
var request = require('supertest');

describe('Routing', function() {
    var url = 'http://localhost:3000';
    before(function (done) {
        done();
    });

    it('test receipt validation', function (done) {
        this.timeout(60*1000*60); //1mins
        var path = '/v000705/check-purchase';
        var data = {
            "type": "android",
            "id": "tw1year",
            "receipt": [
                {
                    "signature": "",
                    "productId": "",
                    "transactionId": "",
                    "type": "subs",
                    "productType": "subs",
                    "receipt": ""
                }
            ]
        };
        //var data = {
        //    "type": "ios",
        //    "id": "tw1year",
        //    "receipt": ""
        //};

        request(url)
            .post(encodeURI(path))
            .send(data)
            .set('Accept', 'application/json')
            .expect(200)
            .end(function (err, res) {
                if (err) {
                    throw err;
                }
                console.log(res.body);
                done();
            });
    });
});


