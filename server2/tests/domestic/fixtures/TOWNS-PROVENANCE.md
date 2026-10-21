# Town and KR rewrite oracle

The current complete artifact was recorded twice on 2026-10-19 with Node **16.20.2**, TZ=UTC and Mongoose **5.1.2**, using the current legacy source in checkout `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1`. Both compressed outputs are byte-identical: SHA-256 `6cda47a8ee024772e56f68963b1cf0285999cfd9ad17cef786bf23ac8aa90413`. All five actual source-file hashes are embedded in `oracle.files`. The fixed VM clock is `2026-10-16T00:00:00.000Z`.

`server/test/offline/record-towns.js` is byte-identical to the original full54-line `record_towns.js` (SHA-256 `153be6de9cd56676fd4ddc8c0312894353af3d5557a59d6e7868020cd6516913`). It extracts actual `GeoController.name2address`, `ControllerTown._findTown` and `ControllerTown24h.makeResult` into explicit VM contexts. It records **six name rewrites and five town outcomes**, including outside-Korea and provider failure. Provider parsing is explicitly replaced at the parsed-address / convertGeocode boundaries; the full app/router/controller startup does not run.

The complete lifecycle probe executes the actual `server/models/town.js` schema through Mongoose5.1.2 constructor, save callback and `find().lean()` query. Only collection `insertOne` and `find` are memory adapters; Mongoose remains disconnected. It retains first, same-process and cold-lean documents and all three `makeResult` outputs. One memory collection write and readyState0 are recorded. The recorder's `networkWrites:0` field is an authored constant, not an independent transport measurement. The separately checked group-specific guard reports no violations and denies transport, DNS, UDP, child processes, worker threads and Mongoose connections for these executions.

## Current source-authoritative behavior

Merged legacy change `ef6cf7b7e3798b54f6119ef6ff28f4301078d9a6` normalizes newly geocoded **in-Korea** coordinates with `Number(lat)` and `Number(lon)` before saving, caching or returning the object. The first acquisition and same-process lookup now return numeric coordinates and `makeResult` status200 with numeric location, matching the cold-lean phase. The outside-Korea early return still retains the provider's string coordinates. Raw Kakao parser primitive types remain a separate provider-boundary contract.

The previous artifact, recorded against `88448ddf` (identical at `ec32c73f`), had SHA-256 `02b26bfa0c7a68953187dfce6eb6286d41a44081d2f155e141eb4be45f0dea6d`. Its original compressed bytes, both new outputs and full comparison are retained in task evidence. After removing only oracle source hashes/runtime metadata, **16 field/subtree paths change**: six in-Korea town coordinate types, four first/same-process lifecycle coordinate types, and six first/same-process response status/error/location fields. All six remaps, outside/provider-failure town cases, cold-lean document/response and lifecycle counters are unchanged. Root accepted the current merged legacy behavior as the target; the old hot TypeError/500 is historical evidence, not a current compatibility exception.

The selected `_findTown` function differs only by the Number assignments and their comment. Although the full controllerTown24h source hash also changed, the selected `makeResult` slice is byte-identical to the old recording. The full new fixture comes from actual legacy execution; it was not generated or adjusted from Rust output. Its replacement does not establish native parity until the separately recorded Rust Red/Green and native request checks complete.

## Guarded reproduction

Use the named launcher only within an explicitly authorized replay boundary. Supply the verified Node16.20.2 binary, isolated mongoose5.1.2 dependency prefix and installed-file map. No system/global module fallback or real service environment is required. First create a current hash-only fingerprint report, then choose a separate new ignored direct child of the checkout's `reports/` directory for each complete recording:

```sh
python3.11 server2/tools/golden/provenance.py --root "$CHECKOUT" --node "$PINNED_NODE" --out "$FINGERPRINT_OUTPUT"
python3.11 server2/tools/golden/replay_towns.py --record --root "$CHECKOUT" --node "$PINNED_NODE" --deps "$PINNED_MONGOOSE_PREFIX" --installed-manifest "$VERIFIED_INSTALLED_FILE_MAP" --source-report "$FINGERPRINT_OUTPUT/report.json" --out "$NEW_TOWNS_OUTPUT"
```

The provenance command can exit1 because other fixtures still have source drift; validate its complete report and fixed five current town source identities before replay. `--record` does not grant execution authority. The launcher verifies source/driver/guard/dependency identities, uses a narrow environment, admits one new output, bounds child time/streams, reaps the child, preserves raw receipts and reports `RECORDED_NOT_COMPARED`. Compare complete remaps/towns/lifecycle results before any disposition. The guard covers audited known APIs; it is not an OS or hostile-code VM sandbox claim. Runtime never imports or reads legacy files.

Denominators remain separate: six remaps, five `_findTown` outcomes, three lifecycle phases and three `makeResult` probes. None is a full S3-only v000903 assembly oracle, live provider/Mongo availability proof, quota measurement or production qualification. The other13 affected auxiliary fixtures remain unresolved in G1; this artifact refresh is not a whole-task PASS.

## Current-source whole-record renewal (build24, 2026-10-20)

Two separately guarded recordings per group produced identical complete document and gzip bytes. The adopted bytes are the second actual recording in full; no source field was patched into an old record. All 20 typed differences across towns, nation and four delivery groups are source metadata (2 + 2 + 4 × 4); body, status, headers, trace and ordering differences are zero in this corpus. Node is 16.20.2 (binary SHA256 `83325958463d59cb0b16433eefab0a03fd1ce7d565a27e0274f507b1f3839a6e`), TZ UTC.

The delivery `source.revision` value `a6fdf1f4d1f869d63c5310646003967571dac6e2` identifies the base commit. Execution also used candidate files, including untracked named recorder exports and existing G1 changes; the actual inputs are identified by per-file SHA256 in the records and guarded policy inventories. This is not a clean-checkout recording claim. Old fixture bytes and all capture/receipt/comparison histories are preserved in the local build24 evidence. Freshness and native acceptance are verified separately after adoption.

| Group | Preserved predecessor SHA256 | Adopted actual2 SHA256 |
| --- | --- | --- |
| towns | `6cda47a8ee024772e56f68963b1cf0285999cfd9ad17cef786bf23ac8aa90413` | `6e90364d7c3f3d8dc4f115e6b7af19d7eb9ba4008cd4e7a7304c6ff4f71cd945` |

Pinned dependency locks (npm lockfile format and exact direct versions retained):

- SHA256 `056c59c13b4c65c3aa945d1031afac0d5435aabfa78b91549c4efcb2babc88a8`, lockfileVersion 2; direct dependencies: `mongoose@5.1.2`.

Raw build24 receipts are local evidence, not a published CI or whole-G1 PASS. Remaining S02, world and widget qualification and original G1 gates stay open.
