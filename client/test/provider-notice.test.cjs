'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function settings(language) {
    let controller;
    const scope = {};
    let popup;
    const translations = JSON.parse(fs.readFileSync(path.join(__dirname, '../www/locales', (language || 'en') + '.json'), 'utf8'));
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../www/js/controller.settingctrl.js'), 'utf8'), {
        angular: {module: () => ({controller: (_, fn) => { controller = fn; }})},
        ionic: {Platform: {isIOS: () => false, isAndroid: () => true}},
        console
    });
    controller(scope, {title: 'LOC_TODAY_WEATHER'}, {language}, {},
        () => Promise.resolve(translations), {},
        {alert: (options) => { popup = options; return Promise.resolve(); }}, {}, {}, {});
    return {scope, translations, get popup() { return popup; }};
}

const locales = fs.readdirSync(path.join(__dirname, '../www/locales'))
    .filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
for (const language of locales) {
    test(`source and provisional-data notice can be opened in ${language}`, async () => {
        const state = settings(language);
        assert.equal(state.scope.showAbout(), true);
        state.scope.clickMenu('openInfo');
        await new Promise(setImmediate);
        for (const key of ['LOC_KOREA_METEOROLOGICAL_ADMINISTRATION', 'LOC_KOREA_ENVIRONMENT_CORPORATION',
            'LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS']) {
            assert.ok(state.popup.template.includes(state.translations[key]), key);
        }
    });
}

test('source menu visibility does not require a detected language', () => {
    assert.equal(settings(undefined).scope.showAbout(), true);
});
