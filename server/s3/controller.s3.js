/**
 * Created by dhkim2 on 2018-03-11.
 */

"use strict";

const https = require('https');
const http = require('http');
const request = require('request');
const AWS = require('aws-sdk');

class ControllerS3 {
    constructor(region, bucketName) {
        AWS.config.region = region;
        this.s3 = new AWS.S3({params: {Bucket: bucketName}});
    }

    /**
     *
     * @param folderName it has '/' at last of string
     * @returns {Promise<PromiseResult<S3.ListObjectsV2Output, AWSError>>}
     */
    ls(folderName) {
        let opts = {
            MaxKeys: 2147483647, // Maximum allowed by S3 API
            Delimiter: '/'
        };
        if (folderName && folderName.length > 0) {
            opts.Prefix = folderName;
        }
        return this.s3.listObjectsV2(opts).promise();
    }

    get(key) {
        return this.s3.getObject({Key: key}).promise();
    }

    copy(key, source) {
        return this.s3.copyObject({CopySource: source, Key: key}).promise();
    }

    uploadData(body, s3Path) {
        let key = s3Path;
        log.info({s3Path: s3Path});

        let self = this;

        return new Promise((resolve, reject) => {
            self.s3.putObject({
                    // Bucket: process.env.S3_BUCKET,
                    Key: key,
                    ContentType: "application/json",
                    ACL: 'public-read',
                    Body: body
                },
                (e, data) => {
                    if (e) {
                        return reject(e);
                    }

                    resolve(data);
                });
        });
    }

    upload(url, s3Path) {
        let key = s3Path;
        log.info({url:url, s3Path: s3Path});

        let self = this;

        return new Promise((resolve, reject) => {
            request({
                method: 'GET',
                url: url,
                encoding: null // returns body as Buffer
            }, (e, res, body) => {
                if (e) {
                    return reject(e);
                } // something went wrong during fetch
                if (res.statusCode.toString().slice(0, 1) !== '2') { // server respond with unexpected status code
                    return reject(new Error(`Unexpected status code ${res.statusCode}`));
                }

                self.s3.upload({
                    // Bucket: process.env.S3_BUCKET,
                    Key: key,
                    ContentType: res.headers['content-type'] || 'application/octet-stream',
                    ACL: 'public-read',
                    Body: body
                }, (e, data) => {
                    if (e) {
                        return reject(e);
                    }

                    resolve(data);
                });
            });
        });
    }
}

module.exports = ControllerS3;
