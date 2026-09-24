'use strict';

// Load before New Relic or any module that reads config/process.env.
// An absolute path keeps npm, direct Node and process-manager startup consistent.
var result = require('dotenv').config({
    path: require('path').join(__dirname, '../.env')
});

// Environment-only deployments remain supported. Do not expose file contents
// or raw filesystem error details in startup errors.
if (result.error && result.error.code !== 'ENOENT') {
    throw new Error('Unable to load server/.env (' + result.error.code + ')');
}
