/**
 * Created by aleckim on 2018. 2. 2..
 */

var express = require('express');
var router = express.Router();
var ControllerPush = require('../../controllers/controllerPush');

router.post('/', function(req, res) {
    log.info('post : '+ JSON.stringify(req.body));
    log.info('accept-language:'+req.headers['accept-language']);

    var language = req.headers['accept-language'];
    if (language == undefined) {
        log.warn("accept-language is undefined");
        language = 'en';
    }
    else {
        language = language.split(',')[0];
        if (language) {
            language = language.substr(0, language.length-3);
        }
        else {
            log.error("Fail to parse language="+req.headers['accept-language']);
            language = 'en';
        }
    }

    var pushList = req.body;

    var co = new ControllerPush();
    co.updatePushInfoList(language, pushList, function (err, result) {
        if (err) {
            if (err.statusCode) {
                return res.status(err.statusCode).send(err.message);
            }
            else {
                return res.status(501).send(err.message);
            }
        }
        return res.send(result);
    });
});

module.exports = router;
