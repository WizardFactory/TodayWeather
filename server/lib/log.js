/**
 * Created by Peter on 2015. 7. 29..
 */
"use strict";

var LeNode = require('le_node');
var winston = require('winston');
var config = require('../config/config');

//silly, debug, verbose, info, warn, error

var LogentriesToken = config.logToken[config.mode];

module.exports = function() {
    var transports = [];

    var options = {
        level: 'info',
        colorize: true };

    if (process.env.NODE_ENV === 'production') {
       options.level = 'error';
    }

    transports.push(new winston.transports.Console(options));

    if (LogentriesToken && LogentriesToken.length > 0) {
        transports.push(new winston.transports.Logentries({
            level: 'info',
            token: LogentriesToken
        }));
    }

    var logger = new winston.Logger({
        transports: transports
    });

    return logger;
};

