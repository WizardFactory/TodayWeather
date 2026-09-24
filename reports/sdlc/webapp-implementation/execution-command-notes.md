# Exact command notes

The correction browser Red command used:

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome npm run test:e2e -- --grep 'immediate search|late geolocation|corrupt offline'
```

`test-results.json` abbreviates this selection as `immediate-search-or-geolocation-or-corruption`; the npm/Playwright invocation and all four intended assertion failures are retained in `correction-red-browser.log`. This is a command-label clarification, not a different execution.

Production/browser correction commands used the same installed Chromium path. The injected provider in `npm test` and the explicit synthetic data in `npm run test:e2e` are isolated from live providers. The earlier `live-smoke.json` separately records actual public reads; it is reused as earlier integration evidence, not relabelled as a final-candidate test run.
