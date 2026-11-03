# S17c offline nation oracle

`oracle.json` is a reusable fixture recorded by `server2/tools/nation_record.cjs` from
legacy sources at base `73290838` with Node **16.20.2**, UTC, Mongoose **5.1.2**, and
async **2.6.2**, Jade **1.11.0**, and i18n **0.8.3** dependencies. Its `hash` map pins every source loaded directly.
The script runs the actual province saver after `airkoreaObservation.parseRows`, casts its
updates through the actual SidoArpltn model, and runs NationAir, observation evaluation,
query-default validation, pollutant recalculation, nation middleware, and production Jade
error templates. No provider, MongoDB, AWS, private `.env` or configuration is loaded.

City weather dependencies are deterministic doubles (`cityName`, `current.t1h=20`, two
removable city air branches). These recordings prove nation composition and error mapping,
not weather-provider parity. Weather assembly remains covered by the S15/S17a/S17b oracles.
The real loopback HTTP test exercises the full public Gateway/DirectRoutes envelope. The
loopback S3 tests publish raw provider-shaped records then construct entirely new AirInputs
instances to verify all seventeen province projections without providers. They also verify
combined `전남광주` is split with the station-list address, and late owned acquisition is
shared by twelve requests and used by the next request.

Public source code license: repository MIT license. Fixture station identities and provider
outputs are synthetic; no user coordinates, device tokens, credentials or database records
are present. Prior real-provider evidence is reused from the S15b-3a observation in
`docs/architecture/server2.md` (2026-10-14, `전국`, `numOfRows=1000`, 672 stations in one page).
No additional provider request was needed because S17c introduces no provider method.

QA1 adds three actual-legacy child-request boundary cases (16 scenarios total). The recorder
runs the actual app i18n configuration with locale-file updates disabled, then applies i18n
to the child header forwarded by the real nation route. Contract-sensitive child doubles echo
the received version and locale in their output. Uppercase `V000903` defaults children to
v000901; differing parent cookie/header and cookie-only requests do not forward the cookie.
The prior thirteen scenarios and their fifteen source hashes remain unchanged; the app
configuration source is the additional hash. DirectRoutes compares both child calls and
complete output bytes against these recordings.

## Current-source whole-record renewal (build24, 2026-10-20)

Two separately guarded recordings per group produced identical complete document and gzip bytes. The adopted bytes are the second actual recording in full; no source field was patched into an old record. All 20 typed differences across towns, nation and four delivery groups are source metadata (2 + 2 + 4 × 4); body, status, headers, trace and ordering differences are zero in this corpus. Node is 16.20.2 (binary SHA256 `83325958463d59cb0b16433eefab0a03fd1ce7d565a27e0274f507b1f3839a6e`), TZ UTC.

The delivery `source.revision` value `a6fdf1f4d1f869d63c5310646003967571dac6e2` identifies the base commit. Execution also used candidate files, including untracked named recorder exports and existing G1 changes; the actual inputs are identified by per-file SHA256 in the records and guarded policy inventories. This is not a clean-checkout recording claim. Old fixture bytes and all capture/receipt/comparison histories are preserved in the local build24 evidence. Freshness and native acceptance are verified separately after adoption.

| Group | Preserved predecessor SHA256 | Adopted actual2 SHA256 |
| --- | --- | --- |
| nation | `19b186ccf035ecc40fcb34063b8e92bce6d2795f64f209a89a8c74d1847cf3cc` | `ced3f9e1939a2e02ee9bef48b4ca1f10ca794959b48051efd9bffa5c3636caa3` |

Pinned dependency locks (npm lockfile format and exact direct versions retained):

- SHA256 `c34d3d5f2cf6290283c11ad82a53774c5ecf63a4f41550d491b03ee29d305b1e`, lockfileVersion 3; direct dependencies: `mongoose@5.1.2`, `async@2.6.2`, `jade@1.11.0`, `i18n@0.8.3`.

Raw build24 receipts are local evidence, not a published CI or whole-G1 PASS. Remaining S02, world and widget qualification and original G1 gates stay open.
