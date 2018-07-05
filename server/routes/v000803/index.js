var express = require('express');
var jwt = require('jsonwebtoken');
var fs = require('fs');

var privateKey = null;
var publicKey = null;

fs.exists('./config/jwt-private.pem', function(exist) {
    if(exist) {
        privateKey = fs.readFileSync('./config/jwt-private.pem');
    }
});

fs.exists('./config/jwt-public.pem', function(exist) {
    if(exist) {
        publicKey = fs.readFileSync('./config/jwt-public.pem');
    }
});

var router = express.Router();

var idBearerToken = [];

router.use(function checkAuthorization(req, res, next) {
    var deviceId = '';
    if (req.headers['device-id']) {
       deviceId = req.headers['device-id'];
    }

    log.info('@@ + ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' +
        req.sessionID+ ' UUID='+deviceId);
    log.info('user-agent='+req.headers['user-agent']+ '  sID=' + req.sessionID+ ' UUID='+deviceId);

    var err;
    // post일 경우에만 check 한다.
    if(req.method === 'POST') {
        // id, pw가 파라메터에 포함될 경우 json web token을 생성하여 보내고,
        // json web token이 포함되어 있을 경우 검증한 뒤 다음 진행한다.

        if(req.headers.bearertoken === undefined) {
            // body에서 id와 pw 를 찾고 없으면, 503 에러를 보낸다
            if(req.body.id === undefined) {
                err = new Error('Not found id.');

                res.status(err.status || 500);
                res.render('error', {
                    message: err.message,
                    error: err
                });
            } else {
                if((req.body.id === 'todayweather')
                    && (req.body.password === 'wizard')) {
                    var token = null;

                    if(privateKey) {
                        token = jwt.sign({id: req.body.id, password: req.body.password, app: 'TodayWeather'}, privateKey, {algorithm:'RS256'});
                    } else {
                        token = jwt.sign({id: req.body.id, password: req.body.password, app: 'TodayWeather'}, 'wizard');
                    }

                    idBearerToken[req.body.id] = 'TodayWeather';
                    log.debug(token);

                    res.status = 200;
                    res.send(token);
                }
                else {
                    err = new Error('invalid id or password.');

                    res.status(err.status || 500);
                    res.render('error', {
                        message: err.message,
                        error: err
                    })
                }
            }
        } else {
            // bearerToken를 파싱해서 app이름을 확인한다.
            var decode = null;

            if(publicKey) {
                decode = jwt.decode(req.headers.bearertoken, publicKey, {algorithm:'RS256'});
            }
            else {
                decode = jwt.decode(req.headers.bearertoken, 'wizard');
            }

            if(idBearerToken[decode.id] === decode.app) {
                log.debug(decode.app);
                next();
            }
            else {
                err = new Error('App name is invalid.');

                log.debug(decode.id);

                res.status(err.status || 500);
                res.render('error', {
                    message: err.message,
                    error: err
                });
            }
        }
    }
    else {
        next();
    }
});

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', { title: 'TodayWeather' });
});

router.use('/gather', require('../v000001/routeGather'));
router.use('/town', require('./routeTownForecast'));
router.use('/daily', require('../v000705/dailySummary'));
router.use('/check-purchase', require('../v000705/receiptValidation'));
router.use('/push', require('../v000705/routePushNotification'));

router.use('/nation', require('./route.nation'));

router.post('/', function(req,res) {
    res.render('index', {title:'TodayWeather : post'});
});

router.use('/test', require('./route.test'));

router.use('/geo', require('./route.geo'));

module.exports = router;
