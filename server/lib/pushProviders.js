'use strict';

var path = require('path');
var apn = require('apn');
var firebase = require('firebase-admin');
var config = require('../config/config');
var apnProvider;
var firebaseApps = {};

function serverPath(value) {
    return path.resolve(__dirname, '..', value);
}

// Router construction must not read credentials or open provider connections.
exports.apn = function () {
    if (apnProvider) { return apnProvider; }
    var push = config.push;
    var options = {production: process.env.NODE_ENV === 'production'};
    var hasTokenSetting = push.apnKeyPath || push.apnKeyId || push.apnTeamId;
    if (hasTokenSetting) {
        if (!push.apnKeyPath || !push.apnKeyId || !push.apnTeamId || !push.apnTopic) {
            throw new Error('APNs token authentication requires APN_KEY_PATH, APN_KEY_ID, APN_TEAM_ID and APN_TOPIC');
        }
        options.token = {key: serverPath(push.apnKeyPath), keyId: push.apnKeyId, teamId: push.apnTeamId};
    } else {
        // Preserve the certificate pair used by the older deployed service.
        options.cert = serverPath(push.apnCertPath || 'config/aps_cert.pem');
        options.key = serverPath(push.apnCertKeyPath || 'config/aps_key.pem');
    }
    apnProvider = new apn.Provider(options);
    return apnProvider;
};

exports.firebase = function (product) {
    var name = product === 'todayAir' ? 'todayAir' : 'todayWeather';
    if (firebaseApps[name]) { return firebaseApps[name]; }
    var existing = firebase.apps.filter(function (app) { return app.name === name; })[0];
    if (existing) { firebaseApps[name] = existing; return existing; }
    var credentials = name === 'todayAir'
        ? require('../config/todayair-74958-firebase-adminsdk-2n8hn-68ad361049.json')
        : require('../config/admob-app-id-6159460161-firebase-adminsdk-r2shn-9e77fbe119.json');
    firebaseApps[name] = firebase.initializeApp({credential: firebase.credential.cert(credentials)}, name);
    return firebaseApps[name];
};
