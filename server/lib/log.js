/**
 * Created by Peter on 2015. 7. 29..
 */
"use strict";

var winston = require('winston');

//silly, debug, verbose, info, warn, error

module.exports = function(filename) {
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
            error: 9,
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
            error: 'red',
        },
        transports: [
            new winston.transports.Console({
                level      : 'info',
                colorize   : true
            }),
            new winston.transports.File({
                level      : 'error',
                json       : false,
                filename   : filename
            })
        ]
    });
    logger.exitOnError = false;
    return logger;
};

