'use strict';

var firebase = require('firebase-admin');
var firebaseApps = {};

// Router construction must not read credentials or open provider connections.
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
