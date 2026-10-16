# S17c offline nation oracle

`oracle.json` is a reusable fixture recorded by `server2/tools/nation_record.cjs` from
legacy sources at base `73290838` with Node **16.20.2**, UTC, Mongoose **5.1.2**, and
legacy async/Jade dependencies. Its `hash` map pins every source loaded directly.
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
