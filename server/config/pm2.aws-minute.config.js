'use strict';
// Explicit operator start only. Supply AWS_MINUTE_MONGODB_URI out of band.
module.exports = {
    apps: [
        {
            name: 'todayweather-aws-minute',
            script: require('path').resolve(__dirname, '../bin/collect-aws-minute.js'),
            cwd: require('path').resolve(__dirname, '..'),
            exec_mode: 'fork',
            instances: 1,
            autorestart: false,
            kill_timeout: 15000,
            env: {
                AWS_MINUTE_COLLECT_ENABLED:
                    process.env.AWS_MINUTE_COLLECT_ENABLED === 'true' ? 'true' : 'false',
            },
        },
    ],
};
