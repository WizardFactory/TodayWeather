'use strict';
var policy = require('./policy');
exports.parse = function (args, now) {
    var out = {};
    for (var i = 0; i < args.length; i += 2) {
        var name = args[i];
        if (['--station', '--start', '--end'].indexOf(name) < 0 || !args[i + 1] || out[name])
            throw new Error('Usage: --station ID --start YYYYMMDD --end YYYYMMDD');
        out[name] = args[i + 1];
    }
    var station = policy.station(out['--station']);
    if (!station) throw new Error('One ASOS station is required');
    policy.range('daily', out['--start'], out['--end'], now);
    return { station: station, start: out['--start'], end: out['--end'] };
};
