/**
 * Created by Peter on 2016. 2. 12..
 */
var awsCloudfront = require('../../utils/awsCloudFront');
var Logger = require('../../lib/log');
var assert  = require('assert');
var keydata  = require('../../config/config').keyString;
var awsData = require('../../config/config').aws;

global.log  = new Logger();

describe('unit test - invalidate CloudFront', function() {
    it('make instance and do invalidate', function(done) {
        var item = [];
        var cf = new awsCloudfront(awsData.region, keydata.aws_access_key, keydata.aws_secret_key, awsData.cloudfront_api_version);

        item.push('/town/*');
        cf.invalidateCloudFront(item, awsData.distribution_id, function(err){
            if(err){
                console.log('Can not invalidate cloudfront');
                console.log(err);
            }

            done();
        });
    });
});

