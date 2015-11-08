/**
 *
 */

'use strict';

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

mongoose.connect(config.db.path, function(err) {
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

global.manager = new controllerManager();
global.townRss = new controllerShortRss();

if (config.mode === 'gather' || config.mode === 'local') {
    manager.startManager();
    townRss.StartShortRss();
}

var keyBox = require('./config/config').keyString;

var taskKmaIndexService = new (require('./lib/lifeIndexKmaRequester'))();
taskKmaIndexService.setServiceKey(keyBox.cert_key);
//client요청이 있을때 실행함
//taskKmaIndexService.start();

var keco = new (require('./lib/kecoRequester.js'))();
keco.setServiceKey(keyBox.pokers);
keco.setDaumApiKey(keyBox.daum_key);
//client요청이 있을때 실행함
//keco.start();

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
