/**
 * Created by aleckim on 2016. 5. 2..
 */

var apn = require('apn');
var gcm = require('node-gcm');
var config = require('../config/config');
var PushInfo = require('../models/modelPush');
var async = require('async');

var apnGateway;

var production = false;
if (process.env.NODE_ENV === 'production') {
    apnGateway = "gateway.push.apple.com";
    production = true;
}
else {
    apnGateway = "gateway.sandbox.push.apple.com";
}

var apnOptions = {
    gateway : apnGateway,
    cert: './config/aps_cert.pem',
    key: './config/aps_key.pem',
    production: production,
    batchFeedback: true,
    interval: 300 //seconds
};

var server_access_key = config.push.gcmAccessKey;

var apnConnection = new apn.Connection(apnOptions);
var sender = new gcm.Sender(server_access_key);

function controllerPush() {
    this.timeInterval = 60*1000; //1min
}

controllerPush.prototype.updateRegistrationId = function (newId, oldId, callback) {
    PushInfo.find({registrationId: oldId}, function (err, pushList) {
        if (err) {
            return callback(err);
        }
        if (pushList.length == 0) {
            log.info("no registrationId="+oldId);
            return callback(undefined, 'not found oldRegId='+oldId);
        }

        pushList.forEach(function (push) {
            push.registrationId = newId;
            push.save(function (err) {
                if (err) {
                    log.error(err);
                }
            });
        });
        return callback(undefined, 'We will change itmes='+pushList.length+' regid to '+newId);
    });

    return this;
};

/**
 * save push info
 */
controllerPush.prototype.updatePushInfo = function (pushInfo, callback) {
    PushInfo.update(
        {registrationId: pushInfo.registrationId, cityIndex: pushInfo.cityIndex},
        pushInfo,
        {upsert : true},
        function (err, result) {
            if (err) {
                return callback(err);
            }
            return callback(undefined, result);
        });

    return this;
};

controllerPush.prototype.removePushInfo = function (pushInfo, callback) {
    PushInfo.remove({
            registrationId: pushInfo.registrationId,
            type:pushInfo.type,
            cityIndex: pushInfo.cityIndex},
        function (err, result) {
            if (err) {
                return callback(err);
            }
            if (!result) {
                return callback(new Error('Fail to get result'));
            }
            log.info(result.toString());
            callback(undefined, result.toString());
        });

    return this;
};

controllerPush.prototype.getPushByTime = function (time, callback) {
    PushInfo.find({pushTime: time}).lean().exec(function (err, pushList) {
        if (err) {
            return callback(err);
        }
        if (pushList.length == 0) {
            return callback('No push info time='+time);
        }
        callback(undefined, pushList);
    });

    return this;
};

/**
 * node-gcm에 나와야 있는 data, notification분리 방법으로 보내면 안됨. phonegap-plugin-push에 나와야 있는 예제를 따라해야 함.
 * @param pushInfo
 * @param notification
 * @param callback
 * @returns {controllerPush}
 */
controllerPush.prototype.sendAndroidNotification = function (pushInfo, notification, callback) {
    log.info('send android notification pushInfo='+JSON.stringify(pushInfo)+
                ' notification='+JSON.stringify(notification));

    var data = {
        title: notification.title,
        body: notification.text,
        //"image": "www/img/weatherIcon/Sun.png", //it working but small icon has some problems
        cityIndex: pushInfo.cityIndex,
        "notId": pushInfo.cityIndex,
        'content-available': '1'
    };

    var message = new gcm.Message({
        priority     : 'high',
        timeToLive   : 86400,
        sound        : 'default',
        data         : data
    });

    /**
     * Params: message-literal, registrationIds-array, No. of retries, callback-function
     **/
    sender.send(message, [pushInfo.registrationId], 5, function (err, result) {
        if (err) {
            return callback(err);
        }
        return callback(undefined, result);
    });

    return this;
};

/**
 * @param pushInfo
 * @param notification title, text
 * @param callback
 */
controllerPush.prototype.sendIOSNotification = function (pushInfo, notification, callback) {
    log.info('send ios notification pushInfo='+JSON.stringify(pushInfo)+ ' notification='+JSON.stringify(notification));
    var myDevice = new apn.Device(pushInfo.registrationId);

    var note = new apn.Notification();
    //note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
    //note.badge = 1;
    note.sound = "ping.aiff";
    note.alert = notification.title+'\n'+notification.text;
    //note.contentAvailable = true;
    note.payload = {cityIndex: pushInfo.cityIndex};
    apnConnection.pushNotification(note, myDevice);
    callback(undefined, 'sent');
    return this;
};

/**
 * convert rest api to function call
 * @param town
 * @param callback
 */
controllerPush.prototype.requestDailySummary = function (town, callback) {
    var req = require('request');
    var url = "http://"+config.ipAddress+":"+config.port+"/v000705/daily/town";
    if (town.first) {
        url += '/'+ encodeURIComponent(town.first);
    }
    if (town.second) {
        url += '/' + encodeURIComponent(town.second);
    }
    if (town.third) {
        url += '/' + encodeURIComponent(town.third);
    }

    log.info('request url='+url);
    req(url, {json:true}, function(err, response, body) {
        log.info('Finished '+ url +' '+new Date());
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            err = new Error("response.statusCode="+response.statusCode);
            return callback(err)
        }
        callback(undefined, body.dailySummary);
    });

    return this;
};

controllerPush.prototype.convertToNotification = function(dailySummary) {
    return {title: dailySummary.title, text: dailySummary.text, icon: dailySummary.icon}
};

controllerPush.prototype.sendNotification = function (pushInfo, callback) {
    var self = this;

    //make title, message
    log.info('send notification push info='+JSON.stringify(pushInfo));

    self.requestDailySummary(pushInfo.town, function (err, dailySummary) {
        if (err) {
            return callback(err);
        }
        //convert daily summary to notification
        log.info('get daily summary ='+JSON.stringify(dailySummary));

        var notification = self.convertToNotification(dailySummary);

        if (pushInfo.type == 'ios') {
            self.sendIOSNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else if (pushInfo.type == 'android') {
            self.sendAndroidNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else {
            err = new Error('Unknown type='+pushInfo.type);
            callback(err);
        }
    });
};

controllerPush.prototype.sendPush = function (time) {
    var self = this;

    log.info('send push tim='+time);
    async.waterfall([
        function (callback) {
            self.getPushByTime(time, function (err, pushList) {
                if (err) {
                    return callback(err);
                }
                log.info('get push by time : push list='+JSON.stringify(pushList));
                callback(undefined, pushList);
            });
        }, function(pushList, callback) {
            async.map(pushList, function (pushInfo, mCallback) {
                self.sendNotification(pushInfo, function (err, result) {
                    if (err) {
                        return mCallback(err);
                    }
                    mCallback(undefined, result);
                });
            }, function (err, results) {
                if (err) {
                    return callback(err);
                }
                if (pushList.length != results.length) {
                    //some push are failed
                    return callback(new Error('Fail push='+pushList.length+' sccuess='+results.length));
                }
                callback(undefined, 'success push count='+pushList.length);
            });
        }
    ], function(err, result) {
        if (err) {
            return log.warn(err);
        }
        log.info(result);
    });
};

controllerPush.prototype.start = function () {
    var self = this;

    setInterval(function () {
        var date = new Date();
        var timeUTC = date.getUTCHours() * 60 * 60 + date.getUTCMinutes() * 60;
        self.sendPush.call(self, timeUTC);
    }, self.timeInterval);
};

controllerPush.prototype.apnFeedback = function () {
    //var options = {
    //    "batchFeedback": true,
    //    "interval": 300 //seconds
    //};

    var feedback = new apn.Feedback(apnOptions);
    feedback.on("feedback", function(devices) {
        devices.forEach(function(item) {
            log.info(item);
            // Do something with item.device and item.time;
        });
    });
};

module.exports = controllerPush;
