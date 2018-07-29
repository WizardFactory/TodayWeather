/**
 * Created by Peter on 2015. 7. 19..
 */
'use strict';

module.exports = {
    ipAddress: (process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1'),
    port: (process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000'),
    mode: (process.env.SERVER_MODE || 'local'), //local, gather, service, push, scrape
    db: {
        version: (process.env.DB_DATA_VERSION || '1.0'),
        path: (process.env.MONGOLAB_MONGODB_URL || 'mongodb://localhost/'),
        database: (process.env.MONGOLAB_MONGODB_DATABASE || 'test')
    },
    keyString: {
        test_normal: (process.env.DATA_GO_KR_TEST_NORMAL_KEY || 'You have to set key of data.go.kr'),
        test_cert: (process.env.DATA_GO_KR_TEST_CERT_KEY || 'You have to set key of data.go.kr'),
        normal: (process.env.DATA_GO_KR_NORMAL_KEY || 'You have to set key of data.go.kr'),
        cert_key: (process.env.DATA_GO_KR_CERT_KEY || 'You have to set key of data.go.kr'),
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
        }],
        daum_keys : (process.env.DAUM_SECRET_KEYS || '["set string of array of daum keys","key1", "key2"]'),
        dongnae_forecast_keys: (process.env.DONGNAE_SECRET_KEYS || '["key1","key2"]'),
        airkorea_keys : (process.env.AIRKOREA_SECRET_KEYS || '["key1", "key2"]'),
        google_key : (process.env.GOOGLE_SECRET_KEY || 'You have to set googe api key')
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
        googlePublicKey: (process.env.GOOGLE_PUBLIC_KEY || 'Your google public key'),
        googleAccToken: (process.env.PLAY_STORE_API_ACCESS_TOKEN || "PLAY_STORE_API_ACCESS_TOKEN"),
        googleRefToken: (process.env.PLAY_STORE_API_REFRESH_TOKEN || "PLAY_STORE_API_REFRESH_TOKEN"),
        googleClientID: (process.env.PLAY_STORE_API_CLIENT_ID || "PLAY_STORE_API_CLIENT_ID"),
        googleClientSecret: (process.env.PLAY_STORE_API_CLIENT_SECRET || "PLAY_STORE_API_CLIENT_SECRET")
    },
    push: {
        gcmAccessKey: (process.env.GCM_ACCESS_KEY || 'Your gcm access key')
    },
    url: {
        requester: ('http://'+(process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1')+':'+(process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000')+'/'),
        weather: ('http://'+(process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1')+':'+(process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || '3000')+'/')
    },
    serviceServer: {
        url: (process.env.SERVICE_SERVER || 'http://localhost'),
        version:  (process.env.SERVICE_VERSION || 'v000901')
    },
    apiServer: {
        url: (process.env.API_SERVER || 'http://localhost')
    },
    image:{
        airkorea_korea_image:{
            coordi: {
                top_lat: (process.env.AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT || '0'),
                bottom_lat: (process.env.AIRKOREA_KOREA_IMAGE_COORDI_BOTTOM_LAT || '0'),
                left_lon: (process.env.AIRKOREA_KOREA_IMAGE_COORDI_LEFT_LON || '0'),
                right_lon: (process.env.AIRKOREA_KOREA_IMAGE_COORDI_RIGHT_LON || '0')
            },
            size: {
                width: (process.env.AIRKOREA_KOREA_IMAGE_SIZE_WIDTH || '0'),
                height: (process.env.AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT || '0')
            },
            pixel_pos: {
                left: (process.env.AIRKOREA_KOREA_IMAGE_MAP_LEFT || '0'),
                right: (process.env.AIRKOREA_KOREA_IMAGE_MAP_RIGHT || '0'),
                top: (process.env.AIRKOREA_KOREA_IMAGE_MAP_TOP || '0'),
                bottom: (process.env.AIRKOREA_KOREA_IMAGE_MAP_BOTTOM || '0')
            }
        },
        kaq_korea_image:{
            coordi: {
                top_lat: (process.env.KAQ_KOREA_IMAGE_COORDI_TOP_LAT || '0'),
                bottom_lat: (process.env.KAQ_KOREA_IMAGE_COORDI_BOTTOM_LAT || '00'),
                left_lon: (process.env.KAQ_KOREA_IMAGE_COORDI_LEFT_LON || '0'),
                right_lon: (process.env.KAQ_KOREA_IMAGE_COORDI_RIGHT_LON || '0')
            },
            size: {
                width: (process.env.KAQ_KOREA_IMAGE_SIZE_WIDTH || '0'),
                height: (process.env.KAQ_KOREA_IMAGE_SIZE_HEIGHT || '0')
            },
            pixel_pos: {
                left: (process.env.KAQ_KOREA_IMAGE_MAP_LEFT || '0'),
                right: (process.env.KAQ_KOREA_IMAGE_MAP_RIGHT || '0'),
                top: (process.env.KAQ_KOREA_IMAGE_MAP_TOP || '0'),
                bottom: (process.env.KAQ_KOREA_IMAGE_MAP_BOTTOM || '0')
            },
            region: (process.env.KAQ_KOREA_IMAGE_MAP_REGION || ''),
            bucketName: (process.env.KAQ_KOREA_IMAGE_MAP_BUCKET_NAME || ''),
        }
    }
};
