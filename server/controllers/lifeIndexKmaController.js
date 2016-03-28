/**
 * Created by aleckim on 2015. 10. 29..
 */

'use strict';

var LifeIndexKma = require('../models/lifeIndexKma');

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

LifeIndexKmaController._appendFromDb = function(town, callback) {
    LifeIndexKma.find({'town.first':town.first, 'town.second':town.second, 'town.third':town.third}).lean().exec(function (err, indexDataList) {
        if (err) {
            log.error(err);
            return callback(err);
        }
        var indexData = indexDataList[0];
        if (!indexData) {
            err = new Error('Fail to find indexData ' + JSON.stringify(town));
            log.error(err);
            return callback(err);
        }
        return callback(undefined, indexData);
    });
};

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

LifeIndexKmaController.needToUpdate = function(indexData) {
   //todo: check time
    if(indexData) {
        return false;
    }
    return true;
};

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
        log.debug('DiscomfortIndex > invalid parameter.');
        return -1;
    }

    var discomfortIndex = (9/5*temperature)-(0.55*(1-humidity/100)*(9/5*temperature-26))+32;

    return discomfortIndex.toFixed(1);
};

LifeIndexKmaController.convertStringFromDiscomfortIndex = function(discomfortIndex) {
    if(discomfortIndex === undefined
        || discomfortIndex < 0)
    {
        log.debug('DiscomfortString > invalid parameter');
        return "";
    }

    var discomfortString;

    if(discomfortIndex < 68) {
        discomfortString = "낮음";
    } else if(discomfortIndex < 75) {
        discomfortString = "보통";
    } else if(discomfortIndex < 80) {
        discomfortString = "높음";
    } else {
        discomfortString = "매우높음";
    }

    return discomfortString;
};

module.exports = LifeIndexKmaController;
