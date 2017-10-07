/**
 * Created by Peter on 2015. 7. 19..
 */
'use strict';

module.exports = {
    ipAddress: (process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1'),
    port: (process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000'),
    mode: (process.env.SERVER_MODE || 'service'), //local, gather, service, push
    db: {
        version: (process.env.DB_DATA_VERSION || '1.0'),
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
        aws_secret_key:(process.env.AWS_SECRET_KEY || 'You have to set key of AWS'),
        owm_keys : [{
            key: (process.env.OWM_SECRET_KEY || 'You have to set key of Open weather map')
        }],
        wu_keys : [{
            id: (process.env.WU_SECRET_ID || 'You have to set id of weather unlock'),
            key: (process.env.WU_SECRET_KEY || 'You have to set key of weather unlock')
        }],
        dsf_keys : [{
            key: (process.env.DSF_SECRET_KEY || 'You have to set key of Dark Sky')
        }],
        aw_keys : [{
            key : (process.env.AW_SECRET_KEY || 'You have to set key of AW')
        }],
        fc_keys : [{
            key : (process.env.FC_SECRET_KEY || 'You have to set key of FC')
        }],
        aqi_keys : [{
            key: (process.env.WAQI_SECRET_KEY || 'You have to set key of WAQI')
        }]
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
        googlePublicKey: (process.env.GOOGLE_PUBLIC_KEY || 'Your google public key')
    },
    push: {
        serviceServer : (process.env.SERVICE_SERVER || 'http://localhost:3000'),
        gcmAccessKey: (process.env.GCM_ACCESS_KEY || 'Your gcm access key')
    },
    url: {
        requester: ('http://'+(process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1')+':'+(process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000')+'/'),
        weather: ('http://'+(process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1')+':'+(process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000')+'/')
    }
};
