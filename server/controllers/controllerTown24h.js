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
        log.info('>sID=',req.sessionID, meta);

        if (!req.hasOwnProperty('short')) {
            log.error("Short forecast data hasn't attached on req");
            next();
            return this;
        }

        var daySummaryList = [];
        req.short.forEach(function (short, index) {

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

        //r06, s06을 3시간단위로 나눔.
        //앞시간 뒤시간 모두 pty가 1이상이면 반반으로 나누고, 아니라면 몰아줌.
        //todo: merge 순서 변경 필요. 1) short  2) short rss 3) r06, s06분리 4) past
        if (req.short[0].s06 < 0) {
            req.short[0].s06 = 0;
        }
        if (req.short[0].r06 < 0) {
            req.short[0].r06 = 0;
        }
        var i;
        for (i=2; i<req.short.length; i+=2) {
            var short = req.short[i];
            if (short.r06 > 0) {
                if (req.short[i-1].pty > 0 && req.short[i].pty > 0) {
                    req.short[i-1].r06 = +(short.r06/2).toFixed(1);
                    req.short[i].r06 = +(short.r06/2).toFixed(1);
                }
                else if (req.short[i-1].pty > 0 ) {
                    req.short[i-1].r06 = short.r06;
                    req.short[i].r06 = 0;
                }
                else if (req.short[i].pty > 0 ) {
                    req.short[i-1].r06 = 0;
                    req.short[i].r06 = short.r06;
                }
                else {
                    if (req.short[i-1].rn1 != undefined || req.short[i].rn1 != undefined) {
                        //과거의 경우 예보상으로 온다고 했지만, 오지 않은 경우에 발생할 수 있음.
                    }
                    else {
                        log.error("It has r06 but pty is zero short index="+i);
                    }
                    req.short[i-1].r06 = 0;
                    req.short[i].r06 = 0;
                }
            }
            else {
                req.short[i-1].r06 = 0;
                req.short[i].r06 = 0;
            }

            if (short.s06 > 0) {
                if (req.short[i-1].pty > 0 && req.short[i].pty > 0) {
                    req.short[i-1].s06 = +(short.s06/2).toFixed(1);
                    req.short[i].s06 = +(short.s06/2).toFixed(1);
                }
                else if (req.short[i-1].pty > 0 ) {
                    req.short[i-1].s06 = short.s06;
                    req.short[i].s06 = 0;
                }
                else if (req.short[i].pty > 0 ) {
                    req.short[i-1].s06 = 0;
                    req.short[i].s06 = short.s06;
                }
                else {
                    if (req.short[i-1].rn1 != undefined || req.short[i].rn1 != undefined) {
                        //과거의 경우 예보상으로 온다고 했지만, 오지 않은 경우에 발생할 수 있음.
                    }
                    else {
                        log.error("It has s06 but pty is zero short index=" + i);
                    }
                    req.short[i-1].s06 = 0;
                    req.short[i].s06 = 0;
                }
            }
            else {
                req.short[i-1].s06 = 0;
                req.short[i].s06 = 0;
            }
        }

        req.short.forEach(function (short) {
            if (short.hasOwnProperty('shortestRn1')) {
                if (short.hasOwnProperty('pty')) {
                    if (short.pty === 3) {
                        short.s06 = short.shortestRn1;
                    }
                    else if (short.pty === 2 || short.pty === 1)  {
                        short.r06 = short.shortestRn1;
                    }
                }
            }
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

        i = req.short.length - 1;
        for(;i>=0;i--) {
            if(req.short[i].t3h !== -50) {
                break;
            }
        }

        req.short.splice(i+1, (req.short.length-(i+1)));

        next();
        return this;
    };

    this._makeDailyPmStr = function (dustFcst) {
        var pmStr;
        var pmGrade;
        if (dustFcst == undefined) {
            return;
        }

        if (dustFcst.PM10Grade && dustFcst.PM25Grade) {
            pmStr = dustFcst.PM10Grade>=dustFcst.PM25Grade?dustFcst.PM10Str:dustFcst.PM25Str;
            pmGrade = dustFcst.PM10Grade>=dustFcst.PM25Grade?dustFcst.PM10Grade:dustFcst.PM25Grade;
        }
        else if (dustFcst.PM10Grade) {
            pmStr = dustFcst.PM10Str;
            pmGrade = dustFcst.PM10Grade;
        }
        else if (dustFcst.PM25Grade) {
            pmStr = dustFcst.PM25Str;
            pmGrade = dustFcst.PM25Grade;
        }
        return {"pmGrade": pmGrade, "pmStr": pmStr};
    };

    this.makeDailySummary = function (req, res, next) {
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        var meta = {};
        meta.method = "makeDailySummary";
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;
        log.info('>sID=',req.sessionID, meta);

        var todayDate = req.current.date;
        var yD = kmaTimeLib.convertStringToDate(todayDate);
        yD.setDate(yD.getDate()-1);
        var yesterdayDate = kmaTimeLib.convertDateToYYYYMMDD(yD);
        var tD = kmaTimeLib.convertStringToDate(todayDate);
        tD.setDate(tD.getDate()+1);
        var tomorrowDate = kmaTimeLib.convertDateToYYYYMMDD(tD);

        var time = parseInt(req.current.time.substr(0, 2));
        req.current.skyIcon = self._parseSkyState(req.current.sky, req.current.pty, req.current.lgt, time < 7 || time > 18);
        var current = req.current;

        var today;
        var yesterday;
        var tomorrow;

        var dailyDataLen = req.midData.dailyData.length;
        var pmObject;
        for (var i=0; i<dailyDataLen; i++) {
            var dailyData =  req.midData.dailyData[i];
            if (dailyData.date === yesterdayDate) {
                yesterday = req.midData.dailyData[i];
            }
            else if (dailyData.date === todayDate) {
                today = req.midData.dailyData[i];
                today.skyIcon = self._parseSkyState(today.sky, today.pty, 0, false);
                today.skyIconAm = self._parseSkyState(today.skyAm, today.ptyAm, 0, false);
                today.skyIconPm = self._parseSkyState(today.skyPm, today.ptyPm, 0, false);
                pmObject = self._makeDailyPmStr(today.dustForecast);
                if (pmObject) {
                    today.pmStr = pmObject.pmStr;
                    today.pmGrade = pmObject.pmGrade;
                }
            }
            else if (dailyData.date === tomorrowDate) {
                tomorrow = req.midData.dailyData[i];
                tomorrow.skyIcon = self._parseSkyState(tomorrow.sky, tomorrow.pty, 0, false);
                tomorrow.skyIconAm = self._parseSkyState(tomorrow.skyAm, tomorrow.ptyAm, 0, false);
                tomorrow.skyIconPm = self._parseSkyState(tomorrow.skyPm, tomorrow.ptyPm, 0, false);
                pmObject = self._makeDailyPmStr(tomorrow.dustForecast);
                if (pmObject) {
                    tomorrow.pmStr = pmObject.pmStr;
                    tomorrow.pmGrade = pmObject.pmGrade;
                }
            }
        }

        //update pop
        if (req.short) {
            today.pop = 0;
            var len = req.short.length;
            for (i=0; i<len; i++) {
                var w3h = req.short[i];
                if (w3h.date === today.date && w3h.time > req.current.time) {
                   if (w3h.pop > today.pop) {
                       today.pop = w3h.pop;
                   }
                }
            }
        }

        var dailyArray = [];
        var dailySummary = "";

        var location = "";
        if (townName && townName != "") {
            location += townName+" ";
        }
        else if (cityName && cityName != "") {
            location += cityName+" ";
        }
        else if (regionName && regionName != "") {
            location += regionName+" ";
        }

        var theDay;
        if (time < 18) {
            theDay = today;
            dailySummary += "오늘: ";
        }
        else {
            theDay = tomorrow;
            dailySummary += "내일: ";
        }

        if (theDay.skyIconAm && theDay.skyIconPm) {
            dailyArray.push(self._getWeatherEmoji(theDay.skyIconAm)+self._getEmoji("RightwardsArrow")+self._getWeatherEmoji(theDay.skyIconPm));
        }
        else if (theDay.skyIcon) {
            dailyArray.push(self._getWeatherEmoji(theDay.skyIcon));
        }

        if (theDay.taMin != undefined && theDay.taMax != undefined) {
            dailyArray.push(theDay.taMin+"˚/"+theDay.taMax+"˚");
        }
        if (theDay.pty && theDay.pty > 0) {
            if (theDay.pop && current.pty <= 0) {
                dailyArray.push("강수확률"+" "+theDay.pop+"%");
            }
        }
        if (theDay.pmGrade && theDay.pmGrade > 1) {
            if (theDay.pmStr) {
                dailyArray.push("미세먼지" + " " + theDay.pmStr);
            }
        }
        if (theDay.ultrvGrade && theDay.ultrvGrade >= 2) {
            dailyArray.push("자외선"+" "+theDay.ultrvStr);
        }
        if (theDay.dustForecast && theDay.dustForecast.O3Grade && theDay.dustForecast.O3Grade >= 2) {
            dailyArray.push("오존"+" "+theDay.dustForecast.O3Str);
        }

        //불쾌지수

        dailySummary += dailyArray.toString();

        var hourlyArray = [];
        var hourlySummary = "";
        hourlySummary += time+"시: ";

        if (current.skyIcon) {
            var weather = self._getWeatherEmoji(current.skyIcon);
            //if (current.weather) {
            //    weather += " "+current.weather;
            //}
            hourlyArray.push(weather);
        }
        if (current.t1h) {
            var str = current.t1h+"˚";

            //if (current.yesterday && current.yesterday.t1h !== undefined) {
            //    str += " ";
            //    var diffTemp = Math.round(current.t1h - current.yesterday.t1h);
            //
            //    str += "어제";
            //    if (diffTemp == 0) {
            //        str += "와 동일";
            //    }
            //    else {
            //        str += "보다 " + Math.abs(diffTemp);
            //        if (diffTemp < 0) {
            //            str += "˚낮음";
            //        }
            //        else if (diffTemp > 0) {
            //            str += "˚높음";
            //        }
            //    }
            //}
            hourlyArray.push(str);
        }

        if (current.arpltn && current.arpltn.khaiGrade) {
            hourlyArray.push("대기"+" "+ current.arpltn.khaiStr);
        }
        if (current.pty && current.pty > 0 && current.rn1 != undefined) {
            hourlyArray.push(current.ptyStr+" "+ current.rn1Str);
        }
        hourlySummary += hourlyArray.toString();
        //불쾌지수

        var date = current.stnDateTime?current.stnDateTime:req.currentPubDate;

        req.dailySummary = {title: location+hourlySummary, text: dailySummary, date: date, icon: current.skyIcon,
                            current: current, yesterday: yesterday, today: today, tomorrow: tomorrow};

        return next();
    };

    this.insertSkyIcon = function (req, res, next) {
        if(req.short){
            req.short.forEach(function (data) {
                var time = parseInt(data.time.substr(0, 2));
                data.skyIcon = self._parseSkyState(data.sky, data.pty, data.lgt, time < 7 || time > 18);
            });
        }
        if(req.shortest){
            req.shortest.forEach(function (data) {
                var time = parseInt(data.time.substr(0, 2));
                data.skyIcon = self._parseSkyState(data.sky, data.pty, data.lgt, time < 7 || time > 18);
            });
        }
        if(req.current){
            var data = req.current;
            var time = parseInt(data.time.substr(0, 2));
            data.skyIcon = self._parseSkyState(data.sky, data.pty, data.lgt, time < 7 || time > 18);
        }
        if(req.midData){
            req.midData.dailyData.forEach(function (data) {
                if (data.sky) {
                    data.skyIcon = self._parseSkyState(data.sky, data.pty, data.lgt, false);
                }
                if (data.skyAm) {
                    data.skyAmIcon = self._parseSkyState(data.skyAm, data.ptyAm, data.lgtAm, false);
                }
                if (data.skyPm) {
                    data.skyPmIcon = self._parseSkyState(data.skyPm, data.ptyPm, data.lgtPm, false);
                }
            });
        }

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
        log.info('## - ' + decodeURI(req.originalUrl) + ' sID=' + req.sessionID);

        result.regionName = regionName;
        result.cityName = cityName;
        result.townName = townName;
        result.dailySummary = req.dailySummary;
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
        log.info('## - ' + decodeURI(req.originalUrl) + ' sID=' + req.sessionID);

        result.regionName = regionName;
        result.cityName = cityName;
        result.townName = townName;

        if(req.shortPubDate) {
            result.shortPubDate = req.shortPubDate;
        }
        if(req.shortRssPubDate) {
            result.shortRssPubDate = req.shortRssPubDate;
        }
        if(req.short) {
            result.short = req.short;
        }
        if (req.shortestPubDate) {
            result.shortestPubDate = req.shortestPubDate;
        }
        if(req.shortest) {
            result.shortest = req.shortest;
        }
        if(req.currentPubDate) {
            result.currentPubDate = req.currentPubDate;
        }
        if(req.current) {
            result.current = req.current;
        }
        if(req.midData) {
            result.midData = req.midData;
        }
        if (req.dailySummary) {
            result.dailySummary = req.dailySummary;
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

ControllerTown24h.prototype._getEmoji = function (name) {
    switch (name) {
        case 'UpwardsArrow':
            return '\u2191';
        case 'RightwardsArrow':
            return '\u2192';
        case 'DownwardsArrow':
            return '\u2193';
        case 'UpwardsArrowToBar':
            return '\u2912';
        case 'DownwardsArrowToBar':
            return '\u2913';
        default:
            log.error('Fail to find emoji name='+name);
    }
    return '';
};

ControllerTown24h.prototype._getWeatherEmoji = function (skyIcon) {
    if (skyIcon.indexOf('Lightning') != -1) {
        return '\u26c8';
    }
    else if (skyIcon.indexOf('RainSnow') != -1) {
        return '\u2614\u2603';
    }
    else if (skyIcon.indexOf('Rain') != -1) {
        return '\u2614';
    }
    else if (skyIcon.indexOf('Snow') != -1) {
        return '\u2603';
    }
    else if (skyIcon.indexOf('Cloud') != -1) {
        if (skyIcon.indexOf('Sun') != -1 || skyIcon.indexOf('Moon') != -1) {
            return '\u26c5';
        }
        else {
            return '\u2601';
        }
    }
    else if (skyIcon.indexOf('Sun') != -1 || skyIcon.indexOf('Moon') != -1) {
        return '\ud83c\udf1e';
    }

    log.error('Fail to find emoji skyIcon='+skyIcon);
    return '';
};

module.exports = ControllerTown24h;
