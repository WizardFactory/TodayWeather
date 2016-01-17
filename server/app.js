/**
 *
 */

'use strict';

require('newrelic');

var express = require('express');
var path = require('path');
//var favicon = require('serve-favicon');
//var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');

var routes = require('./routes/index');
var users = require('./routes/users');

var townForecast = require('./routes/routeTownForecast');
var controllerManager = require('./controllers/controllerManager');
var controllerShortRss = require('./controllers/controllerShortRss');
/*
* wizard factory's modules
*/
var config = require('./config/config');
var Logger = require('./lib/log');

if (process.env.NODE_ENV === 'production') {
    global.log  = new Logger();
}
else {
    global.log  = new Logger(__dirname + "/debug.log");
}

// Bootstrap db connection
log.info(config.db.path);

var options = { server: { socketOptions: { keepAlive: 1, connectTimeoutMS: 30000 } },
                replset: { socketOptions: { keepAlive: 1, connectTimeoutMS : 30000 } } };

mongoose.connect(config.db.path, options, function(err) {
    if (err) {
        log.error('Could not connect to MongoDB! ' + config.db.path);
        log.error(err);
    }
});

var app = express();


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/users', users);
app.use('/town', townForecast);

global.curString = ['t1h', 'rn1', 'sky', 'uuu', 'vvv', 'reh', 'pty', 'lgt', 'vec', 'wsd'];
//global.shortString = ['pop', 'pty', 'r06', 'reh', 's06', 'sky', 't3h', 'tmn', 'tmx', 'uuu', 'vvv', 'wav', 'vec', 'wsd'];
global.shortString = ['pop', 'pty', 'r06', 'reh', 's06', 'sky', 't3h', 'tmn', 'tmx'];
global.shortestString = ['pty', 'rn1', 'sky', 'lgt'];
global.commonString = ['date', 'time'];
global.rssString = ['ftm', 'date', 'temp', 'tmx', 'tmn', 'sky', 'pty', 'wfKor', 'wfEn', 'pop', 'r12', 's12', 'ws', 'wd', 'wdKor', 'wdEn', 'reh', 'r06', 's06'];
global.forecastString = ['cnt', 'wfsv'];
global.tempString = ['taMin3', 'taMax3', 'taMin4', 'taMax4', 'taMin5', 'taMax5', 'taMin6', 'taMax6',
    'taMin7', 'taMax7', 'taMin8', 'taMax8', 'taMin9', 'taMax9', 'taMin10', 'taMax10'];
global.seaString = ['wf3Am', 'wf3Pm', 'wf4Am', 'wf4Pm', 'wf5Am', 'wf5Pm', 'wf6Am', 'wf6Pm',
    'wf7Am', 'wf7Pm', 'wf8', 'wf9', 'wf10',
    'wh3AAm', 'wh3APm', 'wh3BAm', 'wh3BPm', 'wh4AAm', 'wh4APm', 'wh4BAm', 'wh4BPm',
    'wh5AAm', 'wh5APm', 'wh5BAm', 'wh5BPm', 'wh6AAm', 'wh6APm', 'wh6BAm', 'wh6BPm',
    'wh7AAm', 'wh7APm', 'wh7BAm', 'wh7BPm', 'wh8A', 'wh8B', 'wh9A', 'wh9B', 'wh10A', 'wh10B'];
global.landString = ['wf3Am', 'wf3Pm', 'wf4Am', 'wf4Pm', 'wf5Am', 'wf5Pm',
    'wf6Am', 'wf6Pm', 'wf7Am', 'wf7Pm', 'wf8', 'wf9', 'wf10'];
global.manager = new controllerManager();
global.townRss = new controllerShortRss();


var keyBox = require('./config/config').keyString;

if (config.mode === 'gather' || config.mode === 'local') {
    manager.startManager();
}

var taskKmaIndexService = new (require('./lib/lifeIndexKmaRequester'))();
taskKmaIndexService.setServiceKey(keyBox.cert_key);
//client요청이 있을때 실행함
//taskKmaIndexService.start();

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});


if (config.mode === 'gather') {
    setInterval(
        function() {
            var req = require('request');
            var url = 'http://'+ config.ipAddress + ':' + config.port;
            log.info('keep alive : ' + url);
            req(url, function (err, response, body) {
                if (err) { log.error(err);
                }
                log.silly(body);
            });
        },
        1000*60); //check 1 min
}

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});


module.exports = app;
