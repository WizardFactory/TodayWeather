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

LifeIndexKmaController.appendData = function (town, shortList, midList, callback) {
    var self = this;
    //find
    LifeIndexKma.findOne({town:town}, function (err, indexData) {
        if (err) {
            log.error(err);
            return callback(err);
        }

        var ret = false;
        log.debug(indexData.toString());

        for(var k in indexData) {
            if (indexData[k] && indexData[k].lastUpdateDate) {

                log.debug('add ' + k + ' data to list');
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
    });
};

module.exports = LifeIndexKmaController;
