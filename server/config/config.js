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
        newrelic: (process.env.NEW_RELIC_LICENSE_KEY || 'Your New Relic license key')
    },
    logToken: {
        gather: (process.env.LOGENTRIES_GATHER_TOKEN||'Your Logentries key'),
        service: (process.env.LOGENTRIES_SERVICE_TOKEN||'Your Logentries key')
    }
};
