'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function fixture(project) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-pods-target-'));
    fs.writeFileSync(path.join(dir, 'config.xml'), '<widget><platform name="ios"><preference name="deployment-target" value="15.0" /></platform></widget>');
    const file = path.join(dir, 'platforms/ios/Pods/Pods.xcodeproj/project.pbxproj');
    if (project !== undefined) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, project);
    }
    return { dir, file };
}

test('config.xml registers the Pods deployment target hook', () => {
    const xml = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
    assert.match(xml, /<hook type="after_prepare" src="scripts\/ios-pods-deployment-target\.js" \/>/);
});

test('iOS preparation raises only Pods targets below the app minimum', () => {
    const hook = require('../scripts/ios-pods-deployment-target.js');
    const { dir, file } = fixture('A IPHONEOS_DEPLOYMENT_TARGET = 12.0;\nB IPHONEOS_DEPLOYMENT_TARGET = 9.3;\nC IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nD IPHONEOS_DEPLOYMENT_TARGET = 16.4;\n');
    try {
        hook({ opts: { platforms: ['ios'], projectRoot: dir } });
        const first = fs.readFileSync(file, 'utf8');
        assert.equal(first, 'A IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nB IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nC IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nD IPHONEOS_DEPLOYMENT_TARGET = 16.4;\n');
        hook({ opts: { platforms: ['ios'], projectRoot: dir } });
        assert.equal(fs.readFileSync(file, 'utf8'), first);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the hook skips other platforms and a project without Pods', () => {
    const hook = require('../scripts/ios-pods-deployment-target.js');
    const text = 'A IPHONEOS_DEPLOYMENT_TARGET = 12.0;\n';
    const { dir, file } = fixture(text);
    const empty = fixture();
    try {
        hook({ opts: { platforms: ['android'], projectRoot: dir } });
        assert.equal(fs.readFileSync(file, 'utf8'), text);
        hook({ opts: { platforms: ['ios'], projectRoot: empty.dir } });
        assert.equal(fs.existsSync(empty.file), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(empty.dir, { recursive: true, force: true });
    }
});

test('the hook fails when the app deployment target is missing', () => {
    const hook = require('../scripts/ios-pods-deployment-target.js');
    const { dir } = fixture('A IPHONEOS_DEPLOYMENT_TARGET = 12.0;\n');
    fs.writeFileSync(path.join(dir, 'config.xml'), '<widget></widget>');
    try {
        assert.throws(() => hook({ opts: { platforms: ['ios'], projectRoot: dir } }), /deployment-target/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the diagnostic plugin install script is approved at the pinned version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = pkg.devDependencies['cordova.plugins.diagnostic'];
    assert.equal(pkg.allowScripts[`cordova.plugins.diagnostic@${version}`], true);
});
