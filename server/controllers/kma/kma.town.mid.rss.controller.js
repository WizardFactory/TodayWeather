/**
 * Created by aleckim on 2015. 12. 26..
 */

'use strict';

function midRssKmaController() {

}

midRssKmaController.getData = function(regId, callback) {
    callback(new Error('Legacy mid RSS unavailable: retired feed'));
    return this;
};

midRssKmaController.overwriteData = function(reqMidData, regId, callback) {
    // Applies to empty and populated targets, regardless of cached publication.
    callback(null, reqMidData);
    return this;
};

module.exports = midRssKmaController;
