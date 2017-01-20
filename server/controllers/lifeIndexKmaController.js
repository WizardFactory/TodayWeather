/**
 * Created by aleckim on 2015. 10. 29..
 */

'use strict';

var LifeIndexKma = require('../models/lifeIndexKma');
var async = require('async');

function LifeIndexKmaController() {

}

LifeIndexKmaController.fsnStr = function (grade) {
    switch(grade) {
        case 0: return "관심";
        case 1: return "주의";
        case 2: return "경고";
        case 3: return "위험";
        default: return "";
    }
};

LifeIndexKmaController._fsnGrade = function (value) {
    if (value < 35) {
        return 0; //관심
    }
    else if (value < 70) {
        return 1; //주의
    }
    else if (value < 95) {
        return 2; //경고
    }
    else {
        return 3; //위험
    }
};

LifeIndexKmaController.ultrvStr = function (grade) {
    switch(grade) {
        case 0: return "낮음";
        case 1: return "보통";
        case 2: return "높음";
        case 3: return "매우높음";
        case 4: return "위험";
        default: return "";
    }
};

LifeIndexKmaController._ultrvGrade = function (value) {
    if (value <=2) {
        return 0; //낮음
    }
    else if (value <=5) {
        return 1; //보통
    }
    else if (value <=7) {
        return 2; //높음
    }
    else if (value <=10) {
        return 3; //매우높음
    }
    else {
        return 4; //위험.
    }
};

LifeIndexKmaController._addIndexDataToList = function(destList, srcList, indexName) {
    var foundStartPoint = false;
    var i;
    var j;

    for (i=0; i<srcList.length; i++)  {
        for (j=0; j<destList.length; j++) {
            if (srcList[i].time) {

                //add data to shortList
                if (srcList[i].date === destList[j].date && srcList[i].time === destList[j].time) {
                    log.debug('Found date=' + destList[j].date + ' time='+ destList[j].time);
                    foundStartPoint = true;
                    break;
                }
            }
            else {

                //add data to midList
                if (srcList[i].date === destList[j].date) {
                    log.debug('Found date=' + destList[j].date);

                    foundStartPoint = true;
                    break;
                }
            }
        }
        if (foundStartPoint === true) {
            break;
        }
    }

    if (foundStartPoint) {
        for (; i<srcList.length && j<destList.length; i++, j++) {
            if (srcList[i].date != destList[j].date) {
                log.error('Fail to find lifeIndex data of date='+destList[j].date);
                //keep src index
                i--;
                continue;
            }

            log.debug('add data ' + srcList[i].value + ' to ' + destList[j].date + ' ' + indexName);
            (destList[j])[indexName] = srcList[i].value;
            //add grade
            if (indexName === 'fsn') {
                (destList[j])['fsnGrade'] = this._fsnGrade(srcList[i].value);
            }
            else if (indexName === 'ultrv') {
                (destList[j])['ultrvGrade'] = this._ultrvGrade(srcList[i].value);
            }
        }
        return true;
    }

    return false;
};

LifeIndexKmaController._appendFromKma = function (town, callback){
    var keyBox = require('../config/config').keyString;
    var lifeIndexKma = new (require('../lib/lifeIndexKmaRequester'))();
    lifeIndexKma.setServiceKey(keyBox.cert_key);
    lifeIndexKma.getLifeIndexByTown(town, callback);
};

/**
 *
 * @param town
 * @param callback
 * @private
 */
LifeIndexKmaController._appendFromDb = function(town, callback) {

    async.waterfall([
        function(cb)   {
            LifeIndexKma.find({'areaNo':town.areaNo}).lean().exec(function (err, indexDataList) {
                if (err || indexDataList.length === 0 || !(indexDataList[0].fsn.lastUpdateDate)) {
                    log.warn("it is not invalid town="+JSON.stringify(town));
                    return cb();
                }
                return cb('pass data', indexDataList[0]);
            });
        },
        function(cb) {
            var coords = [town.gCoord.lon, town.gCoord.lat];
            LifeIndexKma.find({geo: {$near:coords, $maxDistance: 0.3}}, {_id:0}).limit(3).lean().exec(function (err, indexDataList) {
                if (err)  {
                    return cb(err);
                }
                if (indexDataList.length === 0) {
                    return cb(new Error("Fail to find life index town="+JSON.stringify(town)));
                }
                for (var i=0; i<indexDataList.length; i++) {
                    if (indexDataList[i].fsn.lastUpdateDate) {
                        return cb(err, indexDataList[i]);
                    }
                }
            });
        }
    ], function(err, result) {
        if (result === undefined) {
            if (!err) {
                err = new Error("Fail to find life index town="+JSON.stringify(town));
            }
            return callback(err);
        }
        return callback(undefined, result);
    });
};

/**
 *
 * @param indexData
 * @param shortList
 * @param midList
 * @param callback
 * @private
 */
LifeIndexKmaController._addIndexData = function (indexData, shortList, midList, callback) {
    var ret = false;
    var self = this;
    try {
        log.debug(JSON.stringify(indexData));

        for (var k in indexData) {
            if (indexData[k] && indexData[k].lastUpdateDate) {

                log.debug('add ' + k + ' data to list');

                /*lifeIndexKma에서 lastUpdateDate만 있고 data는 저장안된 경우가 있음*/
                if (indexData[k].data.length === 0) {
                    log.warn(k + ' data is empty');
                    continue;
                }

                if (indexData[k].data[0].time) {
                    if (shortList) {
                        ret = self._addIndexDataToList(shortList, indexData[k].data, k);
                    }
                }
                else {
                    if (midList) {
                        ret = self._addIndexDataToList(midList, indexData[k].data, k);
                    }
                }
            }
        }

        callback(undefined, ret);
    }
    catch(e) {
        callback(e);
    }
};

/**
 *
 * @param indexData
 * @returns {boolean}
 */
LifeIndexKmaController.needToUpdate = function(indexData) {
   //todo: check time
    if(indexData) {
        return false;
    }
    return true;
};

/**
 *
 * @param town
 * @param shortList
 * @param midList
 * @param callback
 */
LifeIndexKmaController.appendData = function (town, shortList, midList, callback) {
    var self = this;
    this._appendFromDb(town, function(err, indexData) {
        if (err || self.needToUpdate(indexData)) {
            return callback(err);
        }
        else {
            self._addIndexData(indexData, shortList, midList, callback);
        }
    });
};

/**
 * @brief 불쾌지수를 구하는 함수
 * @param temperature       온도
 * @param humidity          습도
 * @returns {unsined int}   불퀘지수
 */
LifeIndexKmaController.getDiscomfortIndex = function(temperature, humidity) {
    if(temperature === undefined
        || humidity === undefined
        || temperature < -50
        || humidity < 0)
    {
        log.warn('DiscomfortIndex > invalid parameter.');
        return -1;
    }

    var discomfortIndex = (9/5*temperature)-(0.55*(1-humidity/100)*(9/5*temperature-26))+32;

    return Math.round(discomfortIndex);
};

LifeIndexKmaController.convertGradeFromDiscomfortIndex = function(discomfortIndex) {
    var discomfortGrade = 0;

    if(discomfortIndex === undefined
        || discomfortIndex < 0)
    {
        log.warn('DiscomfortString > invalid parameter');
        return discomfortGrade;
    }

    if(discomfortIndex < 68) {
        discomfortGrade = 1;
    } else if(discomfortIndex < 75) {
        discomfortGrade = 2;
    } else if(discomfortIndex < 80) {
        discomfortGrade = 3;
    } else {
        discomfortGrade = 4;
    }

    return discomfortGrade;
};

/**
 * 불쾌지수
 * @param discomfortIndex
 * @returns {*}
 */
LifeIndexKmaController.convertStringFromDiscomfortIndex = function(discomfortIndex) {
    if(discomfortIndex === undefined
        || discomfortIndex < 0)
    {
        log.warn('DiscomfortString > invalid parameter');
        return "";
    }

    var discomfortString;

    if(discomfortIndex < 68) {
        discomfortString = '낮음';
    } else if(discomfortIndex < 75) {
        discomfortString = '보통';
    } else if(discomfortIndex < 80) {
        discomfortString = '높음';
    } else {
        discomfortString = '매우높음';
    }

    return discomfortString;
};

/**
 * 부패지수
 * @param temperature
 * @param humidity
 * @returns {number}
 */
LifeIndexKmaController.getDecompositionIndex = function(temperature, humidity) {
    if(temperature === undefined
        || humidity === undefined
        || temperature < -50
        || humidity < 0)
    {
        log.warn('DecompositionIndex > invalid parameter.');
        return -1;
    }

    var index = (humidity - 65)/14*(Math.pow(1.054, temperature));
    
    if(index < 0) {
        index = 0;
    }

    return Math.round(index);
};

/**
 *
 * @param DecompositionIndex
 * @returns {*}
 */
LifeIndexKmaController.convertStringFromDecompositionIndex = function(DecompositionIndex) {
    if(DecompositionIndex === undefined
        || DecompositionIndex < 0)
    {
        log.warn('DecompositionString > invalid parameter');
        return "";
    }

    var decompositionString;

    if(DecompositionIndex > 7) {
        decompositionString = '높음';
    } else if(DecompositionIndex > 3) {
        decompositionString = '보통';
    } else {
        decompositionString = '낮음';
    }

    return decompositionString;
};

/**
 * 열지수
 * @param temperature
 * @param humidity
 * @returns {*}
 */
LifeIndexKmaController.getHeatIndex = function(temperature, humidity) {
    if(temperature === undefined
        || humidity === undefined
        || temperature < -50
        || humidity < 0)
    {
        log.warn('DecompositionIndex > invalid parameter.');
        return -1;
    }

    var t2 = (9.0/5.0)*temperature + 32;
    var v2 = humidity;
    var v3 = -42.379 + (2.04901523*t2) + (10.14333127*v2)-(0.22475541*t2*v2) - (0.00683783*t2*t2) - (0.05481717*v2*v2) + (0.00122874*t2*t2*v2)+(0.00085282*t2*v2*v2) - (0.00000199*t2*t2*v2*v2);

    var f_adj = 0.0;

    if(v2 < 13 && t2 >= 80 && t2 <= 112) {
        f_adj = 0.25*(13-v2) * Math.sqrt((17-Math.abs(t2-95.0))/17.0);
        v3 = v3 - f_adj;
    }

    if(v2 > 85.0 && t2 >= 80.0 && t2 <= 87) {
        f_adj = (v2-85)/10.0 * (87-t2) / 5.0;
        v3 = v3 + f_adj;
    }

    if(t2 < 80.0) {
        v3 = t2;
    }

    v3 = (v3-32)*(5.0/9.0);
    v3 = Math.round(v3*10) / 10.0;

    return +v3.toFixed(1);
};

/**
 *
 * @param heatIndex
 * @returns {*}
 */
LifeIndexKmaController.convertStringFromHeatIndex = function(heatIndex) {
    if(heatIndex === undefined
        || heatIndex < 0) 
    {
        log.warn('HeatIndexString > invalid parameter');
        return "";
    }
        
    var heatIndexString;
    
    if(heatIndex >= 54) {
        heatIndexString = '매우높음';
    } else if(heatIndex >= 41 && heatIndex < 54) {
        heatIndexString = '높음';
    } else if(heatIndex >= 32 && heatIndex < 41) {
        heatIndexString = '보통';
    } else {
        heatIndexString = '낮음';
    }
    
    return heatIndexString;
};

/**
 * 동상가능지수
 * @param temperature
 * @returns {*}
 */
LifeIndexKmaController.getFrostString = function(temperature) {
    if(temperature === undefined
        || temperature < -50)
    {
        log.warn('FrostString > invalid parameter.');
        return -1;
    }

    var frostString;

    if(temperature < -5) {
        frostString = '높음';
    } else if(temperature < -1.5) {
        frostString = '보통';
    } else {
        frostString = '낮음';
    }

    return frostString;
};

/**
 *
 * @param temperature
 * @param yesterMinTemperature
 * @returns {*}
 */
LifeIndexKmaController.getFreezeString = function(temperature, yesterMinTemperature) {
    if(temperature === undefined
        || temperature < -50)
    {
        log.warn('FrostString > invalid parameter.');
        return -1;
    }

    var freezeString;

    if(temperature <= -10) {
        freezeString = '매우높음';
    } else if((temperature <= -5)
                && (yesterMinTemperature < -5))
    {
        freezeString = '높음';
    } else if((temperature <= -5)
                && (yesterMinTemperature >= -5))
    {
        freezeString = '보통';
    } else {
        freezeString = '낮음';
    }

    return freezeString;
};

module.exports = LifeIndexKmaController;
