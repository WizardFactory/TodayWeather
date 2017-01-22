/**
 * Created by Peter on 2017. 1. 15..
 */

"use strict";

var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var keybox = require('../../config/config').keyString;
var mongoBackup = require('mongo-backup-to-s3');

global.log  = new Logger(__dirname + "/debug.log");

var backupConfig = {
    mongodb:{
        url: ''
    },
    s3:{
        bucket:'',
        folder:'',
        key: '',
        secret: ''
    }
};

describe('practice', function(){
    it('time test 1 ', function(done){

        mongoBackup.dumpToS3(backupConfig, function(err){
            if(err){
                log.info('Fail to backup : ', err);
                return done();
            }

            done();
        });
    });

});