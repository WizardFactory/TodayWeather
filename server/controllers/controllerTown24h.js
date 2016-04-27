/**
 * Created by aleckim on 2016. 2. 19..
 * controllerTown에서 short의 time table을 0~21 에서 3~24시로 변경한 클래스임.
 */

var ControllerTown = require('../controllers/controllerTown');
var kmaTimeLib = require('../lib/kmaTimeLib');

/**
 *
 * @constructor
 */
function ControllerTown24h() {
    var self = this;

    ControllerTown.call(this);

    /**
     * adjust tmn, tmx and reorganize position of tmn and tmx
     * @param req
     * @param res
     * @param next
     */
    this.adjustShort = function(req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        var meta = {};
        meta.method = 'adjustShort';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>', meta);

        if (!req.hasOwnProperty('short')) {
            log.error("Short forecast data hasn't attached on req");
            next();
            return this;
        }

        var daySummaryList = [];
        req.short.forEach(function (short, index) {

            //client 하위 버전 지원 못함.
            if (short.time === "0000") {
                var D = kmaTimeLib.convertStringToDate(short.date);
                D.setDate(D.getDate()-1);
                //date = back one day
                //date = (parseInt(short.date)-1).toString();
                short.time = "2400";
                short.date = kmaTimeLib.convertDateToYYYYMMDD(D);
            }

            var daySummary = self._createOrGetDaySummaryList(daySummaryList, short.date);
            daySummary.taMax = daySummary.taMax === undefined ? -50:daySummary.taMax;
            daySummary.taMin = daySummary.taMin === undefined ? -50:daySummary.taMin;

            if (daySummary.taMax < short.t3h) {
                daySummary.taMax = short.t3h;
            }
            if (daySummary.taMax < short.tmx) {
                daySummary.taMax = short.tmx;
                log.verbose(index+" tmx clear");
                //clear tmx
            }
            short.tmx = -50;

            if (daySummary.taMin === -50 && short.t3h !== -50) {
                daySummary.taMin = short.t3h;
            }
            else if (daySummary.taMin > short.t3h && short.t3h !== -50) {
                daySummary.taMin = short.t3h;
            }

            if (daySummary.taMin === -50 && short.tmn !== -50) {
                daySummary.taMin = short.tmn;
            }
            else if (daySummary.taMin > short.tmn && short.tmn !== -50) {
                daySummary.taMin = short.tmn;
                short.tmn = -50;
                log.verbose(index+" tmn clear");
            }
            short.tmn = -50;
        });

        //client 하위 버전 지원 못함.
        req.short.forEach(function (short, index) {

            var daySum = self._createOrGetDaySummaryList(daySummaryList, short.date);
            daySum.taMax = daySum.taMax === undefined ? -50:daySum.taMax;
            daySum.taMin = daySum.taMin === undefined ? -50:daySum.taMin;
            if (daySum.taMax === -50 || daySum.taMin === -50) {
                log.warn("short date:"+short.date+" fail to get daySummary");
                return;
            }
            var tmxDiff = Math.abs(daySum.taMax - short.t3h);
            var tmnDiff = Math.abs(daySum.taMin - short.t3h);

            if (!daySum.hasOwnProperty("tmxDiff")) {
                daySum.tmxDiff = tmxDiff;
                short.tmx = daySum.taMax;
                daySum.tmxIndex = index;
            }
            else {
                if (daySum.tmxDiff === tmxDiff) {
                    if(short.time === "1500")  {
                        req.short[daySum.tmxIndex].tmx = -50;

                        daySum.tmxDiff = tmxDiff;
                        short.tmx = daySum.taMax;
                        daySum.tmxIndex = index;
                        log.verbose("put index:"+index+" tmx:"+short.tmx);
                    }
                    else if (req.short[daySum.tmxIndex].time === "1500") {
                        //skip
                    }
                    else {
                        //날짜와 무관하게 비교값들의 앞과 뒤 값 중에 큰쪽을 최대온도로 표기
                        var prvTmx;
                        var nextTmx;
                        if (daySum.tmnIndex > 0 && req.short[daySum.tmnIndex-1].t3h > req.short[daySum.tmnIndex].t3h) {
                           prvTmx = req.short[daySum.tmnIndex-1].t3h;
                        }
                        else {
                            prvTmx = req.short[daySum.tmnIndex].t3h;
                        }
                        if (index < req.short.length-1 && req.short[index+1].t3h > short.t3h)  {
                            nextTmx = req.short[index+1].t3h;
                        }
                        else {
                            nextTmx = short.t3h;
                        }
                        if (prvTmx > nextTmx) {
                           //skip
                        }
                        else {
                             //nearest from 1500
                            //late time
                            req.short[daySum.tmxIndex].tmx = -50;

                            daySum.tmxDiff = tmxDiff;
                            short.tmx = daySum.taMax;
                            daySum.tmxIndex = index;
                            log.verbose("put index:"+index+" tmx:"+short.tmx);
                        }
                    }
                }
                else if (daySum.tmxDiff > tmxDiff) {
                    req.short[daySum.tmxIndex].tmx = -50;

                    daySum.tmxDiff = tmxDiff;
                    short.tmx = daySum.taMax;
                    daySum.tmxIndex = index;
                    log.verbose("put index:"+index+" tmx:"+short.tmx);
                }
            }

            if (!daySum.hasOwnProperty("tmnDiff")) {
                daySum.tmnDiff = tmnDiff;
                short.tmn = daySum.taMin;
                daySum.tmnIndex = index;
            }
            else {
                if (daySum.tmnDiff === tmnDiff) {
                    if(short.time === "0600")  {
                        req.short[daySum.tmnIndex].tmn = -50;

                        daySum.tmnDiff = tmnDiff;
                        short.tmn = daySum.taMin;
                        daySum.tmnIndex = index;
                        log.verbose("put index:"+index+" tmn:"+short.tmn);
                    }
                    else if (req.short[daySum.tmnIndex].time === "0600") {
                        //skip
                    }
                    else {
                        //날짜와 무관하게 비교값들의 앞과 뒤 값 중에 작은 쪽을 최저온도로 표기
                        var prvTmn;
                        var nextTmn;
                        if (daySum.tmnIndex > 0 && req.short[daySum.tmnIndex-1].t3h < req.short[daySum.tmnIndex].t3h) {
                           prvTmn = req.short[daySum.tmnIndex-1].t3h;
                        }
                        else {
                            prvTmn = req.short[daySum.tmnIndex].t3h;
                        }
                        if (index < req.short.length-1 && req.short[index+1].t3h < short.t3h)  {
                            nextTmn = req.short[index+1].t3h;
                        }
                        else {
                            nextTmn = short.t3h;
                        }
                        if (prvTmn > nextTmn) {
                            req.short[daySum.tmnIndex].tmn = -50;

                            daySum.tmnDiff = tmnDiff;
                            short.tmn = daySum.taMin;
                            daySum.tmnIndex = index;
                            log.verbose("put index:"+index+" tmn:"+short.tmn);
                        }
                        else {
                            //nearest from 0600
                            //early time
                        }
                    }
                }
                else if (daySum.tmnDiff > tmnDiff) {
                    req.short[daySum.tmnIndex].tmn = -50;

                    daySum.tmnDiff = tmnDiff;
                    short.tmn = daySum.taMin;
                    daySum.tmnIndex = index;
                    log.verbose("put index:"+index+" tmn:"+short.tmn);
                }
            }
        });

        var i = req.short.length - 1;
        for(;i>=0;i--) {
            if(req.short[i].reh !== -1) {
                break;
            }
        }

        req.short.splice(i+1, (req.short.length-(i+1)));

        next();
        return this;
    };

    this.sendDailySummaryResult = function (req, res) {
        var meta = {};

        var result = {};
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = '/:region/:city/:town';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('##', decodeURI(req.originalUrl));

        result.regionName = regionName;
        result.cityName = cityName;
        result.townName = townName;

        var time = parseInt(req.current.time.substr(0, 2));
        req.current.skyIcon = self._parseSkyState(req.current.sky, req.current.pty, req.current.lgt, time < 7 || time > 18);

        var dustFcst;
        for (var i=6; i<9; i++) {
            dustFcst = req.midData.dailyData[i].dustForecast;
            if (dustFcst) {
                if (dustFcst.PM10Grade && dustFcst.PM25Grade) {
                    req.midData.dailyData[i].pmStr = dustFcst.PM10Grade>=dustFcst.PM25Grade?dustFcst.PM10Str:dustFcst.PM25Str;
                }
                else if (dustFcst.PM10Grade) {
                    req.midData.dailyData[i].pmStr = dustFcst.PM10Str;
                }
                else if (dustFcst.PM25Grade) {
                    req.midData.dailyData[i].pmStr = dustFcst.PM25Str;
                }
            }
        }

        result.current = req.current;
        result.yesterday = req.midData.dailyData[6];
        result.today =  req.midData.dailyData[7];
        result.tomorrow =  req.midData.dailyData[8];

        res.json(result);

        return this;
    };

    this.sendResult = function (req, res) {
        var meta = {};

        var result = {};
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = '/:region/:city/:town';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        log.info('##', decodeURI(req.originalUrl));

        result.regionName = regionName;
        result.cityName = cityName;
        result.townName = townName;

        if(req.shortPubDate) {
            result.shortPubDate = req.shortPubDate;
        }
        if(req.shortRssPubDate) {
            result.shortRssPubDate = req.shortRssPubDate;
        }
        if(req.short){
            result.short = req.short;
        }
        if (req.shortestPubDate) {
            result.shortestPubDate = req.shortestPubDate;
        }
        if(req.shortest){
            result.shortest = req.shortest;
        }
        if(req.currentPubDate) {
            result.currentPubDate = req.currentPubDate;
        }
        if(req.current){
            result.current = req.current;
        }
        if(req.midData){
            result.midData = req.midData;
        }

        res.json(result);

        return this;
    };
}

// subclass extends superclass
ControllerTown24h.prototype = Object.create(ControllerTown.prototype);
ControllerTown24h.prototype.constructor = ControllerTown24h;

ControllerTown24h.prototype._parseSkyState = function (sky, pty, lgt, isNight) {
    var skyIconName = "";

    if (isNight) {
        skyIconName = "Moon";
    }
    else {
        skyIconName = "Sun";
    }

    switch (sky) {
        case 1:
            skyIconName;
            break;
        case 2:
            skyIconName += "SmallCloud";
            break;
        case 3:
            skyIconName += "BigCloud"; //Todo need new icon
            break;
        case 4:
            skyIconName = "Cloud";
            break;
        default:
            console.log('Fail to parse sky='+sky);
            break;
    }

    switch (pty) {
        case 0:
            //nothing
            break;
        case 1:
            skyIconName += "Rain";
            break;
        case 2:
            skyIconName += "RainSnow"; //Todo need RainWithSnow icon";
            break;
        case 3:
            skyIconName += "Snow";
            break;
        default:
            console.log('Fail to parse pty='+pty);
            break;
    }

    if (lgt === 1) {
        skyIconName += "Lightning";
    }

    return skyIconName;
};

module.exports = ControllerTown24h;
