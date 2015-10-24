/**
 * Created by kay
 * */

var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');

mongoose.connect(config.db.path, config.db.options);

var fs = require('fs');
var lineList = fs.readFileSync('./utils/data/test.csv').toString().split('\n');
lineList.shift(); //  header remove

var bSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    mCoord:{
        mx: Number,
        my: Number
    }
});

var mSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
        third: String
    },
    regId : String
});

var forecastNameList = ['short', 'current'];
var midNameList = ['midLand', 'midTemp', 'midSea'];
//var collectionNameList = ['town', 'short', 'current'];
var bDoc = null;
var mDoc = null;

function setCollectionName(name){
    bDoc = mongoose.model(name, bSchema);
    //bDoc.toObject({retainKeyOrder: true});
}

function setMidCollectionNane(name){
    mDoc = mongoose.model(name, mSchema);
}

function createDoc(){
    lineList.forEach(function(line, idx){
        var tempCoord = {lon: 0 , lat: 0};
        var doc = new bDoc();
        line.split(',').forEach(function (entry, i) {
             if(i == 0) doc.town.first = entry;
             else if(i == 1) doc.town.second = entry;
             else if(i == 2) doc.town.third = entry;
             else if(i == 3) tempCoord.lat = entry;
             else if(i == 4) tempCoord.lon = entry;

             if(tempCoord.lon != null && tempCoord.lat != null){
                 var conv = new convert(tempCoord, {}).toLocation();
                 doc.mCoord.mx = conv.getLocation().x;
                 doc.mCoord.my = conv.getLocation().y;
             }
//             console.log(doc);
        });

        doc.save(function(err){
            if(err) process.exit(1);
            if(idx + 1 == lineList.length) process.exit(0);
        });
    });
}

function createMidDoc(){
    lineList.forEach(function(line, idx){
        var doc = new mDoc();
        line.split(',').forEach(function(entry, i){
            if(i == 0) doc.town.first = entry;
            else if(i == 1) doc.town.second = entry;
            else if(i == 2) doc.town.third = entry;
            else if(i == 3) doc.regId = entry;
        });

        doc.save(function(err){
            if(err) process.exit(1);
            if(idx + 1 == lineList.length) process.exit(0);
        });
    });
}

function run(){
    forecastNameList.forEach(function(name, idx){
        setCollectionName(name);
        createDoc();
    });

    midNameList.forEach(function(name, idx){
        setMidCollectionNane(name);
        createMidDoc();
    });
}

run();
