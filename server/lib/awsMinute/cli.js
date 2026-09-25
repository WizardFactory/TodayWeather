'use strict';
exports.parse = function (argv, env) {
    var allowed = ['--dry-run', '--once'];
    if (
        argv.some(function (a) {
            return allowed.indexOf(a) < 0;
        }) ||
        new Set(argv).size !== argv.length
    )
        throw new Error('Usage: collect-aws-minute.js [--dry-run] [--once]');
    return {
        dryRun: argv.indexOf('--dry-run') >= 0,
        once: argv.indexOf('--once') >= 0,
        enabled: env.AWS_MINUTE_COLLECT_ENABLED === 'true',
    };
};
exports.run = async function (options, adapters) {
    if (!options.enabled && !options.dryRun) return { disabled: true };
    var Collector = require('./collector');
    var collector, stopPromise;
    var stop = function () {
        if (!stopPromise)
            stopPromise = (async function () {
                try {
                    if (collector) await collector.stop();
                } finally {
                    if (adapters.closeStore) await adapters.closeStore();
                }
            })();
        return stopPromise;
    };
    try {
        var store = options.dryRun ? null : await adapters.openStore();
        collector = new Collector(
            Object.assign({}, options, { store: store, fetch: adapters.fetch, log: adapters.log }),
        );
        if (adapters.onStop) adapters.onStop(stop);
        var result = await collector.start();
        if (options.once) await stop();
        return result;
    } catch (e) {
        await stop();
        throw e;
    }
};
