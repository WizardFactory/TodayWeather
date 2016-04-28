/**
 * Created by Peter on 2015. 7. 19..
 */
'use strict';

module.exports = {
    ipAddress: (process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1'),
    port: (process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000'),
    mode: (process.env.SERVER_MODE || 'local'), //local, gather, service
    db: {
        path: (process.env.MONGOLAB_MONGODB_URL || 'mongodb://localhost/todayweather')
    },
    keyString: {
        test_normal: (process.env.DATA_GO_KR_TEST_NORMAL_KEY || 'You have to set key of data.go.kr'),
        test_cert: (process.env.DATA_GO_KR_TEST_CERT_KEY || 'You have to set key of data.go.kr'),
        normal: (process.env.DATA_GO_KR_NORMAL_KEY || 'You have to set key of data.go.kr'),
        cert_key: (process.env.DATA_GO_KR_CERT_KEY || 'You have to set key of data.go.kr'),
        daum_key: (process.env.DAUM_KEY || 'You have to set key of daum.net'),
        newrelic: (process.env.NEW_RELIC_LICENSE_KEY || 'Your New Relic license key'),
        aws_access_key:(process.env.AWS_ACCESS_KEY || 'You have to set key of AWS'),
        aws_secret_key:(process.env.AWS_SECRET_KEY || 'You have to set key of AWS')
    },
    logToken: {
        gather: (process.env.LOGENTRIES_GATHER_TOKEN||'Your Logentries key'),
        service: (process.env.LOGENTRIES_SERVICE_TOKEN||'Your Logentries key')
    },
    aws:{
        distribution_id:(process.env.AWS_DISTRIBUTION_ID || 'You need to set the distributionid of CloudFront'),
        region: (process.env.AWS_REGION || 'us-east-1'),
        cloudfront_api_version:(process.env.AWS_CLOUDFRONT_API_VERSION || 'latest')
    },
    platforms: {
        applePassword: (process.env.APPLE_PASSWORD || 'Your apple password'),
        googlePublicKey: (process.env.APPLE_PASSWORD || 'Your google public key')
    }
};
