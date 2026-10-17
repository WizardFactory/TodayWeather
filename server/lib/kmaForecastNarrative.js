/** Nationwide short-term narrative (#2798). Separate from warning/zone/push state. */
'use strict';
var DAY_MS = 24 * 3600 * 1000;
var KST_MS = 9 * 3600 * 1000;
var TYPE = 5;

// The existing KmaSpecial announcement stores the KST wall clock as if it were UTC.
function announcementOf(value) {
    var s = String(value);
    if (!/^\d{12}$/.test(s)) { return null; }
    var date = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6)-1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)));
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,16).replace(/\D/g, '') !== s) { return null; }
    return date;
}
function fresh(announcement, now) {
    var instant = new Date(announcement).getTime() - KST_MS;
    var age = now - instant;
    return Number.isFinite(instant) && age >= 0 && age < DAY_MS;
}
function escapeText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function Narrative(options) {
    options = options || {};
    var Requester = require('./kmaWarningRequester');
    this.requester = options.requester || new Requester({baseUrl: 'https://apis.data.go.kr/1360000/VilageFcstMsgService/', strict: true});
    this.model = options.model || require('../models/modelKmaSpecialWeatherSituation');
    this.now = options.now || Date.now;
    this.inFlight = false;
}
Narrative.prototype.gather = function (callback) {
    var self = this;
    if (self.inFlight) { return callback(null, false); }
    self.inFlight = true;
    function done(err, stored) { self.inFlight = false; callback(err, stored); }
    self.requester.get('getWthrSituation', {stnId:108, pageNo:1, numOfRows:10}, function (err, result) {
        if (err) { return done(err); }
        if (result.noData) { return done(null, false); }
        if (!Array.isArray(result.items) || !result.items.length || result.items.length > 10) {
            return done(new Error('kma narrative invalid items'));
        }
        var docs = [];
        for (var i=0; i<result.items.length; i++) {
            var row = result.items[i];
            var announcement = row && announcementOf(row.tmFc);
            if (!row || (row.stnId !== 108 && row.stnId !== '108') || !announcement ||
                typeof row.wfSv1 !== 'string' || !row.wfSv1.trim()) {
                return done(new Error('kma narrative invalid publication'));
            }
            if (fresh(announcement, self.now())) {
                docs.push({
                    // Deterministic 24-hex ObjectId: type + publication + station. Built-in _id uniqueness
                    // makes concurrent/recreated workers idempotent without changing indexes on types 1–4.
                    _id: '000005' + String(row.tmFc) + '000108',
                    type: TYPE, announcement: announcement, comment: row.wfSv1.replace(/\r\n?/g, '\n')
                });
            }
        }
        docs.sort(function (a,b) { return b.announcement - a.announcement; });
        if (!docs.length) { return done(null, false); }
        var doc = docs[0];
        // Immutable publication: repeated acquisition never re-dates or rewrites a stored announcement.
        self.model.update({_id:doc._id}, {$setOnInsert:doc}, {upsert:true}, function (err, res) {
            // A simultaneous upsert can lose the insert race; the same deterministic identity already exists.
            if (err && err.code === 11000) { return done(null, false); }
            if (err) { return done(new Error('kma narrative persistence failed')); }
            done(null, !!(res && res.upserted && res.upserted.length));
        });
    });
};
Narrative.TYPE = TYPE;
Narrative.fresh = fresh;
Narrative.announcementOf = announcementOf;
Narrative.escapeText = escapeText;
module.exports = Narrative;
