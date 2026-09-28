'use strict';
// Small JSON-object store. The only registration writer is the coordinator.
function create(options) {
    options = options || {};
    if (!options.bucket) {
        throw new Error('PUSH_S3_BUCKET is required');
    }
    var client =
        options.client ||
        new (require('aws-sdk').S3)({
            region: options.region,
            maxRetries: 2,
            httpOptions: { connectTimeout: 2000, timeout: 5000 }
        });
    var prefix = (options.prefix || 'push/v2').replace(/\/+$/, '') + '/';
    function key(value) {
        if (typeof value !== 'string' || value.indexOf('..') !== -1 || value[0] === '/') {
            throw new Error('Invalid push object key');
        }
        return prefix + value;
    }
    return {
        get: async function (name) {
            try {
                var r = await client.getObject({ Bucket: options.bucket, Key: key(name) }).promise();
                return JSON.parse(r.Body.toString('utf8'));
            } catch (e) {
                if (e.code === 'NoSuchKey' || e.statusCode === 404) return null;
                throw new Error('Push S3 read failed');
            }
        },
        put: async function (name, value) {
            await client
                .putObject({
                    Bucket: options.bucket,
                    Key: key(name),
                    Body: JSON.stringify(value),
                    ContentType: 'application/json',
                    ServerSideEncryption: 'AES256'
                })
                .promise();
        },
        list: async function (name) {
            var token,
                keys = [];
            do {
                var r = await client
                    .listObjectsV2({ Bucket: options.bucket, Prefix: key(name), ContinuationToken: token })
                    .promise();
                (r.Contents || []).forEach(function (x) {
                    keys.push(x.Key.slice(prefix.length));
                });
                token = r.IsTruncated ? r.NextContinuationToken : null;
            } while (token);
            return keys;
        }
    };
}
async function mapLimit(items, limit, fn) {
    var index = 0,
        results = new Array(items.length);
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async function () {
            while (index < items.length) {
                var i = index++;
                results[i] = await fn(items[i], i);
            }
        })
    );
    return results;
}
module.exports = { create: create, mapLimit: mapLimit };
