'use strict';

var google = require('./googleForecast');
var http = require('../air/httpClient');

// Focus-market subset of the provider coverage table. CO and UY are absent.
var supportedCountries = new Set(['AR', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'DE',
    'ES', 'FR', 'GB', 'IE', 'JP', 'KR', 'MX', 'NZ', 'PT', 'US']);

function createCoordinateForecast(options) {
    return {
        supports: function (country) {
            return supportedCountries.has(country);
        },
        fetch: function (location, country, now, callback) {
            if (!supportedCountries.has(country) || !http.isValidKey(options.keyString && options.keyString.google_key)) {
                return callback();
            }
            var settled = false;
            var timer = setTimeout(finish, options.deadlineMs || 1800);
            function finish(result) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    callback(result);
                }
            }
            options.reserve(now, function (admitted) {
                if (settled || !admitted) {
                    return finish();
                }
                google.fetch(location, options, function (result) {
                    if (result.outcome !== 'ok' || result.region !== country) {
                        return finish();
                    }
                    finish({
                        source: result.source,
                        attribution: result.attribution,
                        region: result.region,
                        retrievedAt: now.toISOString(),
                        days: result.days
                    });
                });
            });
        }
    };
}

module.exports = createCoordinateForecast;

module.exports.defaultService = function (cap) {
    return createCoordinateForecast({
        axios: require('axios'),
        keyString: require('../../config/config').keyString,
        reserve: require('./monthlyBudget')(require('../../models/air.provider.usage.model'), cap),
        timeoutMs: 1400
    });
};
