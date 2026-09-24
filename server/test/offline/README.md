# Gather reconciliation tests

All provider fixtures are synthetic. These tests load real exported functions with explicit VM dependency injection before evaluation. HTTP, DNS initialization, logging, model methods and timers cannot access production; undeclared dependencies/timers fail immediately. No `app.js`, configuration file, `/gather/*` route or Mongo initialization is loaded.

Use an isolated harness instead of installing the whole legacy application:

```sh
npm install --prefix /tmp/issue-2555-harness --ignore-scripts --no-audit --no-fund --package-lock=false mocha@2.5.3 xml2js@0.4.23 async@2.6.4
NODE_PATH=/tmp/issue-2555-harness/node_modules /tmp/issue-2555-harness/node_modules/.bin/mocha server/test/offline/gather-code-drift.test.js
NODE_PATH=/tmp/issue-2555-harness/node_modules node server/test/offline/gather-smoke.js
```

Commands run from the repository root; dependency installation needs package-registry access, but test execution needs no network. Tested with Node v22.22.2/npm 10.9.7. Mocha 2.5.3 is within the repository's legacy range; no application dependency tree changes are made.

The separate smoke integrates real XML parsing, requestData/events and the short storage controller's save/read functions through synthetic HTTP and in-memory model adapters. It verifies timestamps, coordinates, exact values and no write on failure. It is not a live provider/DB/mobile test.

The legacy 24h consumer characterization deliberately exposes its adjacent-record quantity split. Passing means the existing assumption is documented; it does not validate that split for hourly PCP/SNO. See [period limitations and full disposition](../../../docs/architecture/gather-source-reconciliation.md).
