'use strict';

// Forecast calls use the same provider budgets as observations. They never
// escalate a request to the paid phase or delay the usual weather deadline.
module.exports = function createCoordinateForecast(options) {
    var ids = ['google', 'openweather'];
    return function fetch(gCoord, now, callback) {
        var lat = gCoord && gCoord.lat != null ? Number(gCoord.lat) : NaN;
        var lon = gCoord && gCoord.lon != null ? Number(gCoord.lon) : NaN;
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 ||
            !Number.isFinite(lon) || Math.abs(lon) > 180 ||
            !now || !Number.isFinite(now.getTime())) {
            return callback();
        }
        var coord = {lat: lat, lon: lon};
        var settled = false;
        var index = 0;
        var timer = setTimeout(finish, options.deadlineMs || 1800);
        function finish(result) {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                callback(result);
            }
        }
        function next() {
            if (settled) {
                return;
            }
            if (index === ids.length) {
                return finish();
            }
            var id = ids[index++];
            var provider = options.providers[id];
            if (!provider || typeof provider.fetchForecast !== 'function' || !provider.isConfigured(options.keyString)) {
                return next();
            }
            options.budget.check(id, 'forecast', 1, function (admission) {
                if (settled) {
                    return;
                }
                if (!admission || !admission.allowed) {
                    return next();
                }
                provider.fetchForecast(coord, now, options, function (result) {
                    var valid = !!(result && result.outcome === 'ok');
                    options.budget.record(id, 'forecast', {failed: !valid, cost: 1, reservation: admission.reservation}, function () {
                        if (!valid) {
                            if (result && (result.kind === 'auth' || result.kind === 'quota')) {
                                return options.budget.markDown(id, result.kind, next);
                            }
                            return next();
                        }
                        var credit = id === 'google' ? 'Source: Includes air quality data from Google' : provider.label;
                        finish({source: id, attribution: credit, retrievedAt: now.toISOString(), rows: result.rows});
                    });
                });
            });
        }
        next();
    };
};

module.exports.defaultService = function () {
    var config = require('../../config/air');
    return module.exports({
        axios: require('axios'),
        budget: require('./providerBudget').createBudget(),
        keyString: require('../../config/config').keyString,
        providers: {google: require('./providers/google'), openweather: require('./providers/openweather')},
        timeoutMs: Math.min(config.providerTimeoutMs, 800)
    });
};
