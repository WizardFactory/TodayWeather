/**
 * Created by aleckim on 2017. 6. 16..
 */

var kmaTimeLib = require('../lib/kmaTimeLib');
var Town = require('../models/town');
var controllerKmaStnWeather = require('../controllers/controllerKmaStnWeather');

function routeText() {
}

routeText.stnWeatherHourly = function (req, res, next) {
    var now = new Date();
    now = kmaTimeLib.toTimeZone(9, now);

    var date = kmaTimeLib.convertDateToYYYYMMDD(now);
    var time = kmaTimeLib.convertDateToHHZZ(now);

    var query = {};
    query["town.third"]  = req.params.town?req.params.town:"";
    query["town.second"]  = req.params.city?req.params.city:"";
    query["town.first"]  = req.params.region?req.params.region:"";

    Town.find(query, {_id:0}).lean().exec(function (err, tList) {
        if (err) {
            return res.status(500).send(err);
        }
        if (tList == undefined || tList.length == 0) {
            err = new Error("Fail to find town query="+JSON.stringify(query));
            log.error(err);
            return res.status(500).send(err.toString());
        }

        try {
            var town = tList[0];
            var coords = [town.gCoord.lon, town.gCoord.lat];
            controllerKmaStnWeather.getStnList(coords, 1, undefined, 1, function (err, stnList) {
                if (err)  {
                    return res.status(500).send(err.toString());
                }

                var stn = stnList[0];
                var fromDate = new Date();
                fromDate = kmaTimeLib.toTimeZone(9, fromDate);
                fromDate.setDate(fromDate.getDate()-8);
                if (fromDate.getMinutes()<4) {
                    fromDate.setHours(fromDate.getHours()-1);
                }
                log.info("fromDate="+fromDate);
                controllerKmaStnWeather.findHourlies2(stn.stnId, fromDate, function (err, stnWeatherList2) {
                    if (err) {
                        return res.status(500).send(err.toString());
                    }
                    controllerKmaStnWeather.findHourlies(stn.stnId, fromDate, function (err, stnWeatherList1) {
                        if (err) {
                            return res.status(500).send(err.toString());
                        }
                        var matched = 0;
                        stnWeatherList1[0].hourlyData.forEach(function (hourlyData, index) {
                            if (stnWeatherList2.length <= index) {
                               return;
                            }
                            if (hourlyData.t1h == stnWeatherList2[index].t1h &&
                                hourlyData.wdd == stnWeatherList2[index].wdd &&
                                hourlyData.wsd == stnWeatherList2[index].wsd &&
                                hourlyData.vec == stnWeatherList2[index].vec)
                            {
                                matched++;
                            }
                        });
                        var result = {};
                        result.fromDate = fromDate;
                        result.list1FromDate = stnWeatherList1[0].hourlyData[0].date;
                        result.list2FromDate = stnWeatherList2[0].date;
                        result.cnt = stnWeatherList2.length;
                        result.matched = matched;
                        result.list1 = stnWeatherList1[0].hourlyData;
                        result.list2 = stnWeatherList2;

                        return res.send(result);
                    });
                });
                //res.send(stnList);
            });
        }
        catch(err) {
            log.error(err);
            return res.status(500).send(err);
        }
    });
};

routeText.stnWeatherMinute = function (req, res, next) {
    var now = new Date();
    now = kmaTimeLib.toTimeZone(9, now);

    var date = kmaTimeLib.convertDateToYYYYMMDD(now);
    var time = kmaTimeLib.convertDateToHHZZ(now);

    var query = {};
    query["town.third"]  = req.params.town?req.params.town:"";
    query["town.second"]  = req.params.city?req.params.city:"";
    query["town.first"]  = req.params.region?req.params.region:"";

    Town.find(query, {_id:0}).lean().exec(function (err, tList) {
        if (err) {
            return res.status(500).send(err.toString());
        }
        if (tList == undefined || tList.length == 0) {
            err = new Error("Fail to find town query="+JSON.stringify(query));
            log.error(err);
            return res.status(500).send(err.toString());
        }

        try {
            var town = tList[0];
            var coords = [town.gCoord.lon, town.gCoord.lat];
            controllerKmaStnWeather.getStnList(coords, 1, undefined, 1, function (err, stnList) {
                if (err)  {
                    return res.status(500).send(err.toString());
                }

                var stn = stnList[0];
                var fromDate = new Date();
                fromDate = kmaTimeLib.toTimeZone(9, fromDate);
                fromDate.setHours(fromDate.getHours()-1);
                controllerKmaStnWeather._getStnMinute2(stn, fromDate, function (err, stnWeatherList2) {
                    if (err) {
                        return res.status(500).send(err.toString());
                    }
                    controllerKmaStnWeather._getStnMinute(stn, fromDate, function (err, stnWeatherList1) {
                        if (err) {
                            return res.status(500).send(err.toString());
                        }
                        var matched = 0;
                        if (stnWeatherList1.t1h == stnWeatherList2.t1h &&
                                stnWeatherList1.reh == stnWeatherList2.reh &&
                                stnWeatherList1.hPa == stnWeatherList2.hPa &&
                                stnWeatherList1.wdd == stnWeatherList2.wdd) {
                           matched++;
                        }

                        var result = {};
                        result.fromDate = fromDate;
                        result.matched = matched;
                        result.weather1 = stnWeatherList1;
                        result.weather2 = stnWeatherList2;
                        return res.send(result);
                    });
                });
                //res.send(stnList);
            });
        }
        catch(err) {
            log.error(err);
            return res.status(500).send(err);
        }
    });
};

module.exports = routeText;
