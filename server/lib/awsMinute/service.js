'use strict';
var policy = require('./policy');
// No DB dependency is loaded until an enabled request asks for enrichment.
exports.enrich = function (req, res, next, options) {
    options = options || {};
    if (!options.enabled || !req.current) return next();
    var completed = false,
        timer,
        schedule = options.schedule || setTimeout,
        cancel = options.cancel || clearTimeout;
    function finish(result) {
        if (completed) return;
        completed = true;
        cancel(timer);
        if (result && result !== req.current) {
            req.current = result;
            var remaining = Math.max(
                0,
                Math.floor(
                    (+new Date(result.minuteObservation.observedAt) +
                        policy.WINDOW -
                        (options.now || Date.now)()) /
                        1000,
                ),
            );
            res.setHeader('Cache-Control', 'max-age=' + Math.min(120, remaining));
        }
        next();
    }
    timer = schedule(function () {
        finish();
    }, 3000);
    Promise.resolve()
        .then(async function () {
            var store = options.store || require('./store').create();
            var mapping = await store.mapping(options.town);
            if (completed || !mapping) return finish();
            var now = (options.now || Date.now)();
            var row = await store.latest(mapping.stationId, now);
            if (completed) return;
            finish(
                policy.overlay(
                    req.current,
                    row,
                    mapping,
                    req._awsMinuteSources,
                    (options.now || Date.now)(),
                ),
            );
        })
        .catch(function () {
            finish();
        });
};
