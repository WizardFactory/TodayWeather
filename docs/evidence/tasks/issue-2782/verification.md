# Issue #2782 isolated verification (2026-10-16)

Baseline: `8daa43ad97f58e7bb1d712f7af12f02bfb2aec9b`. Source change: `controllerTown._findTown` converts newly admitted domestic `gCoord.lat/lon` to numbers after the unchanged Korea-area check and before cache/save/callback.

- Red: the added regression on the unmodified controller exits 1 with HTTP500 and `req.gCoord.lat.toFixed is not a function`.
- Green and post-refactor: Node16.20.2, actual Mongoose5.1.2 and actual Town schema pass first/hot/reloaded HTTP responses on v000901, v000902 and v000903. Driver adapters hold saves pending to prove responses do not wait for persistence. Precision is retained until legacy response rounding to `{lat: 37.566, long: 126.979}`.
- Retained behavior: existing numeric object identity with zero geocode/write calls; numeric provider results; grid and city areaNo fallback; empty list; geocode failure; invalid, empty, null, trailing-junk, infinite and out-of-area coordinates; save failure retaining usable cache.
- Separate functional smoke: Node16.20.2, actual Mongoose5.1.2 and temporary MongoDB4.4.29; real loopback HTTP Kakao fixture -> actual Kakao parser/grid conversion -> actual lookup -> actual Mongo save and lean reload -> actual formatter -> loopback HTTP. Nine HTTP200 responses share the rounded numeric location; one provider request; two persisted towns including the seed. Task-owned API, fixture server, Mongo and temporary data are cleaned up.
- Entire explicit `server/test/offline/run.js` suite passes on Node16.20.2, including the new regression. The broad legacy `npm test` and `npm run e2e` integrations are not run.
- Existing mobile request Archify JSON/HTML updated; showcase finalize passes artifact validation, delivery/provenance and browser checks. Visual-check passes light/dark at 1440x900 and 2048x1320; rendered capture inspected separately.

Reproduce with isolated dependencies (see the `town-geocode-node16` CI job), without starting the application:

```sh
NODE_PATH=/path/to/isolated/node_modules node server/test/offline/town-geocode-coordinates.test.js
NODE_PATH=/path/to/isolated/node_modules TW_MONGOD=/path/to/mongo4.4/mongod node server/test/offline/town-geocode-smoke.js
NODE_PATH=/path/to/isolated/node_modules TZ=UTC node server/test/offline/run.js
```

Dependencies: Mongoose5.1.2, async2.6.4, sprintf0.1.5, Express4.13.4, axios0.18.1 and xml2js0.4.23 for the focused tests/smoke. The offline suite uses the existing gather-offline dependency list. CI also exercises the regression in its Node22 offline suite. No test logs are uploaded; durable selected evidence stays in this document and commit-bound PR review/readiness comments. Raw local runs are ignored.

No production startup, request, provider call, database write, merge or deployment. Production incidence and deployment compatibility beyond these isolated fixtures remain unmeasured.
