/**
 * Created by aleckim on 2016. 5. 2..
 */

var express = require('express');
var router = express.Router();
var config = require('../../config/config');
var ControllerPush = require('../../controllers/controllerPush');

/**
 * create or update pushInfo
 */
router.post('/', function(req, res) {
    log.info('post : '+ JSON.stringify(req.body));
    //update modelPush
    //return _id
    var co = new ControllerPush();
    co.updatePushInfo(req.body, function (err, result) {
        if (err) {
            log.error(err);
            //return  res error
            return res.status(500).send(err.message);
        }
        return res.send(result);
    });
});

/**
 * update registration id
 */
router.put('/', function(req, res) {
    log.info('put : '+ JSON.stringify(req.body));
    var co = new ControllerPush();
    co.updateRegistrationId(req.body.newRegId, req.body.oldRegId, function (err, result) {
        if (err) {
            log.error(err);
            //return  res error
            return res.status(500).send(err.message);
        }
        return res.send(result);
    });
});

/**
 * remove
 */
router.delete('/', function(req, res) {
    log.info('delete : '+ JSON.stringify(req.body));

    var co = new ControllerPush();
    co.removePushInfo(req.body, function (err, result) {
        if (err) {
            log.error(err);
            //return  res error
            return res.status(500).send(err.message);
        }
        return res.send(result.toString());
    });
});

module.exports = router;
