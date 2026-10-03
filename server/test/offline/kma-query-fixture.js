'use strict';
// Real pinned schema/Query implementation. Only exec (fixture persistence) is replaced.
const assert = require('assert');
const h = require('./harness');
const mongoose = require('mongoose');
const expected = require('../../package.json').dependencies.mongoose;
assert.strictEqual(expected, '5.1.2');
assert.strictEqual(mongoose.version, expected, 'Use the exact production mongoose dependency');
exports.mongoose = mongoose;
exports.create = function (rows = {}, error) {
    const instance = new mongoose.Mongoose();
    const queries = [];
    const models = {};
    for (const name of ['modelKmaStnInfo', 'modelKmaStnHourly2']) {
        const model = h.load('models/' + name + '.js', {mongoose: instance});
        const find = model.find;
        model.find = function () {
            const query = find.apply(this, arguments);
            query.exec = function (callback) {
                assert(query instanceof mongoose.Query, 'Query construction must remain real');
                assert.strictEqual(query.options.maxTimeMS, 2000);
                assert.strictEqual(query._mongooseOptions.lean, true);
                queries.push({name, query});
                setImmediate(() => callback(error || null, rows[name] || []));
            };
            return query;
        };
        models[name] = model;
    }
    function controller() {
        const deps = {async: require('async'), '../lib/kmaTimeLib': require('../../lib/kmaTimeLib'),
            './controller.weather.desc': require('../../controllers/controller.weather.desc')};
        for (const name of ['modelKmaStnDaily', 'modelKmaStnHourly', 'modelKmaStnHourly2',
            'modelKmaStnMinute', 'modelKmaStnMinute2', 'modelKmaStnInfo']) {
            deps['../models/' + name] = models[name] || {};
        }
        return h.load('controllers/controllerKmaStnWeather.js', deps, {log: h.logger([])});
    }
    return {models, queries, controller};
};
