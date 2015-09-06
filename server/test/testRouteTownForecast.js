/**
 * Created by Peter on 2015. 8. 25..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');
var mongoose = require('mongoose');

global.log  = new Logger(__dirname + "/debug.log");

var db = mongoose.connect(config.db.path, config.db.options, function(err, seo) {
    if (err) {
        console.error('Could not connect to MongoDB!');
        console.log(err);
    }

});
mongoose.connection.on('error', function(err) {
        console.error('MongoDB connection error: ' + err);
        process.exit(-1);
    }
);
var dbmodel = require('../controllers/test');

describe('unit test - routeTownForecast class', function(){
/*
    it('routes/routeTownForecast : get towns SHORT info', function(done) {
        var testdb = new dbmodel({
            town: {first: 'seo', second: 'joong', third: 'su'},
            coord: {lon: 11, lat: 22},
            mData: {mCoord:{mx: 33, my: 44}}
        });
        var test2 = {
            town: {first: 'aaaa', second: 'bbb', third: 'ccc'},
            coord: {lon: 55, lat: 66},
            mData: {mCoord:{mx: 77, my: 88}}};
        var test3 = {
            town: {first: 'xx', second: 'yy', third: 'zz'},
            coord: {lon: 1111, lat: 2222},
            mData: {mCoord:{mx: 3333, my: 4444}}};

        testdb.save(function(err, doc){
            log.info('saved : '+ doc);
        });

        var items = [test2, test3];
        dbmodel.create(items, function(err, doc){
            log.info(doc[0].toString());
            log.info(doc[1].toString());
        });

        var query = dbmodel.findOne().where('town.first', 'aaaa');
        query.exec(function(err, doc){
            log.info('before:', doc.toString());

            //var change = {$set: {town: {first: 'kk', second: 'uu', third: 'tt'}}};
            var change = {$set: {'town.second': '33'}, $push: {'mData.data.current': {date: '1111', time:'2222', name:'3333'}}};
            var query2 = doc.update(change);
            query2.exec(function(err, result){
                log.info('result', result);
            });

            var query3 = dbmodel.findOne().where('town.second', '33');
            query3.exec(function(err, doc){
                log.info('after:', doc.toJSON());
            });


            log.info('end function');
        });
        dbmodel.save();


        //query.update({mData:{mCoord:xy}}, {$push: {mData:{mCoord:xy}}});
        //query.exec(function (err, result){
        //    log.info('exec');
        //    this.findOne({mData:{mCoord:xy}}), function(err, doc){
        //        log.info(doc.toJSON());
        //    };
        //    log.info(result);
        //});

        //testdb.test.push(x);
        //testdb.save(function(err){
        //    if(err){
        //        log.error('save failed');
        //    }
        //});

        //log.info(testdb.test.length);

        //testdb.save(function(err){
        //    log.info(String(err));
        //    testdb.state = 'open';
        //    testdb.save(callback);
        //});

        //testdb.setCurrentData('0100', currentObj, mcode, function(count){
        //    log.info('UPDATE', count);
        //    testdb.save(function(err){
        //        if(err){
        //            log.error('save failed');
        //        }
        //
        //        testdb.find({"mData":{"mCoord": {"mx":2, "my":2}}}, function(seo){
        //            log.info(seo);
        //        });
        //    })
        //});

        //testdb.getMdata(mcode, function(item){
        //    log.info(item);
        //});


        done();
    });
    */
});
