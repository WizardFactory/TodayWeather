// Repository-managed wiring: never run upstream automatic init/reconciliation.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');
exports.guard = function(entry) {
  // Node ESM resolves symlinks before the loader sees a URL. Match that identity.
  const dist = path.dirname(path.dirname(fs.realpathSync(entry)));
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
