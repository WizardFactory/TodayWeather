angular.module('service.weatherinfo', [])
    .factory('WeatherInfo', function ($rootScope, WeatherUtil, Util, TwStorage) {
        var cities = [];
        var cityIndex = -1;
        var obj = {
            towns: []
        };

        var createCity = function (item) {
            var city = {};

            if (item === undefined) {
                city.currentPosition = true;
                city.address = null;
                city.location = null;
                city.currentWeather = null;
                city.timeTable = null;
                city.timeChart = null;
                city.dayTable = null;
                city.dayChart = null;
                city.disable = true; // 현재 위치 off
            } else {
                city = item;
                if (item.country == undefined) {
                    city.country = "KR";
                }
                city.disable = item.disable === undefined ? false : item.disable;
            }
            city.loadTime = null;
            cities.push(city);
        };

        //region APIs

        obj.getIndexOfCity = function (city) {
            for (var i = 0; i < cities.length; i += 1) {
                if (cities[i].currentPosition === true) {
                    if (city.currentPosition === true) {
                        return i;
                    }
                }
                else {
                    if (cities[i].address === city.address) {
                        if (city.name || cities[i].name) {
                           if (city.name === cities[i].name)  {
                               return i;
                           }
                        }
                        else {
                            return i;
                        }
                    }
                }
            }
            return -1;
        };

        obj.getCityOfIndex = function (index) {
            if (index < 0 || index >= cities.length) {
                return null;
            }
            return cities[index];
        };

        obj.getCityCount = function () {
            return cities.length;
        };

        obj.getEnabledCityCount = function () {
            var count = cities.length;

            for (var i = 0; i < cities.length; i += 1) {
                if (cities[i].disable === true) {
                    count -= 1;
                }
            }
            return count;
        };

        obj.getCityIndex = function () {
            return cityIndex;
        };

        obj.setCityIndex = function (index) {
            if (index >= -1 && index < cities.length) {
                cityIndex = index;
                TwStorage.set(
                    function (result) {
                        console.log("city index save " + result);
                    },
                    function (err) {
                        Util.ga.trackEvent('storage', 'error', 'setCityIndex');
                        Util.ga.trackException(err, false);
                    },
                    'cityIndex', JSON.stringify(cityIndex));

                console.log("cityIndex = " + cityIndex);
            }
        };

        obj.setFirstCityIndex = function () {
            var that = this;
            var city = cities[0];

            if (city.disable === true) {
                if (cities.length === 1) {
                    that.setCityIndex(-1);
                } else {
                    that.setCityIndex(1);
                }
            } else {
                that.setCityIndex(0);
            }
        };

        obj.setPrevCityIndex = function () {
            var that = this;
            var city = cities[0];

            if (cityIndex === 0 || (cityIndex === 1 && city.disable === true)) {
                that.setCityIndex(cities.length - 1);
            }
            else {
                that.setCityIndex(cityIndex - 1);
            }
        };

        obj.setNextCityIndex = function () {
            var that = this;

            if (cityIndex === cities.length - 1) {
                that.setFirstCityIndex();
            }
            else {
                that.setCityIndex(cityIndex + 1);
            }
        };

        obj.canLoadCity = function (index) {
            if (index === -1) {
                return false;
            }

            var city = cities[index];

            if (city.disable === true) {
                return false;
            }

            var time = new Date();
            return !!(city.loadTime === null || time.getTime() - city.loadTime.getTime() > (10 * 60 * 1000));
        };

        obj.addCity = function (city) {
            var that = this;

            if (that.getIndexOfCity(city) === -1) {
                city.disable = false;
                city.loadTime = new Date();
                cities.push(city);
                that.saveCities();
                return true;
            }
            return false;
        };

        obj.removeCity = function (index) {
            var that = this;

            if (index !== -1) {
                cities.splice(index, 1);
                that.saveCities();

                if (cityIndex === that.getCityCount()) {
                    that.setFirstCityIndex();
                }
                return true;
            }
            return false;
        };

        obj.disableCity = function (disable) {
            var that = this;

            cities[0].disable = disable;
            that.saveCities();

            if (cityIndex <= 0) {
                that.setFirstCityIndex();
            }
        };

        obj.reloadCity = function (index) {
            var city = cities[index];

            city.loadTime = null;
        };

        obj.updateCity = function (index, newCityInfo) {
            var that = this;
            var city = cities[index];

            if (newCityInfo.name) {
                city.name = newCityInfo.name;
            }
            if (newCityInfo.country) {
                city.country = newCityInfo.country;
            }
            if (newCityInfo.address) {
                city.address = newCityInfo.address;
            }
            if (newCityInfo.location) {
                city.location = newCityInfo.location;
            }
            if (newCityInfo.currentWeather) {
                city.currentWeather = newCityInfo.currentWeather;
            }
            if (newCityInfo.timeTable) {
                city.timeTable = newCityInfo.timeTable;
            }
            if (newCityInfo.timeChart) {
                city.timeChart = newCityInfo.timeChart;
            }
            if (newCityInfo.dayTable) {
                city.dayTable = newCityInfo.dayTable;
            }
            if (newCityInfo.dayChart) {
                city.dayChart = newCityInfo.dayChart;
            }
            if (window.push && city.currentPosition == true) {
                if (window.push.getAlarm(index)) {
                    window.push.updateAlarm(index, city.address);
                }
            }
            city.loadTime = new Date();

            if (newCityInfo.source) {
                city.source = newCityInfo.source;
            }

            that.saveCities();
        };

        obj._loadCities = function () {
            var that = this;
            TwStorage.get(
                function (value) {
                    var items = JSON.parse(value);
                    if (items === null) {
                        createCity();
                        Util.ga.trackEvent('app', 'user', 'new');
                    } else {
                        items.forEach(function (item) {
                            createCity(item);
                        });
                        that._loadCitiesPreference(function (err) {
                            if (err) {
                                //restore cities
                                that._saveCitiesPreference(items);
                            }
                        });
                        Util.ga.trackEvent('app', 'user', 'returning', that.getCityCount());
                    }
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', "getCities");
                    Util.ga.trackException(err, false);
                },
                "cities");
        };

        obj._loadCityIndex = function () {
            var that = this;
            TwStorage.get(
                function (value) {
                    // load last cityIndex
                    cityIndex = JSON.parse(value);
                    if (cityIndex === null) {
                        that.setFirstCityIndex();
                    }
                    else if (cityIndex >= cities.length) {
                        console.log('city index is over');
                        that.setFirstCityIndex();
                    }
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', "getCityIndex");
                    Util.ga.trackException(err, false);
                },
                "cityIndex");
        };

        obj.loadCities = function() {
            var that = this;
            that._loadCities();
            that._loadCityIndex();
        };

        obj._saveCitiesPreference = function (cities) {
            var pList = {cityList: []};
            cities.forEach(function (city) {
                if (!city.disable) {
                    var simpleInfo = {};
                    if (city.name) {
                        simpleInfo.name = city.name;
                    }
                    simpleInfo.currentPosition = city.currentPosition;
                    simpleInfo.address = city.address;
                    simpleInfo.location = city.location;
                    simpleInfo.country = city.country;
                    pList.cityList.push(simpleInfo);
                }
            });

            TwStorage.set(
                function (result) {
                    console.log("city list save " + result);
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', 'setCityList');
                    Util.ga.trackException(err, false);
                },
                'cityList', JSON.stringify(pList));
        };

        obj._loadCitiesPreference = function (callback) {
            TwStorage.get(
                function (value) {
                    callback(undefined, value);
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', 'getCityList');
                    Util.ga.trackException(err, false);
                    callback(error);
                },
                'cityList');
        };

        obj.saveCities = function() {
            TwStorage.set(
                function (result) {
                    console.log("cities save " + result);
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', 'getCityList');
                    Util.ga.trackException(err, false);
                },
                "cities", JSON.stringify(cities));

            this._saveCitiesPreference(cities);
        };

        obj.loadTowns = function() {
            var that = this;

            that.towns = window.towns;
        };

        //endregion

        return obj;
    });
