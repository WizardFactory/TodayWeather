/** Scheduled national/regional short-term prose; never warning/zone/push state. */
'use strict';
var regions = require('./kmaForecastRegions');
var DAY_MS = 24*3600*1000, KST_MS = 9*3600*1000;
function announcementOf(value) {
    var s = String(value);
    if (!/^\d{12}$/.test(s)) { return null; }
    var wall = new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8), +s.slice(8,10), +s.slice(10,12)));
    if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0,16).replace(/\D/g,'') !== s) { return null; }
    return new Date(wall.getTime()-KST_MS);
}
function fresh(announcement, now) {
    var age = now-new Date(announcement).getTime();
    return Number.isFinite(age) && age >= 0 && age < DAY_MS;
}
function Narrative(options) {
    options = options || {};
    this.requester = options.requester || null; // service reads do not construct a provider client
    this.model = options.model || require('../models/modelKmaForecastNarrative');
    this.stationIds = options.stationIds || regions.offices.map(function (o) { return o.stationId; });
    this.now = options.now || Date.now;
    this.readTimeoutMs = options.readTimeoutMs || 2000;
    this.writeTimeoutMs = options.writeTimeoutMs || 2000;
    this.inFlight = false;
}
Narrative.prototype._gatherStation = function (stationId, callback) {
    var self = this;
    if (!regions.byStation(stationId)) { return callback(new Error('kma narrative invalid station')); }
    if (!self.requester) {
        var Requester = require('./kmaWarningRequester');
        self.requester = new Requester({baseUrl:'https://apis.data.go.kr/1360000/VilageFcstMsgService/', strict:true});
    }
    self.requester.get('getWthrSituation', {stnId:stationId, pageNo:1, numOfRows:10}, function (err, result) {
        if (err) { return callback(new Error('kma narrative acquisition failed')); }
        if (result && result.noData) { return callback(null, false); }
        if (!result || !Array.isArray(result.items) || !result.items.length || result.items.length > 10) {
            return callback(new Error('kma narrative invalid items'));
        }
        var docs = [];
        for (var i=0; i<result.items.length; i++) {
            var row = result.items[i], announcement = row && announcementOf(row.tmFc);
            if (!row || (row.stnId !== stationId && row.stnId !== String(stationId)) || !announcement ||
                typeof row.wfSv1 !== 'string' || !row.wfSv1.trim()) {
                return callback(new Error('kma narrative invalid publication'));
            }
            if (fresh(announcement, self.now())) {
                docs.push({_id:stationId+':'+row.tmFc, stationId:stationId, announcement:announcement,
                    text:row.wfSv1.replace(/\r\n?/g,'\n')});
            }
        }
        docs.sort(function (a,b) { return b.announcement-a.announcement; });
        if (!docs.length) { return callback(null, false); }
        var doc = docs[0];
        var settled = false;
        var deadline = setTimeout(function () { written(new Error('deadline')); }, self.writeTimeoutMs);
        function written(err, result) {
            if (settled) { return; }
            settled = true; clearTimeout(deadline);
            if (err && err.code === 11000) { return callback(null, false); }
            if (err) { return callback(new Error('kma narrative persistence failed')); }
            callback(null, !!(result && result.upserted && result.upserted.length));
        }
        try {
            self.model.update({_id:doc._id}, {$setOnInsert:doc}, {upsert:true,maxTimeMS:self.writeTimeoutMs}, written);
        } catch (err) { written(err); }
    });
};
Narrative.prototype.gather = function (callback) {
    var self = this, index = 0, stored = false, failed = false;
    if (self.inFlight) { return callback(null, false); }
    self.inFlight = true;
    function next() {
        if (index >= self.stationIds.length) {
            self.inFlight = false;
            return callback(failed ? new Error('kma narrative collection failed') : null, stored);
        }
        self._gatherStation(self.stationIds[index++], function (err, added) {
            failed = failed || !!err; stored = stored || !!added;
            next();
        });
    }
    next();
};
/** Optional DB-only read. Deadline/errors/late completions cannot fail or mutate weather. */
Narrative.prototype.read = function (stationId, callback) {
    var self = this, office = regions.byStation(stationId), settled = false;
    if (!office) { return callback(null, null); }
    var deadline = setTimeout(function () { finish(null); }, self.readTimeoutMs);
    function finish(value) {
        if (settled) { return; }
        settled = true; clearTimeout(deadline); callback(null, value);
    }
    try {
        var query = self.model.find({stationId:office.stationId}, {_id:0,__v:0}).sort({announcement:-1}).limit(1).lean();
        if (typeof query.maxTimeMS === 'function') { query.maxTimeMS(self.readTimeoutMs); }
        query.exec(function (err, rows) {
            if (settled) { return; }
            if (err) { log.warn('kma narrative optional read failed'); return finish(null); }
            var row = Array.isArray(rows) && rows[0];
            if (!row || Number(row.stationId) !== office.stationId || !fresh(row.announcement,self.now()) ||
                typeof row.text !== 'string' || !row.text.trim()) { return finish(null); }
            var at = new Date(row.announcement).getTime();
            finish({stationId:office.stationId, region:office.region, announcement:new Date(at).toISOString(),
                expiresAt:new Date(at+DAY_MS).toISOString(), text:row.text.replace(/\r\n?/g,'\n'),
                language:'ko', source:'KMA', textFormat:'plain'});
        });
    } catch (err) { log.warn('kma narrative optional read failed'); finish(null); }
};
Narrative.announcementOf = announcementOf;
Narrative.fresh = fresh;
module.exports = Narrative;
