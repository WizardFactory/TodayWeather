/**
 * Created by aleckim on 2017. 12. 8..
 */

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

var UnitConverter = require('../lib/unitConverter');

describe('unit test - unit converter', function() {
    it('test wdd to string', function () {
        var ts = {
            '__': function (str) {
                switch (str) {
                    case 'LOC_N':
                        return '북';
                    case 'LOC_S':
                        return '남';
                    case 'LOC_E':
                        return '동';
                    case 'LOC_W':
                        return '서';
                }
                return '';
            }
        };
        var wdd = UnitConverter.wdd2Str('NSSEWNSEW', ts);
        assert(wdd, '북남남동서북남동서');
    });
});

