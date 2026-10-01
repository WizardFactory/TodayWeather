'use strict';
// Execute the unchanged legacy controller comparison, including its translation
// callback. No Angular app, browser, request, or production service is started.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../../client/www/js/controller.forecastctrl.js'), 'utf8');
const start = source.indexOf('function _diffTodayYesterday(current, yesterday) {');
const end = source.indexOf('\n        $scope.getTempUnit', start);
if (start === -1 || end === -1) throw new Error('Legacy comparison source markers missing');
module.exports = function (current, yesterday, unit) {
    const scope = {};
    const compare = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
        $scope: scope, Units: {getUnit: () => unit || 'C'},
        sprintf: (format, value) => format.replace('%s', value),
        $translate: () => ({then: success => {
            success({LOC_SAME_AS_YESTERDAY: 'same', LOC_THAN_YESTERDAY: '%s˚ than yesterday'});
            return {finally: run => run()};
        }})
    });
    compare(current, yesterday);
    return scope.diffTempStr;
};
