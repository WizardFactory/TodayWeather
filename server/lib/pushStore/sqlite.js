/**
 * Push registrations in a SQLite file on tw-svc (#2626), written by the service workers and the push worker.
 *
 * Each record is kept as JSON in `doc` with the fields of the former Mongo models; the other columns exist for
 * keys and selection. `rec_key` is the Mongo upsert key: token (registrationId, else fcmToken), type, cityIndex, id.
 * Bump SCHEMA_VERSION on any schema change. Keep to Node 10 syntax and APIs.
 */
'use strict';

var sqliteFileStore = require('../sqliteFileStore');

var SCHEMA_VERSION = 1;
var TABLE_SQL = ' (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
    'rec_key TEXT NOT NULL UNIQUE, ' +
    'registration_id TEXT, ' +
    'fcm_token TEXT, ' +
    'enable INTEGER, ' +
    'push_time INTEGER, ' +
    'start_time INTEGER, ' +
    'end_time INTEGER, ' +
    'reverse_time INTEGER, ' +
    'updated_at TEXT, ' +
    'doc TEXT NOT NULL)';
var SCHEMA_SQL = 'CREATE TABLE alarms' + TABLE_SQL + '; ' +
    'CREATE INDEX alarms_push_time ON alarms (push_time); ' +
    'CREATE INDEX alarms_fcm_token ON alarms (fcm_token); ' +
    'CREATE INDEX alarms_registration_id ON alarms (registration_id); ' +
    'CREATE TABLE alerts' + TABLE_SQL + '; ' +
    'CREATE INDEX alerts_fcm_token ON alerts (fcm_token); ' +
    'CREATE INDEX alerts_registration_id ON alerts (registration_id);';

var COMMON_FIELDS = ['type', 'registrationId', 'fcmToken', 'cityIndex', 'id', 'enable', 'town', 'geo', 'lang', 'name',
    'source', 'units', 'updatedAt', 'updatedBy', 'timezoneOffset', 'dayOfWeek', 'package', 'uuid', 'appVersion'];
var TABLES = {
    alarms: {fields: COMMON_FIELDS.concat(['pushTime']), defaults: {}},
    alerts: {
        fields: COMMON_FIELDS.concat(['startTime', 'endTime', 'reverseTime', 'airAlertsBreakPoint', 'precipAlerts',
            'airAlerts']),
        // Mongoose model defaults, applied when a record is created.
        defaults: {reverseTime: false, enable: true}
    }
};
var TOKEN_COLUMNS = {fcmToken: 'fcm_token', registrationId: 'registration_id'};
var SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function pick(table, info) {
    var doc = {};
    TABLES[table].fields.forEach(function (field) {
        if (info[field] !== undefined) {
            doc[field] = info[field];
        }
    });
    return doc;
}

function recKey(doc) {
    var token = doc.registrationId ? doc.registrationId : doc.fcmToken;
    return JSON.stringify([token === undefined ? null : token, doc.type === undefined ? null : doc.type,
        doc.cityIndex === undefined ? null : doc.cityIndex, doc.id === undefined ? null : doc.id]);
}

function toDate(value) {
    return value === undefined || value === null ? value : new Date(value);
}

/** Return a record like a lean Mongo document: `_id` and Date fields. */
function revive(row) {
    var doc = JSON.parse(row.doc);
    doc._id = row.id;
    if (doc.updatedAt) {
        doc.updatedAt = toDate(doc.updatedAt);
    }
    ['precipAlerts', 'airAlerts'].forEach(function (field) {
        if (doc[field] && doc[field].pushTime) {
            doc[field].pushTime = toDate(doc[field].pushTime);
        }
    });
    return doc;
}

function select(db, table, where, params) {
    var stmt = db.prepare('SELECT id, doc, updated_at FROM ' + table + (where ? ' WHERE ' + where : '') +
        ' ORDER BY id');
    var rows = [];
    try {
        stmt.bind(params || []);
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
    }
    finally {
        stmt.free();
    }
    return rows;
}

function flag(value) {
    return value === undefined || value === null ? null : (value ? 1 : 0);
}

function write(db, table, rowId, doc) {
    var stored = JSON.stringify(doc, function (key, value) {
        return key === '_id' ? undefined : value;
    });
    var values = [recKey(doc), doc.registrationId || null, doc.fcmToken || null, flag(doc.enable),
        doc.pushTime === undefined ? null : doc.pushTime,
        doc.startTime === undefined ? null : doc.startTime, doc.endTime === undefined ? null : doc.endTime,
        flag(doc.reverseTime), doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null, stored];
    if (rowId === null) {
        db.run('INSERT INTO ' + table + ' (rec_key, registration_id, fcm_token, enable, push_time, start_time, ' +
            'end_time, reverse_time, updated_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', values);
    }
    else {
        db.run('UPDATE ' + table + ' SET rec_key = ?, registration_id = ?, fcm_token = ?, enable = ?, push_time = ?, ' +
            'start_time = ?, end_time = ?, reverse_time = ?, updated_at = ?, doc = ? WHERE id = ?',
            values.concat([rowId]));
    }
}

function findByKey(db, table, key) {
    var rows = select(db, table, 'rec_key = ?', [key]);
    return rows.length ? rows[0] : null;
}

function upsert(db, table, info) {
    var incoming = pick(table, info);
    var existing = findByKey(db, table, recKey(incoming));
    if (existing) {
        write(db, table, existing.id, Object.assign(revive(existing), incoming));
        return {n: 1, nModified: 1, ok: 1};
    }
    write(db, table, null, Object.assign({}, TABLES[table].defaults, incoming));
    return {n: 1, nModified: 0, upserted: 1, ok: 1};
}

/** Replace a token in every record. A record that would collide with another one of the new token keeps the newer. */
function updateToken(db, table, kind, newToken, oldToken) {
    var rows = select(db, table, TOKEN_COLUMNS[kind] + ' = ?', [oldToken]);
    rows.forEach(function (row) {
        var doc = revive(row);
        doc[kind] = newToken;
        var other = findByKey(db, table, recKey(doc));
        if (other && other.id !== row.id) {
            var otherTime = other.updated_at || '';
            if (otherTime >= (row.updated_at || '')) {
                db.run('DELETE FROM ' + table + ' WHERE id = ?', [row.id]);
                return;
            }
            db.run('DELETE FROM ' + table + ' WHERE id = ?', [other.id]);
        }
        write(db, table, row.id, doc);
    });
    return {n: rows.length, nModified: rows.length, ok: 1};
}

function remove(db, table, selector) {
    var where = [TOKEN_COLUMNS[selector.tokenKind] + ' = ?'];
    var params = [selector.token];
    var ids = select(db, table, where.join(' AND '), params).filter(function (row) {
        var doc = JSON.parse(row.doc);
        if (selector.cityIndex !== undefined && doc.cityIndex !== selector.cityIndex) {
            return false;
        }
        return !(selector.id !== undefined && doc.id !== selector.id);
    }).map(function (row) { return row.id; });
    ids.forEach(function (id) {
        db.run('DELETE FROM ' + table + ' WHERE id = ?', [id]);
    });
    return {n: ids.length, ok: 1};
}

function disableByFcm(db, table, fcmToken, now) {
    var rows = select(db, table, 'fcm_token = ?', [fcmToken]);
    rows.forEach(function (row) {
        write(db, table, row.id, Object.assign(revive(row), {enable: false, updatedAt: now, updatedBy: 'push'}));
    });
    return {n: rows.length, nModified: rows.length, ok: 1};
}

function callbackify(promise, callback) {
    promise.then(function (result) {
        callback(undefined, result);
    }, function (err) {
        callback(err);
    });
}

function create(file) {
    var store = sqliteFileStore.create({file: file, schemaSql: SCHEMA_SQL, version: SCHEMA_VERSION,
        name: 'push store'});

    function mutate(fn, callback) {
        callbackify(store.mutate(fn), callback);
    }

    function read(fn, callback) {
        callbackify(store.read(fn), callback);
    }

    return {
        kind: 'sqlite',
        file: file,

        upsertAlarm: function (pushInfo, callback) {
            mutate(function (db) { return upsert(db, 'alarms', pushInfo); }, callback);
        },
        removeAlarms: function (selector, callback) {
            mutate(function (db) { return remove(db, 'alarms', selector); }, callback);
        },
        updateAlarmToken: function (kind, newToken, oldToken, callback) {
            mutate(function (db) { return updateToken(db, 'alarms', kind, newToken, oldToken); }, callback);
        },
        disableAlarmsByFcm: function (fcmToken, callback) {
            mutate(function (db) { return disableByFcm(db, 'alarms', fcmToken, new Date()); }, callback);
        },
        getAlarmsByTime: function (time, callback) {
            read(function (db) {
                return select(db, 'alarms', 'push_time = ? AND (enable IS NULL OR enable != 0)', [time]).map(revive);
            }, callback);
        },
        /** The unique record key already prevents duplicates. */
        removeDuplicateAlarms: function (callback) {
            callback(null);
        },

        upsertAlert: function (alertPush, callback) {
            mutate(function (db) { return upsert(db, 'alerts', alertPush); }, callback);
        },
        removeAlerts: function (selector, callback) {
            mutate(function (db) { return remove(db, 'alerts', selector); }, callback);
        },
        updateAlertToken: function (kind, newToken, oldToken, callback) {
            mutate(function (db) { return updateToken(db, 'alerts', kind, newToken, oldToken); }, callback);
        },
        disableAlertsByFcm: function (fcmToken, callback) {
            mutate(function (db) { return disableByFcm(db, 'alerts', fcmToken, new Date()); }, callback);
        },
        /** Enabled alerts whose window contains `time`, unless a precipitation or air alert was sent in 6 hours. */
        getAlertsByTime: function (time, callback) {
            var limit = Date.now() - SIX_HOURS_MS;
            read(function (db) {
                return select(db, 'alerts', 'enable = 1 AND ((reverse_time = 0 AND start_time <= ? AND end_time >= ?)' +
                    ' OR (reverse_time = 1 AND (start_time <= ? OR end_time >= ?)))', [time, time, time, time])
                    .map(revive)
                    .filter(function (alert) {
                        return ['precipAlerts', 'airAlerts'].every(function (field) {
                            return !(alert[field] && alert[field].pushTime && alert[field].pushTime.getTime() >= limit);
                        });
                    });
            }, callback);
        },
        updateAlertState: function (alertPush, callback) {
            mutate(function (db) {
                var rows = select(db, 'alerts', 'id = ?', [alertPush._id]);
                rows.forEach(function (row) {
                    write(db, 'alerts', row.id, Object.assign(revive(row),
                        {airAlerts: alertPush.airAlerts, precipAlerts: alertPush.precipAlerts}));
                });
                return {n: rows.length, nModified: rows.length, ok: 1};
            }, callback);
        },
        removeDuplicateAlerts: function (callback) {
            callback(null);
        },
        /**
         * The Mongo cleanup queries a misspelled field (`updateAt`) and removes nothing; keep that effective
         * behavior here instead of starting to delete alerts as part of the storage move.
         */
        removeOldAlerts: function (before, callback) {
            callback(null, {n: 0, ok: 1});
        }
    };
}

module.exports = {
    create: create,
    SCHEMA_VERSION: SCHEMA_VERSION,
    SCHEMA_SQL: SCHEMA_SQL
};
