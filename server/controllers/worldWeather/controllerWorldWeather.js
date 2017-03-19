/**
 * Created by Peter on 2016. 3. 17..
 */
var request = require('request');
var async = require('async');
var modelGeocode = require('../../models/worldWeather/modelGeocode.js');
var modelWuForecast = require('../../models/worldWeather/modelWuForecast');
var modelWuCurrent = require('../../models/worldWeather/modelWuCurrent');
var modelDSForecast = require('../../models/worldWeather/modelDSForecast');
var config = require('../../config/config');


var commandList = ['restart', 'renewGeocodeList'];
var weatherCategory = ['forecast', 'current'];

var itemWuCurrent = ['date', 'desc', 'code', 'tmmp', 'ftemp', 'humid', 'windspd', 'winddir', 'cloud', 'vis', 'slp', 'dewpoint'];
var itemWuForecastSummary =[
    'date',
    'sunrise',
    'sunset',
    'moonrise',
    'moonset',
    'tmax',
    'tmin',
    'precip',
    'rain',
    'snow',
    'prob',
    'humax',
    'humin',
    'windspdmax',
    'windgstmax',
    'slpmax',
    'slpmin'
];
var itemWuForecast = [
    'date',
    'time',
    'utcDate',
    'utcTime',
    'desc',
    'code',
    'tmp',
    'ftmp',
    'winddir',
    'windspd',
    'windgst',
    'cloudlow',
    'cloudmid',
    'cloudhigh',
    'cloudtot',
    'precip',
    'rain',
    'snow',
    'fsnow',
    'prob',
    'humid',
    'dewpoint',
    'vis',
    'splmax'
];

/**
 *
 * @returns {controllerWorldWeather}
 */
function controllerWorldWeather(){
    var self = this;

    self.geocodeList = [];
    /*****************************************************************************
     * Public Functions (For Interface)
     *****************************************************************************/
    /**
     *
     * @param req
     * @param res
     */
    self.sendResult = function(req, res){
        if(req.error){
            res.json(req.error);
        }
        else if(req.result){
            if (req.result.thisTime.length != 2) {
               log.error("thisTime's length is not 2 loc="+JSON.stringify(req.result.location));
            }
            res.json(req.result);
        }
        else {
            res.json({result: 'Unknow result'});
        }
        log.info('## - ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' + req.sessionID);
        return;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     */
    self.showUsage = function(req, res, next){
        if(req.result === undefined){
            req.result = {};
        }
        req.result.usage = [
            '/{API version}/{categroy}',
            'example 3 > /010000/current?key={key}&code={lat},{lon}&country={country_name}&city={city_name}'
        ];

        next();
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     */
    self.checkApiVersion = function(req, res, next){
        var self = this;
        var meta = {};

        meta.method = 'checkApiVersion';
        meta.version = req.params.version;
        meta.sID = req.sessionID;

        req.version = req.params.version;

        log.info("WW>",meta);

        // todo: To check all version and make way to alternate route.
        if(req.version !== '010000') {
            log.error('WW> It is not valid version :', req.version);
            req.validVersion = false;
            req.error = 'WW> It is not valid version : ' + req.version;
            next();
        }else{
            log.info('WW> go to next step', meta);
            req.validVersion = true;
            next();
        }
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {*}
     */
    self.queryWeather = function(req, res, next){
        var meta = {};
        meta.method = 'queryWeather';

        if(!req.validVersion){
            log.error('WW queryWeather> invalid version : ', req.validVersion);
            return next();
        }

        if(!self.isValidCategory(req)){
            return next();
        }

        self.getCode(req);
        self.getCountry(req);
        self.getCity(req);

        if(!req.geocode && !req.city){
            log.error('WW queryWeather> It is not valid request');
            req.error = 'It is not valid request';
            next();
            return;
        }

        log.info('geocode : ', req.geocode);

        async.waterfall([
                // 1. load geocode list, if it does not load geocode yet.
                function(callback){
                    if(self.geocodeList.length <= 0){
                        self.loadGeocodeList(function(err){
                            if(err){
                                req.error = err;
                                callback('err_exit');
                                return;
                            }
                            log.info('WW queryWeather> load geocode, count:', self.geocodeList.length);
                            callback(null);
                        });
                    }else{
                        // goto next step
                        callback(null);
                    }
                },
                // 2. check geocode if it is in the geocodelist or not.
                function(callback){
                    if(req.city !== undefined && self.checkCityName(req.city)){
                        log.info('WW queryWeather> matched by city name');
                        callback(null);
                        return;
                    }

                    if(req.geocode !== undefined && self.checkGeocode(req.geocode)){
                        log.info('WW queryWeather> matched by geocode');
                        callback(null);
                        return;
                    }

                    // Need to send request to add this geocode.
                    req.error = 'WW queryWeather> It is the fist request, will collect weather for this geocode :', req.geocode, req.city;
                    log.error(req.error);

                    self.requestData(req, 'req_add', function(err, result){
                        if(err){
                            log.error('WW queryWeather> fail to reqeust');
                            req.error = {res: 'fail', msg:'this is the first request of geocode'};
                            callback('err_exit : Fail to requestData()');
                            return;
                        }

                        // need to update location list
                        // TODO : Perhaps it'll take for long time, so need to find out other way to update.
                        self.loadGeocodeList(function(err){
                            if(err){
                                log.error('WW queryWeather> Fail to update geocode list, count:', self.geocodeList.length);
                            }else{
                                log.silly('WW queryWeather> update geocode list, count:', self.geocodeList.length);
                            }

                            req.error = undefined;

                            callback(null);
                        });
                    });
                },
                // 3. get MET data from DB by using geocode.
                function(callback){
                    self.getDataFromMET(req, function(err){
                        log.info('WW queryWeather> get MET data');

                        // goto next step
                        callback(null);
                    });
                },
                // 4. get OWM data from DB by using geocode
                function(callback){
                    self.getDataFromOWM(req, function(err){
                        log.info('WW queryWeather> get OWM data');

                        // goto next step
                        callback(null);
                    });
                },
                // 5. get WU data from DB by using geocode
                function(callback){
                    self.getDataFromWU(req, function(err, result){
                        if(err){
                            log.error('WW queryWeather> Fail to get WU data: ', err);
                            callback(null);
                            return;
                        }
                        log.info('WW queryWeather> get WU data');

                        // goto next step
                        callback(null);
                    });
                },
                // 6. get DSF data from DB by using geocode.
                function(callback){
                    self.getDataFromDSF(req, function(err, result){
                        if(err){
                            log.error('WW queryWeather> Fail to get DSF data', err);
                            callback(null);
                            return;
                        }
                        log.info('WW queryWeather> get DSF data');

                        // goto next step
                        callback(null);
                    });
                }
        ],
        function(err, result){
            if(err){
                log.info('WW> queryWeather Error : ', err);
            }else{
                log.silly('WW> queryWeather no error')
            }

            log.info('WW queryWeather> Finish to get weather data');
            next();
        });
    };

    self.checkValidDate = function(cDate, sDate){
        if(cDate.getYear() != sDate.getYear()) {
            return false;
        }

        if(cDate.getMonth() != sDate.getMonth()) {
            return false;
        }

        if(cDate.getDate() != sDate.getDate()) {
            return false;
        }

        if(cDate.getHours() != sDate.getHours()) {
            return false;
        }

        return true;
    };

    /**
     * compare until hour
     * @param first
     * @param second
     * @returns {boolean}
     * @private
     */
    self._compareDateString = function(first, second){
        //log.info('Compare Date', first, second);

        // YYYY.mm.dd HH:MM
        if(first.slice(0, 13) === second.slice(0, 13)){
            return true;
        }
        return false;
    };


    self._checkHour = function(date, hourList){
        // YYYY.mm.dd HH:MM
        for(var i=0 ; i<hourList.length ; i++){
            if(date.slice(11, 13) === hourList[i]){
                return true;
            }
        }

        return false;
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {*}
     */
    self.queryTwoDaysWeather = function(req, res, next){
        var cDate = new Date();
        var meta = {};
        meta.method = 'queryTwoDaysWeather';
        meta.sID = req.sessionID;

        if(!req.validVersion){
            log.error('TWW> invalid version : ', req.validVersion, meta);
            return next();
        }

        if(!self.isValidCategory(req)){
            return next();
        }

        self.getCode(req);
        self.getCountry(req);
        self.getCity(req);

        if(!req.geocode && !req.city){
            log.error('It is not valid request', meta);
            req.error = 'It is not valid request';
            next();
            return;
        }

        log.info('TWW> geocode : ', req.geocode, meta);

        async.waterfall([
                function(callback){
                    self.getLocalTimezone(req, function(err){
                        if(err){
                            log.error('Fail to get LocalTimezone : ', err, meta);
                        }
                        return callback(null);
                    });
                },
                /*
                * No use WU data.
                function(callback){
                    self.getDataFromWU(req, function(err, result){
                        if(err){
                            log.error('TWW> Fail to get WU data: ', err);
                            callback('err_exit_WU');
                            return;
                        }

                        if(req.WU.current.dataList === undefined){
                            log.error('TWW> There is no WU data');
                            callback('err_exit_notValid');
                            return;
                        }

                        if(!self.checkValidDate(cDate, req.WU.current.dateObj)){
                            log.error('TWW> invaild WU data');
                            log.error('TWW> WU CurDate : ', cDate.toString());
                            log.error('TWW> WU DB Date : ', req.WU.current.dateObj.toString());
                            callback('err_exit_notValid');
                            return;
                        }

                        log.info('TWW> get WU data');
                        callback(null);
                    });
                },
                */
                function(callback){
                    self.getDataFromDSF(req, function(err, result){
                        if(err){
                            log.error('TWW> Fail to get DSF data', err, meta);
                            callback('err_exit_DSF');
                            return;
                        }

                        if(req.DSF === undefined){
                            log.warn('TWW> There is no DSF data', meta);
                            callback('err_exit_notValid');
                            return;
                        }

                        log.info('cDate : ', cDate.toString());
                        log.info('DB Date : ', req.DSF.dateObj.toString());

                        //업데이트 시간이 한시간을 넘어가면 어제,오늘,예보 갱신.
                        if(!self.checkValidDate(cDate, req.DSF.dateObj)){
                            log.info('TWW> Invaild DSF data', meta);
                            log.info('TWW> DSF CurDate : ', cDate.toString(), meta);
                            log.info('TWW> DSF DB Date : ', req.DSF.dateObj.toString(), meta);
                            callback('err_exit_notValid');
                            return;
                        }

                        log.info('TWW> get DSF data', meta);
                        callback(null);
                    });
                }
            ],
            function(err, result){
                if(err){
                    log.info('TWW> There is no correct weather data... try to request', meta);

                    async.waterfall([
                            function(cb){
                                self.requestData(req, 'req_two_days', function(err, result){
                                    if(err){
                                        log.error('TWW> fail to request', meta);
                                        req.error = {res: 'fail', msg:'Fail to request Two days data'};
                                        cb('err_exit : Fail to requestData()');
                                        return;
                                    }
                                    cb(null);
                                });
                            },
                            /*
                            function(cb){
                                self.getDataFromWU(req, function(err, result){
                                    if(err){
                                        log.error('TWW> Fail to get WU data: ', err);
                                        cb('err_exit_WU');
                                        return;
                                    }

                                    log.info('TWW> get WU data');
                                    cb(null);
                                });
                            },
                            */
                            function(cb){
                                self.getDataFromDSF(req, function(err, result){
                                    if(err){
                                        log.error('TWW> Fail to get DSF data', err, meta);
                                        cb('err_exit_DSF');
                                        return;
                                    }
                                    log.info('TWW> get DSF data', meta);
                                    cb(null);
                                });
                            }
                        ],
                        function(err, result){
                            if(err){
                                log.info('TWW> Error!!!! : ', err, meta);
                            }else {
                                log.info('TWW> Finish to req&get Two days weather data', meta);
                            }
                            next();
                        }
                    );
                }else{
                    log.silly('TWW> queryWeather no error');
                    log.info('TWW> Finish to get Two days weather data', meta);
                    next();
                }
            });
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     */
    self.checkCommand = function(req, res, next){
        if(req.query.command === undefined){
            next();
            return;
        }

        switch(req.query.command){
            case 'restart':
                next();
                break;
            case 'renew_geocode_list':
                self.loadGeocodeList(req, function(err){
                    if(err){
                        req.error = err;
                    }
                    next();
                });
                break;
            default:
                log.error('WW> unknown command :' + req.query.command);
                next();
                break;
        }
    };

    self._leadingZeros = function(n, digits) {
        var zero = '';
        n = n.toString();

        if(n.length < digits) {
            for(var i = 0; i < digits - n.length; i++){
                zero += '0';
            }
        }
        return zero + n;
    };

    self._getTimeString = function(tzOffset) {
        var self = this;
        var now = new Date();
        var result;
        var offset;

        if(tzOffset === undefined){
            offset = 9;
        }else{
            offset = tzOffset;
        }

        var tz = now.getTime() + (offset * 3600000);
        now.setTime(tz);

        result =
            self._leadingZeros(now.getUTCFullYear(), 4) + '.' +
            self._leadingZeros(now.getUTCMonth() + 1, 2) + '.' +
            self._leadingZeros(now.getUTCDate(), 2) + ' ' +
            self._leadingZeros(now.getUTCHours(), 2) + ':' +
            self._leadingZeros(now.getUTCMinutes(), 2);

        return result;
    };

    self._convertTimeString = function(timevalue){
        var self = this;

        return self._leadingZeros(timevalue.getUTCFullYear(), 4) + '.' +
            self._leadingZeros(timevalue.getUTCMonth() + 1, 2) + '.' +
            self._leadingZeros(timevalue.getUTCDate(), 2) + ' ' +
            self._leadingZeros(timevalue.getUTCHours(), 2) + ':' +
            self._leadingZeros(timevalue.getUTCMinutes(), 2);

    };

    self._getDateObj = function(date){
        // YYYY.MM.DD HH:MM
        //var d = date.toString();
        //var dateObj = new Date(d.slice(0,4)+'/'+d.slice(5,7)+'/'+ d.slice(8,10)+' '+d.slice(11,13)+':'+ d.slice(10,12));
        var dateObj = new Date(date);

        //log.info('dateobj :', dateObj.toString());
        //log.info(''+d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));
        return dateObj;
    };
/**********************************************************
*   WU Util
***********************************************************/
    self.mergeWuForecastData = function(req, res, next){
        var dateString = self._getTimeString(0 - 24).slice(0,14) + '00';
        var startDate = self._getDateObj(dateString);

        if(req.hasOwnProperty('WU') && req.WU.forecast){
            if(req.result === undefined){
                req.result = {};
            }
            var forecast = req.WU.forecast;

            // Merge WU Forecast DATA
            if(forecast.geocode){
                req.result.location = {};
                if(forecast.geocode.lat){
                    req.result.location.lat = forecast.geocode.lat;
                }
                if(forecast.geocode.lon){
                    req.result.location.lon = forecast.geocode.lon;
                }
            }

            if(forecast.date){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.wuForecast = forecast.date;
            }
            if(forecast.dateObj){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.wuForecast = forecast.dateObj;
            }

            if(forecast.days){
                if(req.result.daily === undefined){
                    req.result.daily = [];
                }
                log.info('WU mergeWuForecastData> SDATE : ', startDate.toString());

                forecast.days.forEach(function(item){
                    //log.info('Daily Data', item.summary.dateObj.toString());
                    if(item.summary.dateObj.getTime() >= startDate.getTime()){
                        req.result.daily.push(self._makeDailyDataFromWU(item.summary));

                        if(req.result.hourly === undefined){
                            req.result.hourly = [];
                        }

                        item.forecast.forEach(function(time){
                            var index = -1;

                            //log.info('MG WU hourly > item', time.dateObj.toString());
                            if(time.dateObj.getTime() >= startDate.getTime()){
                                for(var i=0 ; i<req.result.hourly.length ; i++){
                                    if(req.result.hourly[i].date.getYear() === time.dateObj.getYear() &&
                                        req.result.hourly[i].date.getMonth() === time.dateObj.getMonth() &&
                                        req.result.hourly[i].date.getDate() === time.dateObj.getDate() &&
                                        req.result.hourly[i].date.getHours() === time.dateObj.getHours()){
                                        index = i;
                                        log.info('WU mergeWuForecastData> MergeWU hourly : Found!! same date');
                                        break;
                                    }
                                }

                                if(index < req.result.hourly.length){
                                    req.result.hourly[i] = self._makeHourlyDataFromWU(time);
                                }
                                else{
                                    req.result.hourly.push(self._makeHourlyDataFromWU(time));
                                }
                            }
                        });
                    }
                });
            }
        }

        next();
    };

    self.mergeWuCurrentDataToHourly = function(req, res, next){
        if(req.hasOwnProperty('WU') && req.WU.current && req.WU.current.dataList){
            var dateString = self._getTimeString(0 - 48).slice(0,14) + '00';
            var startDate = self._getDateObj(dateString);

            var list = req.WU.current.dataList;
            var curDate = new Date();
            log.info('MG WuCToHourly> curDate ', curDate.toString());

            if(req.result.hourly === undefined){
                req.result.hourly = [];
            }

            if(req.WU.current.date){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.wuCurrent = req.WU.current.date;
            }
            if(req.WU.current.dateObj){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.wuCurrent = req.WU.current.dateObj;
            }

            list.forEach(function(curItem){
                var isExist = 0;
                if(curItem.dateObj.getHours() != 0 && (curItem.dateObj.getHours() % 3) != 0){
                    return;
                }

                if(curItem.dateObj && curItem.dateObj.getTime() > curDate.getTime()){
                    log.info('MG WuCToHourly> skip future data', curItem.dateObj.toString());
                    return;
                }

                // 과거 2일까지의 데이터만처리 한다. hourly data는 과거 1~2일 데이터만 필요함.
                if(curItem.dateObj && curItem.dateObj.getTime() < startDate.getTime()){
                    log.info('MG WuCToHourly> skip past data', curItem.dateObj.toString());
                    return;
                }

                for(var i=0 ; i<req.result.hourly.length ; i++){
                    if(req.result.hourly[i].dateObj != undefined &&
                        req.result.hourly[i].dateObj.getTime() === curItem.dateObj.getTime()){
                        isExist = 1;
                        if(curItem.desc){
                            req.result.hourly[i].desc = curItem.desc;
                        }
                        if(curItem.temp){
                            req.result.hourly[i].temp_c = curItem.temp;
                        }
                        if(curItem.temp_f){
                            req.result.hourly[i].temp_f = curItem.temp_f;
                        }
                        if(curItem.ftemp){
                            req.result.hourly[i].ftemp_c = curItem.ftemp;
                        }
                        if(curItem.ftemp_f){
                            req.result.hourly[i].ftemp_f = curItem.ftemp_f;
                        }
                        if(curItem.humid){
                            req.result.hourly[i].humid = curItem.humid;
                        }
                        if(curItem.windspd){
                            req.result.hourly[i].windSpd_ms = curItem.windspd;
                        }
                        if(curItem.windspd_mh){
                            req.result.hourly[i].windSpd_mh = curItem.windspd_mh;
                        }
                        if(curItem.winddir){
                            req.result.hourly[i].windDir = curItem.winddir;
                        }
                        if(curItem.cloud){
                            req.result.hourly[i].cloud = curItem.cloud;
                        }
                        if(curItem.vis){
                            req.result.hourly[i].vis = curItem.vis;
                        }
                        if(curItem.slp){
                            req.result.hourly[i].press = curItem.slp;
                        }
                    }
                }
                if(isExist === 0){
                    req.result.hourly.push(self._makeHourlyDataFromWUCurrent(curItem));
                }

            });
        }
        next();
    };

    self.mergeWuCurrentData = function(req, res, next){
        if(req.hasOwnProperty('WU') && req.WU.current && req.WU.current.dataList){
            var list = req.WU.current.dataList;
            var curDate = new Date();
            log.info('MG WuC> curDate ', curDate);

            if(req.result.current === undefined){
                req.result.current = {};
            }

            list.forEach(function(curItem){
                if(curItem.dateObj
                    && curItem.dateObj.getYear() === curDate.getYear()
                    && curItem.dateObj.getMonth() === curDate.getMonth()
                    && curItem.dateObj.getDate() === curDate.getDate()
                    && curItem.dateObj.getHours() === curDate.getHours()){
                    log.info('MG WuC> Find matched current date', curItem.dateObj.toString());

                    req.result.current = self._makeHourlyDataFromWUCurrent(curItem);
                }


            });
        }
        next();
    };

    /**********************************************************
     **********************************************************
        DSF Util
     **********************************************************
     **********************************************************/
    self.getLocalTimezone = function (req, callback) {

        //find chached data
        //else
        var lat;
        var lon;
        var timestamp;
        var url;

        var meta = {};
        meta.sID = req.sessionID;

        if(req.hasOwnProperty('result') === false){
            req.result = {};
        }
        if(req.result.hasOwnProperty('timezone') === false){
            req.result.timezone = {};
        }
        req.result.timezone.min = (100 * 60);
        req.result.timezone.ms = 0;

        if(req.geocode.hasOwnProperty('lat') && req.geocode.hasOwnProperty('lon')){
            lat = req.geocode.lat;
            lon = req.geocode.lon;
            timestamp = (new Date()).getTime();
            url = "https://maps.googleapis.com/maps/api/timezone/json";
            url += "?location="+lat+","+lon+"&timestamp="+Math.floor(timestamp/1000);

            request.get(url, {json:true, timeout: 1000 * 20}, function(err, response, body){
                if (err) {
                    log.error('DSF Timezone > Fail to get timezone', err, meta);
                    return callback(err);
                }
                else {
                    try {
                        log.silly(body);
                        var result = body;
                        var offset = (result.dstOffset+result.rawOffset);
                        req.result.timezone.min = offset/60; //convert to min;
                        req.result.timezone.ms = offset * 1000; // convert to millisecond

                        log.info('DSF Timezone > ', req.result.timezone, meta);

                        return callback(0);
                    }
                    catch (e) {
                        log.error(e);
                        return callback(e);
                    }
                }
            });
        }else{
            log.error('there is no geocode from DSF data', meta);
            callback(1);
        }
    };

    self.convertDsfLocalTime = function(req, res, next){
        var meta = {};
        meta.sID = req.sessionID;

        if(req.DSF && req.result.timezone){
            var dsf = req.DSF;

            dsf.data.forEach(function(dsfItem){
                if(dsfItem.current){
                    var time = new Date();
                    log.info('convert DSF LocalTime > current', meta);
                    time.setTime(dsfItem.current.dateObj.getTime() + req.result.timezone.ms);
                    dsfItem.current.dateObj = self._convertTimeString(time);
                }

                if(dsfItem.hourly){
                    log.info('convert DSF LocalTime > hourly', meta);
                    dsfItem.hourly.data.forEach(function(hourlyItem){
                        var time = new Date();
                        time.setTime(hourlyItem.dateObj.getTime() + req.result.timezone.ms);
                        hourlyItem.dateObj = self._convertTimeString(time);
                    });
                }

                if(dsfItem.daily){
                    log.info('convert DSF LocalTime > daily', meta);
                    dsfItem.daily.data.forEach(function(dailyItem){
                        var time = new Date();
                        time.setTime(dailyItem.dateObj.getTime() + req.result.timezone.ms);
                        dailyItem.dateObj = self._convertTimeString(time);

                        time.setTime(dailyItem.sunrise.getTime() + req.result.timezone.ms);
                        dailyItem.sunrise = self._convertTimeString(time);

                        time.setTime(dailyItem.sunset.getTime() + req.result.timezone.ms);
                        dailyItem.sunset = self._convertTimeString(time);

                        //mint, maxt, pre_intmaxt
                    });
                }
            });
        }
        next();
    };

    self.mergeDsfData = function(req, res, next){
        if(req.DSF){
            if(req.result === undefined){
                req.result = {};
            }
            var dsf = req.DSF;

            if(req.result.location === undefined){
                req.result.location = {};
                req.result.location.lat = dsf.geocode.lat;
                req.result.location.lon = dsf.geocode.lon;
            }

            if(req.result.daily === undefined){
                req.result.daily = [];
            }

            if(req.result.hourly === undefined){
                req.result.hourly = [];
            }

            if(dsf.date){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.date;
            }
            if(dsf.dateObj){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.dateObj;
            }

            // TODO : Need to merge DSF data
            //req.result.DSF = req.DSF;
        }
        next();
    };

    self.mergeDsfDailyData = function(req, res, next){
        var meta = {};
        meta.sID = req.sessionID;

        if(req.DSF && req.DSF.data){
            var timeOffset = req.result.timezone.min / 60;
            var startDate = self._getTimeString(0 - 48 + timeOffset).slice(0,14) + '00';
            var curDate = self._getTimeString(timeOffset).slice(0,14) + '00';

            if(req.result === undefined){
                req.result = {};
            }
            var dsf = req.DSF;

            if(req.result.location === undefined){
                req.result.location = {};
                req.result.location.lat = dsf.geocode.lat;
                req.result.location.lon = dsf.geocode.lon;
            }

            if(dsf.date != undefined){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.date;
            }

            if(dsf.dateObj != undefined){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.dateObj;
            }

            if(req.result.daily === undefined){
                req.result.daily = [];
            }

            log.info('DSF Daily> SDate : ', startDate, meta);
            log.info('DSF Daily> CDdate : ', curDate, meta);

            dsf.data.forEach(function(item){
                item.daily.data.forEach(function(dbItem){
                    var isExist = false;
                    if(new Date(dbItem.dateObj).getTime() >= new Date(startDate).getTime()){
                        req.result.daily.forEach(function(dailyItem, index){
                            //log.info('dailyItem : ', dailyItem.date);
                            if(self._compareDateString(dailyItem.date, dbItem.dateObj)){
                                req.result.daily[index] = self._makeDailyDataFromDSF(dbItem);
                                isExist = true;
                            }
                        });
                        if(!isExist){
                            //log.info('NEW! DSF -> Daily : ', dbItem.dateObj.toString());
                            req.result.daily.push(self._makeDailyDataFromDSF(dbItem));
                        }
                    }
                });
            });

        }
        next();
    };

    self.mergeDsfHourlyData = function(req, res, next){
        var meta = {};
        meta.sID = req.sessionID;

        if(req.DSF && req.DSF.data){
            var timeOffset = req.result.timezone.min / 60;
            var startDate = self._getTimeString(0 - 48 + timeOffset).slice(0,14) + '00';
            var yesterdayDate = self._getTimeString(0 - 24 + timeOffset).slice(0, 14) + '00';
            var curDate = self._getTimeString(timeOffset).slice(0, 14) + '00';

            if(req.result === undefined){
                req.result = {};
            }

            var dsf = req.DSF;

            if(req.result.location === undefined){
                req.result.location = {};
                req.result.location.lat = dsf.geocode.lat;
                req.result.location.lon = dsf.geocode.lon;
            }

            if(dsf.date){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.date;
            }

            if(dsf.dateObj){
                if(req.result.pubDate === undefined){
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.dateObj;
            }

            if(req.result.hourly === undefined){
                req.result.hourly = [];
            }

            if (req.result.thisTime === undefined) {
                req.result.thisTime = [];
            }

            log.info('DSF Hourly> SDate : ', startDate, meta);
            log.info('DSF Hourly> yesterday : ', yesterdayDate, meta);
            log.info('DSF Hourly> CDate : ', curDate, meta);
            //data안의 hourly가 0h~23h 까지이므로, 22,23,0를 묶기위해서 houryList에 모두합침.
            var hourlyList = [];
            dsf.data.forEach(function(item) {
                item.hourly.data.forEach(function(dbItem) {
                    var isExist = false;
                    if (hourlyList.length == 0) {
                        hourlyList.push(dbItem);
                        return;
                    }

                    for (var i=0; i<hourlyList.length-1; i++) {
                        if(self._compareDateString(hourlyList[i].dateObj, dbItem.dateObj)){
                            hourlyList[i] = dbItem;
                            isExist = true;
                            break;
                        }
                    }
                    if (isExist == false) {
                        hourlyList.push(dbItem);
                    }
                });
            });

            //log.info("hourly list = "+hourlyList.length);

            hourlyList.forEach(function(dbItem, dataIndex) {
                var isExist = false;
                if(self._compareDateString(yesterdayDate, dbItem.dateObj)) {
                    req.result.thisTime.forEach(function(thisTime, index){
                        if(thisTime.date != undefined &&
                            self._compareDateString(yesterdayDate, thisTime.date)){
                            req.result.thisTime[index] = self._makeCurrentDataFromDSFCurrent(dbItem);
                            isExist = true;
                        }
                    });

                    if(!isExist){
                        log.info('DSF yesterday > Found yesterday data', dbItem.dateObj, meta);
                        req.result.thisTime.push(self._makeCurrentDataFromDSFCurrent(dbItem));
                    }
                }

                isExist = false;
                if(self._checkHour(dbItem.dateObj, ['00','03','06','09','12','15','18','21','24']) &&
                    new Date(dbItem.dateObj).getTime() >= new Date(startDate).getTime()) {

                    for (var index = 0; index<req.result.hourly.length-1; index++) {
                        var hourly =  req.result.hourly[index];
                        if(self._compareDateString(hourly.date, dbItem.dateObj)){
                            //log.info('hourlyItem : ', hourly.date.toString());
                            req.result.hourly[index] = self._makeHourlyDataFromDSF(dbItem, hourlyList[dataIndex-1],
                                        hourlyList[dataIndex-2], req.result.daily);
                            isExist = true;
                            break;
                        }
                    }

                    if(!isExist){
                        req.result.hourly.push(self._makeHourlyDataFromDSF(dbItem, hourlyList[dataIndex-1],
                                    hourlyList[dataIndex-2], req.result.daily ));
                        var len = req.result.hourly.length;
                        //log.info('NEW! DSF -> Hourly : ', JSON.stringify(req.result.hourly[len-1]));
                    }
                }
            });
        }
        next();
    };

    self.mergeDsfCurrentData = function(req, res, next) {
        var meta = {};
        meta.sID = req.sessionID;

        if (req.DSF && req.DSF.data) {
            var timeOffset = req.result.timezone.min / 60;
            var startDate = self._getTimeString(0 - 48 + timeOffset).slice(0,14) + '00';
            var curDate = self._getTimeString(timeOffset);

            if (req.result === undefined) {
                req.result = {};
            }

            var dsf = req.DSF;

            if (req.result.location === undefined) {
                req.result.location = {};
                req.result.location.lat = dsf.geocode.lat;
                req.result.location.lon = dsf.geocode.lon;
            }

            if (dsf.date) {
                if (req.result.pubDate === undefined) {
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.date;
            }

            if (dsf.dateObj) {
                if (req.result.pubDate === undefined) {
                    req.result.pubDate = {};
                }
                req.result.pubDate.DSF = dsf.dateObj;
            }

            if (req.result.thisTime === undefined) {
                req.result.thisTime = [];
            }

            log.info('DSF current> SDate : ', startDate, meta);
            log.info('DSF current> CDdate : ', curDate, meta);

            /**
             * timeoff이 30분이 경우가 있으며, new delhi, dsf.data의 마지막이 최신 현재날씨라고 전제하고 사용함.
             */
            if (dsf.data.length > 0) {
                var item = dsf.data[dsf.data.length-1];
                log.info('DSF current > Found current data', item.current.dateObj.toString(), meta);
                var current = self._makeCurrentDataFromDSFCurrent(item.current);
                var isNight = self._isNight(curDate, item.daily.data);
                current.skyIcon = self._parseWorldSkyState(current.precType, current.cloud, isNight);
                req.result.thisTime.push(current);
            }
        }

        next();
    };

    self.dataSort = function(req, res, next){
        var meta = {};
        meta.sID = req.sessionID;

        if(req.result.thisTime){
            log.debug('sort thisTime', meta);
            req.result.thisTime.sort(function(a, b){
                if(a.date > b.date){
                    return 1;
                }
                if(a.date < b.date){
                    return -1;
                }
                return 0;
            });
        }
        if(req.result.hourly){
            log.debug('sort hourly', meta);
            req.result.hourly.sort(function(a, b){
                if(a.date > b.date){
                    return 1;
                }
                if(a.date < b.date){
                    return -1;
                }
                return 0;
            });
        }

        if(req.result.daily){
            log.debug('sort daily', meta);
            req.result.daily.sort(function(a, b){
                if(a.date > b.date){
                    return 1;
                }
                if(a.date < b.date){
                    return -1;
                }
                return 0;
            });
        }

        next();
    };



    /*******************************************************************************
     * * ***************************************************************************
     * * Private Functions (For internal)
     * * ***************************************************************************
     * *****************************************************************************/

    self._getDatabyDate = function(list, date){
        list.forEach(function(item, index){
            if(item.date === date){

            }
        })
    };

    self._makeHourlyDataFromWUCurrent = function(time){
        var result = {};

        if(time.date){
            result.date = time.date;
        }
        if(time.dateObj){
            result.date = time.dateObj;
        }
        if(time.desc){
            result.desc = time.desc;
        }
        if(time.temp){
            result.temp_c = time.temp;
        }
        if(time.temp_f){
            result.temp_f = time.temp_f;
        }
        if(time.ftemp){
            result.ftemp_c = time.ftemp;
        }
        if(time.ftemp_f){
            result.ftemp_f = time.ftemp_f;
        }
        if(time.humid){
            result.humid = time.humid;
        }
        if(time.windspd){
            result.windSpd_ms = time.windspd;
        }
        if(time.windspd_mh){
            result.windSpd_mh = time.windspd_mh;
        }
        if(time.winddir){
            result.windDir = time.winddir;
        }
        if(time.cloud){
            result.cloud = time.cloud;
        }
        if(time.vis){
            result.vis = time.vis;
        }
        if(time.slp){
            result.press = time.slp;
        }

        return result;
    };

    self._makeHourlyDataFromWU = function(time){
        var result = {};

        if(time.date && time.time){
            result.date = '' + time.date + time.time;
        }
        if(time.utcDate && time.utcTime){
            result.date = '' + time.date + time.time;
        }
        if(time.dateObj){
            result.date = time.dateObj;
        }
        if(time.tmp){
            result.temp_c = time.tmp;
        }
        if(time.tmp_f){
            result.temp_f = time.tmp_f;
        }
        if(time.ftmp){
            result.ftemp_c = time.ftmp;
        }
        if(time.ftmp_f){
            result.ftemp_f = time.ftmp_f;
        }
        if(time.cloudtot){
            result.cloud = time.cloudtot;
        }
        if(time.windspd){
            result.windSpd_ms = time.windspd;
        }
        if(time.windspd_mh){
            result.windSpd_mh = time.windspd_mh;
        }
        if(time.winddir){
            result.windDir = time.winddir;
        }
        if(time.humid){
            result.humid = time.humid;
        }
        result.precType = 0;
        if(time.rain > 0){
            result.precType += 1;
        }
        if(time.snow > 0){
            result.precType += 2;
        }
        if(time.prob){
            result.precProb = time.prob;
        }
        if(time.precip){
            result.precip = time.precip;
        }
        if(time.vis){
            result.vis = time.vis;
        }
        if(time.splmax){
            result.press = time.splmax;
        }

        return result;
    };

    self._makeDailyDataFromWU = function(summary){
        var day = {};

        if(summary.date){
            day.date = summary.date;
        }
        if(summary.dateObj){
            day.date = summary.dateObj;
        }
        if(summary.desc){
            day.desc = summary.desc;
        }
        if(summary.sunrise){
            day.sunrise = summary.sunrise;
        }
        if(summary.sunset){
            day.sunset = summary.sunset;
        }
        if(summary.moonrise){
            day.moonrise = summary.moonrise;
        }
        if(summary.moonset){
            day.moonset = summary.moonset;
        }
        if(summary.tmax){
            day.tempMax_c = summary.tmax;
        }
        if(summary.tmax_f){
            day.tempMax_f = summary.tmax_f;
        }
        if(summary.tmin){
            day.tempMin_c = summary.tmin;
        }
        if(summary.tmin_f){
            day.tempMin_f = summary.tmin_f;
        }
        if(summary.ftmax){
            day.ftempMax_c = summary.ftmax;
        }
        if(summary.ftmax_f){
            day.ftempMax_f = summary.ftmax_f;
        }
        if(summary.ftmin){
            day.ftempMin_c = summary.ftmin;
        }
        if(summary.ftmin_f){
            day.ftempMin_f = summary.ftmon_f;
        }

        day.precType = 0;
        if(summary.rain > 0){
            day.precType += 1;
        }
        if(summary.snow > 0){
            day.precType += 2;
        }

        if(summary.prob){
            day.precProb = summary.prob;
        }
        if(summary.humax){
            day.humid = summary.humax;
        }
        if(summary.windspdmax){
            day.windSpd_ms = Math.round(summary.windspdmax);
        }
        if(summary.windspdmax_mh){
            day.windSpd_mh = Math.round(summary.windspdmax_mh);
        }
        if(summary.slpmax){
            day.press = summary.slpmax;
        }

        return day;
    };

    self._max = function (list) {
        var max = 0;
        list.forEach(function (val) {
           if (val > max) {
                max = val;
           }
        });
        return max;
    };

    self._min = function (list) {
        var min = 10000;
        list.forEach(function (val) {
           if (val < max) {
                min = val;
           }
        });
        return min;
    };

    self._sum = function (list) {
        var sum = 0;
        list.forEach(function (val) {
           if (!(val == undefined)) {
               sum += val;
           }
        });
        return sum;
    };

    self._avg = function (list) {
        var cnt = 0;
        var total = 0;
        list.forEach(function (val) {
            if (!(val == undefined)) {
                total += val;
                cnt++;
            }
        });
        if (cnt == 0) {
            return -1;
        }
        return total/cnt;
    };

    self._mergeSummary = function(list) {
        var summaryArray = [];
        list.forEach(function (val) {
            if (!(val == undefined)) {
                val = val.toLowerCase();
            }
            if (val && val.indexOf('and')) {
                val.split(' and ').forEach(function (desc) {
                   summaryArray.push(desc);
                })
            }
            else {
                summaryArray.push(val);
            }
        });
        //log.info("summary array="+summaryArray.toString());
        summaryArray = summaryArray.filter(function (str) {
            if (str == undefined || str == 'clear' || str == 'sunny' || str == 'partly cloudy' || str == 'mostly cloudy'
                || str == 'overcast' || str == 'cloudy')   {
                return false;
            }
            else {
                return true;
            }
        });
        if (summaryArray.length == 0) {
            return list[0];
        }
        return summaryArray[0];
    };

    /**
     *
     * @param precType
     * @param cloud
     * @param isNight
     * @returns {string}
     * @private
     */
    self._parseWorldSkyState = function(precType, cloud, isNight) {
        var skyIconName = "";

        if (isNight) {
            skyIconName = "Moon";
        }
        else {
            skyIconName = "Sun";
        }

        if (!(cloud == undefined)) {
            if (cloud <= 20) {
                skyIconName += "";
            }
            else if (cloud <= 50) {
                skyIconName += "SmallCloud";
            }
            else if (cloud <= 80) {
                skyIconName += "BigCloud";
            }
            else {
                skyIconName = "Cloud";
            }
        }
        else {
            if (precType > 0)  {
                skyIconName = "Cloud";
            }
        }

        switch (precType) {
            case 0:
                skyIconName += "";
                break;
            case 1:
                skyIconName += "Rain";
                break;
            case 2:
                skyIconName += "Snow";
                break;
            case 3:
                skyIconName += "RainSnow";
                break;
            case 4: //우박
                skyIconName += "RainSnow";
                break;
            default:
                console.log('Fail to parse precType='+precType);
                break;
        }

        //if (lgt === 1) {
        //    skyIconName += "Lightning";
        //}

        return skyIconName;
    };

    self._makeDailyDataFromDSF = function(summary){
        var day = {};

        if(summary.date){
            day.date = summary.date;
        }
        if(summary.dateObj){
            day.date = summary.dateObj;
        }
        if(summary.summary){
            day.desc = summary.summary;
        }
        if(summary.sunrise){
            day.sunrise = summary.sunrise;
        }
        if(summary.sunset){
            day.sunset = summary.sunset;
        }
        if(summary.temp_max){
            day.tempMax_c = parseFloat(((summary.temp_max - 32) / (9/5)).toFixed(1));
            day.tempMax_f = parseFloat((summary.temp_max).toFixed(1));
        }
        if(summary.temp_min){
            day.tempMin_c = parseFloat(((summary.temp_min - 32) / (9/5)).toFixed(1));
            day.tempMin_f = parseFloat((summary.temp_min).toFixed(1));
        }
        if(summary.ftemp_max){
            day.ftempMax_c = parseFloat(((summary.ftemp_max - 32) / (9/5)).toFixed(1));
            day.ftempMax_f = parseFloat((summary.ftemp_max).toFixed(1));
        }
        if(summary.ftemp_min){
            day.ftempMin_c = parseFloat(((summary.ftemp_min - 32) / (9/5)).toFixed(1));
            day.ftempMin_f = parseFloat((summary.ftemp_min).toFixed(1));
        }
        if(summary.cloud){
            day.cloud = Math.round(summary.cloud * 100);
        }
        day.precType = 0;

        day.precType = self._getPrecType(summary.icon, summary.pre_pro, summary.pre_type);

        if(summary.pre_pro){
            day.precProb = Math.round(summary.pre_pro * 100);
        }
        if(summary.pre_int){
            //inches per hourly to mm per daily
            day.precip = parseFloat((summary.pre_int*25.4*24).toFixed(2));
        }
        if(summary.humid){
            day.humid = Math.round(summary.humid * 100);
        }
        if(summary.windspd){
            day.windSpd_mh = summary.windspd;
            day.windSpd_ms = parseFloat((summary.windspd * 0.44704).toFixed(2));
        }
        if(summary.winddir){
            day.windDir = summary.winddir;
        }
        if(summary.pres){
            day.press = summary.pres;
        }
        if(summary.vis){
            day.vis = parseFloat((summary.vis * 1.609344).toFixed(2));
        }

        day.skyIcon = self._parseWorldSkyState(day.precType, day.cloud, false);
        return day;
    };

    self._isNight = function (current, dailyInfo) {
        for (var i=0; i<dailyInfo.length-1; i++) {
            if(current >= dailyInfo[i].dateObj.slice(0, 13)) {
                //compare sunrise, sunset
                if (current < dailyInfo[i].sunrise) {
                    return true;
                }
                else if (current >= dailyInfo[i].sunset) {
                    return true;
                }
                return false;
            }
        }

        return false;
    };

    /**
     *
     * @param name
     * @param date
     * @param list
     * @returns {*}
     * @private
     */
    self._getSunTime = function (name, date, list) {
        for (var i=0; i<list.length-1; i++) {
            if (date.slice(0,10) == list[i].date.slice(0, 10)) {
                return list[i][name];
            }
        }
        log.error("Fail to find name="+name+" date="+date);
        return undefined;
    };

    /**
     * icon에 rain,snow,sleet가 있다면(과거데이터), 동일하게 설정, pro가 50%이상이면 pre_type 값 설정.
     * @param icon
     * @param pro
     * @param type
     * @private
     */
    self._getPrecType = function (icon, pro, type) {
        var precType = 0;
        if (icon) {
            if (icon == 'rain') {
                precType = 1;
            }
            else if (icon == 'snow') {
                precType = 2;
            }
            else if (icon == 'sleet' || icon == 'hail') {
                precType = 3;
            }
            else if (pro < 0.5) {
                return precType;
            }
        }
        else if (pro < 0.5) {
            return precType;
        }
        // pro >= 50%
        if(type == 'rain') {
            precType = 1;
        }
        else if(type == 'snow') {
            precType = 2;
        }
        else if (type == 'sleet') {
            precType = 3;
        }
        return precType;
    };

    /**
     *
     * @param summary
     * @param summary2 1hour before
     * @param summary1 2hours ago
     * @param daily day list
     * @returns {{}}
     * @private
     */
    self._makeHourlyDataFromDSF = function(summary, summary2, summary1, daily) {
        var self = this;
        var hourly = {};
        if (summary2 == undefined) {
            summary2 = {};
        }
        if (summary1 == undefined) {
            summary1 = {};
        }

        if(summary.date){
            hourly.date = summary.date;
        }
        if(summary.dateObj){
            hourly.date = summary.dateObj;
        }
        if(summary.temp){
            hourly.temp_c = parseFloat(((summary.temp - 32) / (9/5)).toFixed(1));
            hourly.temp_f = parseFloat(summary.temp.toFixed(1));
        }
        if(summary.ftemp){
            hourly.ftemp_c = parseFloat(((summary.ftemp - 32) / (9/5)).toFixed(1));
            hourly.ftemp_f = parseFloat(summary.ftemp.toFixed(1));
        }

        var sunrise = self._getSunTime("sunrise", summary.dateObj, daily);
        var sunset = self._getSunTime("sunset", summary.dateObj, daily);
        var isNight = false;
        if (sunrise < summary.dateObj && summary.dateObj <= sunset) {
            isNight = false;
        }
        else {
            isNight = true;
        }

        var list = [];
        list.push(summary.cloud);
        list.push(summary2.cloud);
        list.push(summary1.cloud);
        hourly.cloud = Math.round(self._avg(list) * 100);

        if(summary.windspd){
            hourly.windSpd_mh = summary.windspd;
            hourly.windSpd_ms = parseFloat((summary.windspd * 0.44704).toFixed(2));
        }
        if(summary.winddir){
            hourly.windDir = summary.winddir;
        }
        if(summary.humid){
            hourly.humid = Math.round(summary.humid * 100);
        }

        var precType = self._getPrecType(summary.icon, summary.pre_pro, summary.pre_type);
        var precType2 = self._getPrecType(summary2.icon, summary2.pre_pro, summary2.pre_type);
        var precType1 = self._getPrecType(summary1.icon, summary1.pre_pro, summary1.pre_type);

        hourly.precType = 0;
        if (precType == 1 || precType2 == 1 || precType1 == 1) {
            hourly.precType = 1;
        }
        if (precType == 2 || precType2 == 2 || precType1 == 2) {
            hourly.precType += 2;
        }
        if (precType == 3 || precType2 == 3 || precType1 == 3) {
            hourly.precType = 3;
        }

        list = [];
        list.push(summary.pre_pro);
        list.push(summary2.pre_pro);
        list.push(summary1.pre_pro);
        hourly.precProb = Math.round(self._max(list) * 100);

        list = [];
        list.push(summary.pre_int>=0?summary.pre_int:undefined);
        list.push(summary2.pre_int>=0?summary2.pre_int:undefined);
        list.push(summary1.pre_int>=0?summary1.pre_int:undefined);
        hourly.precip = parseFloat((self._sum(list)*25.4).toFixed(2));

        /**
         * in -100 is invalid
         * out -1.61 is invalid
         */
        list = [];
        list.push(summary.vis>0?summary.vis:undefined);
        list.push(summary2.vis>0?summary2.vis:undefined);
        list.push(summary1.vis>0?summary1.vis:undefined);
        hourly.vis = parseFloat((self._avg(list) * 1.609344).toFixed(2));

        if(summary.pres){
            hourly.press = summary.pres;
        }

        list = [];
        list.push(summary.oz);
        list.push(summary2.oz);
        list.push(summary1.oz);
        hourly.oz = parseFloat(self._avg(list).toFixed(2));

        list = [];
        list.push(summary.summary);
        list.push(summary2.summary);
        list.push(summary1.summary);
        hourly.desc = self._mergeSummary(list);
        //log.info('desc='+hourly.desc);

        hourly.weatherType = self._description2weatherType(summary.summary);

        /**
         * precProb 값에 따라 아이콘을 rain으로 표시해야 함
         */
        hourly.skyIcon = self._parseWorldSkyState(hourly.precType, hourly.cloud, isNight);
        return hourly;
    };

    self._makeCurrentDataFromDSFCurrent = function(summary) {
        var current = {};

        if(summary.date){
            current.date = summary.date;
        }
        if(summary.dateObj){
            current.date = summary.dateObj;
        }
        if(summary.summary){
            current.desc = summary.summary;
            current.weatherType = self._description2weatherType(summary.summary);
        }
        if(summary.temp){
            current.temp_c = parseFloat(((summary.temp - 32) / (9/5)).toFixed(1));
            current.temp_f = parseFloat(summary.temp.toFixed(1));
        }
        if(summary.ftemp){
            current.ftemp_c = parseFloat(((summary.ftemp - 32) / (9/5)).toFixed(1));
            current.ftemp_f = parseFloat(summary.ftemp.toFixed(1));
        }
        if(summary.cloud){
            current.cloud = Math.round(summary.cloud * 100);
        }
        if(summary.windspd){
            current.windSpd_mh = summary.windspd;
            current.windSpd_ms = parseFloat((summary.windspd * 0.44704).toFixed(2));
        }
        if(summary.winddir){
            current.windDir = summary.winddir;
        }
        if(summary.humid){
            current.humid = Math.round(summary.humid * 100);
        }

        current.precType = self._getPrecType(summary.icon, summary.pre_pro, summary.pre_type);

        if(summary.pre_pro){
            current.precProb = parseFloat((summary.pre_pro * 100).toFixed(2));
        }

        if(summary.pre_int){
            current.precip = parseFloat((summary.pre_int*25.4).toFixed(1));
        }
        if(summary.vis){
            //miles -> km
            current.vis = Math.round(summary.vis * 1.609344);
        }
        if(summary.pres){
            current.press = summary.pres;
        }
        if(summary.oz){
            current.oz = summary.oz;
        }
        return current;
    };

    /**
     *
     * @param req
     * @returns {boolean}
     */
    self.isValidCategory = function(req){
        if(req.params.category === undefined){
            log.error('there is no category');
            return false;
        }

        for(var i in weatherCategory){
            if(weatherCategory[i] === req.params.category){
                return true;
            }
        }

        return false;
    };

    /**
     *
     * @param req
     * @returns {boolean}
     */
    self.getCode = function(req){
        if(req.query.gcode === undefined){
            log.silly('WW> can not find geocode from qurey');
            return false;
        }

        var geocode = req.query.gcode.split(',');
        if(geocode.length !== 2){
            log.error('WW> wrong geocode : ', geocode);
            req.error = 'WW> wrong geocode : ' + geocode;
            return false;
        }

        req.geocode = {lat:geocode[0], lon:geocode[1]};

        return true;
    };

    /**
     *
     * @param req
     * @returns {boolean}
     */
    self.getCountry = function(req){
        if(req.query.country === undefined){
            log.silly('WW> can not find country name from query');
            return false;
        }

        req.country = req.query.country;

        return true;
    };

    /**
     *
     * @param req
     * @returns {boolean}
     */
    self.getCity = function(req){
        if(req.query.city === undefined){
            log.silly('WW> can not find city name from query');
            return false;
        }

        req.city = req.query.city;

        return true;
    };

    /**
     *
     * @param callback
     */
    self.loadGeocodeList = function(callback){
        log.silly('WW> IN loadGeocodeList');

        try{
            modelGeocode.find({}, {_id:0}).lean().exec(function (err, tList){
                if(err){
                    log.error('WW> Can not found geocode:', + err);
                    callback(new Error('WW> Can not found geocode:', + err));
                    return;
                }

                //if(tList.length <= 0){
                //    log.error('WW> There are no geocode in the DB');
                //    callback(new Error('WW> There are no geocode in the DB'));
                //    return;
                //}

                self.geocodeList = tList;
                log.info('WW> ', JSON.stringify(self.geocodeList));
                callback(0);
            });
        }
        catch(e){
            callback(new Error('WW> catch exception when loading geocode list from DB'));
        }
    };

    /**
     *
     * @param city
     * @returns {boolean}
     */
    self.checkCityName = function(city){
        for(var i = 0; i < self.geocodeList.length ; i++){
            if(self.geocodeList[i].address.city === city){
                return true;
            }
        }

        return false;
    };

    /**
     *
     * @param geocode
     * @returns {boolean}
     */
    self.checkGeocode = function(geocode){
        for(var i = 0; i < self.geocodeList.length ; i++){
            log.info('index[' + i + ']' + 'lon:(' + self.geocodeList[i].geocode.lon + '), lat:(' + self.geocodeList[i].geocode.lat + ') | lon:(' + geocode.lon + '), lat:(' + geocode.lat + ')');
            if((self.geocodeList[i].geocode.lon === parseFloat(geocode.lon)) &&
                (self.geocodeList[i].geocode.lat === parseFloat(geocode.lat))){
                return true;
            }
        }

        return false;
    };

    /**
     *
     * @param req
     * @param callback
     */
    self.getDataFromMET = function(req, callback){
        req.MET = {};
        callback(0, req.MET);
    };

    /**
     *
     * @param req
     * @param callback
     */
    self.getDataFromOWM = function(req, callback){
        req.OWM = {};
        callback(0, req.OWM);
    };

    self.getWuForecastData = function(days){
        var result = [];

        days.forEach(function(day){
            var newItem = {
                summary:{},
                forecast: []
            };
            itemWuForecastSummary.forEach(function(summaryItem){
                if(day.summary[summaryItem]){
                    newItem.summary[summaryItem] = day.summary[summaryItem];
                }
            });

            day.forecast.forEach(function(forecastItem){
                var newForecast = {};

                itemWuForecast.forEach(function(name){
                    if(forecastItem[name]){
                        newForecast[name] = forecastItem[name];
                    }
                });

                newItem.forecast.push(newForecast);
            });

            newItem.forecast.sort(function(a, b){
                if(a.time > b.time){
                    return 1;
                }
                if(a.time < b.time){
                    return -1;
                }
                return 0;
            });

            result.push(newItem);
        });

        result.sort(function(a, b){
            if(a.summary.date > b.summary.date){
                return 1;
            }
            if(a.summary.date < b.summary.date){
                return -1;
            }
            return 0;
        });

        return result;
    };

    self.getWuCurrentData = function(dataList){
        var result = [];

        dataList.forEach(function(item){
            var newData = {};
            itemWuCurrent.forEach(function(name){
                newData[name] = item[name];
            });
            result.push(newData);
        });

        return result;
    };

    /**
     *
     * @param req
     * @param callback
     */
    self.getDataFromWU = function(req, callback){
        var geocode = {
            lat: parseFloat(req.geocode.lat),
            lon: parseFloat(req.geocode.lon)
        };

        var res = {
            current:{},
            forecast: {}
        };

        async.parallel([
                function(cb){
                    modelWuCurrent.find({geocode:geocode}).lean().exec(function(err, list){
                        if(err){
                            log.error('gWU> fail to get WU Current data');
                            //cb(new Error('gFU> fail to get WU Current data'));
                            cb(null);
                            return;
                        }

                        if(list.length === 0){
                            log.error('gWU> There is no WU Current data for ', geocode);
                            //cb(new Error('gFU> There is no WU Current data'));
                            cb(null);
                            return;
                        }

                        res.current = list[0];
                        cb(null);
                    });
                },
                function(cb){
                    modelWuForecast.find({geocode:geocode}).lean().exec(function(err, list){
                        if(err){
                            log.error('gWU> fail to get WU Forecast data');
                            //cb(new Error('gFU> fail to get WU Forecast data'));
                            cb(null);
                            return;
                        }

                        if(list.length === 0){
                            log.error('gWU> There is no WU Forecast data for ', geocode);
                            //cb(new Error('gFU> There is no WU Forecast data'));
                            cb(null);
                            return;
                        }

                        res.forecast = list[0];
                        cb(null);
                    });
                }
            ],
            function(err, result){
                if(err){
                    log.error('gWU> something is wrong???');
                    return;
                }

                req.WU = {};
                req.WU.current = res.current;
                req.WU.forecast = res.forecast;

                callback(err, req.WU);
            }
        );
    };

    self.getDataFromDSF = function(req, callback){
        var meta = {};
        meta.sID = req.sessionID;

        var geocode = {
            lat: parseFloat(req.geocode.lat),
            lon: parseFloat(req.geocode.lon)
        };

        modelDSForecast.find({geocode:geocode}).lean().exec(function(err, list){
            if(err){
                log.error('gDSF> fail to get DSF data', meta);
                callback(err);
                return;
            }

            if(list.length === 0){
                log.warn('gDSF> There is no DSF data for ', geocode, meta);
                callback(err);
                return;
            }

            req.DSF = list[0];

            callback(err, req.DSF);
        });
    };

    /**
     *
     * @param req
     */
    self.makeDefault = function(req){
        req.result = {};
    };

    /**
     *
     * @param req
     */
    self.mergeWeather = function(req){
        if(req.MET){
            // TODO : merge MET data
        }

        if(req.OWM){
            // TODO : merge OWM data
        }

        if(req.WU){
            // TODO : merge WU data
            req.result.WU = req.WU;
        }

        if(req.DSF){
            req.result.DSF = req.DSF;
        }
    };

    self.requestData = function(req, command, callback){
        var meta = {};
        meta.sID = req.sessionID;

        var base_url = config.url.requester;
        var key = 'abcdefg';

        var url = base_url + 'req/all/' + command+ '/?key=' + key;

        if(req.geocode){
            url += '&gcode=' + req.geocode.lat + ',' + req.geocode.lon;
        }

        if(req.country){
            url += '&country=' + req.country;
        }

        if(req.city){
            url += '&city=' + req.city;
        }

        if(req.hasOwnProperty('result') &&
            req.result.hasOwnProperty('timezone') &&
            req.result.timezone.min != (100 * 60)){
            url += '&timezone=' + req.result.timezone.min / 60;
        }else{
            url += '&timezone=0';
        }

        log.info('WW> req url : ', url, meta);
        try{
            request.get(url, {timeout: 1000 * 20}, function(err, response, body){
                if(err){
                    log.error('WW> Fail to request adding geocode to db', meta);
                    callback(err);
                    return;
                }

                var result = JSON.parse(body);
                log.info('WW> request success', meta);
                log.info('WW> '+ JSON.stringify(result), meta);
                if(result.status == 'OK'){
                    // adding geocode OK
                    callback(0, result);
                }else{
                    callback(new Error('fail(receive fail message from requester'));
                }
            });
        }
        catch(e){
            callback(new Error('WW> something wrong!'));
        }
    };

    /**
     * controllerKmaStnWeather._makeWeatherType , $scope.getWeatherStr, self._description2weatherType 와 sync 맞추어야 함
     * @param weatherStr
     * @returns {number}
     * @private
     */
    self._description2weatherType = function (weatherStr) {
        if (!weatherStr.hasOwnProperty('length') || weatherStr.length <= 0) {
            return;
        }

        /**
         *  'light rain and breezy' -> 'light rain'
         */
        weatherStr = weatherStr.toLowerCase();
        if (weatherStr.indexOf('and')) {
            //log.info('weatherStr='+weatherStr);
            weatherStr = weatherStr.split(' and ')[0];
        }

        switch (weatherStr) {
            case 'sunny':
            case 'clear': return 0;
            case 'partly cloudy': return 1;
            case 'mostly cloudy': return 2;
            case 'cloudy':
            case 'overcast': return 3;
            case 'mist': return 4;
            case 'haze': return 5;
            case 'fog': return 6;
            case 'thin fog': return 7;
            case 'dense fog':
            case 'foggy': return 8;
            case 'fog clear': return 9;
            case '시계내안개': return 10;
            case 'partly fog': return 11;
            case 'yellow dust': return 12;
            case '시계내강수': return 13;
            case 'light drizzle': return 14;
            case 'drizzle': return 15;
            case 'heavy drizzle': return 16;
            case 'drizzle clear': return 17;
            case 'light rain at times': return 18;
            case 'light rain': return 19;
            case 'rain at times': return 20;
            case 'rain': return 21;
            case 'heavy rain at times': return 22;
            case 'heavy rain': return 23;
            case 'light showers': return 24;
            case 'showers': return 25;
            case 'heavy showers': return 26;
            case 'showers clear': return 27;
            case 'rain clear': return 28;
            case 'light sleet': return 29;
            case 'heavy sleet': return 30;
            case 'sleet clear': return 31;
            case 'light snow at times': return 32;
            case 'light snow': return 33;
            case 'snow at times': return 34;
            case 'snow': return 35;
            case 'heavy snow at times': return 36;
            case 'heavy snow': return 37;
            case 'light snow showers': return 38;
            case 'heavy snow showers': return 39;
            case 'snow showers clear': return 40;
            case 'snow clear': return 41;
            case 'light snow pellets': return 42;
            case 'heavy snow pellets': return 43;
            case 'light snowstorm': return 44;
            case 'snowstorm': return 45;
            case 'heavy snowstorm': return 46;
            case 'flurries': return 47;
            case 'waterspout': return 48;
            case 'hail': return 49;
            case 'thundershowers': return 50;
            case 'thundershowers hail': return 51;
            case 'thundershowers snow/rain':
            case 'thundershowers rain/snow': return 52;
            case 'thundershowers clear, rain': return 53;
            case 'thundershowers clear, snow': return 54;
            case 'lightning': return 55;
            case 'dry lightning': return 56;
            case 'thunderstorm clear': return 57;
            case 'ice pellets': return 58;
            case 'breezy': return 59;
            case 'humid': return 60;
            case 'windy': return 61;
            case 'dry': return 62;
            case 'dangerously windy': return 63; //LOC_VERY_STRONG_WIND
            case 'sleet': return 64;
            default :
                log.error("Fail weatherStr="+weatherStr);
        }
        return -1;
    };

    return self;
}


module.exports = controllerWorldWeather;
