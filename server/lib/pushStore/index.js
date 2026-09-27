/**
 * Push registration store (#2626). `PUSH_STORE=sqlite` with `PUSH_DB_PATH` keeps registrations in a SQLite file on
 * tw-svc; unset or `mongo` keeps MongoDB. Resolved on first use, so loading the controllers needs no configuration.
 */
'use strict';

var store = null;

function get() {
    if (store) {
        return store;
    }
    var kind = process.env.PUSH_STORE || 'mongo';
    if (kind === 'sqlite') {
        if (!process.env.PUSH_DB_PATH) {
            throw new Error('PUSH_DB_PATH is required with PUSH_STORE=sqlite');
        }
        store = require('./sqlite').create(process.env.PUSH_DB_PATH);
    }
    else if (kind === 'mongo') {
        store = require('./mongo');
    }
    else {
        throw new Error('Unknown PUSH_STORE: ' + kind);
    }
    return store;
}

module.exports = {get: get};
