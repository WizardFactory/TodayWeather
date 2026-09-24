'use strict';

// Real dotenv in temporary server trees. Stop app startup at Express so no
// provider, database, scheduler or HTTP listener can run.
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');
var server = path.resolve(__dirname, '../..');
var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-env-test-'));
var fixture = path.join(temporary, 'server');
var count = 0;

function remove(dir) {
    fs.readdirSync(dir).forEach(function (name) {
        var file = path.join(dir, name);
        if (fs.lstatSync(file).isDirectory()) { remove(file); }
        else { fs.unlinkSync(file); }
    });
    fs.rmdirSync(dir);
}

function run(name, options) {
    options = options || {};
    var envFile = path.join(fixture, '.env');
    if (fs.existsSync(envFile)) {
        if (fs.statSync(envFile).isDirectory()) { fs.rmdirSync(envFile); }
        else { fs.unlinkSync(envFile); }
    }
    if (options.directory) { fs.mkdirSync(envFile); }
    else if (!options.missing) {
        fs.writeFileSync(envFile, options.contents || [
            "SERVER_MODE='gather'", 'DB_DATA_VERSION="2.0"',
            'PORT=4321', 'OPENSHIFT_NODEJS_PORT=4322',
            "DONGNAE_SECRET_KEYS='[\"dummy-a\",\"dummy-b\"]'",
            'DATA_GO_KR_TEST_NORMAL_KEY=synthetic-key', 'EMPTY_VALUE='
        ].join('\n'));
    }
    // Strip every production setting; copy only command/runtime essentials.
    var env = {PATH: process.env.PATH, NODE_PATH: path.dirname(path.dirname(require.resolve('dotenv/package.json')))};
    Object.keys(options.env || {}).forEach(function (key) { env[key] = options.env[key]; });
    env.TW_EXPECTED = JSON.stringify(options.expected || {mode: 'gather', version: '2.0', port: '4322'});
    env.TW_ERROR = options.error || '';
    env.TW_ENTRY = options.entry || 'app.js';
    env.TW_DENIED = options.denied ? '1' : '';
    var command = options.npm ? 'npm' : process.execPath;
    var args = options.npm ? ['start', '--silent'] : [path.join(fixture, 'probe.js')];
    var result = childProcess.spawnSync(command, args, {
        cwd: options.cwd || temporary, env: env, encoding: 'utf8', timeout: 15000
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, name + '\n' + result.stdout + result.stderr);
    assert.ok(result.stdout.indexOf('startup probe passed') >= 0, name);
    count += 1;
    console.log('PASS ' + name);
}

try {
    fs.mkdirSync(fixture);
    fs.mkdirSync(path.join(fixture, 'config'));
    fs.mkdirSync(path.join(fixture, 'bin'));
    ['app.js', 'bin/www', 'config/config.js', 'config/env.js'].forEach(function (relative) {
        if (fs.existsSync(path.join(server, relative))) {
            fs.copyFileSync(path.join(server, relative), path.join(fixture, relative));
        }
    });
    // Preload the probe while retaining the actual start command.
    var pkg = JSON.parse(fs.readFileSync(path.join(server, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({scripts: {start: pkg.scripts.start}}));
    fs.writeFileSync(path.join(temporary, '.env'), 'SERVER_MODE=wrong-cwd\nPORT=9999');
    fs.writeFileSync(path.join(fixture, 'probe.js'), [
        "if (process.env.TW_NPM_PROBE && require('path').basename(process.argv[1]) !== 'www') return;",
        "var assert = require('assert'), Module = require('module'), fs = require('fs');",
        "var original = Module._load, stop = {}, seen = false;",
        "var expected = JSON.parse(process.env.TW_EXPECTED);",
        "if (process.env.TW_DENIED) {",
        "  var read = fs.readFileSync;",
        "  fs.readFileSync = function (file) {",
        "    if (String(file) === require('path').join(__dirname, '.env')) {",
        "      var error = new Error('private-error-detail'); error.code = 'EACCES'; throw error;",
        "    } return read.apply(this, arguments);",
        "  };",
        "}",
        "Module._load = function (name) {",
        "  if (name === 'express') {",
        "    seen = true;",
        "    var config = require('./config/config');",
        "    assert.strictEqual(config.mode, expected.mode);",
        "    assert.strictEqual(config.db.version, expected.version);",
        "    assert.strictEqual(config.port, expected.port);",
        "    if (expected.mode === 'gather') {",
        "      assert.deepStrictEqual(JSON.parse(config.keyString.dongnae_forecast_keys), ['dummy-a', 'dummy-b']);",
        "      assert.strictEqual(config.keyString.test_normal, 'synthetic-key');",
        "      assert.strictEqual(process.env.EMPTY_VALUE, '');",
        "    }",
        "    if (expected.emptyMode) assert.strictEqual(process.env.SERVER_MODE, '');",
        "    if (expected.literal) assert.strictEqual(process.env.LITERAL, expected.literal);",
        "    throw stop;",
        "  }",
        "  return original.apply(this, arguments);",
        "};",
        "try { require('./' + process.env.TW_ENTRY); throw new Error('startup was not intercepted'); }",
        "catch (error) {",
        "  if (process.env.TW_ERROR) {",
        "    assert.strictEqual(seen, false);",
        "    assert.strictEqual(error.message, 'Unable to load server/.env (' + process.env.TW_ERROR + ')');",
        "  } else { if (error !== stop) throw error; assert.ok(seen); }",
        "}",
        "console.log('startup probe passed');",
        // npm preload must stop before Node runs bin/www a second time.
        "if (process.env.TW_NPM_PROBE) process.exit(0);"
    ].join('\n'));

    run('repository cwd, before first Express import');
    run('server cwd', {cwd: fixture});
    run('unrelated cwd', {cwd: os.tmpdir()});
    run('bin/www entrypoint', {entry: 'bin/www'});
    run('npm start entrypoint', {npm: true, cwd: fixture, entry: 'bin/www', env: {
        NODE_OPTIONS: '--require=' + path.join(fixture, 'probe.js'), TW_NPM_PROBE: '1'
    }});
    run('process environment wins', {env: {SERVER_MODE: 'service', DB_DATA_VERSION: '1.0', OPENSHIFT_NODEJS_PORT: '5555'},
        expected: {mode: 'service', version: '1.0', port: '5555'}});
    run('empty process value is preserved', {env: {SERVER_MODE: ''},
        expected: {mode: 'local', version: '2.0', port: '4322', emptyMode: true}});
    run('missing file keeps defaults', {missing: true, expected: {mode: 'local', version: '1.0', port: '3000'}});
    run('missing file keeps supplied environment', {missing: true, env: {SERVER_MODE: 'service', PORT: '4567'},
        expected: {mode: 'service', version: '1.0', port: '4567'}});
    run('dotenv 10 ignores non-assignment lines; keeps hash in values', {
        contents: '# comment\nnot an assignment\nSERVER_MODE=service\nLITERAL=hash#value',
        expected: {mode: 'service', version: '1.0', port: '3000', literal: 'hash#value'}});
    run('directory at .env stops startup', {directory: true, error: 'EISDIR'});
    run('permission error is sanitized', {denied: true, error: 'EACCES'});
    console.log(count + ' environment startup checks passed');
} finally {
    remove(temporary);
}
