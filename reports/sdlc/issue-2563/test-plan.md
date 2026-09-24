# Verification design
AC1: fresh subprocesses with temporary copies of app.js/bin/www/config, real dotenv; stop at intercepted New Relic import after asserting the effective config. Exercise repository, server and unrelated cwd plus npm start in a temporary package.
AC2: process values (including empty values), no file, dotenv-compatible malformed syntax, unreadable-file error (directory and injected EACCES) with no raw details.
AC3: git check-ignore for .env variants/example; local file byte equality and 0600 checked with no output values.
AC4: package engine inspection and Node 10 runtime if available; documentation links, Archify artifact/browser/visual checks.
AC5: focused test-first run; existing offline suite with isolated dependencies; distinct real bootstrap/config smoke using uploaded file, no app imports or external services; independent read-only verification.
Expected Red: config at first New Relic import has local instead of gather before implementation. Setup errors do not count as Red.
Cleanup: scratch test trees removed; uploaded file remains ignored. No full legacy npm test (external provider/DB integrations).
