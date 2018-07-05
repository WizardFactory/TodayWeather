/**
 * Created by Peter on 2015. 7. 29..
 */
"use strict";

var winston = require('winston');
var config = require('../config/config');
require('winston-logentries');

//silly, debug, verbose, info, warn, error

var LogentriesToken = config.logToken[config.mode];

module.exports = function(filename) {
    var transports = [];

    var options = {level: 'info', colorize: true};
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

    if (filename) {
        transports.push(new winston.transports.File({
                level      : 'error',
                json       : false,
                filename   : filename
            }));
    }

    var logger = new winston.Logger({
        levels: {
            silly: 0,
            input: 1,
            verbose: 2,
            prompt: 3,
            debug: 4,
            info: 5,
            data: 6,
            help: 7,
            warn: 8,
            error: 9
        },
        colors: {
            silly: 'magenta',
            input: 'grey',
            verbose: 'cyan',
            prompt: 'grey',
            debug: 'blue',
            info: 'green',
            data: 'grey',
            help: 'cyan',
            warn: 'yellow',
            error: 'red'
        },
        transports: transports
    });
    logger.exitOnError = false;
    return logger;
};

