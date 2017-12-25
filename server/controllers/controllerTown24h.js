/**
 * Created by aleckim on 2016. 2. 19..
 * controllerTown에서 short의 time table을 0~21 에서 3~24시로 변경한 클래스임.
 */

'use strict';

var ControllerTown = require('../controllers/controllerTown');
var kmaTimeLib = require('../lib/kmaTimeLib');
var UnitConverter = require('../lib/unitConverter');
var KecoController = require('../controllers/kecoController');

/**
 *
 * @constructor
 */
function ControllerTown24h() {
    var self = this;

    ControllerTown.call(this);

    this.checkQueryValidation = function(req, res, next) {
        /**
         *
         * temperatureUnit(C,F), windSpeedUnit(mph,km/h,m/s,bft,kr), pressureUnit(mmHg,inHg,hPa,mb),
         * distanceUnit(km,mi), precipitationUnit(mm,in), airUnit(airkorea,airkorea_who,airnow,aircn)
         */
        if(!req.hasOwnProperty('query')) {
            req.query = {};
        }

        UnitConverter.getUnitList().forEach(function (value) {
                if (!req.query.hasOwnProperty(value)) {
                    req.query[value] = UnitConverter.getDefaultValue(value);
                }
        });

        log.info({sId:req.sessionID, reqQuery: req.query});

        next();
        return this;
    };

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

        //t3h, tmx, tmn로부터 일별 taMax, taMin을 만들고 tmx, tmn을 초기화 한다.
        var daySummaryList = [];
        req.short.forEach(function (short, index) {

            //과거 short가 없는 경우 -1로 client로 넘어가는 것을 방지함. 이것은 short에 대한 merge가 완료된 후에 해야 함.
            if (short.pop == undefined || short.pop == -1) {
                short.pop = 0;
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
                        //17.01.12 05시 단기 예보에서, pty가 0이지만, R06,S06은 1이었음. 충청남도 아산시 온양4동 mx 60, my 110
                        //kma에서는 이경우 r06,s06을 표시하지 않고, 눈,비 안옴으로 표기
                        log.warn("It has r06 but pty is zero short date="+req.short[i].date+" time="+req.short[i].time);
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
                        //17.01.12 05시 단기 예보에서, pty가 0이지만, R06,S06은 1이었음. 충청남도 아산시 온양4동 mx 60, my 110
                        //kma에서는 이경우 r06,s06을 표시하지 않고, 눈,비 안옴으로 표기
                        log.warn("It has s06 but pty is zero short date="+req.short[i].date+" time="+req.short[i].time);
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

        //앞의 invalid한 날씨정보를 제거
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

    this.AirkoreaForecast = function (req, res, next){
        var meta = {};

        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = '/:region/:city/:town';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        if(global.airkoreaDustImageMgr){
            if(req.geocode){
                global.airkoreaDustImageMgr.getDustInfo(req.geocode.lat, req.geocode.lon, 'PM10', req.query.airUnit, function(err, pm10){
                    if(err){
                        log.info('Fail to get PM 10 info');
                        return next();
                    }
                    req.air_forecast = [];
                    var pm10Forecast = {
                        source: 'airkorea',
                        code: 'PM10',
                        pubDate: pm10.pubDate,
                        hourly: pm10.hourly
                    };

                    req.air_forecast.push(pm10Forecast);

                    airkoreaDustImageMgr.getDustInfo(req.geocode.lat, req.geocode.lon, 'PM25', req.query.airUnit, function(err, pm25){
                        if(err){
                            log.info('Fail to get PM 25 info');
                            return next();
                        }
                        var pm25Forecast = {
                            source: 'airkorea',
                            code: 'PM25',
                            pubDate: pm25.pubDate,
                            hourly: pm25.hourly
                        };

                        req.air_forecast.push(pm25Forecast);

                        next();
                    });
                });
            }
        }else{
            next();
        }

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

    this.setYesterday = function (req, res, next) {
        try {
            var meta = {};
            meta.method = 'setYesterday';
            meta.region = req.params.region;
            meta.city = req.params.city;
            meta.town = req.params.town;
            log.info('>sID=',req.sessionID, meta);

            if (!req.current || !req.currentList)  {
                log.warn(new Error("Fail to find current weather or current list "+JSON.stringify(meta)));
                next();
                return this;
            }

            var yesterdayDate = self._getCurrentTimeValue(+9-24);
            var yesterdayItem;
            if (yesterdayDate.time == '0000') {
                kmaTimeLib.convert0Hto24H(yesterdayDate);
            }

            /**
             * short 만들때, 당시간에 데이터가 없는 경우에 그 이전 데이터를 사용하지만,
             * 새로 데이터를 수집하면 23시간전부터 있음.
             * 그래서 해당 시간 데이터가 없는 경우 그 이후 데이터를 사용.
             */
            for (var i=0; i<req.currentList.length-1; i++) {
                if (req.currentList[i].date == yesterdayDate.date &&
                    parseInt(req.currentList[i].time) >= parseInt(req.current.time))
                {
                    yesterdayItem =  req.currentList[i];
                    break;
                }
            }

            if (yesterdayItem) {
                req.current.yesterday = yesterdayItem;
            }
            else {
                log.error('Fail to gt yesterday weather info');
            }
        }
        catch (err) {
            log.error(err);
        }
        next();
        return this;
    };

    /**
     * getSummary -> setYesterday + getSummaryAfterUnitConverter
     * @param req
     * @param res
     * @param next
     * @returns {ControllerTown24h}
     */
    this.getSummaryAfterUnitConverter = function(req, res, next){
        try {
            var meta = {};
            meta.method = 'getSummaryAfterUnitConverter';
            meta.region = req.params.region;
            meta.city = req.params.city;
            meta.town = req.params.town;
            log.info('>sID=',req.sessionID, meta);

            if (!req.current || !req.currentList)  {
                log.warn(new Error("Fail to find current weather or current list "+JSON.stringify(meta)));
                next();
                return this;
            }

            var current = req.current;
            current.summary = self.makeSummary(current, current.yesterday, req.query, res);
        }
        catch (err) {
            log.error(err);
            req.current.summary = '';
        }
        next();
        return this;
    };

    this.makeResult = function (req, res, next) {
        var meta = {};

        var result;
        var regionName = req.params.region;
        var cityName = req.params.city;
        var townName = req.params.town;

        meta.method = '/:region/:city/:town';
        meta.region = regionName;
        meta.city = cityName;
        meta.town = townName;

        if (req.result == undefined) {
            req.result = {};
        }
        result = req.result;
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
            if (req.short == undefined || req.short.length == undefined || req.short.length < 33) {
                log.error("Short is invalid >sID=",req.sessionID, meta)
            }
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
            if (req.current == undefined || req.current.t1h == undefined || req.current.yesterday == undefined) {
                log.error("Current is invalid >sID=",req.sessionID, meta)
            }
            result.current = req.current;
        }
        if(req.midData) {
            if (req.midData.dailyData == undefined || req.midData.dailyData.length == undefined
                || req.midData.dailyData.length < 17) {
                log.error("daily Data is invalid >sID=",req.sessionID, meta)
            }
            result.midData = req.midData;
        }
        if (req.dailySummary) {
            result.dailySummary = req.dailySummary;
        }
        if (req.air_forecast){
            result.air_forecast = req.air_forecast;
        }
        result.source = "KMA";

        var units ={};
        UnitConverter.getUnitList().forEach(function (value) {
            units[value] = req.query[value] || UnitConverter.getDefaultValue(value);
        });
        result.units = units;

        next();
        return this;
    };

    this.sendResult = function (req, res) {
        log.info('## - ' + decodeURI(req.originalUrl) + ' sID=' + req.sessionID);
        res.json(req.result);
    };

    this.convertUnits = function (req, res, next) {
        try {
            var current = req.current;
            var currentDate;
            if (current.hasOwnProperty('stnDateTime')) {
                current.dateObj = kmaTimeLib.convertYYYYoMMoDDoHHoMMtoYYYYoMMoDD_HHoMM(current.stnDateTime);
            }
            else {
                current.dateObj = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM(current.date+current.time);
            }
            currentDate = current.dateObj;
            current.time = parseInt(current.time.slice(0, -2));
            self._convertWeatherData(current, req.query);
            self._convertWeatherData(current.yesterday, req.query);
            current.yesterday.time = parseInt(current.yesterday.time.slice(0, -2));

            req.shortest.forEach(function (value) {
                value.dateObj = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM(value.date+value.time);
                self._convertWeatherData(value, req.query);
            });
            var short = req.short;
            var foundCurrentIndex = false;
            short.forEach(function (value, index) {
                value.dateObj = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM(value.date+value.time);
                value.time = parseInt(value.time.slice(0, -2));
                value.fromToday = kmaTimeLib.getDiffDays(value.dateObj, currentDate);
                if (foundCurrentIndex === false && value.dateObj <= currentDate) {
                    if (index === short.length-1) {
                        value.currentIndex = true;
                    }
                    else {
                        var nextObj = short[index+1];
                        var nextIndexDate = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM(nextObj.date+nextObj.time);
                        if(currentDate <= nextIndexDate) {
                            value.currentIndex = true;
                        }
                    }
                }
                self._convertWeatherData(value, req.query);
            });
            req.midData.dailyData.forEach(function (value, index) {
                value.dateObj = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM(value.date+"0000");
                value.skyAm = value.skyAmIcon;
                value.skyPm = value.skyPmIcon;
                value.tmx = value.taMax;
                value.tmn = value.taMin;
                value.fromToday = kmaTimeLib.getDiffDays(value.dateObj, currentDate);
                value.dayOfWeek = (new Date(value.dateObj)).getDay();
                if (value.date === current.date) {
                    current.todayIndex = index;
                }

                if (!(value.dustForecast == undefined)) {
                    var dustForecast = value.dustForecast;

                    if (!(dustForecast.PM10Grade == undefined)) {
                        dustForecast.pm10Grade = dustForecast.PM10Grade+1;
                        dustForecast.pm10Str = dustForecast.PM10Str;
                        delete dustForecast.PM10Grade;
                        delete dustForecast.PM10Str;
                    }
                    if (!(dustForecast.PM25Grade == undefined)) {
                        dustForecast.pm25Grade = dustForecast.PM25Grade+1;
                        dustForecast.pm25Str = dustForecast.PM25Str;
                        delete dustForecast.PM25Grade;
                        delete dustForecast.PM25Str;
                    }
                    if (!(dustForecast.O3Grade == undefined)) {
                        dustForecast.o3Grade = dustForecast.O3Grade+1;
                        dustForecast.o3Str = dustForecast.O3Str;
                        delete dustForecast.O3Grade;
                        delete dustForecast.O3Str;
                    }
                }
                delete value.skyAmIcon;
                delete value.skyPmIcon;
                delete value.taMax;
                delete value.taMin;

                self._convertWeatherData(value, req.query);
            });
            if (req.current.hasOwnProperty('arpltn')) {
                KecoController.recalculateValue(req.current.arpltn, req.query.airUnit, res);
            }
        }
        catch (err) {
            log.error(err);
        }
        return next();
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
            log.error('Fail to parse sky='+sky);
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
            log.error('Fail to parse pty='+pty);
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

/**
 * temperatureUnit(C,F), windSpeedUnit(mph,km/h,m/s,bft,kr), pressureUnit(mmHg,inHg,hPa,mb),
 * distanceUnit(km,mi), precipitationUnit(mm,in), airUnit(airkorea,airkorea_who,airnow,aircn)
 * @param wData
 * @param query
 * @returns {ControllerTown24h}
 * @private
 */
ControllerTown24h.prototype._convertWeatherData = function(wData, query) {
    var unitConverter = new UnitConverter();
    var toTempUnit;
    var toWindUnit;
    var toPressUnit;
    var toDistUnit;
    var toPrecipUnit;
    var defaultValueList;

    if (wData == undefined) {
        log.error('Invalid weather data for converting');
        return this;
    }
    if (query == undefined) {
        log.error('Invalid query for converting');
        return this;
    }

    toTempUnit = query.temperatureUnit;
    toPrecipUnit = query.precipitationUnit;
    toWindUnit = query.windSpeedUnit;
    toPressUnit = query.pressureUnit;
    toDistUnit = query.distanceUnit;

    defaultValueList = UnitConverter.getDefaultValueList();

    //convert cm to mm s06, sn1, s1d
    ['s06', 'sn1', 's1d'].forEach(function (name) {
        if (wData.hasOwnProperty(name)) {
            wData[name] *= 10;
        }
    });

    if (toTempUnit && toTempUnit !== defaultValueList['temperatureUnit']) {
        //client에서는 taMax,taMin은 tmx, tmn으로 변환해서 사용하고 있음.
        ['t1h', 'sensorytem', 'dpt', 'heatIndex', 't3h', 'tmx', 'tmn', 't1d'].forEach(function (name) {
            if (wData.hasOwnProperty(name) && wData[name] !== -50) {
                wData[name] = unitConverter.convertUnits(defaultValueList['temperatureUnit'], toTempUnit, wData[name]);
                if (toTempUnit === 'F') {
                    wData[name] = Math.floor(wData[name]);
                }
            }
        });
    }

    //will remove rs1h, rs1d
    if (toPrecipUnit && toPrecipUnit !== defaultValueList['precipitationUnit']) {
        ['rn1', 'rs1h', 'rs1d', 'r06', 's06', 'sn1', 's1d'].forEach(function (name) {
            if (wData.hasOwnProperty(name)) {
                wData[name] = unitConverter.convertUnits(defaultValueList['precipitationUnit'], toWindUnit, wData[name]);
            }
        });
    }

    if (wData.hasOwnProperty('wsd')) {
        wData.wsd = unitConverter.convertUnits(defaultValueList['windSpeedUnit'], toWindUnit, wData.wsd);
    }
    if (wData.hasOwnProperty('hPa')) {
        wData.hPa = unitConverter.convertUnits(defaultValueList['pressureUnit'], toPressUnit, wData.hPa);
    }
    if (wData.hasOwnProperty('visibility')) {
        wData.visibility = unitConverter.convertUnits(defaultValueList['distanceUnit'], toDistUnit, wData.visibility);
    }
};


module.exports = ControllerTown24h;
