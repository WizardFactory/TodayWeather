angular.module('service.weatherutil', [])
    .factory('WeatherUtil', function ($q, $http, Util, Units) {
        var obj = {};

        //region Function

        /**
         * sun/moon/cloud + big/small cloud + rain + snow + lighting
         * @param {Number} sky 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1
         * @param {Number} pty 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1
         * @param {Number} lgt 없음(0) 있음(1), invalid : -1
         * @param {Boolean} isNight
         */
        function parseSkyState(sky, pty, lgt, isNight) {
            var skyIconName = "";

            if (isNight) {
                skyIconName = "Moon";
            }
            else {
                skyIconName = "Sun";
            }

            switch (sky) {
                case 1:
                    skyIconName += "";
                    break;
                case 2:
                    skyIconName += "SmallCloud";
                    break;
                case 3:
                    skyIconName += "BigCloud";
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
                    skyIconName += "";
                    break;
                case 1:
                    skyIconName += "Rain";
                    break;
                case 2:
                    skyIconName += "RainSnow";
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
        }

        /**
         * target에 시간이 가지고 있으면, 값 차이가 발생함.
         * @param {Date} target
         * @param {Date} current
         * @returns {number}
         */
        function getDiffDays(target, current) {
            if (!target || !current) {
                console.log("target or current is invalid");
                return 0;
            }
            var targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate())
            var date = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            return Math.ceil((targetDay - date) / (1000 * 3600 * 24));
        }

        /**
         * YYYYMMDD
         * @param {String} str
         * @returns {*}
         */
        function convertStringToDate(str) {
            var y = str.substr(0, 4),
                m = str.substr(4, 2) - 1,
                d = str.substr(6, 2);
            var data = new Date(y, m, d);
            return (data.getFullYear() == y && data.getMonth() == m && data.getDate() == d) ? data : undefined;
        }

        function convertMidSkyString(skyInfo) {
            switch (skyInfo) {
                case "맑음":
                    return "Sun";
                    break;
                case "구름조금":
                    return "SunSmallCloud";
                    break;
                case "구름많음":
                    return "SunBigCloud";
                    break;
                case "흐림":
                    return "Cloud";
                    break;
                case "흐리고 한때 비":
                case "흐리고 비":
                    return "CloudRain";
                case "구름적고 한때 비":
                case "구름적고 비":
                    return "SunSmallCloudRain";
                case "구름많고 한때 비":
                case "구름많고 비":
                    return "SunBigCloudRain";
                    break;
                case "흐리고 한때 눈":
                case "흐리고 눈":
                    return "CloudSnow";
                case "구름적고 한때 눈":
                case "구름적고 눈":
                    return "SunSmallCloudSnow";
                case "구름많고 한때 눈":
                case "구름많고 눈":
                    return "SunBigCloudSnow";
                    break;
                case "구름적고 비/눈":
                case "구름적고 눈/비":
                    return "SunSmallCloudRainSnow";
                case "구름많고 비/눈":
                case "구름많고 눈/비":
                    return "SunBigCloudRainSnow";
                case "흐리고 비/눈":
                case "흐리고 눈/비":
                    return "CloudRainSnow";
            }

            console.log("Fail to convert skystring=" + skyInfo);
            return "";
        }

        function getHighPrioritySky(sky1, sky2) {

            if (sky1.indexOf("RainSnow") != -1) {
                return sky1;
            }
            if (sky2.indexOf("RainSnow") != -1) {
                return sky2;
            }

            if (sky1.indexOf("Rain") != -1 && sky2.indexOf("Snow") != -1) {
                return sky1 + "Snow";
            }

            if (sky1.indexOf("Snow") != -1 && sky2.indexOf("Rain") != -1) {
                return sky2 + "Snow";
            }

            return sky1;
        }

        function decideHumidityIcon(reh) {
            var tempIconName = "Humidity-";

            if (reh == 100) {
                tempIconName += "90";
            }
            else {
                tempIconName += parseInt(reh / 10) * 10;
            }
            return tempIconName;
        }

        /**
         * It's supporting only korean lang
         * @param {Object[]} results
         * @returns {string}
         */
        function findDongAddressFromGoogleGeoCodeResults(results) {
            var dongAddress = "";
            var length = 0;

            results.forEach(function (result) {
                var lastChar = result.formatted_address.slice(-1);
                if (lastChar === "동" || lastChar === "읍" || lastChar === "면")  {
                    var arrayStr = result.formatted_address.split(" ");
                    var secondLastChar = arrayStr[arrayStr.length-2].slice(-1);
                    if (secondLastChar === "시" || secondLastChar === "군" || secondLastChar === "구")  {
                        if(length < result.formatted_address.length) {
                            dongAddress = result.formatted_address;
                            length = result.formatted_address.length;
                        }
                    }
                }
            });

            if (dongAddress.length === 0) {
                console.log("Fail to find index of dong from="+results[0].formatted_address);
            }
            return dongAddress;
        }

        /**
         *
         * @param {Object[]} results
         * @returns {*}
         */
        function findLocationFromGoogleGeoCodeResults(results) {
            var location; //{"lat": Number, "long": Number};

            if (results.length == 0) {
                console.log("result.length = 0");
                return location;
            }
            if (results[0].geometry && results[0].geometry.location) {
                location = {};
                location.lat = results[0].geometry.location.lat;
                location.long = results[0].geometry.location.lng;
            }
            else {
                console.log("fail to parsing results");
            }

            return location;
        }

        function _retryGetHttp(retryCount, url, callback) {
            var retryTimeId = setTimeout(function () {
                retryCount--;
                if (retryCount > 0) {
                    _retryGetHttp(retryCount, url, callback);
                }
            }, 2000);

            console.log("retry="+retryCount+" get http");
            $http({method: 'GET', url: url, timeout: 10000})
                .success(function (data, status, headers, config, statusText) {
                    console.log("status="+status);
                    clearTimeout(retryTimeId);
                    console.log('clear timeout = '+ retryTimeId);
                    callback(undefined, data);
                })
                .error(function (data, status, headers, config, statusText) {
                    if (!data) {
                        data = data | "Fail to get weatherInfo";
                    }
                    console.log(status +":"+data);
                    console.log('clear timeout = '+ retryTimeId);
                    clearTimeout(retryTimeId);
                    var error = new Error(data);
                    error.code = status;
                    callback(error);
                });
        }

        /**
         * http://localhost:3000/ww/010000/current/2?gcode=44.0,30.00
         * @param location
         * @returns {*}
         */
        function getGeoWeatherInfo (location) {
            var deferred = $q.defer();
            var url = twClientConfig.serverUrl + '/ww/010000/current/2';
            url += "?gcode=" + location.lat + ','+location.long;

            console.log(url);
            $http({method: 'GET', url: url, timeout: 10*1000})
                .success(function (data) {
                    deferred.resolve({data : data});
                })
                .error(function (error) {
                    if (!error) {
                        error = new Error("Fail to get geo weather info");
                    }
                    console.log(error);
                    deferred.reject(error);
                });
            return deferred.promise;
        }

        function getTownWeatherInfo (town) {
            var deferred = $q.defer();
            var url = twClientConfig.serverUrl +'/v000803/town';

            url += "/" + town.first;
            if (town.second) {
                url += "/" + town.second;
            }
            if (town.third) {
                url += "/" + town.third;
            }
            console.log(url);

            _retryGetHttp(5, url, function (error, data) {
                if (error != undefined) {
                    return deferred.reject(error);
                }
                deferred.resolve({data: data});
            });

            return deferred.promise;
        }
        //endregion

        //region APIs
        /**
         * wsd : 풍속 4~8 약간 강, 9~13 강, 14~ 매우강
         * pm10Value, pm10Grade
         * {date: String, lgt: Number, mx: Number, my: Number, pty: Number, reh: Number, rn1: Number,
         *          sky: Number, t1h: Number, time: String, uuu: Number, vec: Number, vvv: Number,
         *          wsd: Number}
         * @param {Object} currentTownWeather
         * @returns {{}}
         */
        obj.parseCurrentTownWeather = function (currentTownWeather, units) {
            var currentForecast = {};
            var time;
            var isNight;

            if (!currentTownWeather) {
                return currentForecast;
            }
            time = parseInt(currentTownWeather.time.substr(0, 2));
            isNight = time < 7 || time > 18;
            currentForecast = currentTownWeather;
            //time is used in ngShortChart
            currentForecast.time = time;

            if (currentForecast.skyIcon == undefined) {
                currentForecast.skyIcon = parseSkyState(currentTownWeather.sky, currentTownWeather.pty,
                    currentTownWeather.lgt, isNight);
            }

            if (units.temperatureUnit != Units.getUnit('temperatureUnit')) {
                currentForecast.t1h = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.t1h);
                currentForecast.sensorytem = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.sensorytem);
                currentForecast.dpt = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.dpt);
                currentForecast.heatIndex = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.heatIndex);
                if (!(currentForecast.yesterday == undefined)) {
                    currentForecast.yesterday.t1h = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.yesterday.t1h);
                }
            }

            if (currentForecast.pty == 3 && currentForecast.rn1) {
                currentForecast.rn1 *= 10;
            }
            if (currentForecast.s1d) {
                currentForecast.s1d *= 10;
            }

            if (units.precipitationUnit != Units.getUnit('precipitationUnit')) {
                currentForecast.rn1 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), currentForecast.rn1);
                currentForecast.rs1h = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), currentForecast.rs1h);
                currentForecast.rs1d = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), currentForecast.rs1d);
                currentForecast.r1d = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), currentForecast.r1d);
                if (!(currentForecast.yesterday == undefined)) {
                    if (currentForecast.yesterday.pty == 3) {
                        currentForecast.yesterday.rn1 *= 10;
                    }
                    if (currentForecast.yesterday.s1d) {
                       currentForecast.yesterday.s1d *= 10;
                    }
                    currentForecast.yesterday.rn1 = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.yesterday.rn1);
                }
            }
            if (units.windSpeedUnit != Units.getUnit('windSpeedUnit')) {
                currentForecast.wsd = Units.convertUnits(units.windSpeedUnit, Units.getUnit('windSpeedUnit'), currentForecast.wsd);
                if (!(currentForecast.yesterday == undefined)) {
                    currentForecast.yesterday.wsd = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), currentForecast.yesterday.wsd);
                }
            }
            if (units.pressureUnit != Units.getUnit('pressureUnit')) {
                currentForecast.hPa = Units.convertUnits(units.pressureUnit, Units.getUnit('pressureUnit'), currentForecast.hPa);
            }
            if (units.distanceUnit != Units.getUnit('distanceUnit')) {
                currentForecast.visibility = Units.convertUnits(units.distanceUnit, Units.getUnit('distanceUnit'), currentForecast.visibility);
            }

            return currentForecast;
        };

        /**
         * @param {Object[]} shortForecastList
         * @param {Object} currentForecast
         * @returns {{timeTable: Array, timeChart: Array}}
         */
        obj.parseShortTownWeather = function (shortForecastList, currentForecast, units) {
            var data = [];

            if (!shortForecastList || !Array.isArray(shortForecastList)) {
                return {timeTable: [], timeChart: []};
            }

            var currentIndex = -1;
            var displayItemCount = 0;

            shortForecastList.every(function (shortForecast, index) {
                var tempObject;
                var time = parseInt(shortForecast.time.slice(0, -2));
                var diffDays = getDiffDays(convertStringToDate(shortForecast.date), convertStringToDate(currentForecast.date));
                var isNight = time < 7 || time > 18;

                tempObject = shortForecast;

                if (tempObject.skyIcon == undefined) {
                    tempObject.skyIcon = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, isNight);
                }

                tempObject.fromToday = diffDays;
                tempObject.time = time;

                if (currentForecast.date == tempObject.date && currentForecast.time == tempObject.time) {
                    currentIndex = index;
                    shortForecastList[index].currentIndex = true;
                }
                else if (currentForecast.date == tempObject.date && currentForecast.time > tempObject.time) {
                    if (index == shortForecastList.length-1) {
                        currentIndex = index;
                        tempObject.currentIndex = true;
                    }
                    else {
                        var nextTime = parseInt(shortForecastList[index+1].time.slice(0, -2));
                        if (currentForecast.time < nextTime) {
                            currentIndex = index;
                            shortForecastList[index].currentIndex = true;
                        }
                    }
                }
                else if (currentForecast.time < 3) {
                    if (currentForecast.date == tempObject.date && shortForecastList[index-1].date != currentForecast.date) {
                        shortForecastList[index-1].currentIndex = true;
                        currentIndex = index-1;
                    }
                }

                var tmpDisplayCount = 0;
                //data on chart from yesterday
                if (diffDays > -2) {
                    if (tempObject.skyIcon != undefined) {
                        tmpDisplayCount++;
                    }
                    if (tempObject.pop && tempObject.pop > 0) {
                        tmpDisplayCount++;
                    }
                    if (displayItemCount == 2) {
                        if ((tempObject.rn1 && tempObject.rn1 > 0)
                            || (tempObject.r06 && tempObject.r06 > 0)
                            || (tempObject.s06 && tempObject.s06 > 0)) {
                            tmpDisplayCount++;
                        }
                    }
                    if (tmpDisplayCount > displayItemCount) {
                        displayItemCount = tmpDisplayCount;
                    }
                }

                if (units.temperatureUnit != Units.getUnit('temperatureUnit')) {
                    tempObject.t3h = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.t3h);
                    tempObject.tmn = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.tmn);
                    tempObject.tmx = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.tmx);
                    tempObject.sensorytem = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.sensorytem);
                    tempObject.heatIndex = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.heatIndex);
                }

                if (tempObject.pty == 3 && tempObject.rn1) {
                    tempObject.rn1 *= 10;
                }
                if (tempObject.s06) {
                    tempObject.s06 *= 10;
                }

                if (units.precipitationUnit != Units.getUnit('precipitationUnit')) {
                    tempObject.r06 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), tempObject.r06);
                    tempObject.s06 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), tempObject.s06);
                    tempObject.rn1 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), tempObject.rn1);
                }

                if (units.windSpeedUnit != Units.getUnit('windSpeedUnit')) {
                    tempObject.wsd = Units.convertUnits(units.windSpeedUnit, Units.getUnit('windSpeedUnit'), tempObject.wsd);
                }

                data.push(tempObject);

                return true;
            });

            var timeTable = data.slice(8);
            var timeChart = [
                {
                    name: "yesterday",
                    values: data.slice(0, data.length - 8).map(function (d) {
                        return {name: "yesterday", value: d};
                    })
                },
                {
                    name: "today",
                    values: data.slice(8).map(function (d) {
                        return {name: "today", value: d};
                    }),
                    currentIndex: currentIndex - 8,
                    displayItemCount: displayItemCount
                }
            ];

            return {timeTable: timeTable, timeChart: timeChart};
        };
        
        /**
         * 식중독, ultra 자외선,
         * @param midData
         * @param currentTime
         * @returns {Array}
         */
        obj.parseMidTownWeather = function (midData, currentTime, units) {
            var tmpDayTable = [];
            var displayItemCount = 0;
            var todayInfo;

            if (!midData || !midData.hasOwnProperty('dailyData') || !Array.isArray(midData.dailyData)) {
                return {displayItemCount: displayItemCount, dayTable: tmpDayTable};
            }
            midData.dailyData.forEach(function (dayInfo, index) {
                var data;
                data = dayInfo;

                var diffDays = getDiffDays(convertStringToDate(data.date), currentTime);

                data.fromToday = diffDays;
                data.dayOfWeek = convertStringToDate(data.date).getDay();

                data.skyAm = dayInfo.skyAmIcon;
                data.skyPm = dayInfo.skyPmIcon;
                if (data.skyAm == undefined) {
                    data.skyAm = convertMidSkyString(dayInfo.wfAm);
                }
                if (data.skyPm == undefined) {
                    data.skyPm = convertMidSkyString(dayInfo.wfPm);
                }
                if (data.skyIcon == undefined) {
                    data.skyIcon = getHighPrioritySky(skyAm, skyPm);
                }

                data.tmx = dayInfo.taMax;
                data.tmn = dayInfo.taMin;

                if (units.temperatureUnit != Units.getUnit('temperatureUnit')) {
                    data.tmx = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), data.tmx);
                    data.tmn = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), data.tmn);
                }

                if (data.pty == 3 && data.rn1) {
                    //convert cm to mm of snow
                    data.rn1 *= 10;
                }
                if (data.s06) {
                    data.s06 *= 10;
                }

                if (units.precipitationUnit != Units.getUnit('precipitationUnit')) {
                    data.rn1 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), data.rn1);
                    data.r06 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), data.r06);
                    data.s06 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), data.s06);
                }
                if (units.windSpeedUnit != Units.getUnit('windSpeedUnit')) {
                    data.wsd = Units.convertUnits(units.windSpeedUnit, Units.getUnit('windSpeedUnit'), data.wsd);
                }

                if (data.reh !== undefined) {
                    data.humidityIcon = decideHumidityIcon(data.reh);
                }
                else {
                    data.humidityIcon = "Humidity-00";
                }

                if (diffDays == 0) {
                    todayInfo = data;
                    todayInfo.index = index;
                }

                tmpDayTable.push(data);

                var tmpDisplayCount = 0;

                if (data.skyAm != undefined || data.skyPm != undefined) {
                    if (data.skyAm != data.skyPm && data.skyAm && data.skyPm) {
                        tmpDisplayCount = tmpDisplayCount | 4;
                    }
                }

                if (data.pop && data.pop > 0 && data.fromToday >= 0) {
                    tmpDisplayCount = tmpDisplayCount | 2;
                }
                if ((data.rn1 && data.rn1 > 0)
                    || (data.r06 && data.r06 > 0)
                    || (data.s06 && data.s06 > 0)) {
                    tmpDisplayCount = tmpDisplayCount | 1;
                }
                if (tmpDisplayCount > displayItemCount) {
                    displayItemCount = tmpDisplayCount;
                }

                if (!(data.dustForecast == undefined)) {
                    if (!(data.dustForecast.PM10Grade == undefined)) {
                        data.dustForecast.pm10Grade = data.dustForecast.PM10Grade+1;
                    }
                    if (!(data.dustForecast.PM25Grade == undefined)) {
                        data.dustForecast.pm25Grade = data.dustForecast.PM25Grade+1;
                    }
                    if (!(data.dustForecast.O3Grade == undefined)) {
                        data.dustForecast.o3Grade = data.dustForecast.O3Grade+1;
                    }
                }
            });

            //console.log(tmpDayTable);
            return {displayItemCount: displayItemCount, dayTable: tmpDayTable, today: todayInfo};
        };

        /**
         *
         * @param date
         * @returns {string}
         */
        //obj.convertTimeString = function (date) {
        //    return (date.getMonth()+1)+"월 "+date.getDate()+ "일" + "("+dayToString(date.getDay()) +") " +
        //            " " + (date.getHours()<10?"0":"") + date.getHours() +
        //            ":" + (date.getMinutes()<10?"0":"") + date.getMinutes();
        //};

        /**
         *
         * @param {String} fullAddress 대한민국 천하도 강남시 하늘구 가내동 33-2, 대한민국 서울특별시 라임구 마라동
         * @returns {String[]}
         */
        obj.convertAddressArray = function (fullAddress) {
            var splitAddress = [];

            if (fullAddress && fullAddress.split) {
                splitAddress = fullAddress.split(" ");
            }
            return splitAddress;
        };

        /**
         * 남해군 같은 경우 군을 버리면 남해 라고 표시되어 이상해보이므로, 시,군 표시함.
         * @param name
         * @returns {*}
         * @private
         */
        obj._getShortSiDoName = function(name) {
            //특별시, 특별자치시, 광역시,
            var aStr = ["특별시", "광역시", "특별자치시", "특별자치도"];
            for (var i=0; i<aStr.length; i++) {
                if (name.slice(-1*aStr[i].length) === aStr[i]) {
                    if (i === aStr.length-1) {
                        return name.replace(aStr[i], "도");
                    }
                    else {
                        return name.replace(aStr[i], "시");
                    }
                }
            }

            return name;
        };

        /**
         * It's supporting only korean lang
         * return si+dong, si+gu, si or do
         * @param {String} fullAddress
         * @returns {string}
         */
        obj.getShortenAddress = function (fullAddress) {
            var that = this;
            var parsedAddress = that.convertAddressArray(fullAddress);

            if (!parsedAddress || parsedAddress.length < 2) {
                console.log("Fail to split full address="+fullAddress);
                return "";
            }

            if (parsedAddress.length === 5) {
                //nation + do + si + gu + dong
                return that._getShortSiDoName(parsedAddress[2])+","+parsedAddress[4];
            }
            else if (parsedAddress.length === 4) {
                if (parsedAddress[1].slice(-1) === '도') {
                    //nation + do + si + gu
                    return that._getShortSiDoName(parsedAddress[2])+","+parsedAddress[3];
                }
                else {
                    //nation + si + gu + dong
                    return that._getShortSiDoName(parsedAddress[1])+","+parsedAddress[3];
                }
            }
            else if (parsedAddress.length === 3) {
                //nation + do + si
                //nation + si + gu
                //nation + si + eup,myeon
                return that._getShortSiDoName(parsedAddress[1])+","+parsedAddress[2];
            }
            else if (parsedAddress.length === 2) {
                //nation + si,do
                return that._getShortSiDoName(parsedAddress[1]);
            }
            else {
                console.log("Fail to get shorten from ="+fullAddress);

            }
            return "";
        };

        /**
         *
         * @param addressArray
         * @returns {{first: string, second: string, third: string}}
         */
        obj.getTownFromFullAddress = function (addressArray) {
            var town = {first: "", second: "", third: ""};
            if (!Array.isArray(addressArray) || addressArray.length === 0) {
                console.log("addressArray is invalid");
                return town;
            }

            if (addressArray.length === 5) {
                //nation + do + si + gu + dong
                town.first = addressArray[1];
                town.second = addressArray[2]+addressArray[3];
                town.third = addressArray[4];
            }
            else if (addressArray.length === 4) {
                town.first = addressArray[1];
                if (addressArray[3].slice(-1) === '구') {
                    //nation + do + si + gu
                    town.second = addressArray[2]+addressArray[3];
                }
                else {
                    //nation + si + gu + dong
                    town.second = addressArray[2];
                    town.third = addressArray[3];
                }
            }
            else if (addressArray.length === 3) {
                if (addressArray[2].slice(-1) === '읍' || addressArray[2].slice(-1) === '면' ||
                    addressArray[2].slice(-1) === '동')
                {
                    //nation + si + myeon,eup,dong
                    town.first = addressArray[1];
                    town.second = addressArray[1];
                    town.third = addressArray[2];
                }
                else {
                    //nation + si,do + si, gun, gu
                    town.first = addressArray[1];
                    town.second = addressArray[2];
                }
            }
            else if (addressArray.length === 2) {
               //nation + si,do
                town.first = addressArray[1];
            }
            else {
                var err = new Error("Fail to parse address array="+addressArray.toString());
                console.log(err);
            }
            return town;
        };

        function getGeoCodeFromDaum(address) {
            var deferred = $q.defer();
            var url = 'https://apis.daum.net/local/geo/addr2coord'+
                '?apikey=' + twClientConfig.daumServiceKey +
                '&q='+ encodeURIComponent(address) +
                '&output=json';

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                var lat = data.channel.item[0].lat;
                var lng = data.channel.item[0].lng;
                var location = {"lat":lat, "long":lng};
                deferred.resolve(location);
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        function getGeoCodeFromGoogle(address) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + address;

            console.log(url);
            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.status === 'OK') {
                    try {
                        var location = findLocationFromGoogleGeoCodeResults(data.results) ;

                        var country;
                        for (var i=0; i< data.results[0].address_components.length; i++) {
                            if (data.results[0].address_components[i].types[0] == "country") {
                                country =  data.results[0].address_components[i].short_name;
                                break;
                            }
                        }
                        console.log(location);
                        deferred.resolve({location: location, country: country, address: address});
                    }
                    catch(e) {
                        console.log(e);
                        deferred.reject(e);
                    }
                }
                else {
                    //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                    deferred.reject(new Error(data.status));
                }
            }).error(function (err) {
                console.log(err);
                deferred.reject(err);
            });

            return deferred.promise;
        }

        /**
         * 한국어가 아닌 주소 일수 있음.
         * address가 국내이면, daum에서 주소를 새로 갱신해서 geoInfo에 추가함.
         * controllers.js에서는 geoInfo.name값을 사용하지 않고 다른 값을
         * 사용하지만 코드 통일성 및 추후 사용때문에 name값을 넣기는 함.
         * @param {String} address
         */
        obj.getGeoInfoFromAddress = function (address) {
            var deferred = $q.defer();

            getGeoCodeFromGoogle(address).then(function (geoInfo) {
                console.log(geoInfo);
                if (geoInfo.country == "KR") {
                    getAddressFromDaum(geoInfo.location.lat, geoInfo.location.long).then(function (data) {
                        geoInfo.address = data.address;
                        if (Util.language.indexOf("ko") != -1 && data.name) {
                                geoInfo.name = data.name;
                        }
                        console.log(geoInfo);
                        deferred.resolve(geoInfo);
                    }, function (error) {
                        console.log(error);
                        deferred.reject(error);
                    });
                }
                else {
                    geoInfo.location = obj.geolocationNormalize(geoInfo.location);
                    console.log(geoInfo);
                    deferred.resolve(geoInfo);
                }
            }, function (err) {
                if (err == undefined) {
                    err = new Error("Fail to get geo code from google");
                }
                console.log(err);
                deferred.reject(err);
            });

            return deferred.promise;
        };

        /**
         *
         * @param lat
         * @param lng
         * @returns {*|promise}
         */
        function getAddressFromDaum(lat, lng) {
            var deferred = $q.defer();
            var url = 'https://apis.daum.net/local/geo/coord2addr'+
                '?apikey=' + twClientConfig.daumServiceKey +
                '&longitude='+ lng +
                '&latitude='+lat+
                '&inputCoordSystem=WGS84'+
                '&output=json';

            console.log(url);
            $http({method: 'GET', url: url, timeout: 3000})
                .success(function (data, status, headers, config, statusText) {
                    if (data.fullName) {
                        var address = data.fullName;
                        var name = data.name;

                        address = '대한민국 ' + address;
                        deferred.resolve({address: address, name: name});
                    }
                    else {
                        deferred.reject(new Error('Fail to get address name'));
                    }
                })
                .error(function (data, status, headers, config, statusText) {
                    var error = new Error(data);
                    error.code = status;
                    deferred.reject(error);
                });

            return deferred.promise;
        }

        /**
         * address에서 왼쪽에 국가가 나오거나, 오른쪽에 국가가 나옴 반대쪽 지명을 name으로 사용.
         * tokyo 35.6894875,139.6917064 의 경우 types에 postal_code가 없음.
         * @param lat
         * @param lng
         * @returns {*}
         */
        function getGeoInfoFromGoogle(lat, lng) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng;

            console.log(url);
            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.status === "OK") {
                    var sub_level2_types = [ "political", "sublocality", "sublocality_level_2" ];
                    var sub_level1_types = [ "political", "sublocality", "sublocality_level_1" ];
                    var local_types = [ "locality", "political" ];
                    var country_types = ["country"];
                    var sub_level2_name;
                    var sub_level1_name;
                    var local_name;
                    var country_name;

                    for (var i=0; i < data.results.length; i++) {
                        var result = data.results[i];
                        for (var j=0; j < result.address_components.length; j++) {
                            var address_component = result.address_components[j];
                            if ( address_component.types[0] == sub_level2_types[0]
                                && address_component.types[1] == sub_level2_types[1]
                                && address_component.types[2] == sub_level2_types[2] ) {
                                sub_level2_name = address_component.short_name;
                            }

                            if ( address_component.types[0] == sub_level1_types[0]
                                && address_component.types[1] == sub_level1_types[1]
                                && address_component.types[2] == sub_level1_types[2] ) {
                               sub_level1_name = address_component.short_name;
                            }

                            if ( address_component.types[0] == local_types[0]
                                && address_component.types[1] == local_types[1] ) {
                               local_name = address_component.short_name;
                            }

                            if ( address_component.types[0] == country_types[0] ) {
                               country_name = address_component.short_name;
                            }

                            if (sub_level2_name && sub_level1_name && local_name && country_name) {
                                break;
                            }
                        }

                        if (sub_level2_name && sub_level1_name && local_name && country_name) {
                            break;
                        }
                    }

                    var name;
                    var address = "";
                    //국내는 동단위까지 표기해야 함.
                    if (country_name == "KR") {
                        if (sub_level2_name) {
                            address += sub_level2_name;
                            name = sub_level2_name
                        }
                    }
                    if (sub_level1_name) {
                        address += " " + sub_level1_name;
                        if (name == undefined) {
                            name = sub_level1_name;
                        }
                    }
                    if (local_name) {
                        address += " " + local_name;
                        if (name == undefined) {
                            name = local_name;
                        }
                    }
                    if (country_name) {
                        address += " " + country_name;
                        if (name == undefined) {
                            name = country_name;
                        }
                    }

                    if (name == undefined || name == country_name) {
                        console.log("Fail to find location address");
                    }

                    var geoInfo =  {country: country_name, address: address};
                    geoInfo.location = {lat:lat, long: lng};
                    geoInfo.name = name;
                    deferred.resolve(geoInfo);
                }
                else {
                    //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                    deferred.reject(new Error(data.status));
                }
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        /**
         * 찾은 주소가 한국이면, daum에서 주소 갱신함.
         * @param lat
         * @param long
         * @returns {*}
         */
        obj.getGeoInfoFromGeolocation = function (lat, long) {
            var deferred = $q.defer();
            var startTime = new Date().getTime();
            var endTime;

            getGeoInfoFromGoogle(lat, long).then(function (geoInfo) {
                endTime = new Date().getTime();
                Util.ga.trackTiming('address', endTime - startTime, 'get', 'google');
                Util.ga.trackEvent('address', 'get', 'google', endTime - startTime);

                console.log(geoInfo);
                //todo: if (geoInfo.country == "KR" && source == "KMA")
                if (geoInfo.country == "KR") {
                    startTime = new Date().getTime();
                    getAddressFromDaum(lat, long).then(function (data) {
                        endTime = new Date().getTime();
                        Util.ga.trackTiming('address', endTime - startTime, 'get', 'daum');
                        Util.ga.trackEvent('address', 'get', 'daum', endTime - startTime);

                        //search에서 임시적으로 사용함
                        geoInfo.googleAddress = geoInfo.address;
                        geoInfo.address = data.address;
                        if (Util.language.indexOf("ko") != -1 && data.name) {
                            geoInfo.name = data.name;
                        }
                        console.log(geoInfo);
                        deferred.resolve(geoInfo);
                    }, function (err) {
                        endTime = new Date().getTime();
                        Util.ga.trackTiming('address', endTime - startTime, 'error', 'daum');
                        if (err instanceof Error) {
                            Util.ga.trackEvent('address', 'error', 'daum(message:' + err.message + ', code:' + err.code + ')', endTime - startTime);
                        } else {
                            Util.ga.trackEvent('address', 'error', 'daum(' + err + ')', endTime - startTime);
                        }

                        console.log(err);
                        deferred.reject(err);
                    });
                }
                else {
                    getGeoCodeFromGoogle(geoInfo.address).then(function (info) {
                        geoInfo.location = obj.geolocationNormalize(info.location);
                        deferred.resolve(geoInfo);
                    });
                }
            }, function (err) {
                endTime = new Date().getTime();
                Util.ga.trackTiming('address', endTime - startTime, 'error', 'google');
                if (err instanceof Error) {
                    Util.ga.trackEvent('address', 'error', 'google(message:' + err.message + ', code:' + err.code + ')', endTime - startTime);
                } else {
                    Util.ga.trackEvent('address', 'error', 'google(' + err + ')', endTime - startTime);
                }

                console.log(err);
                deferred.reject(err);
            });
            return deferred.promise;
        };

        function _navigatorRetryGetCurrentPosition(retryCount, callback)  {
            navigator.geolocation.getCurrentPosition(function (position) {
                //경기도,광주시,오포읍,37.36340556,127.2307667
                //deferred.resolve({latitude: 37.363, longitude: 127.230});
                //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                //37.472595, 126.795249
                //경상남도/거제시옥포2동 "lng":128.6875, "lat":34.8966
                //deferred.resolve({latitude: 34.8966, longitude: 128.6875});
                //서울특별시
                //deferred.resolve({latitude: 37.5635694, longitude: 126.9800083});
                //경기 수원시 영통구 광교1동
                //deferred.resolve({latitude: 37.298876, longitude: 127.047527});

                // Tokyo 35.6894875,139.6917064
                // position = {coords: {latitude: 35.6894875, longitude: 139.6917064}};
                // Shanghai 31.227797,121.475194
                //position = {coords: {latitude: 31.227797, longitude: 121.475194}};
                // NY 40.663527,-73.960852
                //position = {coords: {latitude: 40.663527, longitude: -73.960852}};
                // Berlin 52.516407,13.403322
                //position = {coords: {latitude: 52.516407, longitude: 13.403322}};
                // Hochinminh 10.779001,106.662796
                //position = {coords: {latitude: 10.779001, longitude: 106.662796}};
                //경상북도/영천시/대전동
                //position = {coords: {latitude: 35.9859147103, longitude: 128.9122925322}};

                console.log('navigator geolocation');
                console.log(position);

                callback(undefined, position, retryCount);
            }, function (error) {
                console.log("Fail to get current position from navigator");
                console.log("retry:"+retryCount+" code:"+error.code+" message:"+error.message);

                retryCount--;
                if (retryCount <= 0) {
                    return callback(error, undefined, retryCount);
                }
                else {
                    //간격을 주지 않으면 계속 실패해버림.
                    setTimeout(function () {
                        _navigatorRetryGetCurrentPosition(retryCount, callback);
                    }, 500);
                }
            }, { maximumAge: 3000, timeout: 5000, enableHighAccuracy: retryCount%2!=0 });
        }

        function _nativeRetryGetCurrentPosition(retryCount, callback) {
            var orgGeo = cordova.require('cordova/modulemapper').getOriginalSymbol(window, 'navigator.geolocation');

            orgGeo.getCurrentPosition(function (position) {
                    console.log('native geolocation');
                    console.log(position);

                    callback(undefined, position, retryCount);
                },
                function (error) {
                    console.log("Fail to get current position from native");
                    console.log("code:"+error.code+" message:"+error.message);

                    retryCount--;
                    if (retryCount <= 0) {
                        return callback(error, undefined, retryCount);
                    }
                    else {
                        setTimeout(function () {
                            _nativeRetryGetCurrentPosition(retryCount, callback);
                        }, 500);
                    }
                }, { maximumAge: 3000, timeout: 5000, enableHighAccuracy: retryCount%2!=0 });
        }

        obj.getCurrentPosition = function () {
            var deferred = $q.defer();

            ionic.Platform.ready(function() {
                var startTime = new Date().getTime();
                var endTime;

                _navigatorRetryGetCurrentPosition(2, function (error, position, retryCount) {
                    endTime = new Date().getTime();
                    if (error) {
                        Util.ga.trackTiming('position', endTime - startTime, 'error', 'default');
                        Util.ga.trackEvent('position', 'warn', 'default(retry:' + retryCount + ', message: ' + error.message + ', code:' + error.code + ')', endTime - startTime);
                        return deferred.reject();
                    }

                    Util.ga.trackTiming('position', endTime - startTime, 'get', 'default');
                    Util.ga.trackEvent('position', 'get', 'default(retry:' + retryCount + ')', endTime - startTime);
                    deferred.resolve(position.coords);
                });

                if (ionic.Platform.isAndroid() && window.cordova) {
                    _nativeRetryGetCurrentPosition(2, function (error, position, retryCount) {
                        endTime = new Date().getTime();
                        if (error) {
                            Util.ga.trackTiming('position', endTime - startTime, 'error', 'native');
                            Util.ga.trackEvent('position', 'warn', 'native(retry:' + retryCount + ', message: ' + error.message + ', code:' + error.code + ')', endTime - startTime);
                            return deferred.reject();
                        }

                        Util.ga.trackTiming('position', endTime - startTime, 'get', 'native');
                        Util.ga.trackEvent('position', 'get', 'native(retry:' + retryCount + ')', endTime - startTime);
                        deferred.resolve(position.coords);
                    });
                }
            });

            return deferred.promise;
        };

        /**
         *
         * @param geoInfo
         * @returns {Promise}
         */
        obj.getWorldWeatherInfo = function (geoInfo) {
            var promises = [];
            var that = this;

            if (geoInfo.country === "KR") {
                var addressArray = that.convertAddressArray(geoInfo.address);
                var town = that.getTownFromFullAddress(addressArray);
                promises.push(getTownWeatherInfo(town));
            }
            else {
                promises.push(getGeoWeatherInfo(geoInfo.location));
            }

            return $q.all(promises);
        };


        function _parseKmaWeather(that, weatherData) {
            var data = {};
            var currentTime;
            var todayInfo;

            if (weatherData.units == undefined) {
                weatherData.units = Units.getDefaultUnits();
            }

            try {
                if (weatherData.current && weatherData.current.stnDateTime) {
                    //iOS Safari에서 parsing 못함.
                    var dateStr = weatherData.current.stnDateTime.split(".");
                    var timeStr = dateStr[dateStr.length-1].split(":");
                    currentTime = new Date(dateStr[0], parseInt(dateStr[1])-1, dateStr[2], timeStr[0], timeStr[1]);
                }
                else if (weatherData.current.date && !(weatherData.current.time == undefined)) {
                    currentTime = convertStringToDate(weatherData.current.date);
                    currentTime.setHours(parseInt(weatherData.current.time.substr(0, 2)))
                }

                var midTownWeather = that.parseMidTownWeather(weatherData.midData, currentTime, weatherData.units);
                todayInfo = midTownWeather.today;

                var currentForecast = that.parseCurrentTownWeather(weatherData.current, weatherData.units);
                currentForecast.today = todayInfo;

                //console.log(midTownWeather);

                /**
                 * @type {{name, value}|{timeTable, timeChart}|{timeTable: Array, timeChart: Array}}
                 */
                var shortTownWeather = that.parseShortTownWeather(weatherData.short, currentForecast, weatherData.units);
                //console.log(shortTownWeather);

                /**
                 * @type {Array}
                 */

                data.currentWeather = currentForecast;
                data.timeTable = shortTownWeather.timeTable;
                data.timeChart = shortTownWeather.timeChart;
                data.dayChart = [{
                    values: midTownWeather.dayTable,
                    temp: currentForecast.t1h,
                    displayItemCount: midTownWeather.displayItemCount
                }];
                data.source = "KMA";
            }
            catch(e) {
                console.log(e);
                Util.ga.trackEvent('parseKmaWeather', 'error', e);
                Util.ga.trackException(e, false);
                alert(e.message);
                return null;
            }

            return data;
        }

        /**
         *
         * @param windDir
         * @returns {*}
         * @private
         */
        function _convertWindDirToWdd(windDir) {
            switch(windDir) {
                case 0: return "N";
                case 22.5: return "NEN";
                case 45: return "NE";
                case 67.5: return "ENE";
                case 90: return "E";
                case 112.5: return "ESE";
                case 135: return "ES";
                case 157.5: return "SES";
                case 180: return "S";
                case 202.5: return "SWS";
                case 225: return "SW";
                case 247.5: return "WSW";
                case 270: return "W";
                case 292.5: return "WNW";
                case 315: return "WN";
                case 337.5: return "NWN";
                case 360: return "N";
            }
        }

        function _parseWorldSkyState(precType, cloud, isNight) {
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
        }

        function _parseWorldCurrentWeather(thisTime, todayInfo, currentTime, units) {
            var sunrise = 7;
            var sunset = 18;
            var isNight = false;
            var yesterday = thisTime[0];
            var current = thisTime[1];

            if (todayInfo.sunrise) {
                sunrise = _convertYYYYoMMoDD_HH8MMtoDate(todayInfo.sunrise);
            }
            if (todayInfo.sunset) {
                sunset = _convertYYYYoMMoDD_HH8MMtoDate(todayInfo.sunset);
            }

            isNight = currentTime < sunrise.getHours() || currentTime> sunset.getHours();

            if (current.temp_c == undefined) {
                console.log("Error temp_c of current is undefined");
            }

            if (current.precType == undefined) {
               console.log("Error precType of current is undefined");
                current.precType = 0;
            }

            if (current.cloud == undefined) {
                console.log("Error cloud of current is undefined");
            }

            if (yesterday) {
                if (yesterday.temp_c == undefined) {
                    console.log("yesterday temp_c is undefined!!");
                }
                yesterday.t1h = yesterday.temp_c;
                yesterday.summary = yesterday.desc;
            }

            if (units.temperatureUnit != Units.getUnit('temperatureUnit')) {
                current.temp_c = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), current.temp_c);
                current.ftemp_c = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), current.ftemp_c);
                yesterday.t1h = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), yesterday.t1h);
            }

            if (units.windSpeedUnit != Units.getUnit('windSpeedUnit')) {
                current.windSpd_ms = Units.convertUnits(units.windSpeedUnit, Units.getUnit('windSpeedUnit'), current.windSpd_ms);
            }
            if (units.pressureUnit != Units.getUnit('pressureUnit')) {
                current.press = Units.convertUnits(units.pressureUnit, Units.getUnit('pressureUnit'), current.press);
            }
            if (units.distanceUnit != Units.getUnit('distanceUnit')) {
                current.vis = Units.convertUnits(units.distanceUnit, Units.getUnit('distanceUnit'), current.vis);
            }
            if (units.precipitationUnit != Units.getUnit('precipitationUnit')) {
                current.precip = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), current.precip);
            }

            var skyIcon = current.skyIcon;
            if (skyIcon == undefined) {
                skyIcon = _parseWorldSkyState(current.precType, current.cloud, isNight);
            }
            return {
                date: _convertDateToYYYYMMDD(new Date(current.date)),
                stnDateTime: current.date,
                summary: current.desc,
                weatherType: current.weatherType,
                t1h: current.temp_c,
                sensorytem: current.ftemp_c,
                reh: current.humid,
                wsd: current.windSpd_ms,
                wdd: _convertWindDirToWdd(current.windDir),
                skyIcon: skyIcon,
                visibility: current.vis,
                hPa: current.press,
                rn1: current.precip,
                today: todayInfo,
                yesterday: yesterday
            }
        }

        function _convertDateToYYYYMMDD(date) {
            //I don't know why one more create Date object by aleckim
            var d = new Date(date);
            var month = '' + (d.getMonth() + 1);
            var day = '' + d.getDate();
            var year = d.getFullYear();

            if (month.length < 2) { month = '0' + month; }
            if (day.length < 2) { day = '0' + day; }

            return year+month+day;
        }

        function _convertYYYYoMMoDD_HH8MMtoDate(str) {
            //iOS Safari에서 parsing 못함.
            var dateStr = str.split(" ");
            var dateArray = dateStr[0].split(".");
            var timeArray = dateStr[1].split(":");
            return new Date(dateArray[0], parseInt(dateArray[1])-1, dateArray[2], timeArray[0], timeArray[1]);
        }

        function _parseWorldHourlyWeather(hourly, currentTime, todayInfo, units) {
            var data = [];

            if (!hourly || !Array.isArray(hourly)) {
                console.log('hourly is not array');
                return {timeTable: [], timeChart: []};
            }

            var currentIndex;
            var displayItemCount = 0;
            var todayIndex;
            var yesterday = new Date(currentTime);
            yesterday.setDate(yesterday.getDate()-1);

            hourly.forEach(function (hourlyObj, index) {
                var tempObject = {};
                //var date = new Date(hourlyObj.date);
                var date = _convertYYYYoMMoDD_HH8MMtoDate(hourlyObj.date);
                var time = date.getHours();
                var diffDays = getDiffDays(date, todayInfo.dateObj);
                var sunrise = _convertYYYYoMMoDD_HH8MMtoDate(todayInfo.sunrise);
                var sunset = _convertYYYYoMMoDD_HH8MMtoDate(todayInfo.sunset);
                var isNight = time < sunrise.getHours() || time > sunset.getHours();

                tempObject.date = _convertDateToYYYYMMDD(date);
                tempObject.time = date.getHours();
                tempObject.fromToday = diffDays;
                if (hourlyObj.temp_c == undefined) {
                    console.log("Error temp_c of hourly is undefined " + JSON.stringify(hourlyObj));
                    tempObject.t3h = data[data.length-1].t3h;
                }
                else {
                    tempObject.t3h = hourlyObj.temp_c;
                }
                tempObject.sensorytem = hourlyObj.ftemp_c;

                tempObject.wsd = hourlyObj.windSpd_ms;
                tempObject.reh = hourlyObj.humid;
                if (hourlyObj.precType) {
                    tempObject.pty = hourlyObj.precType;
                }
                else {
                    tempObject.pty = 0;
                }
                if (hourlyObj.cloud == undefined) {
                    console.log("Warning cloud of hourly is undefined " + JSON.stringify(hourlyObj));
                    tempObject.cloud = 0;
                }
                else {
                    tempObject.cloud = hourlyObj.cloud;
                }
                tempObject.skyIcon = hourlyObj.skyIcon;
                if (tempObject.skyIcon == undefined) {
                    tempObject.skyIcon = _parseWorldSkyState(tempObject.pty, tempObject.cloud, isNight);
                }

                if (hourlyObj.precProb == undefined) {
                    //console.log("preProb of hourly " + JSON.stringify(hourlyObj));
                    tempObject.pop = 0;
                }
                else {
                    tempObject.pop = hourlyObj.precProb;
                }

                if (hourlyObj.precip) {
                    tempObject.rn1 = +(hourlyObj.precip.toFixed(1));
                    tempObject.r06 = 0;
                }
                else {
                    tempObject.rn1 = 0;
                    tempObject.r06 = 0;
                }

                tempObject.hPa = hourlyObj.press;
                tempObject.visibility = hourlyObj.vis;

                if (units.temperatureUnit != Units.getUnit('temperatureUnit')) {
                    tempObject.t3h = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.t3h);
                    tempObject.sensorytem = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), tempObject.sensorytem);
                    //dewpoint
                }
                if (units.windSpeedUnit != Units.getUnit('windSpeedUnit')) {
                    tempObject.wsd = Units.convertUnits(units.windSpeedUnit, Units.getUnit('windSpeedUnit'), tempObject.wsd);
                }
                if (units.pressureUnit != Units.getUnit('pressureUnit')) {
                    tempObject.hPa = Units.convertUnits(units.pressureUnit, Units.getUnit('pressureUnit'), tempObject.hPa);
                }
                if (units.distanceUnit != Units.getUnit('distanceUnit')) {
                    tempObject.visibility = Units.convertUnits(units.distanceUnit, Units.getUnit('distanceUnit'), tempObject.visibility);
                }
                if (units.precipitationUnit != Units.getUnit('precipitationUnit')) {
                    tempObject.rn1 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), tempObject.rn1);
                }

                if (currentIndex == undefined) {
                    if (currentTime.getDate() == date.getDate()) {
                        todayIndex = index;
                        var currentHours = currentTime.getHours();
                        if (currentHours == time) {
                            currentIndex = index;
                            //hourly[index].currentIndex = true;
                            tempObject.currentIndex = true;
                        }
                        else if (currentHours < time) {
                            if (index == 0)  {
                                console.log("Error current index is -1");
                                currentIndex = -1;
                            }
                            else {
                                currentIndex = index-1;
                                //hourly[index-1].currentIndex = true;
                                data[index-1].currentIndex = true;
                            }
                        }
                        else if (currentHours > time) {
                            //24시가 다음날 0으로 오는 경우
                            if (time >= 21) {
                                if (currentHours >= 21) {
                                    currentIndex = index;
                                    tempObject.currentIndex = true;
                                }
                                else {
                                    console.log("Fail to find current "+currentHours);
                                }
                            }
                        }
                    }
                }

                var tmpDisplayCount = 0;
                //data on chart from yesterday
                if (diffDays > -2) {
                    if (tempObject.skyIcon != undefined) {
                        tmpDisplayCount++;
                    }
                    if (tempObject.pop && tempObject.pop > 0) {
                        tmpDisplayCount++;
                    }
                    if (displayItemCount == 2) {
                        if ((tempObject.rn1 && tempObject.rn1 > 0)
                            || (tempObject.r06 && tempObject.r06 > 0)
                            || (tempObject.s06 && tempObject.s06 > 0)) {
                            tmpDisplayCount++;
                        }
                    }
                    if (tmpDisplayCount > displayItemCount) {
                        displayItemCount = tmpDisplayCount;
                    }
                }

                data.push(tempObject);
            });

            console.log(JSON.stringify(data));

            if (currentIndex == undefined) {
                console.log("Fail to find current index");
                currentIndex = hourly.length-1;
            }

            var timeTable = data.slice(8);
            var timeChart = [
                {
                    name: "yesterday",
                    values: data.slice(0, data.length - 8).map(function (d) {
                        return {name: "yesterday", value: d};
                    })
                },
                {
                    name: "today",
                    values: data.slice(8).map(function (d) {
                        return {name: "today", value: d};
                    }),
                    currentIndex: currentIndex - 8,
                    displayItemCount: displayItemCount
                }
            ];

            return {timeTable: timeTable, timeChart: timeChart};

        }


        function _parseWorldDailyWeather(daily, currentTime, units) {

            var tmpDayTable = [];
            var displayItemCount = 0;
            var todayInfo;

            daily.forEach(function (dayInfo, index) {
                var data;
                data = JSON.parse(JSON.stringify(dayInfo));
                //var date = new Date(dayInfo.date);
                var date = _convertYYYYoMMoDD_HH8MMtoDate(dayInfo.date);

                var diffDays = getDiffDays(date, currentTime);

                data.date = _convertDateToYYYYMMDD(date);
                data.dateObj = date;
                data.fromToday = diffDays;
                data.dayOfWeek = date.getDay();

                if (dayInfo.tempMax_c == undefined) {
                    console.log('Fail to get tempMax_c from '+JSON.stringify(dayInfo));
                }
                else {
                    data.tmx = dayInfo.tempMax_c;
                }
                if (dayInfo.tempMin_c == undefined) {
                    console.log('Fail to get tempMin_c from '+JSON.stringify(dayInfo));
                }
                else {
                    data.tmn = dayInfo.tempMin_c;
                }
                if (dayInfo.precProb == undefined) {
                    data.pop = 0;
                }
                else {
                    data.pop = dayInfo.precProb;
                }
                if (dayInfo.precType == undefined) {
                    console.log('Fail to get precType from '+JSON.stringify(dayInfo));
                    data.pty = 0;
                }
                else {
                    data.pty = dayInfo.precType;
                }

                var sky = dayInfo.skyIcon;
                if (sky == undefined) {
                    sky = _parseWorldSkyState(data.pty, data.cloud, false);
                }
                data.skyIcon = sky;
                data.skyAm = sky;
                data.skyPm = sky;

                if (!(dayInfo.humid == undefined)) {
                    data.reh = dayInfo.humid;
                    if (data.reh !== undefined) {
                        data.humidityIcon = decideHumidityIcon(data.reh);
                    }
                    else {
                        data.humidityIcon = "Humidity-00";
                    }
                }

                if (!(dayInfo.windSpd_ms == undefined)) {
                    data.wsd = dayInfo.windSpd_ms;
                }
                if (!(dayInfo.press == undefined)) {
                    data.hPa = dayInfo.press;
                }
                if (!(dayInfo.vis == undefined)) {
                   data.visibility = dayInfo.vis;
                }
                if (!(dayInfo.precip == undefined)) {
                    data.rn1 = +dayInfo.precip.toFixed(1);
                }

                if (units.temperatureUnit != Units.getUnit('temperatureUnit')) {
                    data.tmx = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), data.tmx);
                    data.tmn = Units.convertUnits(units.temperatureUnit, Units.getUnit('temperatureUnit'), data.tmn);
                }
                if (units.windSpeedUnit != Units.getUnit('windSpeedUnit')) {
                    data.wsd = Units.convertUnits(units.windSpeedUnit, Units.getUnit('windSpeedUnit'), data.wsd);
                }
                if (units.pressureUnit != Units.getUnit('pressureUnit')) {
                    data.hPa = Units.convertUnits(units.pressureUnit, Units.getUnit('pressureUnit'), data.hPa);
                }
                if (units.distanceUnit != Units.getUnit('distanceUnit')) {
                    data.visibility = Units.convertUnits(units.distanceUnit, Units.getUnit('distanceUnit'), data.visibility);
                }
                if (units.precipitationUnit != Units.getUnit('precipitationUnit')) {
                    data.rn1 = Units.convertUnits(units.precipitationUnit, Units.getUnit('precipitationUnit'), data.rn1);
                }

                tmpDayTable.push(data);

                if (data.fromToday == 0) {
                    todayInfo = data;
                    todayInfo.index = index;
                }

                var tmpDisplayCount = 0;

                if (data.skyAm != undefined || data.skyPm != undefined) {
                    if (data.skyAm != data.skyPm && data.skyAm && data.skyPm) {
                        tmpDisplayCount = tmpDisplayCount | 4;
                    }
                }

                if (data.pop && data.pop > 0 && data.fromToday >= 0) {
                    tmpDisplayCount = tmpDisplayCount | 2;
                }
                if ((data.rn1 && data.rn1 > 0)
                    || (data.r06 && data.r06 > 0)
                    || (data.s06 && data.s06 > 0)) {
                    tmpDisplayCount = tmpDisplayCount | 1;
                }
                if (tmpDisplayCount > displayItemCount) {
                    displayItemCount = tmpDisplayCount;
                }

                if (!(data.dustForecast == undefined)) {
                    if (!(data.dustForecast.PM10Grade == undefined)) {
                        data.dustForecast.pm10Grade = data.dustForecast.PM10Grade+1;
                    }
                    if (!(data.dustForecast.PM25Grade == undefined)) {
                        data.dustForecast.pm25Grade = data.dustForecast.PM25Grade+1;
                    }
                    if (!(data.dustForecast.O3Grade == undefined)) {
                        data.dustForecast.o3Grade = data.dustForecast.O3Grade+1;
                    }
                }
            });
            console.log(JSON.stringify(tmpDayTable));
            return {displayItemCount: displayItemCount, dayTable: tmpDayTable, today: todayInfo};
        }

        function _parseWorldWeather(weatherData) {
            var data = {};
            var currentTime;
            var todayInfo;
            var midTownWeather;
            var shortTownWeather;

            if (weatherData.units == undefined) {
                weatherData.units = Units.getDefaultUnits();
            }

            try {
                if (weatherData.thisTime && weatherData.thisTime[1].date) {
                    currentTime = _convertYYYYoMMoDD_HH8MMtoDate(weatherData.thisTime[1].date);
                }
                else {
                    console.log("Error fail to get current date !!");
                    currentTime = new Date();
                }

                console.log("current time="+currentTime.toString());

                midTownWeather =_parseWorldDailyWeather(weatherData.daily, currentTime, weatherData.units);
                todayInfo = midTownWeather.today;
                shortTownWeather = _parseWorldHourlyWeather(weatherData.hourly, currentTime, todayInfo, weatherData.units);
                data.currentWeather = _parseWorldCurrentWeather(weatherData.thisTime, todayInfo, currentTime.getHours(), weatherData.units);
                data.timeTable = shortTownWeather.timeTable;
                data.timeChart = shortTownWeather.timeChart;
                data.dayChart = [{
                    values: midTownWeather.dayTable,
                    temp: data.currentWeather.t1h,
                    displayItemCount: midTownWeather.displayItemCount
                }];

                if (weatherData.hasOwnProperty('pubDate')) {
                    if (weatherData.pubDate.hasOwnProperty('DSF')) {
                       data.source = "DSF";
                    }
                }
            }
            catch (e) {
                console.log(e);
                Util.ga.trackEvent('parseWorldWeather', 'error', e);
                Util.ga.trackException(e, false);
                alert(e.message);
                return null;
            }

            return data;
        }

        /**
         *
         * @param weatherDataList
         * @returns {{}}
         */
        obj.convertWeatherData = function (weatherDataList) {
            var that = this;
            var weatherData = {};
            weatherDataList.forEach(function (weatherObject) {
                if (weatherObject.hasOwnProperty("data")) {
                    weatherData = weatherObject.data;
                }
            });

            if (weatherData.hasOwnProperty('regionName')) {
                return _parseKmaWeather(that, weatherData);
            }
            else {
                return _parseWorldWeather(weatherData);
            }
        };

        obj.getWeatherEmoji = function (skyIcon) {
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

            console.log('Fail to find emoji skyIcon='+skyIcon);
            return '';
        };
        //endregion

        /**
         * hochimin의 경우 106.6296638 가 두자리로 떨어지지 않음.
         * @param coords
         * @returns {{lat: number, long: number}}
         */
        obj.geolocationNormalize = function (coords) {
            //var baseLength = 0.02;
            //var lat = coords.lat;
            //var lon = coords.long;
            //console.log (lat + " " + lon);
            //
            //var normal_lat = lat - (lat%baseLength) + baseLength/2;
            //var normal_lon = lon - (lon%baseLength) + baseLength/2;
            //return {lat: normal_lat, long: normal_lon};

            return {lat: parseFloat(coords.lat.toFixed(2)), long: parseFloat(coords.long.toFixed(2))}
        };

        return obj;
    });
