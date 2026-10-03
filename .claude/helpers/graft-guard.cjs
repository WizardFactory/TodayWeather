// Repository-managed wiring: never run upstream automatic init/reconciliation.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');
exports.guard = function(entry) {
  const dist = path.dirname(path.dirname(entry));
  const pkg = JSON.parse(fs.readFileSync(path.join(dist, '..', 'package.json'), 'utf8'));
  if (pkg.name !== '@nanonets/graft' || pkg.version !== '0.21.1' || typeof register !== 'function') {
    throw new Error('Repository adapters require @nanonets/graft 0.21.1 and Node 20.6+; review upgrades explicitly.');
  }
  process.env.DO_NOT_TRACK = '1';
  register(pathToFileURL(path.join(__dirname, 'graft-upkeep-loader.mjs')), {
    parentURL: pathToFileURL(__filename),
    data: { upkeep: pathToFileURL(path.join(dist, 'upkeep-run.js')).href }
  });
};
