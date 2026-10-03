'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function handler() {
    const source = fs.readFileSync(path.join(root, 'www/js/controller.tabctrl.js'), 'utf8');
    const match = source.match(/\$scope\.showPollenInfo = function\(day, event\) \{[\s\S]*?\n        \};/);
    assert.ok(match, 'shared TabCtrl must expose pollen popup');
    const calls = [];
    let destroyed = 0;
    const scope = {$new: () => ({$destroy: () => destroyed++})};
    const popup = {alert(options) {calls.push(options); return {finally(fn) {fn();}};}};
    vm.runInNewContext(match[0], {$scope: scope, $ionicPopup: popup,
        $translate: {instant: key => key}});
    return {show: scope.showPollenInfo, calls, destroyed: () => destroyed};
}
test('popup lists available spring/autumn/low grades and releases its scope', () => {
    for (const [day, labels] of [
        [{pollenGrade: 2, flowerWoodyGrade: 2, flowerWoodyStr: 'High', flowerPineGrade: 1, flowerPineStr: 'Normal'}, ['LOC_POLLEN_OAK', 'LOC_POLLEN_PINE']],
        [{pollenGrade: 1, flowerWeedsGrade: 1, flowerWeedsStr: 'Normal'}, ['LOC_POLLEN_WEEDS']],
        [{pollenGrade: 0, flowerWeedsGrade: 0, flowerWeedsStr: 'Low'}, ['LOC_POLLEN_WEEDS']]
    ]) {
        const h = handler(); h.show(day);
        assert.equal(h.calls.length, 1);
        assert.deepEqual(Array.from(h.calls[0].scope.pollenTypes, row => row.labelKey), labels);
        assert.equal(h.calls[0].title, 'LOC_POLLEN_RISK');
        assert.equal(h.calls[0].okText, 'LOC_CLOSE');
        assert.equal(h.destroyed(), 1);
        assert.match(h.calls[0].template, /ng-repeat/);
    }
});
test('missing pollen cannot open a popup; both templates use a button', () => {
    const h = handler(); h.show({}); h.show(undefined);
    assert.equal(h.calls.length, 0);
    for (const name of ['tab-forecast', 'ta-tab-weather']) {
        const s = fs.readFileSync(path.join(root, 'www/templates', name + '.html'), 'utf8');
        assert.match(s, /ng-click="showPollenInfo\(currentWeather.today\)"/);
        assert.match(s, /<button[^>]*class="[^"]*pollen-risk/);
        assert.ok(!s.includes('<details'));
    }
});
test('Enter/Space open the popup once and other keys leave it closed', () => {
    for (const keyCode of [13, 32, 27]) {
        const h = handler(); let prevented = 0;
        h.show({pollenGrade: 0, flowerWeedsGrade: 0, flowerWeedsStr: 'Low'},
            {keyCode, preventDefault() {prevented++;}});
        assert.equal(h.calls.length, keyCode === 27 ? 0 : 1);
        assert.equal(prevented, keyCode === 27 ? 0 : 1);
    }
});
test('each available type carries its own description and grade-specific precautions in every locale', () => {
    const h = handler(); h.show({pollenGrade: 3, flowerWoodyGrade: 3, flowerWoodyStr: 'Very high',
        flowerPineGrade: 1, flowerPineStr: 'Normal'});
    assert.deepEqual(Array.from(h.calls[0].scope.pollenTypes, row => [row.infoKey, row.adviceKey]),
        [['LOC_POLLEN_OAK_INFO', 'LOC_POLLEN_ADVICE_3'], ['LOC_POLLEN_PINE_INFO', 'LOC_POLLEN_ADVICE_1']]);
    for (const folder of ['client/www/locales', 'server/locales']) {
        for (const lang of ['de','en','ja','ko','zh-CN','zh-TW']) {
            const data = JSON.parse(fs.readFileSync(path.resolve(root, '..', folder, lang + '.json')));
            for (const key of ['LOC_POLLEN_OAK_INFO','LOC_POLLEN_PINE_INFO','LOC_POLLEN_WEEDS_INFO',
                'LOC_POLLEN_ADVICE_0','LOC_POLLEN_ADVICE_1','LOC_POLLEN_ADVICE_2','LOC_POLLEN_ADVICE_3','LOC_POLLEN_SOURCE']) {
                assert.ok(data[key], folder + '/' + lang + ' missing ' + key);
            }
        }
    }
});
