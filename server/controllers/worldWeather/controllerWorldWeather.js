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

        if(cDate.getDay() != sDate.getDay()) {
            return false;
        }

        if(cDate.getHours() != sDate.getHours()) {
            return false;
        }

        return true;
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
            self._leadingZeros(now.getFullYear(), 4) +
            self._leadingZeros(now.getMonth() + 1, 2) +
            self._leadingZeros(now.getDate(), 2) +
            self._leadingZeros(now.getHours(), 2) +
            self._leadingZeros(now.getMinutes(), 2);

        return result;
    };

    self._getDateObj = function(date){
        var d = date.toString();
        var dateObj = new Date(d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));

        //log.info('dateobj :', dateObj.toString());
        //log.info(''+d.slice(0,4)+'/'+d.slice(4,6)+'/'+ d.slice(6,8)+' '+d.slice(8,10)+':'+ d.slice(10,12));
        return dateObj;
    };

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

                        if(req.result.timely === undefined){
                            req.result.timely = [];
                        }

                        item.forecast.forEach(function(time){
                            var index = -1;

                            //log.info('MG WU timely > item', time.dateObj.toString());
                            if(time.dateObj.getTime() >= startDate.getTime()){
                                for(var i=0 ; i<req.result.timely.length ; i++){
                                    if(req.result.timely[i].date.getYear() === time.dateObj.getYear() &&
                                        req.result.timely[i].date.getMonth() === time.dateObj.getMonth() &&
                                        req.result.timely[i].date.getDay() === time.dateObj.getDay() &&
                                        req.result.timely[i].date.getHours() === time.dateObj.getHours()){
                                        index = i;
                                        log.info('MergeWU Timely> Found!! same date');
                                        break;
                                    }
                                }

                                if(index < req.result.timely.length){
                                    req.result.timely[i] = self._makeTimelyDataFromWU(time);
                                }
                                else{
                                    req.result.timely.push(self._makeTimelyDataFromWU(time));
                                }
                            }
                        });
                    }
                });
            }
        }

        next();
    };

    self.mergeWuCurrentDataToTimely = function(req, res, next){
        if(req.WU.current){
            var dateString = self._getTimeString(0 - 48).slice(0,10) + '00';
            var startDate = self._getDateObj(dateString);

            var list = req.WU.current.dataList;
            var curDate = new Date();
            log.info('MG WuCToTimely> curDate ', curDate.toString());

            if(req.result.timely === undefined){
                req.result.timely = [];
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
                if(curItem.dateObj && curItem.dateObj.getTime() > curDate.getTime()){
                    log.info('MG WuCToTimely> skip future data', curItem.dateObj.toString());
                    return;
                }

                // 과거 2일까지의 데이터만처리 한다. timely data는 과거 1~2일 데이터만 필요함.
                if(curItem.dateObj && curItem.dateObj.getTime() < startDate.getTime()){
                    log.info('MG WuCToTimely> skip past data', curItem.dateObj.toString());
                    return;
                }

                for(var i=0 ; i<req.result.timely.length ; i++){
                    if(req.result.timely[i].dateObj != undefined &&
                        req.result.timely[i].dateObj.getTime() === curItem.dateObj.getTime()){
                        isExist = 1;
                        if(curItem.desc){
                            req.result.timely[i].desc = curItem.desc;
                        }
                        if(curItem.temp){
                            req.result.timely[i].temp_c = curItem.temp;
                        }
                        if(curItem.temp_f){
                            req.result.timely[i].temp_f = curItem.temp_f;
                        }
                        if(curItem.ftemp){
                            req.result.timely[i].ftemp_c = curItem.ftemp;
                        }
                        if(curItem.ftemp_f){
                            req.result.timely[i].ftemp_f = curItem.ftemp_f;
                        }
                        if(curItem.humid){
                            req.result.timely[i].humid = curItem.humid;
                        }
                        if(curItem.windspd){
                            req.result.timely[i].windSpd_ms = curItem.windspd;
                        }
                        if(curItem.windspd_mh){
                            req.result.timely[i].windSpd_mh = curItem.windspd_mh;
                        }
                        if(curItem.winddir){
                            req.result.timely[i].windDir = curItem.winddir;
                        }
                        if(curItem.cloud){
                            req.result.timely[i].cloud = curItem.cloud;
                        }
                        if(curItem.vis){
                            req.result.timely[i].vis = curItem.vis;
                        }
                        if(curItem.slp){
                            req.result.timely[i].press = curItem.slp;
                        }
                    }
                }
                if(isExist === 0){
                    req.result.timely.push(self._makeTimelyDataFromWUCurrent(curItem));
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
                    && curItem.dateObj.getDay() === curDate.getDay()
                    && curItem.dateObj.getHours() === curDate.getHours()){
                    log.info('MG WuC> Find matched current date', curItem.dateObj.toString());

                    req.result.current = self._makeTimelyDataFromWUCurrent(curItem);
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

            if(req.result.timely === undefined){
                req.result.timely = [];
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
        var dateString = self._getTimeString(0 - 48).slice(0,10) + '00';
        var startDate = self._getDateObj(dateString);
        var cDate = new Date();

        if(req.DSF && req.DSF.data){
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

            log.info('DSF Daily> SDate : ', startDate.toString());
            log.info('DSF Daily> CDdate : ', cDate.toString());

            dsf.data.forEach(function(item){
                item.daily.data.forEach(function(dbItem){
                    var isExist = false;
                    if(dbItem.dateObj >= startDate && dbItem.dateObj < cDate){
                        req.result.daily.forEach(function(dailyItem){
                            //log.info('dailyItem : ', dailyItem.date.toString());
                            if(dailyItem.date.getYear() === dbItem.dateObj.getYear() &&
                                dailyItem.date.getMonth() === dbItem.dateObj.getMonth() &&
                                dailyItem.date.getDay() === dbItem.dateObj.getDay() &&
                                dailyItem.date.getHours() === dbItem.dateObj.getHours()){
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
        var dateString = self._getTimeString(0 - 48).slice(0,10) + '00';
        var startDate = self._getDateObj(dateString);
        var cDate = new Date();

        if(req.DSF && req.DSF.data){
            if(req.result === undefined){
                req.resutl = {};
            }

            var dsf = req.DSF;

            if(req.result.location === undefined){
                req.result.location = {};
                req.result.location.lat = dsf.geocode.lat;
                req.result.location.lon = dsf.geocode.lon;
            }

            if(req.result.timely === undefined){
                req.result.timely = [];
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

            log.info('DSF Hourly> SDate : ', startDate.toString());
            log.info('DSF Hourly> CDdate : ', cDate.toString());

            dsf.data.forEach(function(item){
                item.hourly.data.forEach(function(dbItem){
                    var isExist = false;
                    if(dbItem.dateObj >= startDate && dbItem.dateObj < cDate){
                        req.result.timely.forEach(function(timely){
                            //log.info('hourlyItem : ', timely.date.toString());
                            if(timely.date.getYear() === dbItem.dateObj.getYear() &&
                                timely.date.getMonth() === dbItem.dateObj.getMonth() &&
                                timely.date.getDay() === dbItem.dateObj.getDay() &&
                                timely.date.getHours() === dbItem.dateObj.getHours()){
                                isExist = true;
                            }
                        });
                        if(!isExist){
                            //log.info('NEW! DSF -> Hourly : ', dbItem.dateObj.toString());
                            req.result.timely.push(self._makeTimelyDataFromDSF(dbItem));
                        }
                    }
                });
            });
        }
        next();
    };

    self.dataSort = function(req, res, next){
        if(req.result.timely){
            log.info('sort timely');
            req.result.timely.sort(function(a, b){
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

    self._makeTimelyDataFromWUCurrent = function(time){
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

    self._makeTimelyDataFromWU = function(time){
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
            result.temp_f = time.tmp_f
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
            day.windSpd_ms = summary.windspdmax;
        }
        if(summary.windspdmax_mh){
            day.windSpd_mh = summary.windspdmax_mh;
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
            day.tempMax_c = (summary.temp_max - 32) / (9/5);
            day.tempMax_f = summary.temp_max;
        }

        if(summary.temp_min){
            day.tempMin_c = (summary.temp_min - 32) / (9/5);
            day.tempMin_f = summary.temp_min;
        }
        if(summary.ftemp_max){
            day.ftempMax_c = (summary.ftemp_max - 32) / (9/5);
            day.ftempMax_f = summary.ftemp_max;
        }
        if(summary.ftemp_min){
            day.ftempMin_c = (summary.ftemp_min - 32) / (9/5);
            day.ftempMin_f = summary.ftemp_min;
        }

        day.precType = 0;
        if(summary.pre_type == 'rain'){
            day.precType += 1;
        }
        if(summary.pre_type == 'snow'){
            day.precType += 2;
        }

        if(summary.pre_pro){
            day.precProb = summary.pre_pro * 100;
        }
        if(summary.pre_int){
            day.precip = summary.pre_int;
        }
        if(summary.humid){
            day.humid = summary.humid;
        }
        if(summary.windspd){
            day.windSpd_mh = summary.windspd;
            day.windSpd_ms = summary.windspd * 0.44704;
        }
        if(summary.pres){
            day.press = summary.pres;
        }
        if(summary.vis){
            day.vis = ((summary.vis * 1.16093) * 10) / 10;
        }

        return day;
    };

    self._makeTimelyDataFromDSF = function(summary){
        var timely = {};

        if(summary.date){
            timely.date = summary.date;
        }
        if(summary.dateObj){
            timely.date = summary.dateObj;
        }
        if(summary.summary){
            timely.desc = summary.summary;
        }
        if(summary.temp){
            timely.temp_c = (summary.temp - 32) / (9/5);
            timely.temp_f = summary.temp;
        }
        if(summary.ftemp){
            timely.ftemp_c = (summary.ftemp - 32) / (9/5);
            timely.ftemp_f = summary.ftemp;
        }
        if(summary.cloud){
            timely.cloud = summary.cloud;
        }
        if(summary.windspd){
            timely.windSpd_mh = summary.windspd;
            timely.windSpd_ms = summary.windspd * 0.44704;
        }
        if(summary.humid){
            timely.humid = summary.humid;
        }
        timely.precType = 0;
        if(summary.pre_type == 'rain'){
            timely.precType += 1;
        }
        if(summary.pre_type == 'snow'){
            timely.precType += 2;
        }
        if(summary.pre_pro){
            timely.precProb = summary.pre_pro * 100;
        }
        if(summary.pre_int){
            timely.precip = summary.pre_int;
        }
        if(summary.vis){
            timely.vis = ((summary.vis * 1.16093) * 10) / 10;
        }
        if(summary.pres){
            timely.press = summary.press;
        }
        if(summary.oz){
            timely.oz = summary.oz;
        }

        return timely;
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

        log.info('WW> req url : ', url);
        try{
            request.get(url, {timeout: 1000 * 20}, function(err, response, body){
                if(err){
                    log.error('WW> Fail to request adding geocode to db');
                    callback(err);
                    return;
                }

                var result = JSON.parse(body);
                log.silly('WW> request success');
                log.silly(result);
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