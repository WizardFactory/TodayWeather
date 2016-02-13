
"use strict";

var req = require('request');

/**
 *
 * @param region
 * @param accessKey
 * @param secertKey
 * @param apiVersion
 * @returns {*}
 */
function awsCloudFront(region, accessKey, secertKey, apiVersion){
    var self = this;

    self.AWS = require('aws-sdk');
    if(region){
        self.AWS.config.update({region: region});
    }else{
        self.AWS.config.update({region: 'us-east-1'});
    }

    if(accessKey && secertKey){
        self.AWS.config.update({accessKeyId: accessKey, secretAccessKey: secertKey});
    }else{
        log.error('there is no key');
        return NULL;
    }

    if(apiVersion){
        self.AWS.config.apiVersions = {
            cloudfront: apiVersion,
        };
    }else{
        self.AWS.config.apiVersions = {
            cloudfront: 'latest',
        };
    }

    return this;
}

/**
 *
 * @param itemList
 * @param distributionId
 * @param callback
 */
awsCloudFront.prototype.invalidateCloudFront = function(itemList, distributionId, callback){
    var self = this;
    var callRef = new Date();

    self.cloudfront = new self.AWS.CloudFront();

    if(itemList.length === 0 || !Array.isArray(itemList)){
        if(callback){
            callback(new Error('There is no items'));
        }
        return;
    }

    if(distributionId === undefined || typeof distributionId !== 'string'){
        if(callback){
            callback(new Error('There is no distribution ID'));
        }
        return;
    }
    var params = {
        DistributionId: distributionId,
        InvalidationBatch: {
            CallerReference: callRef.toString(),
            Paths: {
                Quantity: itemList.length,
                Items: itemList
            }
        }
    };

    self.cloudfront.createInvalidation(params, function(err, data) {
        if (err){
            return new Error('Can not invalidate cloudfront');
        }

        log.info('invalidated CloudFront');
        log.silly(data);
        if(callback){
            callback();
        }
    });
};

module.exports = awsCloudFront;
