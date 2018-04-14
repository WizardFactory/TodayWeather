/**
 * Created by aleckim on 2018. 4. 3..
 */

"use strict";

var mongoose = require('mongoose');

var kaqMapCaseSchema = new mongoose.Schema({
    date: Date,
    mapCase: String, //'', '_CASE2', '_CASE4', '_CASE5'
});

kaqMapCaseSchema.index({date: 1});

module.exports = mongoose.model('KaqMapCase', kaqMapCaseSchema);
