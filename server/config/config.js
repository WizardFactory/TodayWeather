/**
 * Created by Peter on 2015. 7. 19..
 */
'use strict';

module.exports = {
    ipAddress: (process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1'),
    port: (process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000'),
    mode: (process.env.SERVER_MODE || 'local'), //local, gather, service
    db: {
        mode: (process.env.DB_MODE || 'db'), //ram, db
        path: (process.env.MONGOLAB_MONGODB_URL || 'mongodb://localhost/todayweather')
    },
    keyString: {
        test_normal: (process.env.DATA_GO_KR_TEST_NORMAL_KEY || 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D'),
        test_cert: (process.env.DATA_GO_KR_TEST_CERT_KEY || 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D'),
        normal: (process.env.DATA_GO_KR_NORMAL_KEY || 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D'),
        cert_key: (process.env.DATA_GO_KR_CERT_KEY || 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D'),
        daum_key: (process.env.DAUM_KEY || 'You have to set key of daum.net')
    }
};
