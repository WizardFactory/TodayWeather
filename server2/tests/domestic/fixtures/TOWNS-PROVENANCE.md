# S15b-4b2 town and KR rewrite oracle

Recorded 2026-10-16 with Node 16.20.2 and TZ=UTC against the legacy source in reviewed base `88448ddf` (identical at `ec32c73f`). `record_towns.js` extracts actual `GeoController.name2address` and `ControllerTown._findTown`, executes them unchanged in isolated VM contexts and records six name rewrites and five town outcomes. Provider parsing is explicitly stubbed at the parsed-address / convertGeocode boundaries.

The lifecycle probe additionally runs the actual `server/models/town.js` schema through Mongoose **5.1.2** constructor, save callback and `find().lean()` query execution. Its collection `insertOne` and `find` methods are memory adapters; Mongoose stays disconnected and no database operation occurs. `_findTown` appends and returns its original plain object independently of the model save callback. First acquisition and the same controller's next lookup therefore retain Kakao coordinate strings; constructor/storage/lean values are numbers. The actual legacy `ControllerTown24h.makeResult` runs against all three values: first and same-process return `next(TypeError)` (500), while the cold lean value produces a numeric `location` (200). This is a component response-contract probe, not a claim that the full legacy HTTP stack or MongoDB network was exercised.

All five source-file hashes are embedded. Runtime never reads legacy files. No network, `.env`, database or service startup occurs. The explicit `TW_MONGOOSE_MODULE` points at an existing offline Mongoose 5.1.2 dependency tree; it is a recorder input, not a runtime setting.

Reproduce from repository root:

```sh
TW_MONGOOSE_MODULE=/path/to/offline/node_modules/mongoose TZ=UTC /path/to/node-v16.20.2/bin/node server2/tests/domestic/fixtures/record_towns.js server2/tests/domestic/fixtures/towns-oracle.json.gz
```

`TW_REPO` can select the intended offline checkout. The recording's gzip mtime is zero. SHA-256: `02b26bfa0c7a68953187dfce6eb6286d41a44081d2f155e141eb4be45f0dea6d`.

Denominators stay separate: six remaps + five `_findTown` outcomes; three lifecycle phases and three `makeResult` phase probes. None is represented as a full S3-only v000903 assembly oracle case. Live provider API method evidence is reused separately from dated collector evidence; these boundary probes do not prove provider availability or quotas.
