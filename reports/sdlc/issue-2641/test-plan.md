# Test design
AC1: inspect template/state/menu and real Angular state registry/settings DOM. Billing plugin globals present/absent must not change menu.
AC2: actual app bootstrap and start/guide/settings navigation with local fixture API isolation; fail on Angular errors or any receipt/store request.
AC3: recursive maintained source/build reference audit, deleted files absent, config generator excludes imported paid flags; unrelated inappbrowser stays installed.
AC4: execute real TwAds factory with native adapter doubles to assert ready enables ordinary ads, queued hide remains hidden, show/hide works, stale local purchase/ad records cannot disable ads. Storage no longer reads/migrates payment keys.
Regression prerequisite Node; no network, cleanup none. Smoke prerequisite local web dependencies, Chromium and Playwright. Serve client/www on loopback, deny non-local network; close server/browser in finally. Capture menu screenshot and JSON outcome. Native device ads, live provider calls and store payments are not run.
Intended Red: old app exposes purchase menu/state and persisted ad exemption. Green: all requirements pass. Additional smoke is browser integration, not a renamed unit test.
