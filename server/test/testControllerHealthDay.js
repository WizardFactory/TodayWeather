/**
 * Created by neoqmin on 2016. 6. 21..
 */

var healthDay = require('../controllers/controllerHealthDay');
var mongoose = require('mongoose');
var config = require('../config/config');
var Logger = require('../lib/log');

mongoose.connect(config.db.path, config.db.options, function(err){
    if(err){
        console.error('could net connect to MongoDB');
        console.error(err);
    }
});

global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - health day index', function() {
    var requestUrl;
    
    this.timeout(60*1000);
    it('request', function(done) {
        for(var i=1;i<=7;i++) {
            requestUrl = healthDay.makeRequestString(i, 0);

            log.info('[healthday] get :' + requestUrl);

            healthDay.getData(requestUrl, function (err) {
                if (err) {
                    log.error(err);
                }
            });
        }
        setTimeout(done, 50*1000);
    });
});
