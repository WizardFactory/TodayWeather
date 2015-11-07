/**
 * Created by aleckim on 2015. 10. 29..
 */

'use strict';

var LifeIndexKma = require('../models/lifeIndexKma');

function LifeIndexKmaController() {

}

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
        }
        return true;
    }

    return false;
};

LifeIndexKmaController._appendFromKma = function (town, callback){
    var keyBox = require('../config/keydata').keyString;
    var lifeIndexKma = new (require('../lib/lifeIndexKmaRequester'))();
    lifeIndexKma.setServiceKey(keyBox.pokers);
    lifeIndexKma.getLifeIndexByTown(town, callback);
};

LifeIndexKmaController._appendFromDb = function(town, callback) {
    LifeIndexKma.findOne({town:town}, function (err, indexData) {
        if (err) {
            log.error(err);
            return callback(err);
        }
        if (!indexData) {
            err = new Error('Fail to find indexData ' + town.toString());
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
        log.debug(indexData.toString());

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
        if (err || self.needToUpdate()) {
            self._appendFromKma(town, function(err, indexData) {
                if (err) {
                    return callback(err);
                }
                self._addIndexData(indexData, shortList, midList, callback);
            });
        }
        else {
            self._addIndexData(indexData, shortList, midList, callback);
        }
    });
};

module.exports = LifeIndexKmaController;
