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
            return;
        }

        if(req.result){
            res.json(req.result);
            return;
        }

        res.json({result: 'Unknow result'});
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
        req.version = req.params.version;

        log.info(meta);

        // todo: To check all version and make way to alternate route.
        if(req.version !== '010000') {
            log.error('WW> It is not valid version :', req.version);
            req.validVersion = false;
            req.error = 'WW> It is not valid version : ' + req.version;
            next();
        }else{
            log.info('WW > go to next step', meta);
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
            log.error('WW> invalid version : ', req.validVersion);
            return next();
        }

        if(!self.isValidCategory(req)){
            return next();
        }

        self.getCode(req);
        self.getCountry(req);
        self.getCity(req);

        if(!req.geocode && !req.city){
            log.error('It is not valid request');
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
                            log.info('WW> load geocode, count:', self.geocodeList.length);
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
                        log.info('WW> matched by city name');
                        callback(null);
                        return;
                    }

                    if(req.geocode !== undefined && self.checkGeocode(req.geocode)){
                        log.info('WW> matched by geocode');
                        callback(null);
                        return;
                    }

                    // Need to send request to add this geocode.
                    req.error = 'WW> It is the fist request, will collect weather for this geocode :', req.geocode, req.city;
                    log.error(req.error);

                    self.requestData(req, 'req_add', function(err, result){
                        if(err){
                            log.error('WW> fail to reqeust');
                            req.error = {res: 'fail', msg:'this is the first request of geocode'};
                            callback('err_exit : Fail to requestData()');
                            return;
                        }

                        // need to update location list
                        // TODO : Perhaps it'll take for long time, so need to find out other way to update.
                        self.loadGeocodeList(function(err){
                            if(err){
                                log.error('WW> Fail to update geocode list, count:', self.geocodeList.length);
                            }else{
                                log.silly('WW> update geocode list, count:', self.geocodeList.length);
                            }

                            req.error = undefined;

                            callback(null);
                        });
                    });
                },
                // 3. get MET data from DB by using geocode.
                function(callback){
                    self.getDataFromMET(req, function(err){
                        log.info('WW> get MET data');

                        // goto next step
                        callback(null);
                    });
                },
                // 4. get OWM data from DB by using geocode
                function(callback){
                    self.getDataFromOWM(req, function(err){
                        log.info('WW> get OWM data');

                        // goto next step
                        callback(null);
                    });
                },
                // 5. get WU data from DB by using geocode
                function(callback){
                    self.getDataFromWU(req, function(err, result){
                        if(err){
                            log.error('WW> Fail to get WU data: ', err);
                            callback(null);
                            return;
                        }
                        log.info('WW> get WU data');

                        // goto next step
                        callback(null);
                    });
                },
                // 6. get DSF data from DB by using geocode.
                function(callback){
                    self.getDataFromDSF(req, function(err, result){
                        if(err){
                            log.error('WW> Fail to get DSF data', err);
                            callback(null);
                            return;
                        }
                        log.info('WW> get DSF data');

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

            log.info('WW> Finish to make weather data');
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

    self._compareDateString = function(first, second){
        //log.info('Compare Date', first, second);

        // YYYY.mm.dd HH:MM
        if(first.slice(0, 13) === second.slice(0, 13)){
            return true;
        }
        return false;
    };


    self._chechHour = function(date, hourList){
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

        if(!req.validVersion){
            log.error('TWW> invalid version : ', req.validVersion);
            return next();
        }

        if(!self.isValidCategory(req)){
            return next();
        }

        self.getCode(req);
        self.getCountry(req);
        self.getCity(req);

        if(!req.geocode && !req.city){
            log.error('It is not valid request');
            req.error = 'It is not valid request';
            next();
            return;
        }

        log.info('TWW> geocode : ', req.geocode);

        async.waterfall([
                function(callback){
                    self.getLocalTimezone(req, function(err){
                        if(err){
                            log.error('Fail to get LocalTimezone : ', err);
                        }
                    });

                    return callback(null);
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
                            log.error('TWW> Fail to get DSF data', err);
                            callback('err_exit_DSF');
                            return;
                        }

                        if(req.DSF === undefined){
                            log.error('TWW> There is no DSF data');
                            callback('err_exit_notValid');
                            return;
                        }

                        if(!self.checkValidDate(cDate, req.DSF.dateObj)){
                            log.error('TWW> Invaild DSF data');
                            log.error('TWW> DSF CurDate : ', cDate.toString());
                            log.error('TWW> DSF DB Date : ', req.DSF.dateObj.toString());
                            callback('err_exit_notValid');
                            return;
                        }

                        log.info('TWW> get DSF data');
                        callback(null);
                    });
                }
            ],
            function(err, result){
                if(err){
                    log.info('There is no correct weather data... try to request');

                    async.waterfall([
                            function(cb){
                                self.requestData(req, 'req_two_days', function(err, result){
                                    if(err){
                                        log.error('TWW> fail to reqeust');
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
                                        log.error('TWW> Fail to get DSF data', err);
                                        cb('err_exit_DSF');
                                        return;
                                    }
                                    log.info('TWW> get DSF data');
                                    cb(null);
                                });
                            }
                        ],
                        function(err, result){
                            if(err){
                                log.info('TWW> Error!!!! : ', err);
                            }else {
                                log.info('TWW> Finish to req&get Two days weather data');
                            }
                            next();
                        }
                    );
                }else{
                    log.silly('TWW> queryWeather no error');
                    log.info('TWW> Finish to get Two days weather data');
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
        var d = date.toString();
        var dateObj = new Date(d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));

        //log.info('dateobj :', dateObj.toString());
        //log.info(''+d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));
        return dateObj;
    };
/**********************************************************
*   WU Util
***********************************************************/
    self.mergeWuForecastData = function(req, res, next){
        var dateString = self._getTimeString(0 - 24).slice(0,10) + '00';
        var startDate = self._getDateObj(dateString);

        if(req.WU.forecast){
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
                log.info('WU SDATE : ', startDate.toString());

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
                                        log.info('MergeWU hourly> Found!! same date');
                                        break;
                                    }
                                }

                                if(index < req.result.hourly.length){
                                    req.result.hourly[i] = self._makehourlyDataFromWU(time);
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
        if(req.WU.current){
            var dateString = self._getTimeString(0 - 48).slice(0,10) + '00';
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
        if(req.WU.current){
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

        if(req.hasOwnProperty('result') === false){
            req.result = {};
        }
        if(req.result.hasOwnProperty('timezone') === false){
            req.result.timezone = {};
        }
        req.result.timezone.min = 0;
        req.result.timezone.ms = 0;

        if(req.geocode.hasOwnProperty('lat') && req.geocode.hasOwnProperty('lon')){
            lat = req.geocode.lat;
            lon = req.geocode.lon;
            timestamp = (new Date()).getTime();
            url = "https://maps.googleapis.com/maps/api/timezone/json";
            url += "?location="+lat+","+lon+"&timestamp="+Math.floor(timestamp/1000);

            request.get(url, {json:true, timeout: 1000 * 20}, function(err, response, body){
                if (err) {
                    log.error('DSF Timezone > Fail to get timezone', err);
                    return callback(err);
                }
                else {
                    try {
                        log.silly(body);
                        var result = body;
                        var offset = (result.dstOffset+result.rawOffset);
                        req.result.timezone.min = offset/60; //convert to min;
                        req.result.timezone.ms = offset * 1000; // convert to millisecond

                        log.info('DSF Timezone > ', req.result.timezone);

                        return callback(0);
                    }
                    catch (e) {
                        log.error(e);
                        return callback(e);
                    }
                }
            });
        }else{
            log.error('there is no geocode from DSF data');
            callback(1);
        }
    };

    self.convertDsfLocalTime = function(req, res, next){

        if(req.DSF && req.result.timezone){
            var dsf = req.DSF;

            dsf.data.forEach(function(dsfItem){
                if(dsfItem.current){
                    var time = new Date();
                    log.info('convert DSF LocalTime > current');
                    time.setTime(dsfItem.current.dateObj.getTime() + req.result.timezone.ms);
                    dsfItem.current.dateObj = self._convertTimeString(time);
                }

                if(dsfItem.hourly){
                    log.info('convert DSF LocalTime > hourly');
                    dsfItem.hourly.data.forEach(function(hourlyItem){
                        var time = new Date();
                        time.setTime(hourlyItem.dateObj.getTime() + req.result.timezone.ms);
                        hourlyItem.dateObj = self._convertTimeString(time);
                    });
                }

                if(dsfItem.daily){
                    log.info('convert DSF LocalTime > daily');
                    dsfItem.daily.data.forEach(function(dailyItem){
                        var time = new Date();
                        time.setTime(dailyItem.dateObj.getTime() + req.result.timezone.ms)
                        dailyItem.dateObj = self._convertTimeString(time);
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

            log.info('DSF Daily> SDate : ', startDate);
            log.info('DSF Daily> CDdate : ', curDate);

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

            log.info('DSF Hourly> SDate : ', startDate);
            log.info('DSF Hourly> yesterday : ', yesterdayDate);
            log.info('DSF Hourly> CDate : ', curDate);

            dsf.data.forEach(function(item){
                item.hourly.data.forEach(function(dbItem){
                    var isExist = false;
                    if(self._compareDateString(yesterdayDate, dbItem.dateObj)){
                        req.result.thisTime.forEach(function(thisTime, index){
                            if(thisTime.date != undefined &&
                                self._compareDateString(yesterdayDate, thisTime.date)){
                                req.result.thisTime[index] = self._makeCurrentDataFromDSFCurrent(dbItem);
                                isExist = true;
                            }
                        });

                        if(!isExist){
                            log.info('DSF yesterday > Found yesterday data', dbItem.dateObj);
                            req.result.thisTime.push(self._makeCurrentDataFromDSFCurrent(dbItem));
                        }
                    }

                    isExist = false;
                    if(self._chechHour(dbItem.dateObj, ['00','03','06','09','12','15','18','21','24']) &&
                        new Date(dbItem.dateObj).getTime() >= new Date(startDate).getTime()){
                        req.result.hourly.forEach(function(hourly, index){
                            //log.info('hourlyItem : ', hourly.date.toString());
                            if(self._compareDateString(hourly.date, dbItem.dateObj)){
                                req.result.hourly[index] = self._makeHourlyDataFromDSF(dbItem);
                                isExist = true;
                            }
                        });
                        if(!isExist){
                            //log.info('NEW! DSF -> Hourly : ', dbItem.dateObj.toString());
                            req.result.hourly.push(self._makeHourlyDataFromDSF(dbItem));
                        }
                    }
                });
            });
        }
        next();
    };

    self.mergeDsfCurrentData = function(req, res, next) {
        if (req.DSF && req.DSF.data) {
            var timeOffset = req.result.timezone.min / 60;
            var startDate = self._getTimeString(0 - 48 + timeOffset).slice(0,14) + '00';
            var curDate = self._getTimeString(timeOffset).slice(0, 14) + '00';

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

            log.info('DSF current> SDate : ', startDate);
            log.info('DSF current> CDdate : ', curDate);

            dsf.data.forEach(function (item) {
                var isExist = false;
                if(self._compareDateString(curDate, item.current.dateObj)){
                    req.result.thisTime.forEach(function(thisTime, index) {
                        if (thisTime.date != undefined &&
                            self._compareDateString(curDate, thisTime.date)){
                            req.result.thisTime[index] = self._makeCurrentDataFromDSFCurrent(item.current);
                            isExist = true;
                        }
                    });

                    if(!isExist){
                        log.info('DSF current > Found current data', item.current.dateObj.toString());
                        req.result.thisTime.push(self._makeCurrentDataFromDSFCurrent(item.current));
                    }
                }

            });
        }

        next();
    };

    self.dataSort = function(req, res, next){
        if(req.result.thisTime){
            log.info('sort thisTime');
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
            log.info('sort hourly');
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
            log.info('sort daily');
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
        if(summary.pre_type == 'rain'){
            day.precType += 1;
        }
        if(summary.pre_type == 'snow'){
            day.precType += 2;
        }

        if(summary.pre_pro){
            day.precProb = Math.round(summary.pre_pro * 100);
        }
        if(summary.pre_int){
            day.precip = summary.pre_int;
        }
        if(summary.humid){
            day.humid = Math.round(summary.humid * 100);
        }
        if(summary.windspd){
            day.windSpd_mh = Math.round(summary.windspd * 1609.344);
            day.windSpd_ms = +((summary.windspd * 0.44704).toFixed(2));
        }
        if(summary.winddir){
            day.windDir = summary.winddir;
        }
        if(summary.pres){
            day.press = summary.pres;
        }
        if(summary.vis){
            day.vis = Math.round(summary.vis * 1.16093);
        }

        return day;
    };

    self._makeHourlyDataFromDSF = function(summary){
        var hourly = {};

        if(summary.date){
            hourly.date = summary.date;
        }
        if(summary.dateObj){
            hourly.date = summary.dateObj;
        }
        if(summary.summary){
            hourly.desc = summary.summary;
        }
        if(summary.temp){
            hourly.temp_c = parseFloat(((summary.temp - 32) / (9/5)).toFixed(1));
            hourly.temp_f = parseFloat(summary.temp.toFixed(1));
        }
        if(summary.ftemp){
            hourly.ftemp_c = parseFloat(((summary.ftemp - 32) / (9/5)).toFixed(1));
            hourly.ftemp_f = parseFloat(summary.ftemp.toFixed(1));
        }
        if(summary.cloud){
            hourly.cloud = Math.round(summary.cloud * 100);
        }
        if(summary.windspd){
            hourly.windSpd_mh = Math.round(summary.windspd * 1609.344);
            hourly.windSpd_ms = +((summary.windspd * 0.44704).toFixed(2));
        }
        if(summary.winddir){
            hourly.windDir = summary.winddir;
        }
        if(summary.humid){
            hourly.humid = Math.round(summary.humid * 100);
        }
        hourly.precType = 0;
        if(summary.pre_type == 'rain'){
            hourly.precType += 1;
        }
        if(summary.pre_type == 'snow'){
            hourly.precType += 2;
        }
        if(summary.pre_pro){
            hourly.precProb = parseFloat((summary.pre_pro * 100).toFixed(2));
        }
        if(summary.pre_int){
            hourly.precip = summary.pre_int;
        }
        if(summary.vis){
            hourly.vis = Math.round(summary.vis * 1.16093);
        }
        if(summary.pres){
            hourly.press = summary.pres;
        }
        if(summary.oz){
            hourly.oz = summary.oz;
        }

        return hourly;
    };

    self._makeCurrentDataFromDSFCurrent = function(summary){
        var current = {};

        if(summary.date){
            current.date = summary.date;
        }
        if(summary.dateObj){
            current.date = summary.dateObj;
        }
        if(summary.summary){
            current.desc = summary.summary;
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
            current.windSpd_mh = Math.round(summary.windspd * 1609.344);
            current.windSpd_ms = +((summary.windspd * 0.44704).toFixed(2));
        }
        if(summary.winddir){
            current.windDir = summary.winddir;
        }
        if(summary.humid){
            current.humid = Math.round(summary.humid * 100);
        }
        current.precType = 0;
        if(summary.pre_type == 'rain'){
            current.precType += 1;
        }
        if(summary.pre_type == 'snow'){
            current.precType += 2;
        }
        if(summary.pre_pro){
            current.precProb = parseFloat((summary.pre_pro * 100).toFixed(2));
        }
        if(summary.pre_int){
            current.precip = parseFloat(summary.pre_int.toFixed(2));
        }
        if(summary.vis){
            current.vis = Math.round(summary.vis * 1.16093);
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
            log.error('WW> wrong goecode : ', geocode);
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
            log.silly('WW> can not find country name from qurey');
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
            log.silly('WW> can not find city name from qurey');
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
                    modelWuCurrent.find({geocode:geocode}, function(err, list){
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
                    modelWuForecast.find({geocode:geocode}, function(err, list){
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
        var geocode = {
            lat: parseFloat(req.geocode.lat),
            lon: parseFloat(req.geocode.lon)
        };

        modelDSForecast.find({geocode:geocode}, function(err, list){
            if(err){
                log.error('gDSF> fail to get DSF data');
                callback(err);
                return;
            }

            if(list.length === 0){
                log.error('gDSF> There is no DSF data for ', geocode);
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

        if(req.result.timezone.min){
            url += '&timezone=' + req.result.timezone.min / 60;
        }else{
            url += '&timezone=0';
        }

        log.info('WW> req url : ', url);
        try{
            request.get(url, {timeout: 1000 * 20}, function(err, response, body){
                if(err){
                    log.error('WW> Fail to request adding geocode to db');
                    callback(err);
                    return;
                }

                var result = JSON.parse(body);
                log.info('WW> request success');
                log.info(result);
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

    return self;
}


module.exports = controllerWorldWeather;